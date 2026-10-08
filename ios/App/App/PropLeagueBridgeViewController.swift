import UIKit
import WebKit
import Capacitor

/// The app's web view controller. Same as Capacitor's own, plus our local plugins (Capacitor only
/// finds plugins that come from npm packages on its own). AppearancePlugin is at the bottom of this file.
class PropLeagueBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(LiveActivityPlugin())
        bridge?.registerPluginInstance(AppearancePlugin())
        // Before the page loads, so the view behind it is already the user's theme instead of the
        // build-time navy for however long the web bundle takes to start.
        AppearancePlugin.applySaved(to: self)
    }
}

/// Keeps the native layer in step with the app's theme (JS name "Appearance", see src/services/theme.ts).
/// The web page repaints itself from CSS, but two things behind it are native and would otherwise stay on
/// the launch colors: the view under the web content (the band that shows between the tab bar and the
/// keyboard, and in any overscroll), and the keyboard itself, which follows the phone's light/dark setting
/// unless told otherwise. `style` is "dark" or "light" to force one, or "auto" to follow the phone.
/// The last theme set is remembered (UserDefaults) and applied again at the next launch, in
/// capacitorDidLoad, before the web page has loaded anything.
/// Declared here, not in its own file, so it is already part of the app target.
@objc(AppearancePlugin)
public class AppearancePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppearancePlugin"
    public let jsName = "Appearance"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
    ]

    @objc func set(_ call: CAPPluginCall) {
        let hex = call.getString("background") ?? ""
        let style = call.getString("style") ?? "auto"
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else {
                call.resolve()
                return
            }
            let interface: UIUserInterfaceStyle
            switch style {
            case "dark": interface = .dark
            case "light": interface = .light
            default: interface = .unspecified
            }
            vc.overrideUserInterfaceStyle = interface
            vc.view.window?.overrideUserInterfaceStyle = interface

            if let color = AppearancePlugin.color(fromHex: hex) {
                AppearancePlugin.paint(color, view: vc.view, web: self.bridge?.webView)
            }
            let defaults = UserDefaults.standard
            defaults.set(style, forKey: AppearancePlugin.styleKey)
            if AppearancePlugin.color(fromHex: hex) != nil { defaults.set(hex, forKey: AppearancePlugin.backgroundKey) }
            call.resolve()
        }
    }

    private static let styleKey = "pl.appearance.style"
    private static let backgroundKey = "pl.appearance.background"
    /// Page background of the light and gray Dark themes (index.css), for Auto before the page can say.
    private static let lightBackground = "#e3e9f1"
    private static let graphiteBackground = "#0e0e10"

    private static func paint(_ color: UIColor, view: UIView, web: WKWebView?) {
        view.backgroundColor = color
        if let web = web {
            web.backgroundColor = color
            web.scrollView.backgroundColor = color
            if #available(iOS 15.0, *) {
                web.underPageBackgroundColor = color
            }
        }
    }

    /// Re-applies the theme saved by the last `set` call. Nothing saved yet (first ever launch) leaves
    /// Capacitor's own launch color in place.
    static func applySaved(to vc: CAPBridgeViewController) {
        let defaults = UserDefaults.standard
        guard let style = defaults.string(forKey: styleKey) else { return }
        switch style {
        case "dark": vc.overrideUserInterfaceStyle = .dark
        case "light": vc.overrideUserInterfaceStyle = .light
        default: vc.overrideUserInterfaceStyle = .unspecified
        }
        let hex: String?
        if style == "auto" {
            // Follow the phone: the page is not there yet to ask, so read it from the screen.
            hex = UIScreen.main.traitCollection.userInterfaceStyle == .light ? lightBackground : graphiteBackground
        } else {
            hex = defaults.string(forKey: backgroundKey)
        }
        if let hex = hex, let saved = color(fromHex: hex) {
            paint(saved, view: vc.view, web: vc.webView)
        }
    }

    /// "#rrggbb" (or "rrggbb"); nil for anything else.
    private static func color(fromHex hex: String) -> UIColor? {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let value = UInt32(s, radix: 16) else { return nil }
        return UIColor(
            red: CGFloat((value >> 16) & 0xFF) / 255,
            green: CGFloat((value >> 8) & 0xFF) / 255,
            blue: CGFloat(value & 0xFF) / 255,
            alpha: 1
        )
    }
}
