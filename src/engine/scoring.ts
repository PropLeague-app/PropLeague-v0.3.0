import type { LeagueSettings, WeeklyRoster } from '../types';
import { americanToImpliedProbability, profitForStake } from './oddsMath';
import { settleWager, type GameResult } from './settlement';

/**
 * Spec §4: an incomplete lineup scores as a lost bet averaged across the empty/
 * unallocated slots. Mathematically that average-loss always nets out to simply
 * the unallocated dollar amount (e.g. 2 empty slots / $20 unallocated / -$10 each
 * = -$20 total), so we just negate whatever credits never got staked.
 */
export function computeIncompleteLineupPenalty(roster: WeeklyRoster, settings: LeagueSettings): number {
  const allocated = roster.slots.reduce((sum, s) => sum + (s.wager?.stake ?? 0), 0);
  const unallocated = Math.max(0, settings.weeklyCredits - allocated);
  const hasEmptySlot = roster.slots.some((s) => !s.wager);
  if (!roster.submitted || hasEmptySlot) return -unallocated;
  return 0;
}

/** Weekly team score = sum of all settled wager P/L, plus the incomplete-lineup penalty. */
export function computeWeeklyScore(roster: WeeklyRoster, settings: LeagueSettings): number {
  const settledPL = roster.slots.reduce((sum, s) => sum + (s.wager?.settledProfit ?? 0), 0);
  return settledPL + computeIncompleteLineupPenalty(roster, settings);
}

export interface DecidedGameLookup {
  /** True once a pending wager's game has revealed its result (final, or pushed early
   * to 'live'/'final' via the dev-panel day-slot stepper — manual v0.03 §5 #11). */
  isDecided: (gameId: string) => boolean;
  resultFor: (gameId: string) => GameResult | undefined;
}

/**
 * Heuristic expected score used for the League Home win-probability bar and live
 * matchup P/L: settled wagers count as-is; pending wagers whose game has already been
 * revealed (via `decided`) are scored at their actual outcome instead of a projection,
 * so mid-week dev-panel simulation visibly moves the matchup card (manual v0.03 §5
 * #11) without touching the wager's real `status` — that still only changes on Advance
 * Week. Wagers on games not yet decided fall back to the odds-implied expected value.
 */
export function expectedWeeklyScore(roster: WeeklyRoster, settings: LeagueSettings, decided?: DecidedGameLookup): number {
  const expected = roster.slots.reduce((sum, s) => {
    if (!s.wager) return sum;
    if (s.wager.status !== 'pending') return sum + (s.wager.settledProfit ?? 0);
    if (decided?.isDecided(s.wager.gameId)) {
      const result = decided.resultFor(s.wager.gameId);
      if (result) return sum + settleWager(s.wager, result).profit;
    }
    const p = americanToImpliedProbability(s.wager.oddsAtPlacement);
    const profit = profitForStake(s.wager.stake, s.wager.oddsAtPlacement);
    return sum + p * profit - (1 - p) * s.wager.stake;
  }, 0);
  return expected + computeIncompleteLineupPenalty(roster, settings);
}

export function winProbability(myExpected: number, oppExpected: number): number {
  const diff = myExpected - oppExpected;
  return 1 / (1 + Math.exp(-diff / 15));
}
