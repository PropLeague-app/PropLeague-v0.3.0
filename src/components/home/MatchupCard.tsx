import { useNavigate } from 'react-router-dom';
import type { League, LeagueTeam, Matchup, WeeklyRoster } from '../../types';
import { buildEmptyRoster, rosterKey } from '../../engine/rosterSlots';
import { expectedScoreDistribution, expectedWeeklyScore, matchupGive, matchupWinProbability, type DecidedGameLookup } from '../../engine/scoring';
import { resolveGame, gameHasStarted } from '../../services/oddsService';
import { resultForGame } from '../../data/seed';
import { useAppStore } from '../../store/useAppStore';
import { AnimatedNumber } from '../common/AnimatedNumber';
import { Card } from '../common/Card';
import { TeamLogo } from '../common/TeamLogo';

/** Per-team pick progress for the small line under the win-probability bar (see
 * chat): how many of this week's picks are still awaiting a result ("active"),
 * how many have already graded this week (with a W-L-P record), and how many
 * roster slots are still empty and need a pick placed. A team with literally
 * zero picks placed has no weekly_rosters row at all (see settle-week's own
 * comments on this), so `roster` can be undefined -- treated as "everything
 * still open" rather than crashing. */
function pickProgress(roster: WeeklyRoster | undefined, totalSlots: number): { active: number; won: number; lost: number; pushed: number; open: number } {
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

export function MatchupCard({ league, matchup, highlightTeamId }: { league: League; matchup: Matchup; highlightTeamId?: string }) {
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
  const scoreA = matchup.teamAScore ?? (rosterA ? expectedWeeklyScore(rosterA, league.settings, decided) : 0);
  const scoreB = matchup.teamBScore ?? (rosterB ? expectedWeeklyScore(rosterB, league.settings, decided) : 0);
  // matchup.teamAScore now updates live all week as picks settle (see chat --
  // settle-week writes scores progressively but only sets winnerId/isTie once
  // the whole week is actually complete), so "has a score" no longer means
  // "is final" the way it used to. Decided is winnerId/isTie being set, full stop.
  const isFinal = matchup.winnerId != null || matchup.isTie;

  // Win probability is its own model now, not just a curve on the two $ scores
  // above (see chat: Hunter's 3-part spec) -- it needs each side's full roster
  // (odds/stakes per slot, and how many slots are still empty), not just the
  // aggregate score. A team with literally no weekly_rosters row yet still needs
  // a roster shape to model against, hence the buildEmptyRoster fallback here --
  // unlike scoreA/scoreB above, expectedScoreDistribution never treats an empty
  // roster as a foregone loss, so this is safe to call on one right away.
  const distA = expectedScoreDistribution(rosterA ?? buildEmptyRoster(teamA.id, matchup.week, league.settings.lineupSlots), league.settings, decided);
  const distB = expectedScoreDistribution(rosterB ?? buildEmptyRoster(teamB.id, matchup.week, league.settings.lineupSlots), league.settings, decided);
  const prob = matchupWinProbability(distA, distB);
  const give = matchupGive(distA, distB, league.settings);

  const totalSlots = Object.values(league.settings.lineupSlots).reduce((a, b) => a + b, 0);
  // 2px at give=0 (matches the old flat divider's width) up to 16px at give=1
  // (both rosters still fully open) -- see matchupGive() in engine/scoring.
  const giveWidthPx = 2 + give * 14;
  const progressA = pickProgress(rosterA, totalSlots);
  const progressB = pickProgress(rosterB, totalSlots);

  return (
    <Card onClick={() => navigate(`/matchup/${matchup.id}`)} className="space-y-3">
      <div className="flex items-center justify-between">
        <TeamBlock team={teamA} highlighted={teamA.id === highlightTeamId} />
        <span className="text-text-muted text-xs font-bold">VS</span>
        <TeamBlock team={teamB} highlighted={teamB.id === highlightTeamId} reverse />
      </div>

      <div className="flex items-center justify-between text-xl font-bold">
        <AnimatedNumber value={scoreA} />
        <AnimatedNumber value={scoreB} />
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
        <div className="relative h-1.5 rounded-full overflow-hidden bg-bg-card border border-border">
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
          <span>{Math.round(prob * 100)}%</span>
          <span>{isFinal ? 'Final' : prob === 0.5 ? 'Even' : `${prob > 0.5 ? teamA.abbrev : teamB.abbrev} leads`}</span>
          <span>{Math.round((1 - prob) * 100)}%</span>
        </div>
        <div className="flex items-center justify-between text-[9px] text-text-muted mt-1">
          <span>
            {progressA.active} active · {progressA.won}-{progressA.lost}-{progressA.pushed} settled · {progressA.open} left
          </span>
          <span className="text-right">
            {progressB.active} active · {progressB.won}-{progressB.lost}-{progressB.pushed} settled · {progressB.open} left
          </span>
        </div>
      </div>
    </Card>
  );
}

function TeamBlock({ team, highlighted, reverse }: { team: LeagueTeam; highlighted?: boolean; reverse?: boolean }) {
  return (
    <div className={`flex items-center gap-2 min-w-0 ${reverse ? 'flex-row-reverse text-right' : ''}`}>
      <TeamLogo team={team} />
      <p className={`text-xs font-medium truncate max-w-[80px] ${highlighted ? 'text-primary' : ''}`}>{team.teamName}</p>
    </div>
  );
}
