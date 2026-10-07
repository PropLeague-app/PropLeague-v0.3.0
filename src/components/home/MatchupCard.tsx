import { useNavigate } from 'react-router-dom';
import { Triangle } from 'lucide-react';
import type { League, LeagueTeam, Matchup, RosterSlotState, WeeklyRoster } from '../../types';
import { buildEmptyRoster, rosterKey } from '../../engine/rosterSlots';
import { expectedScoreDistribution, expectedWeeklyScore, matchupGive, matchupWinProbability, type DecidedGameLookup } from '../../engine/scoring';
import { isWagerVisibleToViewer, rosterHasHiddenPicks, weekAllGamesStarted } from '../../engine/stats';
import { isPerfectWeek } from '../../engine/perfectWeek';
import { weekScaleRef } from '../../engine/plColor';
import { resolveGame, gameHasStarted } from '../../services/oddsService';
import { resultForGame } from '../../data/seed';
import { useAppStore } from '../../store/useAppStore';
import { AnimatedNumber } from '../common/AnimatedNumber';
import { Card } from '../common/Card';
import { TeamLogo } from '../common/TeamLogo';
import { FireAura } from '../common/FireAura';

/** Per-team pick progress for the small line under the win-probability bar (see
 * chat): how many of this week's picks are still awaiting a result ("active"),
 * how many have already graded this week (with a W-L-P record), and how many
 * roster slots are still empty and need a pick placed. A team with literally
 * zero picks placed has no weekly_rosters row at all (see settle-week's own
 * comments on this), so `roster` can be undefined -- treated as "everything
 * still open" rather than crashing. */
// Exported so MatchupDetail (the Matchup screen) can show the exact same
// weekly-record line under each team header instead of duplicating this
// logic a second time (see chat, Sept 2026: "replaced with the same weekly
// bet record that appears on the Home screen matchup bubbles").
export function pickProgress(roster: WeeklyRoster | undefined, totalSlots: number): { active: number; won: number; lost: number; pushed: number; open: number } {
  if (!roster) return { active: 0, won: 0, lost: 0, pushed: 0, open: totalSlots };
  let active = 0;
  let won = 0;
  let lost = 0;
  let pushed = 0;
  for (const slot of roster.slots) {
    const status = slot.wager?.status;
    if (!status) continue;
    if (status === 'pending') active++;
    else if (status === 'won') won++;
    else if (status === 'lost') lost++;
    // Voided folds into the push bucket, same as the Standings screen and
    // settle-week's standings tally (a voided pick is $0, stake spent, slot
    // not reopened) -- before, it matched no branch, so it vanished from the
    // settled record and its slot was miscounted as still open.
    else if (status === 'push' || status === 'voided') pushed++;
  }
  const placed = active + won + lost + pushed;
  return { active, won, lost, pushed, open: Math.max(0, totalSlots - placed) };
}

/** Renders pickProgress's counts as "N active · W-L-P settled · N left" -- but
 * only includes a category when it's actually populated. Before, this was a
 * fixed three-part string always shown in full, so a fully-settled matchup
 * read as a noisy "0 active · 7-0-1 settled · 0 left" -- and on the Matchup
 * screen's narrower team-header column, that extra dead text is exactly what
 * pushed the line into mid-word truncation (see chat, Sept 2026: "we just
 * need the pure record, and how many unsettled... if any of those categories
 * are empty... those should be removed"). The settled W-L-P record is the
 * "pure record" and always shows; active/left are the "how many unsettled"
 * piece and only show up when there's actually something left to report. */
export function formatProgressLine(
  progress: { active: number; won: number; lost: number; pushed: number; open: number },
  /** An opponent with hidden picks: active and left counts would reveal how many they placed. */
  hideCounts = false,
): string {
  const segments: string[] = [];
  if (!hideCounts && progress.active > 0) segments.push(`${progress.active} active`);
  segments.push(`${progress.won}-${progress.lost}-${progress.pushed} settled`);
  if (!hideCounts && progress.open > 0) segments.push(`${progress.open} left`);
  return segments.join(' · ');
}

/** `compact` (see chat, Sept 2026) renders the exact same real computation --
 * win probability, give, per-team scores, hidePicks-aware "decided" lookup --
 * just visually smaller and without the settled-pick-count line, for the Home
 * screen's "Other Matchups" disclosure. Deliberately NOT a separate hand-rolled
 * component: an earlier attempt at that duplicated (and got wrong) logic this
 * component already has right, including status text ('Final'/'Even'/'X leads'
 * -- there's no separate "Upcoming" state to get out of sync with reality). */
export function MatchupCard({
  league,
  matchup,
  highlightTeamId,
  compact,
}: {
  league: League;
  matchup: Matchup;
  highlightTeamId?: string;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  // Real games for this matchup's week -- LeagueHome (the only place this card
  // is rendered) already loads them, this just reads what's there (see chat:
  // getGame() alone can't see real games at all, which made every real,
  // genuinely-upcoming game read as "decided").
  const realGamesById = useAppStore((s) => s.realGamesById);
  const teamA = league.teams.find((t) => t.id === matchup.teamAId);
  const teamB = league.teams.find((t) => t.id === matchup.teamBId);
  if (!teamA || !teamB) return null;

  const rosterA = league.rostersByTeamWeek[rosterKey(teamA.id, matchup.week)];
  const rosterB = league.rostersByTeamWeek[rosterKey(teamB.id, matchup.week)];

  const decided: DecidedGameLookup = {
    isDecided: (gameId) =>
      gameHasStarted(resolveGame(gameId, realGamesById, league.currentWeek, league.settings.lineMovementEnabled, league.manualGameOverrides)),
    resultFor: (gameId) => resultForGame(gameId),
  };
  // hide-picks: match MatchupDetail's masking so this card's own score preview
  // can't reveal a still-hidden opponent pick's stake before its own game has
  // started (see engine/scoring.ts's isSlotHidden param doc).
  const buildSlotHider = (team: LeagueTeam) => {
    if (team.isUser || !league.settings.hidePicks) return undefined;
    return (s: RosterSlotState) =>
      !!s.wager &&
      !isWagerVisibleToViewer({
        isOwnTeam: false,
        hidePicks: league.settings.hidePicks,
        wagerWeek: matchup.week,
        currentWeek: league.currentWeek,
        wagerStatus: s.wager.status,
        gameStarted: decided.isDecided(s.wager.gameId),
      });
  };
  const scoreA = matchup.teamAScore ?? (rosterA ? expectedWeeklyScore(rosterA, league.settings, decided, buildSlotHider(teamA)) : 0);
  const scoreB = matchup.teamBScore ?? (rosterB ? expectedWeeklyScore(rosterB, league.settings, decided, buildSlotHider(teamB)) : 0);
  // matchup.teamAScore now updates live all week as picks settle (see chat --
  // settle-week writes scores progressively but only sets winnerId/isTie once
  // the whole week is actually complete), so "has a score" no longer means
  // "is final" the way it used to. Decided is winnerId/isTie being set, full stop.
  const isFinal = matchup.winnerId != null || matchup.isTie;

  // hide-picks: an opponent with a still-hidden pick has no safe score preview, win probability or pick
  // count (the unspent-credits penalty and the model both depend on the hidden stakes), so the score
  // reads "$-", the odds even out and only the settled record shows, until the picks go live. A score the
  // server already wrote (graded picks only) is safe.
  const weekLocked = weekAllGamesStarted(Object.values(realGamesById), matchup.week);
  const hideCtx = {
    hidePicks: league.settings.hidePicks,
    hideEmptySlots: league.settings.hideEmptySlots,
    week: matchup.week,
    currentWeek: league.currentWeek,
    weekLocked,
    isGameStarted: decided.isDecided,
  };
  const hiddenA = rosterHasHiddenPicks(rosterA, { ...hideCtx, isOwnTeam: teamA.isUser });
  const hiddenB = rosterHasHiddenPicks(rosterB, { ...hideCtx, isOwnTeam: teamB.isUser });
  const scoreHiddenA = hiddenA && matchup.teamAScore == null;
  const scoreHiddenB = hiddenB && matchup.teamBScore == null;
  const probHidden = (hiddenA || hiddenB) && !isFinal;

  // Win probability is its own model now, not just a curve on the two $ scores
  // above (see chat: Hunter's 3-part spec) -- it needs each side's full roster
  // (odds/stakes per slot, and how many slots are still empty), not just the
  // aggregate score. A team with literally no weekly_rosters row yet still needs
  // a roster shape to model against, hence the buildEmptyRoster fallback here --
  // unlike scoreA/scoreB above, expectedScoreDistribution never treats an empty
  // roster as a foregone loss, so this is safe to call on one right away.
  const distA = expectedScoreDistribution(rosterA ?? buildEmptyRoster(teamA.id, matchup.week, league.settings.lineupSlots), league.settings, decided);
  const distB = expectedScoreDistribution(rosterB ?? buildEmptyRoster(teamB.id, matchup.week, league.settings.lineupSlots), league.settings, decided);
  const prob = probHidden ? 0.5 : matchupWinProbability(distA, distB);
  const give = probHidden ? 0 : matchupGive(distA, distB, league.settings);

  const totalSlots = Object.values(league.settings.lineupSlots).reduce((a, b) => a + b, 0);
  // 2px at give=0 (matches the old flat divider's width) up to 16px at give=1
  // (both rosters still fully open) -- see matchupGive() in engine/scoring.
  const giveWidthPx = 2 + give * 14;
  const progressA = pickProgress(rosterA, totalSlots);
  const progressB = pickProgress(rosterB, totalSlots);

  // Who's ahead, for the small leader triangle on the team name (see chat,
  // Sept 2026: "particularly for matchups where both teams are negative $,
  // it can be a bit tough to tell who is winning at a glance"). Deliberately
  // reuses the exact same source the "X leads"/"Final" text below already
  // uses -- matchup.winnerId once final, otherwise the win-probability model
  // -- rather than comparing scoreA/scoreB directly, so the new triangle can
  // never contradict the text sitting right next to it. null/undefined (tie,
  // or prob exactly 0.5) means no one gets the triangle.
  const scaleRef = weekScaleRef(league, matchup.week, [scoreHiddenA ? 0 : scoreA, scoreHiddenB ? 0 : scoreB]);
  const perfectA = isPerfectWeek(rosterA, league.settings, isFinal);
  const perfectB = isPerfectWeek(rosterB, league.settings, isFinal);
  const leaderId = isFinal ? matchup.winnerId : prob === 0.5 ? null : prob > 0.5 ? teamA.id : teamB.id;

  return (
    <Card
      onClick={() => navigate(`/matchup/${matchup.id}`)}
      dense={compact}
      className={`${compact ? 'space-y-1.5' : 'space-y-3'} ${perfectA || perfectB ? 'pl-slip' : ''} ${perfectA ? 'pl-slip-l' : ''} ${perfectB ? 'pl-slip-r' : ''}`}
    >
      <div className="flex items-center gap-1.5">
        <TeamBlock
          team={teamA}
          highlighted={teamA.id === highlightTeamId}
          trailing={leaderId != null && leaderId !== teamA.id}
          perfect={perfectA}
          compact={compact}
        />
        {/* Single shared indicator on the VS itself, not per-team (see chat, Sept
            2026 -- v2): points toward whichever side is actually ahead rather than
            marking the winner's own name, and both sides always render a triangle
            now -- white for whoever's ahead, dark gray (text-muted, same as VS
            itself) for the other side -- rather than the losing one just vanishing
            at opacity-0 (see chat: a single lone white triangle read as
            "off-centered," not "this side is winning," without a second triangle
            to balance it visually). A tie/50-50 leaves both gray. White (not gold)
            per Hunter's ask -- gold was reading as too close to "you won the week"
            (WeeklyResultPopup's color), and this is a much lower-stakes,
            live-updating signal.
            h-9/h-4 (matching TeamLogo's own w-9/w-4 circle at each size, see
            TeamLogo.tsx's SIZE_CLASSES) pins this span to the exact same explicit
            height the logo sits in, rather than an implicit auto height computed
            from its own (much shorter) text+icon content -- see chat, Sept 2026:
            "VS...should always be in the same spot vertically, from one matchup
            bubble to the next." Without it, this span's height was whatever the
            browser happened to compute for a ~16px text+icon row, centered inside
            the taller logo row by `items-center` -- correct in theory, but left the
            exact pixel up to browser rounding instead of pinning it to the same
            fixed number every TeamBlock's logo already uses.
            opacity-40 on the trailing triangle (on top of text-muted's own dimmer
            gray) per Hunter's follow-up -- "gray out more, dark-gray" -- so it reads
            clearly as the secondary/losing side rather than competing with the
            white leading triangle. */}
        <span
          className={`flex items-center justify-center gap-1 text-text-muted text-xs font-bold shrink-0 ${compact ? 'h-4' : 'h-9'}`}
        >
          <Triangle
            size={7}
            className={`-rotate-90 shrink-0 ${leaderId === teamA.id ? 'fill-white text-white' : 'fill-text-muted text-text-muted opacity-40'}`}
          />
          <span className="leading-none">VS</span>
          <Triangle
            size={7}
            className={`rotate-90 shrink-0 ${leaderId === teamB.id ? 'fill-white text-white' : 'fill-text-muted text-text-muted opacity-40'}`}
          />
        </span>
        <TeamBlock
          team={teamB}
          highlighted={teamB.id === highlightTeamId}
          trailing={leaderId != null && leaderId !== teamB.id}
          reverse
          perfect={perfectB}
          compact={compact}
        />
      </div>

      <div className={`flex items-center justify-between font-bold ${compact ? 'text-sm' : 'text-xl'}`}>
        {scoreHiddenA ? <HiddenScore /> : <AnimatedNumber value={scoreA} scaleRef={scaleRef} perfect={perfectA} />}
        {scoreHiddenB ? <HiddenScore /> : <AnimatedNumber value={scoreB} scaleRef={scaleRef} perfect={perfectB} />}
      </div>

      <div>
        {/* Both halves are the teams' own colors, meeting at a divider whose width
            reflects how settled the matchup actually is (see give comment below) --
            needed even when both teams happen to have picked the same color (see
            chat). The trailing side is dimmed down (not at an exact tie) so a fixed
            color never reads as an inherent enemy/loser -- whoever is actually
            behind is the one that's muted, whichever side of the card that is (see
            chat: "it has to function more like ... starts even, but then supports
            whoever is winning"). The bar and the team badges both get a hairline
            border so they stay visible even against a background close to a team's
            own color. Requires every team to have a real logoColor even in Image
            mode, which IdentityPicker now always collects. */}
        <div className={`relative ${compact ? 'h-1' : 'h-1.5'} rounded-full overflow-hidden bg-bg-card border border-border`}>
          <div
            className="absolute inset-y-0 left-0 h-full transition-all duration-500"
            style={{ width: `calc(${prob * 100}% - ${giveWidthPx / 2}px)`, backgroundColor: teamA.logoColor, opacity: prob < 0.5 ? 0.4 : 1 }}
          />
          <div
            className="absolute inset-y-0 right-0 h-full transition-all duration-500"
            style={{ width: `calc(${(1 - prob) * 100}% - ${giveWidthPx / 2}px)`, backgroundColor: teamB.logoColor, opacity: prob > 0.5 ? 0.4 : 1 }}
          />
          {/* The seam between the two fills isn't a fixed 2px line anymore --
              its width now breathes with `give` (see chat: a fully-undecided week
              should read as less locked-in than one where only a coinflip prop or
              two remains). Two overlapping gradients, each fading its own team's
              (muting-adjusted) color toward transparent over the bar's own
              background, replace the old flat bg-bg-card divider rect; at give=0
              they collapse to the same ~2px hard edge the flat divider used to be. */}
          <div
            className="absolute inset-y-0 transition-all duration-500"
            style={{
              left: `calc(${prob * 100}% - ${giveWidthPx / 2}px)`,
              width: `${giveWidthPx}px`,
              background: `linear-gradient(to right, ${teamA.logoColor}, transparent)`,
              opacity: prob < 0.5 ? 0.4 : 1,
            }}
          />
          <div
            className="absolute inset-y-0 transition-all duration-500"
            style={{
              left: `calc(${prob * 100}% - ${giveWidthPx / 2}px)`,
              width: `${giveWidthPx}px`,
              background: `linear-gradient(to left, ${teamB.logoColor}, transparent)`,
              opacity: prob > 0.5 ? 0.4 : 1,
            }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-text-muted mt-1">
          <span>{probHidden ? '–%' : `${Math.round(prob * 100)}%`}</span>
          <span>{isFinal ? 'Final' : probHidden ? '–' : prob === 0.5 ? 'Even' : `${prob > 0.5 ? teamA.abbrev : teamB.abbrev} leads`}</span>
          <span>{probHidden ? '–%' : `${Math.round((1 - prob) * 100)}%`}</span>
        </div>
        {!compact && (
          <div className="flex items-center justify-between text-[9px] text-text-muted mt-1">
            <span>{formatProgressLine(progressA, hiddenA)}</span>
            <span className="text-right">{formatProgressLine(progressB, hiddenB)}</span>
          </div>
        )}
      </div>
    </Card>
  );
}

/** Stands in for an opponent's score while their picks are hidden: same size and weight as the number. */
function HiddenScore() {
  return <span className="text-text-muted">$–</span>;
}

function TeamBlock({
  team,
  highlighted,
  trailing,
  reverse,
  perfect = false,
  compact,
}: {
  team: LeagueTeam;
  highlighted?: boolean;
  trailing?: boolean;
  reverse?: boolean;
  /** A perfect week: flames behind the logo and the name drawn as fire. */
  perfect?: boolean;
  compact?: boolean;
}) {
  // flex-1 + min-w-0 (see chat, Sept 2026 -- truncation fix): each side now claims an
  // equal share of whatever width is actually left after the logo and "VS" text,
  // rather than truncating at a fixed 68/80px cap regardless of how much room the
  // card actually has. Still truncates (never wraps/overflows) for a genuinely long
  // name, but most real team names now show in full.
  //
  // `trailing` (see chat, Sept 2026 -- v2 of the leader indicator) dims the losing
  // side's name instead of highlighting the winning one -- the arrow next to VS
  // already marks who's ahead, so this just needs to read as "not that one" at a
  // glance. `highlighted` (own team, primary blue) wins out over the dimming when
  // both apply, since "this is you" is the stronger signal to preserve.
  return (
    <div className={`flex items-center gap-1.5 min-w-0 flex-1 ${reverse ? 'flex-row-reverse text-right' : ''}`}>
      <FireAura active={perfect}>
        <TeamLogo team={team} size={compact ? 'xs' : 'md'} />
      </FireAura>
      <p
        className={`relative text-xs font-medium truncate min-w-0 ${perfect ? 'pl-fire-name' : highlighted ? 'text-primary' : trailing ? 'text-text-muted' : ''}`}
      >
        {team.teamName}
      </p>
    </div>
  );
}
