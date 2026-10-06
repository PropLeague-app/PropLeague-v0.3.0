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
