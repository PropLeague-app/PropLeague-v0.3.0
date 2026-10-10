import Foundation
import UIKit

#if canImport(ActivityKit)
import ActivityKit

/// Everything native about the Live Activities: watching for activities and tokens (including the
/// background launch iOS does after the server starts one), registering those tokens with
/// Supabase, and starting, updating and ending activities from the plan the app gets from the
/// server (see supabase/functions/live-activities, mode "plan").
///
/// Activities only exist on iOS 16.2 and later. The app still installs and runs on older iOS; every
/// entry point is behind an availability check, and older devices simply get the normal pushes.
/// One background task id, handed out once (see register(activity:pushToken:)): whichever of "work finished" and
/// "iOS says time is up" comes first ends the task, and the other finds nothing to end. If iOS
/// expires it before the id is stored, the id is stored afterwards and the normal path ends it.
private final class BackgroundTaskBox: @unchecked Sendable {
    private let lock = NSLock()
    private var id: UIBackgroundTaskIdentifier = .invalid

    func set(_ newId: UIBackgroundTaskIdentifier) {
        lock.lock()
        id = newId
        lock.unlock()
    }

    func take() -> UIBackgroundTaskIdentifier? {
        lock.lock()
        defer { lock.unlock() }
        guard id != .invalid else { return nil }
        let taken = id
        id = .invalid
        return taken
    }
}

@available(iOS 16.2, *)
final class LiveActivityManager {
    static let shared = LiveActivityManager()

    /// Set by the Capacitor plugin once the web view is up, so tokens can be handed to the app.
    weak var plugin: LiveActivityPlugin?

    private enum Keys {
        static let startToken = "la.startToken"
        static let supabaseUrl = "la.supabaseUrl"
        static let anonKey = "la.anonKey"
    }

    private var started = false
    private var observed = Set<String>()
    private let lock = NSLock()

    // MARK: Observing

    /// Call once at launch (AppDelegate). Also what makes a background launch useful: when the
    /// server starts an activity while the app is closed, iOS launches the app briefly and these
    /// loops are how we learn the new activity's push token.
    func startObserving() {
        lock.lock()
        if started { lock.unlock(); return }
        started = true
        lock.unlock()

        if #available(iOS 17.2, *) {
            Task {
                for await data in Activity<PropLeagueActivityAttributes>.pushToStartTokenUpdates {
                    let token = Self.hex(data)
                    UserDefaults.standard.set(token, forKey: Keys.startToken)
                    SharedPrefs.startToken = token
                    await MainActor.run { self.plugin?.notifyListeners("startToken", data: ["token": token]) }
                }
            }
        }

        Task {
            for await activity in Activity<PropLeagueActivityAttributes>.activityUpdates {
                self.observe(activity)
            }
        }
        for activity in Activity<PropLeagueActivityAttributes>.activities { observe(activity) }
    }

    private func observe(_ activity: Activity<PropLeagueActivityAttributes>) {
        lock.lock()
        let isNew = observed.insert(activity.id).inserted
        lock.unlock()
        guard isNew else { return }

        Task {
            for await tokenData in activity.pushTokenUpdates {
                await self.register(activity: activity, pushToken: Self.hex(tokenData))
            }
        }
        // Logos: a widget cannot fetch them, so save them into the shared folder, then redraw.
        Task {
            let attrs = activity.attributes
            if await LogoCache.prefetch([attrs.myLogoUrl, attrs.oppLogoUrl, attrs.leagueLogoUrl ?? ""]) {
                await activity.update(ActivityContent(state: activity.content.state, staleDate: activity.content.staleDate))
            }
        }
    }

    // MARK: Registering tokens

    func configure(supabaseUrl: String, anonKey: String) {
        UserDefaults.standard.set(supabaseUrl, forKey: Keys.supabaseUrl)
        UserDefaults.standard.set(anonKey, forKey: Keys.anonKey)
        SharedPrefs.supabaseUrl = supabaseUrl
        SharedPrefs.anonKey = anonKey
    }

    var startToken: String? { UserDefaults.standard.string(forKey: Keys.startToken) }

    private func register(activity: Activity<PropLeagueActivityAttributes>, pushToken: String) async {
        let a = activity.attributes
        let payload: [String: Any] = [
            "activityId": activity.id,
            "pushToken": pushToken,
            "leagueId": a.leagueId,
            "teamId": a.teamId,
            "week": a.week,
            "kind": a.kind,
            "windowKey": a.windowKey,
        ]

        // With a push-to-start token and the Supabase address saved, register straight from native
        // code: this is the only way that works in the background launch, when the web view (and
        // so the signed-in session) is not running. The start token identifies the device.
        if let start = startToken,
           let base = UserDefaults.standard.string(forKey: Keys.supabaseUrl),
           let key = UserDefaults.standard.string(forKey: Keys.anonKey),
           let url = URL(string: base + "/rest/v1/rpc/register_live_activity_by_start_token") {
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue(key, forHTTPHeaderField: "apikey")
            request.setValue("Bearer " + key, forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let body: [String: Any] = [
                "p_start_token": start,
                "p_activity_id": activity.id,
                "p_push_token": pushToken,
                "p_league_id": a.leagueId,
                "p_team_id": a.teamId,
                "p_week": a.week,
                "p_kind": a.kind,
                "p_window_key": a.windowKey,
            ]
            request.httpBody = try? JSONSerialization.data(withJSONObject: body)

            // The task id lives in a small locked box instead of a captured `var` (that was the
            // "mutated after capture" warning), and the box hands it out once, so the task is ended
            // exactly once whether the request finishes or iOS's expiration handler fires first.
            let bgTask = BackgroundTaskBox()
            let taskId = await UIApplication.shared.beginBackgroundTask(withName: "register-live-activity") {
                if let id = bgTask.take() { UIApplication.shared.endBackgroundTask(id) }
            }
            bgTask.set(taskId)
            let ok: Bool
            if let (_, response) = try? await URLSession.shared.data(for: request), let http = response as? HTTPURLResponse {
                ok = (200..<300).contains(http.statusCode)
            } else {
                ok = false
            }
            if let id = bgTask.take() { await UIApplication.shared.endBackgroundTask(id) }
            if ok { return }
        }

        // Otherwise hand it to the web app, which registers it with the signed-in session.
        await MainActor.run { self.plugin?.notifyListeners("activityToken", data: payload) }
    }

    // MARK: Plan from the server

    struct PlanItem {
        let kind: String
        let ending: Bool
        let staleDate: Date?
        let relevance: Double
        let attributes: PropLeagueActivityAttributes
        let state: PropLeagueActivityAttributes.ContentState
    }

    /// Makes what is on screen match the plan: start what is missing, update what is showing, end
    /// what is finished, and close anything the plan no longer mentions.
    func sync(_ items: [PlanItem]) async {
        let existing = Activity<PropLeagueActivityAttributes>.activities
        func matches(_ a: PropLeagueActivityAttributes, _ b: PropLeagueActivityAttributes) -> Bool {
            a.leagueId == b.leagueId && a.week == b.week && a.kind == b.kind && a.windowKey == b.windowKey
        }

        var kept = [String]()
        for item in items {
            let current = existing.first { matches($0.attributes, item.attributes) }
            if item.ending {
                if let current = current {
                    kept.append(current.id)
                    let closing = ActivityContent(state: item.state, staleDate: nil)
                    let linger: TimeInterval = item.kind == "score" ? 30 * 60 : (item.state.phase == "ready" ? 90 : 30)
                    await current.end(closing, dismissalPolicy: .after(Date().addingTimeInterval(linger)))
                }
                continue
            }
            let content = ActivityContent(state: item.state, staleDate: item.staleDate, relevanceScore: item.relevance)
            if let current = current {
                kept.append(current.id)
                await current.update(content)
            } else if ActivityAuthorizationInfo().areActivitiesEnabled {
                // Save the logos first so the very first draw already has them.
                let at = item.attributes
                _ = await LogoCache.prefetch([at.myLogoUrl, at.oppLogoUrl, at.leagueLogoUrl ?? ""])
                do {
                    let created = try Activity<PropLeagueActivityAttributes>.request(attributes: item.attributes, content: content, pushType: .token)
                    kept.append(created.id)
                    observe(created)
                } catch {
                    // Too many activities already, or the user turned them off: nothing to do.
                }
            }
        }
        for activity in existing where !kept.contains(activity.id) {
            await activity.end(nil, dismissalPolicy: .immediate)
        }
    }

    /// Redraws every showing activity (same content, one counter bumped), e.g. after a color setting
    /// changed.
    func nudgeAll() async {
        for activity in Activity<PropLeagueActivityAttributes>.activities {
            var state = activity.content.state
            state.nudge = (state.nudge ?? 0) &+ 1
            await activity.update(ActivityContent(state: state, staleDate: activity.content.staleDate))
        }
    }

    // MARK: Helpers

    static func hex(_ data: Data) -> String { data.map { String(format: "%02x", $0) }.joined() }
}
#endif
