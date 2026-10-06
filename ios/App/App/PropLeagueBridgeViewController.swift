import UIKit
import Capacitor

/// The app's web view controller. Same as Capacitor's own, plus our local plugins (Capacitor only
/// finds plugins that come from npm packages on its own).
class PropLeagueBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(LiveActivityPlugin())
    }
}
