import type { League, LeagueSettings, MultiplierBasis, PlayoffBracket, PrizePool, TeamStanding, WeekId } from '../types';
import { championAndRunnerUp } from './playoffs';

export { championAndRunnerUp };

/** Σ buy-ins across the league — the pool's starting value (manual §Buy-In & Prize Pool). */
export function initialPoolAmount(teamCount: number, buyInAmount: number): number {
  return teamCount * buyInAmount;
}

/** A wager's virtual stake/profit converts to real dollars proportional to how much of
 * the week's credit budget it used, applied against the team's 1/N share of the pool:
 * staking $20 of $100 weekly credits ($100 pool / 10 teams = $10 share) wagers 20% of
 * that $10 share = $2.00 real. */
export function realDollarAmount(virtualAmount: number, weeklyCredits: number, poolBefore: number, teamCount: number): number {
  if (weeklyCredits <= 0 || teamCount <= 0) return 0;
  const perTeamShare = poolBefore / teamCount;
  return (virtualAmount / weeklyCredits) * perTeamShare;
}

/** Lazily creates the pool the first time buy-ins are enabled for a league that doesn't
 * have one yet. Once a week has actually settled (`history.length > 0`), this is a
 * no-op — buy-in amount changes mid-season don't retroactively resize an
 * already-running pool, matching the "future weeks only" settings policy. But
 * manual v0.2.1 §5 #7: pre-season (no settled history yet), there's nothing to
 * protect, so this keeps recomputing `initial`/`current` from the current buy-in
 * amount and team count — otherwise a commissioner who toggles buy-in on and *then*
 * sets the per-team amount (the natural order) would get the pool stuck at the
 * default $0 it briefly existed at. */
export function ensurePool(league: League): PrizePool | null {
  if (!league.settings.buyInEnabled) return league.prizePool;
  const amount = initialPoolAmount(league.teams.length, league.settings.buyInAmount);
  if (league.prizePool && (league.prizePool.history.length > 0 || league.prizePool.locked)) return league.prizePool;
  return { initial: amount, current: amount, locked: false, history: [] };
}

/** Advances the pool by one settled week: every active team's virtual weekly P/L
 * (already computed by computeWeeklyScore) converts to real dollars via the same
 * proportional formula — scaled by that team's impact multiplier (manual v0.3.0 §8,
 * defaulting to 1.0x for every team when the feature is off) — and sums into the
 * pool's net movement. Never goes negative; locks automatically once it hits (near)
 * zero, or once the regular season ends — playoffs decide who wins the pool, not how
 * much it's worth. `weeklyVirtualScores` is keyed by teamId (not a plain array) so
 * each score can be paired with its own team's multiplier. */
export function advancePoolForWeek(
  pool: PrizePool,
  week: WeekId,
  weeklyVirtualScores: Map<string, number>,
  settings: LeagueSettings,
  teamCount: number,
  multipliers: Record<string, number> = {},
): PrizePool {
  if (pool.locked) return pool;
  let netRealPL = 0;
  for (const [teamId, score] of weeklyVirtualScores) {
    netRealPL += realDollarAmount(score, settings.weeklyCredits, pool.current, teamCount) * (multipliers[teamId] ?? 1);
  }
  const poolAfter = Math.max(0, pool.current + netRealPL);
  const locked = poolAfter <= 0.01;
  return {
    ...pool,
    current: poolAfter,
    locked,
    history: [...pool.history, { week, poolBefore: pool.current, poolAfter, netRealPL }],
  };
}

// --- Prize pool impact multipliers (manual v0.3.0 §8) -----------------------

/** Slider endpoint: spread=1 produces exactly the spec's worked example (1.2x top,
 * 0.8x bottom). The 0.5x-1.5x hard cap below is a separate, wider safety net — at
 * spread=1 it never actually engages, but stays in place as an invariant regardless
 * of how the curve above it might change later. */
const MULTIPLIER_SPREAD_AT_MAX = 0.2;
const MULTIPLIER_HARD_MIN = 0.5;
const MULTIPLIER_HARD_MAX = 1.5;

/** What the top/bottom multiplier would be at a given spread, before the hard-cap
 * clamp and mean-1.0 normalization — exposed so the settings UI can show "1.2x top /
 * 0.8x bottom" as the slider moves without hardcoding MULTIPLIER_SPREAD_AT_MAX
 * separately from the actual calculation. */
export function multiplierRangeForSpread(spread: number): { top: number; bottom: number } {
  const clamped = Math.max(0, Math.min(1, spread));
  return { top: 1 + clamped * MULTIPLIER_SPREAD_AT_MAX, bottom: 1 - clamped * MULTIPLIER_SPREAD_AT_MAX };
}

/** Best-to-worst team order for multiplier purposes. 'rank' trusts the standings
 * array's existing order (the full W-L/P/L/bets/H2H/best-week tiebreaker chain,
 * already applied by engine/standings.ts's sortStandings before this ever runs);
 * 'record' and 'seasonPL' re-rank by just that one number, breaking ties by teamId
 * for a deterministic (if arbitrary) order. */
function orderTeamsForMultiplier(standings: TeamStanding[], basis: MultiplierBasis): string[] {
  if (basis === 'rank') return standings.map((s) => s.teamId);
  const rows = [...standings];
  if (basis === 'seasonPL') {
    rows.sort((a, b) => b.totalPL - a.totalPL || a.teamId.localeCompare(b.teamId));
  } else {
    rows.sort((a, b) => {
      const gamesA = a.wins + a.losses + a.ties;
      const gamesB = b.wins + b.losses + b.ties;
      const pctA = gamesA > 0 ? (a.wins + a.ties * 0.5) / gamesA : 0;
      const pctB = gamesB > 0 ? (b.wins + b.ties * 0.5) / gamesB : 0;
      return pctB - pctA || a.teamId.localeCompare(b.teamId);
    });
  }
  return rows.map((r) => r.teamId);
}

/** Builds every team's real-dollar impact multiplier for the given standings/basis/
 * spread. However the raw curve is computed, this always normalizes the result so it
 * averages exactly 1.0 across the league (manual v0.3.0 §8's core constraint) — a
 * team's boost necessarily comes out of the others' shares, never out of thin air, so
 * total real-dollar exposure is provably unchanged by turning this on. Normalizing
 * *after* the hard-cap clamp keeps that guarantee even if some future curve change
 * makes the clamp actually engage (today, at the declared spread range, it never does). */
export function computeStandingMultipliers(standings: TeamStanding[], basis: MultiplierBasis, spread: number): Record<string, number> {
  const n = standings.length;
  if (n === 0) return {};
  const order = orderTeamsForMultiplier(standings, basis);
  const clampedSpread = Math.max(0, Math.min(1, spread));
  const high = 1 + clampedSpread * MULTIPLIER_SPREAD_AT_MAX;
  const low = 1 - clampedSpread * MULTIPLIER_SPREAD_AT_MAX;
  const raw = order.map((_, i) => (n === 1 ? 1 : high - (high - low) * (i / (n - 1))));
  const clamped = raw.map((v) => Math.max(MULTIPLIER_HARD_MIN, Math.min(MULTIPLIER_HARD_MAX, v)));
  const sum = clamped.reduce((a, b) => a + b, 0);
  const scale = sum > 0 ? n / sum : 1;
  const result: Record<string, number> = {};
  order.forEach((teamId, i) => {
    result[teamId] = clamped[i] * scale;
  });
  return result;
}

/** League-aware entry point: every team gets a flat 1.0x whenever the feature is off
 * or the league is in the playoffs (manual v0.3.0 §8's "turns off in the playoffs"),
 * otherwise delegates to computeStandingMultipliers using whatever `league.standings`
 * currently holds. That single field is deliberately the only source of "current
 * standings" this reads: mid-week (before a close), it's still last week's numbers —
 * exactly what a bet-slip preview should show, since this week hasn't happened yet —
 * and at the moment a week closes, callers pass the freshly recomputed standings for
 * that same week, so "recomputed at each weekly close from current standings" (the
 * spec's own phrasing) is satisfied without two separate code paths. */
export function activeMultipliers(league: League): Record<string, number> {
  const cfg = league.settings.poolMultipliers;
  if (!cfg.enabled || league.seasonPhase !== 'regular') {
    return Object.fromEntries(league.teams.map((t) => [t.id, 1]));
  }
  return computeStandingMultipliers(league.standings, cfg.basis, cfg.spread);
}

export function lockPool(pool: PrizePool): PrizePool {
  return pool.locked ? pool : { ...pool, locked: true };
}

export interface PayoutEntry {
  teamId: string;
  place: number; // 1-indexed: 1 = champion, 2 = runner-up, 3+ = see payoutPlacementOrder
  pct: number;
  amount: number;
}

/** manual v0.3.0 §4: commissioner-chosen percentages, one per paid place, summing to
 * exactly 100 — every paid place must be > 0%, and the number of paid places can't
 * exceed the playoff field (there's no one to pay beyond however many teams actually
 * make the playoffs — and the playoff field is itself always <= the league's team
 * count, so this also satisfies the spec's "paid places <= league team count").
 * Engine-level so Settings can block Save with this exact message rather than only
 * checking it in the UI. */
export function validatePayoutSplit(splits: number[], playoffTeams: number): { valid: boolean; reason?: string } {
  if (splits.length === 0) return { valid: false, reason: 'At least one place must be paid.' };
  if (splits.length > playoffTeams) return { valid: false, reason: `Can't pay out more places (${splits.length}) than playoff teams (${playoffTeams}).` };
  if (splits.some((pct) => !(pct > 0))) return { valid: false, reason: 'Every paid place must be more than 0%.' };
  const sum = splits.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 100) > 0.01) return { valid: false, reason: `Percentages must sum to exactly 100% (currently ${sum.toFixed(1)}%).` };
  return { valid: true };
}

/** Season-end finish order by team, 1st place first. PropLeague doesn't run true
 * placement/consolation games beyond the championship, so only the top two places
 * (champion, runner-up) reflect actual playoff results — every place after that
 * falls back to regular-season seed order among the remaining playoff qualifiers,
 * which is the best information available without adding a full placement bracket. */
export function payoutPlacementOrder(bracket: PlayoffBracket | null): string[] {
  const { championId, runnerUpId } = championAndRunnerUp(bracket);
  if (!championId || !bracket) return [];
  const rest = bracket.seeds.filter((id) => id !== championId && id !== runnerUpId);
  return runnerUpId ? [championId, runnerUpId, ...rest] : [championId, ...rest];
}

/** Season-end payout report, only meaningful once the bracket has crowned a champion.
 * Renders every paid place from settings.payoutSplits against the placement order
 * above — silently stops early if the bracket has fewer teams than paid places
 * (shouldn't happen given validatePayoutSplit's teamCount cap, but keeps this total
 * regardless). */
export function computePayouts(pool: PrizePool, bracket: PlayoffBracket | null, settings: LeagueSettings): PayoutEntry[] {
  const order = payoutPlacementOrder(bracket);
  if (order.length === 0) return [];
  const entries: PayoutEntry[] = [];
  settings.payoutSplits.forEach((pct, i) => {
    const teamId = order[i];
    if (!teamId) return;
    entries.push({ teamId, place: i + 1, pct, amount: pool.current * (pct / 100) });
  });
  return entries;
}
