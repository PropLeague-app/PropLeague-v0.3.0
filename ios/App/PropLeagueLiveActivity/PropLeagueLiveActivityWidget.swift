import ActivityKit
import SwiftUI
import WidgetKit

// MARK: - Widget

/// Lock screen banner + Dynamic Island for both kinds of PropLeague Live Activity:
///   "lineup": countdown to kickoff while the roster still needs work
///   "score":  your team vs your opponent for one slate window
struct PropLeagueLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: PropLeagueActivityAttributes.self) { context in
            LockScreenView(attributes: context.attributes, state: context.state)
                .activityBackgroundTint(PL.background)
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            let a = context.attributes
            let s = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    if a.kind == "score" {
                        VStack(spacing: 2) {
                            TeamBadge(side: .mine, attributes: a, size: 34)
                            Text(a.myAbbrev).font(.caption2.weight(.bold)).foregroundColor(.white.opacity(0.8))
                        }
                    } else {
                        VStack(spacing: 2) {
                            TeamBadge(side: .mine, attributes: a, size: 34)
                            Text(a.myAbbrev).font(.caption2.weight(.bold)).foregroundColor(.white.opacity(0.8))
                        }
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if a.kind == "score" {
                        VStack(spacing: 2) {
                            TeamBadge(side: .opponent, attributes: a, size: 34)
                            Text(a.oppAbbrev).font(.caption2.weight(.bold)).foregroundColor(.white.opacity(0.8))
                        }
                    } else {
                        LineupRing(attributes: a, state: s, size: 52)
                    }
                }
                DynamicIslandExpandedRegion(.center) {
                    if a.kind == "score" {
                        ScoreLine(attributes: a, state: s, size: 22)
                    } else {
                        VStack(spacing: 1) {
                            Text(PL.lineupHeadline(s.phase, title: a.title))
                                .font(.subheadline.weight(.bold))
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                                .foregroundColor(.white)
                            Text(a.leagueName)
                                .font(.caption2)
                                .foregroundColor(.white.opacity(0.65))
                                .lineLimit(1)
                        }
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if a.kind == "score" {
                        ScoreFooter(attributes: a, state: s)
                    } else {
                        LineupFooter(state: s)
                    }
                }
            } compactLeading: {
                if a.kind == "score" {
                    HStack(spacing: 4) {
                        TeamBadge(side: .mine, attributes: a, size: 18)
                        Text(PL.scoreCompact(s.myScore))
                            .font(.caption.weight(.bold).monospacedDigit())
                            .foregroundColor(.white)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                } else {
                    Image(systemName: PL.lineupIcon(s.phase))
                        .foregroundColor(PL.lineupTint(s.phase))
                }
            } compactTrailing: {
                if a.kind == "score" {
                    HStack(spacing: 4) {
                        Text(PL.scoreCompact(s.oppScore))
                            .font(.caption.weight(.bold).monospacedDigit())
                            .foregroundColor(.white)
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                        TeamBadge(side: .opponent, attributes: a, size: 18)
                    }
                } else {
                    LineupCountdown(attributes: a, state: s, font: .caption.weight(.bold))
                        .frame(maxWidth: 52)
                }
            } minimal: {
                if a.kind == "score" {
                    TeamBadge(side: .mine, attributes: a, size: 20)
                } else {
                    Image(systemName: PL.lineupIcon(s.phase))
                        .foregroundColor(PL.lineupTint(s.phase))
                }
            }
            .keylineTint(PL.accent)
        }
    }
}

// MARK: - Lock screen

struct LockScreenView: View {
    let attributes: PropLeagueActivityAttributes
    let state: PropLeagueActivityAttributes.ContentState

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 6) {
                LeagueBadge(attributes: attributes, size: 18)
                Text(attributes.leagueName)
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.white.opacity(0.7))
                    .lineLimit(1)
                Spacer(minLength: 6)
                Image("PLMark")
                    .renderingMode(.template)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 14, height: 14)
                    .foregroundColor(.white.opacity(0.6))
                Text(headerTag)
                    .font(.caption2.weight(.bold))
                    .foregroundColor(PL.accent)
                    .lineLimit(1)
                    .fixedSize()
            }
            if attributes.kind == "score" {
                HStack {
                    VStack(spacing: 3) {
                        TeamBadge(side: .mine, attributes: attributes, size: 44)
                        Text(attributes.myAbbrev).font(.caption2.weight(.bold)).foregroundColor(.white.opacity(0.8)).lineLimit(1)
                    }
                    Spacer(minLength: 8)
                    ScoreLine(attributes: attributes, state: state, size: 28)
                    Spacer(minLength: 8)
                    VStack(spacing: 3) {
                        TeamBadge(side: .opponent, attributes: attributes, size: 44)
                        Text(attributes.oppAbbrev).font(.caption2.weight(.bold)).foregroundColor(.white.opacity(0.8)).lineLimit(1)
                    }
                }
                ScoreFooter(attributes: attributes, state: state)
            } else {
                HStack(alignment: .center, spacing: 12) {
                    TeamBadge(side: .mine, attributes: attributes, size: 46)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(PL.lineupHeadline(state.phase, title: nil))
                            .font(.headline)
                            .foregroundColor(.white)
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                        LineupFooter(state: state)
                    }
                    Spacer(minLength: 4)
                    LineupRing(attributes: attributes, state: state, size: 58)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        // Keep the card from blowing up (and wrapping) when the phone's text size is large.
        .dynamicTypeSize(...DynamicTypeSize.large)
    }

    private var headerTag: String {
        if attributes.kind == "score" {
            return state.phase == "final" ? "FINAL" : "LIVE"
        }
        return attributes.title.uppercased()
    }
}

// MARK: - Pieces

struct ScoreLine: View {
    let attributes: PropLeagueActivityAttributes
    let state: PropLeagueActivityAttributes.ContentState
    let size: CGFloat

    var body: some View {
        HStack(spacing: 8) {
            Text(PL.score(state.myScore))
                .foregroundColor(PL.marginColor(mine: state.myScore, opp: state.oppScore))
            Text("-").foregroundColor(.white.opacity(0.45))
            Text(PL.score(state.oppScore))
                .foregroundColor(.white)
        }
        .font(.system(size: size, weight: .heavy, design: .rounded).monospacedDigit())
        .minimumScaleFactor(0.5)
        .lineLimit(1)
    }
}

struct ScoreFooter: View {
    let attributes: PropLeagueActivityAttributes
    let state: PropLeagueActivityAttributes.ContentState

    var body: some View {
        HStack {
            Text(left)
                .font(.caption.weight(.medium))
                .foregroundColor(.white.opacity(0.75))
            Spacer()
            Text(attributes.title)
                .font(.caption)
                .foregroundColor(.white.opacity(0.5))
        }
    }

    private var left: String {
        if state.phase == "final" {
            if state.myScore > state.oppScore { return "You won by \(PL.score(state.myScore - state.oppScore))" }
            if state.myScore < state.oppScore { return "You lost by \(PL.score(state.oppScore - state.myScore))" }
            return "Tied"
        }
        let total = state.picksAlive + state.picksSettled
        if total == 0 { return "Games in progress" }
        return "\(state.picksAlive) alive, \(state.picksSettled) settled"
    }
}

struct LineupFooter: View {
    let state: PropLeagueActivityAttributes.ContentState

    var body: some View {
        let line = state.hint.isEmpty ? "\(state.picksIn)/\(state.totalSlots) picks in" : "\(state.picksIn)/\(state.totalSlots) in. \(state.hint)"
        Text(line)
            .font(.caption)
            .foregroundColor(.white.opacity(0.75))
            .lineLimit(1)
            .minimumScaleFactor(0.75)
    }
}

/// Counts down to kickoff with the system timer (no pushes needed to tick). Once kickoff passes, or
/// the lineup is ready or locked, it shows a plain label instead so it never counts into negatives.
struct LineupCountdown: View {
    let attributes: PropLeagueActivityAttributes
    let state: PropLeagueActivityAttributes.ContentState
    let font: Font

    var body: some View {
        let kickoff = Date(timeIntervalSince1970: attributes.kickoff)
        let now = Date()
        if state.phase == "open" && kickoff > now {
            Text(timerInterval: now...kickoff, countsDown: true)
                .font(font.monospacedDigit())
                .multilineTextAlignment(.trailing)
                .foregroundColor(.white)
        } else {
            Text(state.phase == "ready" ? "Set" : "Locked")
                .font(font)
                .foregroundColor(PL.lineupTint(state.phase))
        }
    }
}

/// The lineup clock: a ring that drains toward kickoff with the time inside. Both the ring and the
/// digits are drawn by the system from the kickoff time, so they tick without any pushes. Once
/// kickoff passes, or the lineup is ready or locked, it becomes a still ring with an icon.
struct LineupRing: View {
    let attributes: PropLeagueActivityAttributes
    let state: PropLeagueActivityAttributes.ContentState
    let size: CGFloat

    var body: some View {
        let kickoff = Date(timeIntervalSince1970: attributes.kickoff)
        let now = Date()
        if state.phase == "open" && kickoff > now {
            let start = min(now, kickoff.addingTimeInterval(-PL.leadSeconds))
            ZStack {
                ProgressView(timerInterval: start...kickoff, countsDown: true) {
                    EmptyView()
                } currentValueLabel: {
                    EmptyView()
                }
                .progressViewStyle(.circular)
                .tint(PL.warn)
                Text(timerInterval: now...kickoff, countsDown: true)
                    .font(.system(size: size * 0.2, weight: .bold, design: .rounded).monospacedDigit())
                    .foregroundColor(.white)
                    .multilineTextAlignment(.center)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .frame(width: size * 0.72)
            }
            .frame(width: size, height: size)
        } else {
            ZStack {
                Circle().stroke(PL.lineupTint(state.phase).opacity(0.25), lineWidth: 5)
                Image(systemName: PL.lineupIcon(state.phase))
                    .font(.system(size: size * 0.38, weight: .bold))
                    .foregroundColor(PL.lineupTint(state.phase))
            }
            .padding(2)
            .frame(width: size, height: size)
        }
    }
}

/// A round logo: the uploaded image if it has been cached, else an emoji, else initials, on the
/// team's (or league's) color.
struct LogoBadge: View {
    let mode: String
    let emoji: String
    let colorHex: String
    let logoUrl: String
    let fallback: String
    let size: CGFloat

    var body: some View {
        ZStack {
            Circle().fill(Color(hex: colorHex))
            if mode == "image", let image = LogoCache.image(for: logoUrl) {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(width: size, height: size)
                    .clipShape(Circle())
            } else if mode == "emoji", !emoji.isEmpty {
                Text(emoji).font(.system(size: size * 0.55))
            } else {
                Text(String(fallback.prefix(3)))
                    .font(.system(size: size * (fallback.count > 2 ? 0.30 : 0.36), weight: .heavy))
                    .foregroundColor(.white)
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
            }
        }
        .frame(width: size, height: size)
        .overlay(Circle().stroke(Color.white.opacity(0.25), lineWidth: 1))
    }
}

struct TeamBadge: View {
    enum Side { case mine, opponent }

    let side: Side
    let attributes: PropLeagueActivityAttributes
    let size: CGFloat

    var body: some View {
        let a = attributes
        if side == .mine {
            LogoBadge(mode: a.myLogoMode, emoji: a.myEmoji, colorHex: a.myColor, logoUrl: a.myLogoUrl, fallback: a.myAbbrev, size: size)
        } else {
            LogoBadge(mode: a.oppLogoMode, emoji: a.oppEmoji, colorHex: a.oppColor, logoUrl: a.oppLogoUrl, fallback: a.oppAbbrev, size: size)
        }
    }
}

/// The league's logo. Older server pushes do not carry one, so every field falls back to initials.
struct LeagueBadge: View {
    let attributes: PropLeagueActivityAttributes
    let size: CGFloat

    private var initials: String {
        let letters = attributes.leagueName.split(separator: " ").compactMap { $0.first }.prefix(2)
        return letters.isEmpty ? "L" : String(letters).uppercased()
    }

    var body: some View {
        LogoBadge(
            mode: attributes.leagueLogoMode ?? "initials",
            emoji: attributes.leagueEmoji ?? "",
            colorHex: attributes.leagueColor ?? "#4C8DF5",
            logoUrl: attributes.leagueLogoUrl ?? "",
            fallback: initials,
            size: size
        )
    }
}

// MARK: - Shared style helpers

enum PL {
    static let background = Color(hex: "#0B1220")
    static let accent = Color(hex: "#34D399")
    static let warn = Color(hex: "#F59E0B")
    static let win = Color(hex: "#34D399")
    static let loss = Color(hex: "#F87171")

    /// How long before kickoff a lineup activity appears (matches LINEUP_LEAD_MS on the server).
    static let leadSeconds: TimeInterval = 90 * 60

    /// Dollars, the way the app shows a score: "$42.50", "-$31.00".
    static func score(_ value: Double) -> String {
        let cents = Int((value * 100).rounded())
        let sign = cents < 0 ? "-" : ""
        return "\(sign)$" + String(format: "%.2f", Double(abs(cents)) / 100)
    }

    /// Whole dollars, for the cramped compact Dynamic Island.
    static func scoreCompact(_ value: Double) -> String {
        let whole = Int(value.rounded())
        return whole < 0 ? "-$\(abs(whole))" : "$\(whole)"
    }

    static func marginColor(mine: Double, opp: Double) -> Color {
        if mine > opp { return win }
        if mine < opp { return loss }
        return .white
    }

    static func lineupIcon(_ phase: String) -> String {
        switch phase {
        case "ready": return "checkmark.circle.fill"
        case "locked": return "lock.fill"
        default: return "clock.badge.exclamationmark.fill"
        }
    }

    static func lineupTint(_ phase: String) -> Color {
        switch phase {
        case "ready": return accent
        case "locked": return .white.opacity(0.7)
        default: return warn
        }
    }

    /// With a title ("Thursday Night lineup due") for the Dynamic Island; without one ("Lineup due")
    /// on the lock screen, where the window already shows as a tag in the corner.
    static func lineupHeadline(_ phase: String, title: String?) -> String {
        switch phase {
        case "ready": return "Lineup set"
        case "locked": return title.map { "\($0) locked" } ?? "Locked"
        default: return title.map { "\($0) lineup due" } ?? "Lineup due"
        }
    }
}

extension Color {
    /// "#RRGGBB" or "RRGGBB". Falls back to a neutral slate if it cannot be parsed.
    init(hex: String) {
        var cleaned = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.hasPrefix("#") { cleaned.removeFirst() }
        var value: UInt64 = 0
        guard cleaned.count == 6, Scanner(string: cleaned).scanHexInt64(&value) else {
            self = Color(red: 0.2, green: 0.25, blue: 0.33)
            return
        }
        self = Color(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}
