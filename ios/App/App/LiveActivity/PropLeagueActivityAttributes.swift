import Foundation

#if canImport(ActivityKit)
import ActivityKit

/// The one Live Activity type both kinds share ("lineup" countdown and "score" matchup).
///
/// This file is compiled into BOTH the app and the PropLeagueLiveActivity extension. Its property
/// names are the JSON keys the server sends (supabase/functions/live-activities), so renaming
/// anything here without changing the server makes the device silently ignore pushes.
@available(iOS 16.1, *)
struct PropLeagueActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// lineup: "open" | "ready" | "locked".  score: "live" | "final".
        var phase: String
        var picksIn: Int
        var totalSlots: Int
        var unspent: Double
        /// Short line under the countdown, e.g. "Empty: QB, 2 WR".
        var hint: String
        var myScore: Double
        var oppScore: Double
        var picksAlive: Int
        var picksSettled: Int
        /// Weekly W-L-P record and picks in a game that is on right now, per side. Optional so a push
        /// from an older server (without them) still decodes.
        var myWon: Int?
        var myLost: Int?
        var myPush: Int?
        var myLive: Int?
        var oppWon: Int?
        var oppLost: Int?
        var oppPush: Int?
        var oppLive: Int?
        /// My win probability, 0 to 1. Nil when the opponent's picks are still hidden.
        var winProb: Double?
        /// The loss that counts as full red when the person uses scaled P/L colors.
        var lossRef: Double?
        /// My lineup slots, in order, for the card's left/right scroller.
        var slots: [SlotLine]?
        /// Bumped locally to force a redraw (the scroller moved, a setting changed). Never sent by the server.
        var nudge: Int?
        /// How many leagues have a live score activity right now; the island shows a switch button above 1.
        var liveLeagues: Int?
        /// True when this league is the person's favorite: a small star sits by the league logo.
        var favorite: Bool?
    }

    var kind: String
    var leagueId: String
    var teamId: String
    var week: String
    var windowKey: String
    var leagueName: String
    /// "Thursday Night", "Sunday", ...
    var title: String
    /// Unix seconds of the first kickoff this activity is about.
    var kickoff: Double

    /// League logo. Optional so a push from an older server (without these) still decodes.
    var leagueColor: String?
    var leagueLogoMode: String?
    var leagueEmoji: String?
    var leagueLogoUrl: String?

    var myAbbrev: String
    var myColor: String
    var myLogoMode: String
    var myEmoji: String
    var myLogoUrl: String

    var oppTeamId: String
    var oppAbbrev: String
    var oppColor: String
    var oppLogoMode: String
    var oppEmoji: String
    var oppLogoUrl: String
}
#endif


/// One lineup slot on the card's scroller. `status`: pending, live, won, lost, push or empty.
struct SlotLine: Codable, Hashable {
    var pos: String
    var name: String
    var line: String
    var stake: Double
    var status: String
}

/// Small settings the app and the widget both read, kept in the App Group.
enum SharedPrefs {
    static let groupId = "group.com.propleague.app"
    private static var defaults: UserDefaults? { UserDefaults(suiteName: groupId) }

    /// "classic" (any loss is red) or "scaled" (a loss shades yellow to red by size), the app's P/L color setting.
    static var plColorScale: String {
        get { defaults?.string(forKey: "plColorScale") ?? "classic" }
        set { defaults?.set(newValue, forKey: "plColorScale") }
    }

    /// Where Supabase is and which device this is, saved by the app so a Live Activity button (which
    /// can run with no web view and no signed-in session) can tell the server what the person chose.
    static var supabaseUrl: String? {
        get { defaults?.string(forKey: "supabaseUrl") }
        set { defaults?.set(newValue, forKey: "supabaseUrl") }
    }
    static var anonKey: String? {
        get { defaults?.string(forKey: "anonKey") }
        set { defaults?.set(newValue, forKey: "anonKey") }
    }
    static var startToken: String? {
        get { defaults?.string(forKey: "startToken") }
        set { defaults?.set(newValue, forKey: "startToken") }
    }

    /// Whether each activity's lineup panel is open on every slot. Collapsed by default.
    static func lineupExpanded(_ activityId: String) -> Bool {
        defaults?.bool(forKey: "lineupOpen.\(activityId)") ?? false
    }

    static func toggleLineupExpanded(_ activityId: String) {
        defaults?.set(!lineupExpanded(activityId), forKey: "lineupOpen.\(activityId)")
    }
}

#if canImport(AppIntents)
import AppIntents
import ActivityKit

/// The lineup panel's chevron: open or close the full slot grid. Compiled into BOTH the app and the
/// widget extension (this file is in both targets), which iOS needs for a button on a Live Activity
/// to run an intent.
@available(iOS 17.0, *)
struct ToggleLineupExpandedIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Show lineup"

    @Parameter(title: "Activity") var activityId: String

    init() {}

    init(activityId: String) {
        self.activityId = activityId
    }

    func perform() async throws -> some IntentResult {
        SharedPrefs.toggleLineupExpanded(activityId)
        // Bump a counter so the card redraws and reads the new state.
        for activity in Activity<PropLeagueActivityAttributes>.activities where activity.id == activityId {
            var state = activity.content.state
            state.nudge = (state.nudge ?? 0) &+ 1
            await activity.update(ActivityContent(state: state, staleDate: activity.content.staleDate))
        }
        return .result()
    }
}

/// The island's switch button: brings the next league's matchup into the Dynamic Island. iOS shows
/// one activity per app there, the one with the highest relevance score, so this gives the next
/// score activity the top score (and the rest a low one), then tells the server so later pushes keep it.
@available(iOS 17.0, *)
struct SwitchLeagueIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Switch league"

    init() {}

    func perform() async throws -> some IntentResult {
        let scores = Activity<PropLeagueActivityAttributes>.activities
            .filter { $0.attributes.kind == "score" && $0.activityState == .active }
            .sorted { ($0.attributes.leagueName, $0.id) < ($1.attributes.leagueName, $1.id) }
        guard scores.count > 1, let top = scores.map({ $0.content.relevanceScore }).max() else { return .result() }
        let current = scores.firstIndex { $0.content.relevanceScore == top } ?? 0
        let next = scores[(current + 1) % scores.count]

        for activity in scores {
            let content = activity.content
            await activity.update(ActivityContent(
                state: content.state,
                staleDate: content.staleDate,
                relevanceScore: activity.id == next.id ? 100 : 10
            ))
        }

        // Remember the choice on the server (best effort), so its next push does not undo it.
        if let base = SharedPrefs.supabaseUrl, let key = SharedPrefs.anonKey, let token = SharedPrefs.startToken,
           let url = URL(string: base + "/rest/v1/rpc/set_live_activity_front_by_start_token") {
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.timeoutInterval = 8
            request.setValue(key, forHTTPHeaderField: "apikey")
            request.setValue("Bearer " + key, forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: ["p_start_token": token, "p_activity_id": next.id])
            _ = try? await URLSession.shared.data(for: request)
        }
        return .result()
    }
}

#endif
