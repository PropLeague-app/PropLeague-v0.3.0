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
                        Image(systemName: PL.lineupIcon(s.phase))
                            .font(.title2)
                            .foregroundColor(PL.lineupTint(s.phase))
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if a.kind == "score" {
                        VStack(spacing: 2) {
                            TeamBadge(side: .opponent, attributes: a, size: 34)
                            Text(a.oppAbbrev).font(.caption2.weight(.bold)).foregroundColor(.white.opacity(0.8))
                        }
                    } else {
                        LineupCountdown(attributes: a, state: s, font: .title3.weight(.bold))
                            .frame(maxWidth: 90, alignment: .trailing)
                    }
                }
                DynamicIslandExpandedRegion(.center) {
                    if a.kind == "score" {
                        ScoreLine(attributes: a, state: s, size: 28)
                    } else {
                        VStack(spacing: 1) {
                            Text(PL.lineupHeadline(s.phase, title: a.title))
                                .font(.subheadline.weight(.bold))
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
                        Text(PL.score(s.myScore))
                            .font(.caption.weight(.bold).monospacedDigit())
                            .foregroundColor(.white)
                    }
                } else {
                    Image(systemName: PL.lineupIcon(s.phase))
                        .foregroundColor(PL.lineupTint(s.phase))
                }
            } compactTrailing: {
                if a.kind == "score" {
                    HStack(spacing: 4) {
                        Text(PL.score(s.oppScore))
                            .font(.caption.weight(.bold).monospacedDigit())
                            .foregroundColor(.white)
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
            HStack {
                Text(attributes.leagueName)
                    .font(.caption.weight(.semibold))
                    .foregroundColor(.white.opacity(0.7))
                    .lineLimit(1)
                Spacer()
                Text(headerTag)
                    .font(.caption2.weight(.bold))
                    .foregroundColor(PL.accent)
            }
            if attributes.kind == "score" {
                HStack {
                    TeamBadge(side: .mine, attributes: attributes, size: 40)
                    Spacer(minLength: 8)
                    ScoreLine(attributes: attributes, state: state, size: 34)
                    Spacer(minLength: 8)
                    TeamBadge(side: .opponent, attributes: attributes, size: 40)
                }
                ScoreFooter(attributes: attributes, state: state)
            } else {
                HStack(alignment: .center) {
                    Image(systemName: PL.lineupIcon(state.phase))
                        .font(.title)
                        .foregroundColor(PL.lineupTint(state.phase))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(PL.lineupHeadline(state.phase, title: attributes.title))
                            .font(.headline)
                            .foregroundColor(.white)
                        LineupFooter(state: state)
                    }
                    Spacer()
                    LineupCountdown(attributes: attributes, state: state, font: .title2.weight(.bold))
                        .frame(maxWidth: 110, alignment: .trailing)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
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
        .minimumScaleFactor(0.6)
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
            .lineLimit(2)
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

struct TeamBadge: View {
    enum Side { case mine, opponent }

    let side: Side
    let attributes: PropLeagueActivityAttributes
    let size: CGFloat

    private var abbrev: String { side == .mine ? attributes.myAbbrev : attributes.oppAbbrev }
    private var colorHex: String { side == .mine ? attributes.myColor : attributes.oppColor }
    private var mode: String { side == .mine ? attributes.myLogoMode : attributes.oppLogoMode }
    private var emoji: String { side == .mine ? attributes.myEmoji : attributes.oppEmoji }
    private var logoUrl: String { side == .mine ? attributes.myLogoUrl : attributes.oppLogoUrl }

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
                Text(String(abbrev.prefix(3)))
                    .font(.system(size: size * (abbrev.count > 2 ? 0.30 : 0.36), weight: .heavy))
                    .foregroundColor(.white)
                    .minimumScaleFactor(0.5)
                    .lineLimit(1)
            }
        }
        .frame(width: size, height: size)
        .overlay(Circle().stroke(Color.white.opacity(0.25), lineWidth: 1))
    }
}

// MARK: - Shared style helpers

enum PL {
    static let background = Color(hex: "#0B1220")
    static let accent = Color(hex: "#34D399")
    static let warn = Color(hex: "#F59E0B")
    static let win = Color(hex: "#34D399")
    static let loss = Color(hex: "#F87171")

    static func score(_ value: Double) -> String {
        String(format: "%.1f", value)
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

    static func lineupHeadline(_ phase: String, title: String) -> String {
        switch phase {
        case "ready": return "Lineup set"
        case "locked": return "\(title) locked"
        default: return "\(title) lineup due"
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
