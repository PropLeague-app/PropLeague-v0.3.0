import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

// MARK: - Widget

/// Lock screen banner + Dynamic Island for both kinds of PropLeague Live Activity:
///   "lineup": countdown to kickoff while the roster still needs work
///   "score":  your team vs your opponent for one slate window
struct PropLeagueLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: PropLeagueActivityAttributes.self) { context in
            LockScreenView(attributes: context.attributes, state: context.state, activityID: context.activityID)
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
    var activityID: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if attributes.kind == "score" {
                // League badge and name centered; PropLeague mark left, LIVE / FINAL right.
                ZStack {
                    HStack {
                        Image("PLMark")
                            .renderingMode(.template)
                            .resizable()
                            .scaledToFit()
                            .frame(width: 14, height: 14)
                            .foregroundColor(.white.opacity(0.6))
                        Spacer()
                        Text(headerTag)
                            .font(.caption2.weight(.bold))
                            .foregroundColor(PL.accent)
                            .lineLimit(1)
                            .fixedSize()
                    }
                    HStack(spacing: 6) {
                        LeagueBadge(attributes: attributes, size: 20)
                        Text(attributes.leagueName)
                            .font(.caption.weight(.semibold))
                            .foregroundColor(.white.opacity(0.8))
                            .lineLimit(1)
                    }
                    .padding(.horizontal, 44)
                }
            } else {
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
            }
            if attributes.kind == "score" {
                ScoreBoard(attributes: attributes, state: state)
                if #available(iOS 17.0, *), let slots = state.slots, !slots.isEmpty, !activityID.isEmpty {
                    SlotScroller(activityID: activityID, slots: slots)
                }
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
        .padding(.vertical, 10)
        .background { cardBackground }
        // Keep the card from blowing up (and wrapping) when the phone's text size is large.
        .dynamicTypeSize(...DynamicTypeSize.large)
    }

    /// Score card: each team's color glows in from its own edge and fades to charcoal in the middle,
    /// so the text (always white, always over mostly charcoal) stays readable even for a white team.
    @ViewBuilder
    private var cardBackground: some View {
        if attributes.kind == "score" {
            LinearGradient(
                stops: [
                    .init(color: PL.sideTint(attributes.myColor), location: 0),
                    .init(color: PL.background, location: 0.42),
                    .init(color: PL.background, location: 0.58),
                    .init(color: PL.sideTint(attributes.oppColor), location: 1),
                ],
                startPoint: .leading,
                endPoint: .trailing
            )
        } else {
            PL.background
        }
    }

    private var headerTag: String {
        if attributes.kind == "score" {
            return state.phase == "final" ? "FINAL" : "LIVE"
        }
        return PL.shortTitle(attributes.title).uppercased()
    }
}

// MARK: - Pieces

/// Apple Sports style score row: badge, then that side's score right beside it, with W-L-P and the
/// live count under the score. The middle holds the window, the lead and the mini win-probability
/// bar. Scores are green / red like the app (scaled reds follow the app's setting) and the trailing
/// side is dimmed, so the leader stays obvious when both are up or both are down.
struct ScoreBoard: View {
    let attributes: PropLeagueActivityAttributes
    let state: PropLeagueActivityAttributes.ContentState

    private var mineAhead: Bool { state.myScore > state.oppScore }
    private var oppAhead: Bool { state.oppScore > state.myScore }
    private var isFinal: Bool { state.phase == "final" }

    var body: some View {
        HStack(alignment: .top, spacing: 4) {
            TeamColumn(side: .mine, attributes: attributes)
            side(state.myScore, dimmed: oppAhead, won: state.myWon, lost: state.myLost, push: state.myPush, live: state.myLive, alignment: .leading)
            center
            side(state.oppScore, dimmed: mineAhead, won: state.oppWon, lost: state.oppLost, push: state.oppPush, live: state.oppLive, alignment: .trailing)
            TeamColumn(side: .opponent, attributes: attributes)
        }
    }

    private func side(_ value: Double, dimmed: Bool, won: Int?, lost: Int?, push: Int?, live: Int?, alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 1) {
            Text(PL.score(value))
                .font(.system(size: 36, weight: .heavy))
                .fontWidth(.condensed)
                .foregroundColor(PL.scoreColor(value, lossRef: state.lossRef).opacity(dimmed ? 0.55 : 1))
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .frame(height: 40)
            recordLine(won: won, lost: lost, push: push, live: live)
        }
        .frame(maxWidth: .infinity, alignment: Alignment(horizontal: alignment, vertical: .top))
    }

    @ViewBuilder
    private func recordLine(won: Int?, lost: Int?, push: Int?, live: Int?) -> some View {
        if let w = won, let l = lost, let p = push {
            HStack(spacing: 4) {
                Text("\(w)-\(l)-\(p)")
                    .font(.caption2.weight(.semibold).monospacedDigit())
                    .foregroundColor(.white.opacity(0.85))
                if !isFinal, let live = live {
                    HStack(spacing: 2) {
                        if live > 0 { Circle().fill(PL.accent).frame(width: 4, height: 4) }
                        Text("\(live) live")
                            .font(.system(size: 9))
                            .foregroundColor(live > 0 ? PL.accent : .white.opacity(0.45))
                    }
                }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.8)
        }
    }

    /// Window and lead ("TNF", "+$12.34"), then the win-probability bar.
    private var center: some View {
        let margin = abs(state.myScore - state.oppScore)
        return VStack(spacing: 2) {
            Text(isFinal ? "FINAL" : PL.shortTitle(attributes.title))
                .font(.caption.weight(.bold))
                .foregroundColor(.white.opacity(0.9))
                .lineLimit(1)
            if margin >= 0.005 {
                Text((mineAhead ? "+" : "-") + PL.score(margin))
                    .font(.caption2.weight(.semibold))
                    .foregroundColor(mineAhead ? PL.win : PL.loss)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
            } else {
                Text("Even")
                    .font(.caption2)
                    .foregroundColor(.white.opacity(0.55))
            }
            if let p = state.winProb, !isFinal {
                WinBar(probability: p, mine: attributes.myColor, opponent: attributes.oppColor)
                    .padding(.top, 2)
            }
        }
        .frame(width: 80)
    }
}

/// A very small win-probability bar: percentages at each end, a thin bar split in the two teams' colors.
struct WinBar: View {
    let probability: Double
    let mine: String
    let opponent: String

    var body: some View {
        let p = min(max(probability, 0), 1)
        let myPct = Int((p * 100).rounded())
        let (left, right) = PL.barColors(mine, opponent)
        VStack(spacing: 2) {
            HStack {
                Text("\(myPct)%")
                Spacer(minLength: 0)
                Text("\(100 - myPct)%")
            }
            .font(.system(size: 9, weight: .bold).monospacedDigit())
            .foregroundColor(.white.opacity(0.85))
            GeometryReader { geo in
                let usable = max(0, geo.size.width - 2)
                let leftW = min(max(usable * p, 4), max(4, usable - 4))
                HStack(spacing: 2) {
                    Capsule().fill(left).frame(width: leftW)
                    Capsule().fill(right)
                }
            }
            .frame(height: 4)
        }
    }
}

/// Badge with the team abbreviation under it.
struct TeamColumn: View {
    let side: TeamBadge.Side
    let attributes: PropLeagueActivityAttributes

    var body: some View {
        VStack(spacing: 2) {
            TeamBadge(side: side, attributes: attributes, size: 40)
            Text(side == .mine ? attributes.myAbbrev : attributes.oppAbbrev)
                .font(.caption2.weight(.bold))
                .foregroundColor(.white.opacity(0.8))
                .lineLimit(1)
        }
        .frame(width: 44)
    }
}

/// DraftKings style leg scroller for my lineup: arrows step through the slots, each showing the
/// position pill, the pick, its status and the stake. The arrows run an App Intent (iOS 17+).
@available(iOS 17.0, *)
struct SlotScroller: View {
    let activityID: String
    let slots: [SlotLine]

    var body: some View {
        let index = SharedPrefs.slotIndex(activityID, count: slots.count)
        let slot = slots[index]
        HStack(spacing: 6) {
            arrow("chevron.left", delta: -1)
            // Same look as the app's position badge: tinted fill, colored border and text.
            Text(slot.pos)
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(PL.positionColor(slot.pos))
                .frame(minWidth: 32)
                .padding(.vertical, 2)
                .background(RoundedRectangle(cornerRadius: 4).fill(PL.positionColor(slot.pos).opacity(0.15)))
                .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(PL.positionColor(slot.pos), lineWidth: 1))
            VStack(alignment: .leading, spacing: 1) {
                Text(primary(slot))
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(slot.status == "empty" ? .white.opacity(0.5) : .white)
                    .lineLimit(1)
                if !secondary(slot).isEmpty {
                    Text(secondary(slot))
                        .font(.system(size: 10))
                        .foregroundColor(.white.opacity(0.65))
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 0) {
                Text(slot.status == "empty" ? "-" : PL.stake(slot.stake))
                    .font(.system(size: 12, weight: .bold).monospacedDigit())
                    .foregroundColor(.white)
                Text("\(index + 1)/\(slots.count)")
                    .font(.system(size: 9))
                    .foregroundColor(.white.opacity(0.45))
            }
            .frame(minWidth: 34, alignment: .trailing)
            StatusMark(status: slot.status)
            arrow("chevron.right", delta: 1)
        }
        .padding(.horizontal, 2)
        .frame(height: 36)
        .background(RoundedRectangle(cornerRadius: 10).fill(Color.white.opacity(0.07)))
    }

    private func primary(_ s: SlotLine) -> String {
        if s.status == "empty" { return "Empty slot" }
        return s.name.isEmpty ? s.line : s.name
    }

    private func secondary(_ s: SlotLine) -> String {
        s.status == "empty" || s.name.isEmpty ? "" : s.line
    }

    private func arrow(_ symbol: String, delta: Int) -> some View {
        Button(intent: StepLineupSlotIntent(activityId: activityID, delta: delta, count: slots.count)) {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .bold))
                .foregroundColor(.white.opacity(0.7))
                .frame(width: 22, height: 36)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

/// A pick's state: open ring (pending), green ring (its game is on), check (hit), x (miss), dash (push).
struct StatusMark: View {
    let status: String

    var body: some View {
        switch status {
        case "won":
            Image(systemName: "checkmark.circle.fill").foregroundColor(PL.win)
        case "lost":
            Image(systemName: "xmark.circle.fill").foregroundColor(PL.loss)
        case "push":
            Image(systemName: "minus.circle.fill").foregroundColor(.white.opacity(0.5))
        case "live":
            Circle().strokeBorder(PL.accent, lineWidth: 2).frame(width: 13, height: 13)
        case "empty":
            Circle().strokeBorder(Color.white.opacity(0.25), style: StrokeStyle(lineWidth: 1.5, dash: [2, 2])).frame(width: 13, height: 13)
        default:
            Circle().strokeBorder(PL.warn, lineWidth: 2).frame(width: 13, height: 13)
        }
    }
}

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
        if let mine = record(state.myWon, state.myLost, state.myPush), let theirs = record(state.oppWon, state.oppLost, state.oppPush) {
            HStack(alignment: .top) {
                RecordColumn(record: mine, live: state.myLive ?? 0, isFinal: state.phase == "final", alignment: .leading)
                Spacer(minLength: 6)
                Text(center)
                    .font(.caption.weight(state.phase == "final" ? .semibold : .regular))
                    .foregroundColor(centerColor)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                Spacer(minLength: 6)
                RecordColumn(record: theirs, live: state.oppLive ?? 0, isFinal: state.phase == "final", alignment: .trailing)
            }
        } else {
            // Older server push without records.
            HStack {
                Text(legacyLeft)
                    .font(.caption.weight(.medium))
                    .foregroundColor(.white.opacity(0.75))
                Spacer()
                Text(attributes.title)
                    .font(.caption)
                    .foregroundColor(.white.opacity(0.5))
            }
        }
    }

    private func record(_ w: Int?, _ l: Int?, _ p: Int?) -> String? {
        guard let w = w, let l = l, let p = p else { return nil }
        return "\(w)-\(l)-\(p)"
    }

    private var center: String {
        guard state.phase == "final" else { return PL.shortTitle(attributes.title) }
        if state.myScore > state.oppScore { return "You won by \(PL.score(state.myScore - state.oppScore))" }
        if state.myScore < state.oppScore { return "You lost by \(PL.score(state.oppScore - state.myScore))" }
        return "Tied"
    }

    private var centerColor: Color {
        guard state.phase == "final" else { return .white.opacity(0.5) }
        return PL.marginColor(mine: state.myScore, opp: state.oppScore).opacity(0.95)
    }

    private var legacyLeft: String {
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

/// One team's weekly W-L-P record with how many of its picks are in a game that is on right now.
struct RecordColumn: View {
    let record: String
    let live: Int
    let isFinal: Bool
    let alignment: HorizontalAlignment

    var body: some View {
        VStack(alignment: alignment, spacing: 1) {
            Text(record)
                .font(.caption.weight(.bold).monospacedDigit())
                .foregroundColor(.white.opacity(0.9))
            if !isFinal {
                HStack(spacing: 3) {
                    if live > 0 { Circle().fill(PL.accent).frame(width: 5, height: 5) }
                    Text("\(live) live")
                        .font(.caption2)
                        .foregroundColor(live > 0 ? PL.accent : .white.opacity(0.45))
                }
            }
        }
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
                    .font(.system(size: size * 0.17, weight: .bold, design: .rounded).monospacedDigit())
                    .foregroundColor(.white)
                    .multilineTextAlignment(.center)
                    .lineLimit(1)
                    .minimumScaleFactor(0.5)
                    .frame(width: size * 0.82)
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
    static let background = Color(hex: "#15171C")
    static let accent = Color(hex: "#34D399")
    static let warn = Color(hex: "#F59E0B")
    static let win = Color(hex: "#34D399")
    static let loss = Color(hex: "#F87171")

    /// How long before kickoff a lineup activity appears (matches LINEUP_LEAD_MS on the server).
    static let leadSeconds: TimeInterval = 90 * 60

    /// Score color like the app: a gain is green, a loss is red, $0 is white. With the app's "scaled"
    /// P/L colors on, a loss runs yellow, to orange, to red by how big it is next to `lossRef`
    /// (same stops as the app's dark theme: yellow at 0, orange by 30%, red by 65%).
    static func scoreColor(_ value: Double, lossRef: Double?) -> Color {
        if value > 0.004 { return win }
        if value >= -0.004 { return .white }
        guard SharedPrefs.plColorScale == "scaled", let ref = lossRef, ref > 0 else { return loss }
        let t = min(1, -value / ref)
        if t <= 0.3 { return mix("#F2C94C", "#F5944A", t / 0.3) }
        return mix("#F5944A", "#F55C5C", min(1, (t - 0.3) / 0.35))
    }

    private static func mix(_ a: String, _ b: String, _ t: Double) -> Color {
        let (r1, g1, b1) = rgb(a)
        let (r2, g2, b2) = rgb(b)
        return Color(red: r1 + (r2 - r1) * t, green: g1 + (g2 - g1) * t, blue: b1 + (b2 - b1) * t)
    }

    /// The two team colors for the win bar. Dark colors are lifted so they show on the charcoal card,
    /// and if the teams share nearly the same color the opponent's side goes light grey.
    static func barColors(_ mine: String, _ opponent: String) -> (Color, Color) {
        let a = lifted(mine)
        var b = lifted(opponent)
        let d = abs(a.0 - b.0) + abs(a.1 - b.1) + abs(a.2 - b.2)
        if d < 0.35 { b = (0.8, 0.8, 0.8) }
        return (Color(red: a.0, green: a.1, blue: a.2), Color(red: b.0, green: b.1, blue: b.2))
    }

    private static func lifted(_ hex: String) -> (Double, Double, Double) {
        var (r, g, b) = rgb(hex)
        let luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
        if luminance < 0.25 {
            let t = (0.25 - luminance) / 0.25 * 0.6
            r += (1 - r) * t
            g += (1 - g) * t
            b += (1 - b) * t
        }
        return (r, g, b)
    }

    /// Stake for the scroller: "$25" or "$12.50".
    static func stake(_ value: Double) -> String {
        value == value.rounded() ? "$\(Int(value))" : "$" + String(format: "%.2f", value)
    }

    /// Position colors, the same as the app's --color-pos-* (index.css).
    static func positionColor(_ pos: String) -> Color {
        switch pos {
        case "QB": return Color(hex: "#F472B6")
        case "RB": return Color(hex: "#F5A45C")
        case "WR": return Color(hex: "#4C8DF5")
        case "TE": return Color(hex: "#3DDC84")
        case "K": return Color(hex: "#9D4EED")
        case "ML": return Color(hex: "#FACC15")
        default: return Color(hex: "#94A3B8")
        }
    }

    /// A team color for the card edge, dimmed so white text on top stays readable. Light colors
    /// (a white team) are dimmed more than dark ones.
    static func sideTint(_ hex: String) -> Color {
        let (r, g, b) = rgb(hex)
        let luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
        return Color(red: r, green: g, blue: b).opacity(0.42 - 0.2 * luminance)
    }

    private static func rgb(_ hex: String) -> (Double, Double, Double) {
        var cleaned = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.hasPrefix("#") { cleaned.removeFirst() }
        var value: UInt64 = 0
        guard cleaned.count == 6, Scanner(string: cleaned).scanHexInt64(&value) else { return (0.2, 0.25, 0.33) }
        return (Double((value >> 16) & 0xFF) / 255, Double((value >> 8) & 0xFF) / 255, Double(value & 0xFF) / 255)
    }

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

    /// "Thursday Night" is TNF, "Sunday Night" SNF, "Monday Night" MNF. Windows with no common
    /// abbreviation (Wednesday, Saturday, Sunday, Sunday early) keep their full name.
    static func shortTitle(_ title: String) -> String {
        switch title.lowercased() {
        case "thursday night": return "TNF"
        case "sunday night": return "SNF"
        case "monday night": return "MNF"
        default: return title
        }
    }

    /// With a title ("Thursday Night lineup due") for the Dynamic Island; without one ("Lineup due")
    /// on the lock screen, where the window already shows as a tag in the corner.
    static func lineupHeadline(_ phase: String, title: String?) -> String {
        switch phase {
        case "ready": return "Lineup set"
        case "locked": return title.map { "\(shortTitle($0)) locked" } ?? "Locked"
        default: return title.map { "\(shortTitle($0)) lineup due" } ?? "Lineup due"
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
