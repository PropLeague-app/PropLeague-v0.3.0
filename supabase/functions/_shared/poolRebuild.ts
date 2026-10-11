// Prize pool rebuilt from stored results (1.2.11). Shared by settle-week (every time a week closes) and
// rebuild-pool (right after a commissioner changes pool settings), so both produce the same pool.

import {
  calendarIndex,
  isPlayoffPairing,
  rebuildPrizePool,
  standingsThrough,
  type PlayoffBracket,
  type PoolWeekInput,
  type PrizePool,
  type SeasonPlan,
  type WeekId,
} from './playoffLogic.ts';

export interface PoolSettingsSlice {
  buyInEnabled: boolean;
  buyInAmount: number;
  weeklyCredits: number;
  aiTeamsAffectPool: boolean;
  poolMultipliers: { enabled: boolean; basis: 'rank' | 'record' | 'seasonPL'; spread: number };
  poolTrackFromWeek: WeekId | null;
  poolMultipliersBackfill: boolean;
  poolMultipliersSince: WeekId | null;
}

/**
 * The pool from the tracking week (the season start unless the commissioner picked another) through
 * `closedWeek`, under the current pool rules. "AI teams count toward the pool" off: only human teams buy
 * in, move it and are ranked for multipliers. With buy-ins off the stored pool is returned unchanged.
 */
export function buildLeaguePool(args: {
  prior: PrizePool | null;
  settings: PoolSettingsSlice;
  teams: { id: string; is_simulated?: boolean | null }[];
  /** weekly_rosters rows: team_id, week, wagers(status, settled_profit). */
  rosterRows: { team_id: string; week: string | number; wagers?: { status: string; settled_profit: number | null }[] | null }[];
  /** matchups rows: week, team ids, scores, winner_id, is_tie. */
  matchups: { week: string | number; team_a_id: string; team_b_id: string; team_a_score: number | null; team_b_score: number | null; winner_id: string | null; is_tie: boolean | null }[];
  bracket: PlayoffBracket | null;
  plan: SeasonPlan;
  seasonStartWeek: string | null;
  closedWeek: string;
  lock: boolean;
}): PrizePool | null {
  const { settings, plan } = args;
  if (!settings.buyInEnabled) return args.prior;
  const aiIds = new Set(args.teams.filter((t) => t.is_simulated).map((t) => t.id));
  const allIds = args.teams.map((t) => t.id);
  const humanIds = allIds.filter((id) => !aiIds.has(id));
  const poolTeamIds = !settings.aiTeamsAffectPool && humanIds.length > 0 ? humanIds : allIds;
  const fromIdx = Math.max(0, calendarIndex(args.seasonStartWeek), calendarIndex(settings.poolTrackFromWeek));
  const closedIdx = calendarIndex(args.closedWeek);
  const regularSet = new Set(plan.regularWeeks.map(String));
  const poolWeeks = [...plan.regularWeeks, ...plan.playoffWeeks].filter((w) => {
    const i = calendarIndex(w);
    return i >= fromIdx && i <= closedIdx;
  });
  const betPLByWeek = new Map<string, Map<string, number>>();
  const betsByTeamWeek: { teamId: string; week: string; won: number; lost: number }[] = [];
  for (const row of args.rosterRows) {
    const wk = String(row.week);
    const byTeam = betPLByWeek.get(wk) ?? new Map<string, number>();
    let pl = 0;
    let won = 0;
    let lost = 0;
    for (const w of row.wagers ?? []) {
      pl += Number(w.settled_profit ?? 0);
      if (w.status === 'won') won++;
      else if (w.status === 'lost') lost++;
    }
    byTeam.set(row.team_id, (byTeam.get(row.team_id) ?? 0) + pl);
    betPLByWeek.set(wk, byTeam);
    betsByTeamWeek.push({ teamId: row.team_id, week: wk, won, lost });
  }
  const regularMatchups = args.matchups
    .filter((m) => !isPlayoffPairing(args.bracket, String(m.week), m.team_a_id, m.team_b_id))
    .map((m) => ({
      week: String(m.week), teamAId: m.team_a_id, teamBId: m.team_b_id,
      teamAScore: m.team_a_score, teamBScore: m.team_b_score, winnerId: m.winner_id, isTie: !!m.is_tie,
    }));
  const weekInputs: PoolWeekInput[] = poolWeeks.map((w) => {
    const regular = regularSet.has(String(w));
    return {
      week: w,
      regular,
      betPL: betPLByWeek.get(String(w)) ?? new Map(),
      standings: regular && settings.poolMultipliers.enabled ? standingsThrough(poolTeamIds, w, regularMatchups, betsByTeamWeek) : [],
    };
  });
  return rebuildPrizePool(weekInputs, {
    buyInAmount: settings.buyInAmount,
    weeklyCredits: settings.weeklyCredits,
    teamIds: poolTeamIds,
    multipliers: settings.poolMultipliers,
    multipliersFromWeek: settings.poolMultipliersBackfill ? null : settings.poolMultipliersSince,
    lock: args.lock,
  });
}
