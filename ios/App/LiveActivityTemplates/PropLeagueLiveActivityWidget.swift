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
            let isScore = a.kind == "score"
            return DynamicIsland {
                // Expanded: badge and score on each side (Apple Sports), the league, win bar and lead in
                // the middle (ESPN), and the lineup scroller underneath.
                DynamicIslandExpandedRegion(.leading) {
                    if isScore {
                        IslandSide(side: .mine, attributes: a, state: s)
                    } else {
                        VStack(spacing: 2) {
                            TeamBadge(side: .mine, attributes: a, size: 40)
                            Text(a.myAbbrev).font(.caption2.weight(.bold)).foregroundColor(.white.opacity(0.8))
                        }
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if isScore {
                        IslandSide(side: .opponent, attributes: a, state: s)
                    } else {
                        LineupRing(attributes: a, state: s, size: 56)
                    }
                }
                DynamicIslandExpandedRegion(.center) {
                    if isScore {
                        IslandScoreCenter(attributes: a, state: s)
                    } else {
                        VStack(spacing: 1) {
                            Text(PL.lineupHeadline(s.phase, title: a.title))
                                .font(.subheadline.weight(.bold))
                                .lineLimit(1)
                                .minimumScaleFactor(0.8)
                                .foregroundColor(PL.lineupTint(s.phase))
                            HStack(spacing: 3) {
                                if s.favorite == true {
                                    Image(systemName: "star.fill")
                                        .font(.system(size: 8, weight: .bold))
                                        .foregroundColor(PL.gold)
                                }
                                Text(a.leagueName)
                                    .font(.caption2)
                                    .foregroundColor(.white.opacity(0.65))
                                    .lineLimit(1)
                            }
                        }
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    if isScore {
                        IslandScoreBottom(attributes: a, state: s, activityID: context.activityID)
                    } else {
                        VStack(spacing: 4) {
                            LineupPips(state: s)
                            LineupFooter(state: s)
                        }
                    }
                }
            } compactLeading: {
                if isScore {
                    HStack(spacing: 4) {
                        TeamBadge(side: .mine, attributes: a, size: 20)
                        CompactScore(value: s.myScore, dimmed: s.oppScore > s.myScore, lossRef: s.lossRef)
                    }
                } else {
                    LineupMiniRing(attributes: a, state: s, size: 22)
                }
            } compactTrailing: {
                if isScore {
                    HStack(spacing: 4) {
                        CompactScore(value: s.oppScore, dimmed: s.myScore > s.oppScore, lossRef: s.lossRef)
                        TeamBadge(side: .opponent, attributes: a, size: 20)
                    }
                } else {
                    LineupCountdown(attributes: a, state: s, font: .system(.caption, design: .rounded).weight(.bold))
                        .frame(maxWidth: 52)
                }
            } minimal: {
                if isScore {
                    // Both teams' badges overlapping, the leader in front (mine on a tie).
                    let mineFront = s.myScore >= s.oppScore
                    ZStack {
                        TeamBadge(side: .opponent, attributes: a, size: 20)
                            .opacity(mineFront ? 0.55 : 1)
                            .offset(x: 7)
                            .zIndex(mineFront ? 0 : 1)
                        TeamBadge(side: .mine, attributes: a, size: 20)
                            .opacity(mineFront ? 1 : 0.55)
                            .offset(x: -7)
                            .zIndex(mineFront ? 1 : 0)
                    }
                } else {
                    LineupMiniRing(attributes: a, state: s, size: 22)
                }
            }
            .keylineTint(isScore ? (PL.leadColor(mine: s.myScore, opp: s.oppScore) ?? PL.accent) : PL.lineupTint(s.phase))
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
                        LeagueBadge(attributes: attributes, size: 20, favorite: state.favorite == true)
                        Text(attributes.leagueName)
                            .font(.caption.weight(.semibold))
                            .foregroundColor(.white.opacity(0.8))
                            .lineLimit(1)
                    }
                    .padding(.horizontal, 44)
                }
            } else {
                HStack(spacing: 6) {
                    LeagueBadge(attributes: attributes, size: 18, favorite: state.favorite == true)
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
            ScoreText(value: value, dimmed: dimmed, lossRef: state.lossRef, size: 36)
                .frame(height: 40)
            RecordLine(won: won, lost: lost, push: push, live: live, isFinal: isFinal)
        }
        .frame(maxWidth: .infinity, alignment: Alignment(horizontal: alignment, vertical: .top))
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

/// One side's score in the lock-screen / island style: bold condensed, green or red like the app,
/// dimmed when that side is trailing.
struct ScoreText: View {
    let value: Double
    let dimmed: Bool
    let lossRef: Double?
    let size: CGFloat

    var body: some View {
        Text(PL.score(value))
            .font(.system(size: size, weight: .heavy))
            .fontWidth(.condensed)
            .foregroundColor(PL.scoreColor(value, lossRef: lossRef).opacity(dimmed ? 0.55 : 1))
            .lineLimit(1)
            .minimumScaleFactor(0.5)
    }
}

/// "3-1-0 . 2 live": a team's weekly W-L-P and how many picks are in a game that is on now.
struct RecordLine: View {
    let won: Int?
    let lost: Int?
    let push: Int?
    let live: Int?
    let isFinal: Bool

    var body: some View {
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
}

/// Compact island score: whole dollars, bold condensed, green / red, dimmed when trailing.
struct CompactScore: View {
    let value: Double
    let dimmed: Bool
    let lossRef: Double?

    var body: some View {
        Text(PL.scoreCompact(value))
            .font(.system(size: 17, weight: .heavy))
            .fontWidth(.condensed)
            .foregroundColor(PL.scoreColor(value, lossRef: lossRef).opacity(dimmed ? 0.6 : 1))
            .lineLimit(1)
            .minimumScaleFactor(0.6)
    }
}

/// Expanded island, one side: badge with its abbreviation, and the score (record and live count
/// under it) right beside the badge. Mirrored for the opponent so the score hugs its badge.
struct IslandSide: View {
    let side: TeamBadge.Side
    let attributes: PropLeagueActivityAttributes
    let state: PropLeagueActivityAttributes.ContentState

    var body: some View {
        let mine = side == .mine
        let isFinal = state.phase == "final"
        let value = mine ? state.myScore : state.oppScore
        let trailing = mine ? state.oppScore > state.myScore : state.myScore > state.oppScore
        let badge = VStack(spacing: 2) {
            TeamBadge(side: side, attributes: attributes, size: 38)
            Text(mine ? attributes.myAbbrev : attributes.oppAbbrev)
                .font(.caption2.weight(.bold))
                .foregroundColor(.white.opacity(0.7))
                .lineLimit(1)
        }
        let score = VStack(alignment: mine ? .leading : .trailing, spacing: 0) {
            ScoreText(value: value, dimmed: trailing, lossRef: state.lossRef, size: 34)
            RecordLine(
                won: mine ? state.myWon : state.oppWon,
                lost: mine ? state.myLost : state.oppLost,
                push: mine ? state.myPush : state.oppPush,
                live: mine ? state.myLive : state.oppLive,
                isFinal: isFinal
            )
        }
        HStack(alignment: .top, spacing: 6) {
            if mine {
                badge
                score
            } else {
                score
                badge
            }
        }
    }
}

/// Island league line when several leagues are live: the league name as a pill, tapping it brings the
/// next league's matchup in. Kept apart from the window label so it reads as a league control.
@available(iOS 17.0, *)
struct LeagueSwitchButton: View {
    let attributes: PropLeagueActivityAttributes

    var body: some View {
        Button(intent: SwitchLeagueIntent()) {
            HStack(spacing: 4) {
                Text(attributes.leagueName)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundColor(.white.opacity(0.85))
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                    .frame(maxWidth: 96)
                Image(systemName: "arrow.left.arrow.right")
                    .font(.system(size: 8, weight: .bold))
                    .foregroundColor(.white.opacity(0.6))
            }
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(Capsule().fill(Color.white.opacity(0.12)))
        }
        .buttonStyle(.plain)
    }
}

/// Expanded island, middle: league badge and window, the mini win bar, and the lead.
struct IslandScoreCenter: View {
    let attributes: PropLeagueActivityAttributes
    let state: PropLeagueActivityAttributes.ContentState

    var body: some View {
        let isFinal = state.phase == "final"
        let margin = abs(state.myScore - state.oppScore)
        let mineAhead = state.myScore > state.oppScore
        let label = isFinal ? "FINAL" : PL.shortTitle(attributes.title)
        let multi = (state.liveLeagues ?? 0) > 1
        VStack(spacing: 3) {
            HStack(spacing: 4) {
                LeagueBadge(attributes: attributes, size: 16, favorite: state.favorite == true)
                Text(label)
                    .font(.caption.weight(.bold))
                    .foregroundColor(.white.opacity(0.9))
                    .lineLimit(1)
            }
            if multi {
                if #available(iOS 17.0, *) {
                    LeagueSwitchButton(attributes: attributes)
                } else {
                    Text(attributes.leagueName)
                        .font(.system(size: 9))
                        .foregroundColor(.white.opacity(0.55))
                        .lineLimit(1)
                }
            }
            if let p = state.winProb, !isFinal {
                WinBar(probability: p, mine: attributes.myColor, opponent: attributes.oppColor)
                    .frame(width: 96)
            }
            if margin >= 0.005 {
                Text((mineAhead ? "+" : "-") + PL.score(margin))
                    .font(.caption2.weight(.semibold))
                    .foregroundColor(mineAhead ? PL.win : PL.loss)
            } else {
                Text("Even").font(.caption2).foregroundColor(.white.opacity(0.55))
            }
        }
    }
}

/// Expanded island, bottom: the lineup scroller (iOS 17+), or the league name on older iOS.
struct IslandScoreBottom: View {
    let attributes: PropLeagueActivityAttributes
    let state: PropLeagueActivityAttributes.ContentState
    let activityID: String

    var body: some View {
        if #available(iOS 17.0, *), let slots = state.slots, !slots.isEmpty, !activityID.isEmpty {
            SlotScroller(activityID: activityID, slots: slots)
        } else {
            Text(attributes.leagueName)
                .font(.caption)
                .foregroundColor(.white.opacity(0.7))
                .lineLimit(1)
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

/// A small ring for the compact and minimal island: drains toward kickoff, with the status icon inside.
struct LineupMiniRing: View {
    let attributes: PropLeagueActivityAttributes
    let state: PropLeagueActivityAttributes.ContentState
    let size: CGFloat

    var body: some View {
        let kickoff = Date(timeIntervalSince1970: attributes.kickoff)
        let now = Date()
        ZStack {
            if state.phase == "open" && kickoff > now {
                let start = min(now, kickoff.addingTimeInterval(-PL.leadSeconds))
                ProgressView(timerInterval: start...kickoff, countsDown: true) {
                    EmptyView()
                } currentValueLabel: {
                    EmptyView()
                }
                .progressViewStyle(.circular)
                .tint(PL.warn)
            } else {
                Circle().stroke(PL.lineupTint(state.phase).opacity(0.3), lineWidth: 2.5)
            }
            Image(systemName: PL.lineupIcon(state.phase))
                .font(.system(size: size * 0.42, weight: .bold))
                .foregroundColor(PL.lineupTint(state.phase))
        }
        .frame(width: size, height: size)
    }
}

/// One small capsule per roster slot, filled for each pick that is in.
struct LineupPips: View {
    let state: PropLeagueActivityAttributes.ContentState

    var body: some View {
        let total = max(state.totalSlots, 1)
        HStack(spacing: 3) {
            ForEach(0..<min(total, 12), id: \.self) { i in
                Capsule()
                    .fill(i < state.picksIn ? PL.lineupTint(state.phase) : Color.white.opacity(0.18))
                    .frame(height: 4)
            }
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
    /// The person's favorite league gets a small gold star just left of the badge.
    var favorite: Bool = false

    private var initials: String {
        let letters = attributes.leagueName.split(separator: " ").compactMap { $0.first }.prefix(2)
        return letters.isEmpty ? "L" : String(letters).uppercased()
    }

    var body: some View {
        HStack(spacing: 3) {
            // A plain gold star (a system symbol, not an emoji) to the left of the logo.
            if favorite {
                Image(systemName: "star.fill")
                    .font(.system(size: max(7, size * 0.42), weight: .bold))
                    .foregroundColor(PL.gold)
            }
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
}

// MARK: - Shared style helpers

enum PL {
    static let background = Color(hex: "#15171C")
    static let accent = Color(hex: "#34D399")
    static let warn = Color(hex: "#F59E0B")
    static let gold = Color(hex: "#F4C542")
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

    /// Green when I am ahead, red when behind, nil when tied.
    static func leadColor(mine: Double, opp: Double) -> Color? {
        if mine > opp { return win }
        if mine < opp { return loss }
        return nil
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
