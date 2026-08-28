import type { ActivityItem, League, Matchup, MomentCategory, PlayoffFieldSize, RosterSlotState, WeeklyRoster, WeekId } from '../types';
import { weekLabel } from '../types';
import { resultForGame, gameById, gamesForWeek } from '../data/seed';
import { settleWager, isWagerScratched } from './settlement';
import { computeWeeklyScore } from './scoring';
import { computeStandings, sortStandings } from './standings';
import { computeWeeklyMoments } from './moments';
import {
  buildBracket,
  buildConferenceBracket,
  conferenceBracketSupported,
  advanceBracket,
  teamsActiveInWeek,
  regularSeasonWeeksFor,
  playoffWeekSequence,
} from './playoffs';
import { conferencesEligible } from './conferences';
import { generateAutoLineup } from './autoLineup';
import { ClaimTracker } from './duplicatePicks';
import { buildEmptyRoster, rosterKey } from './rosterSlots';
import { ensurePool, advancePoolForWeek, lockPool, activeMultipliers } from './prizePool';

function settleRoster(roster: WeeklyRoster): WeeklyRoster {
  const slots: RosterSlotState[] = roster.slots.map((slot) => {
    if (!slot.wager || slot.wager.status !== 'pending') return slot;
    const wager = slot.wager;

    if (isWagerScratched(wager.id)) {
      return { ...slot, wager: { ...wager, status: 'push', settledProfit: 0 } };
    }
    const result = resultForGame(wager.gameId);
    if (!result) return { ...slot, wager: { ...wager, status: 'push', settledProfit: 0 } };
    const { status, profit } = settleWager(wager, result);
    return { ...slot, wager: { ...wager, status, settledProfit: profit } };
  });
  return { ...roster, slots };
}

function fieldSizeAndElim(league: League): { fieldSize: PlayoffFieldSize; eliminationType: 'single' | 'double' } {
  const fieldSize = (([2, 4, 6, 8, 16] as const).includes(league.settings.playoffTeams as PlayoffFieldSize)
    ? league.settings.playoffTeams
    : 4) as PlayoffFieldSize;
  return { fieldSize, eliminationType: league.settings.eliminationType };
}

function activeTeamsForWeek(league: League, week: WeekId): string[] {
  if (league.seasonPhase === 'regular') return league.teams.map((t) => t.id);
  if (!league.bracket) return [];
  return teamsActiveInWeek(league.bracket, week);
}

/** Builds a lightweight Matchup record (for ScheduleView/MatchupCard/etc, which all
 * read from league.matchupsByWeek) mirroring every bracket match scheduled for a week. */
function matchupsForBracketWeek(bracket: NonNullable<League['bracket']>, weekId: WeekId): Matchup[] {
  return bracket.matches
    .filter((m) => m.weekId === weekId && m.teamAId && m.teamBId)
    .map((m) => ({
      id: m.id,
      week: weekId,
      teamAId: m.teamAId as string,
      teamBId: m.teamBId as string,
      teamAScore: m.teamAScore,
      teamBScore: m.teamBScore,
      winnerId: m.winnerId,
      isTie: false,
    }));
}

export interface AdvanceWeekOptions {
  /** Also auto-fill the user's own lineup for next week, same as simulated members
   * (manual v0.03 §5 #10) — only ever passed true from the "Simulate to Week N"
   * multi-week dev jump, never from a single Advance Week click during normal play. */
  autoFillUser?: boolean;
}

export function advanceLeagueWeek(league: League, options: AdvanceWeekOptions = {}): League {
  if (league.seasonPhase === 'complete') return league;

  const week = league.currentWeek;
  const activeTeamIds = activeTeamsForWeek(league, week);
  const rostersByTeamWeek = { ...league.rostersByTeamWeek };
  const weeklyScores = new Map<string, number>();

  for (const teamId of activeTeamIds) {
    const key = rosterKey(teamId, week);
    const existing = rostersByTeamWeek[key] ?? buildEmptyRoster(teamId, week, league.settings.lineupSlots);
    const settled = settleRoster(existing);
    rostersByTeamWeek[key] = settled;
    weeklyScores.set(teamId, computeWeeklyScore(settled, league.settings));
  }

  const matchupsByWeek = { ...league.matchupsByWeek };
  const weekKey = String(week);
  if (league.seasonPhase === 'regular') {
    matchupsByWeek[weekKey] = (matchupsByWeek[weekKey] ?? []).map((m) => scoreMatchup(m, weeklyScores));
  }

  let standings = league.standings;
  if (league.seasonPhase === 'regular') {
    standings = sortStandings(
      computeStandings(league.teams.map((t) => t.id), matchupsByWeek, rostersByTeamWeek),
      matchupsByWeek,
    );
  }

  let prizePool = ensurePool(league);
  if (prizePool && league.seasonPhase === 'regular') {
    // manual v0.3.0 §8: multipliers for the week that's closing right now are based on
    // the standings *as of this same close* (the freshly-sorted `standings` above), per
    // activeMultipliers' documented contract — not `league.standings`, which is still
    // last week's numbers at this point in the function.
    const multipliers = activeMultipliers({ ...league, standings });
    prizePool = advancePoolForWeek(prizePool, week, weeklyScores, league.settings, league.teams.length, multipliers);
  }

  const { fieldSize, eliminationType } = fieldSizeAndElim(league);
  const regularSeasonWeeks = regularSeasonWeeksFor(fieldSize, eliminationType);
  const sequence = playoffWeekSequence(fieldSize, eliminationType);

  let bracket = league.bracket;
  let nextWeek: WeekId;
  let nextPhase: League['seasonPhase'];

  if (league.seasonPhase === 'regular' && week === regularSeasonWeeks) {
    if (prizePool) prizePool = lockPool(prizePool);
    const conferences = league.settings.conferences;
    const useConferences =
      league.settings.conferencesEnabled &&
      conferencesEligible(league.teams.length) &&
      conferences.length === 2 &&
      conferenceBracketSupported(fieldSize, eliminationType, conferences.length);

    if (useConferences) {
      const [confA, confB] = conferences;
      const standingsFor = (conferenceId: string) =>
        sortStandings(
          standings.filter((s) => league.teams.find((t) => t.id === s.teamId)?.conferenceId === conferenceId),
          matchupsByWeek,
        ).map((s) => s.teamId);
      bracket = buildConferenceBracket([standingsFor(confA.id), standingsFor(confB.id)], fieldSize);
    } else {
      bracket = buildBracket(standings.map((s) => s.teamId), fieldSize, eliminationType);
    }
    // Prime: resolve any matches whose sources are already known (seed-only first round).
    bracket = advanceBracket(bracket, null, () => null, sequence[0]);
    matchupsByWeek[String(sequence[0])] = matchupsForBracketWeek(bracket, sequence[0]);
    nextWeek = sequence[0];
    nextPhase = 'playoffs';
  } else if (league.seasonPhase === 'playoffs' && bracket) {
    const idx = sequence.findIndex((w) => String(w) === String(week));
    // regularSeasonWeeksFor's worst-case (bracket-reset-forced) simulation guarantees the
    // sequence always has a next slot while the bracket is still undecided; the `week`
    // fallback only exists so this can never throw or loop if that invariant is ever violated.
    const candidateNext = idx >= 0 && idx + 1 < sequence.length ? sequence[idx + 1] : week;
    bracket = advanceBracket(bracket, week, (teamId) => weeklyScores.get(teamId) ?? null, candidateNext);
    if (bracket.championId != null || candidateNext === week) {
      nextWeek = week;
      nextPhase = 'complete';
    } else {
      matchupsByWeek[String(candidateNext)] = matchupsForBracketWeek(bracket, candidateNext);
      nextWeek = candidateNext;
      nextPhase = 'playoffs';
    }
  } else if (typeof week === 'number' && week < regularSeasonWeeks) {
    nextWeek = week + 1;
    nextPhase = 'regular';
  } else {
    // Fallback safety net — shouldn't be reachable given the branches above.
    nextWeek = week;
    nextPhase = league.seasonPhase;
  }

  // Auto-submit next week's lineups for simulated members still alive — and for the
  // user too when a multi-week dev jump asked for it (manual v0.03 §5 #10).
  const autoFillUserThisPass = options.autoFillUser && league.settings.autoFillUserLineupsWhenSimulating;
  if (nextPhase !== 'complete') {
    const nextActiveTeamIds = activeTeamsForWeek({ ...league, currentWeek: nextWeek, seasonPhase: nextPhase, bracket }, nextWeek);
    const nextGames = gamesForWeek(nextWeek);
    const claims = new ClaimTracker({ ...league, rostersByTeamWeek }, nextWeek);
    for (const team of league.teams) {
      if ((!team.isSimulated && !(autoFillUserThisPass && team.isUser)) || !nextActiveTeamIds.includes(team.id)) continue;
      const key = rosterKey(team.id, nextWeek);
      if (rostersByTeamWeek[key]) continue;
      const roster = generateAutoLineup(team.id, nextWeek, league.settings, nextGames, (g, m, p, s, pt) => claims.isTaken(g, m, p, s, pt));
      claims.claimRoster(roster);
      rostersByTeamWeek[key] = roster;
    }
  }

  // manual v0.2.1 §6 #9: this snapshot must include the freshly-scored
  // `matchupsByWeek` (not just `rostersByTeamWeek`/`standings`) — computeTeamStreak
  // (via computeWeeklyMoments) reads matchupsByWeek directly, so leaving it as the
  // pre-settlement `league.matchupsByWeek` made Hot Hand/Ice Box lag exactly one week
  // behind (and let a team that just lost still show an active win streak).
  const moments =
    league.seasonPhase === 'regular' && weeklyScores.size > 0
      ? buildMomentActivity({ ...league, rostersByTeamWeek, standings, matchupsByWeek }, week, weeklyScores)
      : [];
  const activity = buildActivity(league, week, weeklyScores, bracket, nextPhase, regularSeasonWeeks);

  return {
    ...league,
    currentWeek: nextWeek,
    seasonPhase: nextPhase,
    matchupsByWeek,
    rostersByTeamWeek,
    standings,
    bracket,
    prizePool,
    manualGameOverrides: nextWeek === week ? league.manualGameOverrides : {},
    activity: [...moments, ...activity, ...league.activity].slice(0, 40),
  };
}

const MOMENT_ICONS: Record<MomentCategory, string> = {
  biggestWinner: '💥',
  biggestLoser: '🥯',
  worstBeat: '💔',
  boldestBet: '🎯',
  bestBet: '💰',
  hottestBettor: '🔥',
  coldestBettor: '🧊',
  biggestSwing: '🎢',
};

/** Bridges the pure engine/moments.ts computation into stored ActivityItems, applying
 * the commissioner's editable display names and per-category enable toggle (manual
 * v0.03 §4.5) — disabling a category is a presentation choice, so it's applied here
 * rather than inside the pure computation. */
function buildMomentActivity(league: League, week: WeekId, weeklyScores: Map<string, number>): ActivityItem[] {
  const generated = computeWeeklyMoments(league, week, weeklyScores, (id) => gameById(id), (id) => resultForGame(id));
  const ts = new Date().toISOString();
  const teamName = (id: string) => league.teams.find((t) => t.id === id)?.teamName ?? 'A team';
  const items: ActivityItem[] = [];
  for (const moment of generated) {
    const config = league.settings.moments[moment.category];
    if (!config.enabled) continue;
    items.push({
      id: `moment-${moment.category}-${league.id}-${week}`,
      ts,
      type: 'moment',
      message: `${MOMENT_ICONS[moment.category]} ${config.displayName}: ${teamName(moment.teamId)} — ${moment.extra}`,
      momentCategory: moment.category,
      momentDisplayName: config.displayName,
      momentWeek: week,
      momentTeamId: moment.teamId,
      momentExtra: moment.extra,
      momentPosition: moment.position,
    });
  }
  return items;
}

function scoreMatchup(matchup: Matchup, weeklyScores: Map<string, number>): Matchup {
  if (!weeklyScores.has(matchup.teamAId) || !weeklyScores.has(matchup.teamBId)) return matchup;
  const teamAScore = weeklyScores.get(matchup.teamAId)!;
  const teamBScore = weeklyScores.get(matchup.teamBId)!;
  const isTie = teamAScore === teamBScore;
  const winnerId = isTie ? null : teamAScore > teamBScore ? matchup.teamAId : matchup.teamBId;
  return { ...matchup, teamAScore, teamBScore, winnerId, isTie };
}

function buildActivity(
  league: League,
  settledWeek: WeekId,
  weeklyScores: Map<string, number>,
  bracket: League['bracket'],
  nextPhase: League['seasonPhase'],
  regularSeasonWeeks: number,
): ActivityItem[] {
  const items: ActivityItem[] = [];
  const userTeam = league.teams.find((t) => t.isUser);
  const ts = new Date().toISOString();
  const weekLabelStr = weekLabel(settledWeek);

  if (userTeam) {
    const score = weeklyScores.get(userTeam.id);
    if (score != null) {
      const sign = score >= 0 ? '+' : '-';
      items.push({
        id: `settled-${userTeam.id}-${settledWeek}`,
        ts,
        type: 'settled',
        message: `${weekLabelStr} final: your lineup scored ${sign}$${Math.abs(score).toFixed(2)}`,
      });
    }
  }

  if (nextPhase === 'complete' && bracket?.championId) {
    const champ = league.teams.find((t) => t.id === bracket.championId);
    if (champ) {
      items.push({
        id: `champion-${bracket.championId}`,
        ts,
        type: 'announcement',
        message: `🏆 ${champ.teamName} are the PropLeague Champions!`,
      });
    }
  } else if (league.seasonPhase === 'regular' && settledWeek === regularSeasonWeeks) {
    items.push({
      id: `playoffs-begin-${league.id}`,
      ts,
      type: 'announcement',
      message: 'Regular season complete! The playoff bracket has been seeded.',
    });
  } else if (league.seasonPhase === 'playoffs' && bracket?.matches.some((m) => m.id === 'RESET' && m.weekId === settledWeek)) {
    items.push({
      id: `bracket-reset-${league.id}-${settledWeek}`,
      ts,
      type: 'announcement',
      message: `The losers-bracket finalist forced a bracket reset — one more game decides the championship.`,
    });
  } else {
    items.push({
      id: `week-advance-${league.id}-${settledWeek}`,
      ts,
      type: 'announcement',
      message: `${weekLabelStr} is final. Build your lineup for next week.`,
    });
  }

  return items;
}
