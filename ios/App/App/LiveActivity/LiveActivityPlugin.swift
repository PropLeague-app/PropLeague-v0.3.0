import Foundation
import Capacitor

#if canImport(ActivityKit)
import ActivityKit
#endif

/// A `propleague://` URL from a tapped Live Activity card (lock screen or Dynamic Island), held
/// until the web view is listening. SceneDelegate drops it in here, on a cold launch and while the
/// app is already running; LiveActivityPlugin hands it to JS, which turns it into a route
/// (src/services/pushRoute.ts) and moves to that league's screen.
final class DeepLinkInbox {
    static let shared = DeepLinkInbox()
    private let lock = NSLock()
    private var pending: String?
    private var deliver: ((String) -> Void)?

    func receive(_ url: URL) {
        guard url.scheme?.lowercased() == "propleague" else { return }
        let raw = url.absoluteString
        lock.lock()
        let fn = deliver
        if fn == nil { pending = raw }
        lock.unlock()
        if let fn { DispatchQueue.main.async { fn(raw) } }
    }

    /// Set once the plugin loads. Anything parked before that is flushed by `take()`.
    func setDeliver(_ fn: @escaping (String) -> Void) {
        lock.lock()
        deliver = fn
        lock.unlock()
    }

    /// The parked link, cleared as it is read so a tap is only followed once.
    func take() -> String? {
        lock.lock()
        let v = pending
        pending = nil
        lock.unlock()
        return v
    }
}

/// The web app's door to the Live Activities (JS name "LiveActivity", see
/// src/services/liveActivities.ts). Registered in PropLeagueBridgeViewController.
@objc(LiveActivityPlugin)
public class LiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivityPlugin"
    public let jsName = "LiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "configure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sync", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setPlColorScale", returnType: CAPPluginReturnPromise),
    ]

    public override func load() {
        // A tapped card. Retained until JS adds the listener, so a tap that cold launches the app
        // still lands in the right place once sign-in and league loading are done.
        DeepLinkInbox.shared.setDeliver { [weak self] raw in
            self?.notifyListeners("openUrl", data: ["url": raw], retainUntilConsumed: true)
        }
        if let parked = DeepLinkInbox.shared.take() {
            notifyListeners("openUrl", data: ["url": parked], retainUntilConsumed: true)
        }
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            LiveActivityManager.shared.plugin = self
        }
        #endif
    }

    /// { supported, enabled, startToken? }  supported = iOS 16.2+, enabled = the user has not
    /// switched Live Activities off for the app in Settings.
    @objc func getStatus(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            var result: [String: Any] = [
                "supported": true,
                "enabled": ActivityAuthorizationInfo().areActivitiesEnabled,
            ]
            if let token = LiveActivityManager.shared.startToken { result["startToken"] = token }
            call.resolve(result)
            return
        }
        #endif
        call.resolve(["supported": false, "enabled": false])
    }

    /// Saves the Supabase address so a background launch (after the server starts an activity)
    /// can register its push token without the web view.
    @objc func configure(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            if let url = call.getString("supabaseUrl"), let key = call.getString("anonKey") {
                LiveActivityManager.shared.configure(supabaseUrl: url, anonKey: key)
            }
        }
        #endif
        call.resolve()
    }

    /// "classic" or "scaled": which P/L colors the person chose in the app. Saved where the widget can
    /// read it, then every showing activity is nudged so it redraws in the new colors.
    @objc func setPlColorScale(_ call: CAPPluginCall) {
        let scale = call.getString("scale") == "scaled" ? "scaled" : "classic"
        let changed = SharedPrefs.plColorScale != scale
        SharedPrefs.plColorScale = scale
        #if canImport(ActivityKit)
        if changed, #available(iOS 16.2, *) {
            Task { await LiveActivityManager.shared.nudgeAll() }
        }
        #endif
        call.resolve()
    }

    /// items: [{ kind, ending, staleDate?, attributesJson, stateJson }] straight from the server plan.
    @objc func sync(_ call: CAPPluginCall) {
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            let raw = call.getArray("items", JSObject.self) ?? []
            let decoder = JSONDecoder()
            var items = [LiveActivityManager.PlanItem]()
            for entry in raw {
                guard
                    let attrsJson = entry["attributesJson"] as? String,
                    let stateJson = entry["stateJson"] as? String,
                    let attrs = try? decoder.decode(PropLeagueActivityAttributes.self, from: Data(attrsJson.utf8)),
                    let state = try? decoder.decode(PropLeagueActivityAttributes.ContentState.self, from: Data(stateJson.utf8))
                else { continue }
                var stale: Date? = nil
                if let s = entry["staleDate"] as? Double { stale = Date(timeIntervalSince1970: s) }
                else if let s = entry["staleDate"] as? Int { stale = Date(timeIntervalSince1970: Double(s)) }
                let relevance = (entry["relevance"] as? Double) ?? (entry["relevance"] as? Int).map(Double.init) ?? 0
                items.append(.init(
                    kind: entry["kind"] as? String ?? attrs.kind,
                    ending: entry["ending"] as? Bool ?? false,
                    staleDate: stale,
                    relevance: relevance,
                    attributes: attrs,
                    state: state
                ))
            }
            Task {
                await LiveActivityManager.shared.sync(items)
                call.resolve()
            }
            return
        }
        #endif
        call.resolve()
    }
}
