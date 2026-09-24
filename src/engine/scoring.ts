import type { LeagueSettings, RosterSlotState, WeeklyRoster } from '../types';
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
export function expectedWeeklyScore(
  roster: WeeklyRoster,
  settings: LeagueSettings,
  decided?: DecidedGameLookup,
  // hide-picks (manual v0.3.0 §5): masks a still-hidden opponent pick's dollar
  // contribution out of the shown score entirely, rather than folding its EV in
  // unmasked -- otherwise the team-level number leaked exactly how much was
  // staked on a pick whose own roster card correctly said 'Hidden' (see chat,
  // Sept 2026 -- Wilhelm's \$95 total was fully attributable to its one hidden
  // pending pick). Deliberately left OUT of computeIncompleteLineupPenalty below --
  // that penalty reflects real unallocated-credit facts about the roster and must
  // stay accurate regardless of what's visually hidden, or a hidden pick would
  // wrongly read as an empty slot and get double-penalized on top of just not
  // showing its value. Callers build this from the same isWagerVisibleToViewer
  // predicate collectTeamBets/BetHistory already use, so a pick's score-line
  // visibility and its roster-card visibility can never drift apart.
  isSlotHidden?: (slot: RosterSlotState) => boolean,
): number {
  const expected = roster.slots.reduce((sum, s) => {
    if (!s.wager) return sum;
    if (isSlotHidden?.(s)) return sum;
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

/** Standard normal CDF via the Abramowitz & Stegun erf approximation (max error
 * ~1.5e-7 -- plenty for a UI probability bar, and no stats-library dependency
 * needed for one function). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

export interface ScoreDistribution {
  mean: number;
  variance: number;
}

/**
 * Mean + variance for a team's expected weekly score -- replaces the old flat
 * myExpected/oppExpected-only win probability model (see chat, Hunter's 3-part
 * spec for what this needed to account for):
 *  1) an empty, never-touched slot still contributes -- a "phantom" bet sized off
 *     the credits not yet allocated, split evenly across the slots still open,
 *     modeled as a neutral (mean 0) coin-flip risking that amount, so a team
 *     with more left to decide reads as genuinely less locked-in rather than a
 *     flat, unaccounted-for zero. Scales automatically with however many lineup
 *     slots this league is configured for -- there's no hardcoded slot count
 *     anywhere here, just roster.slots.length and settings.weeklyCredits.
 *  2) a still-pending wager with known odds contributes both the existing EV
 *     formula as its mean AND a variance term (p * (1-p) * (profit+stake)^2) --
 *     so a small stake on a heavy favorite barely moves the distribution (both
 *     its mean and its variance are small) while a real stake on a real
 *     swing genuinely does (see chat: the -300 vs +300 example). A settled or
 *     already-decided slot contributes a known value at zero variance.
 * matchupWinProbability() below is the only consumer of this -- it is
 * deliberately NOT what's shown anywhere as the team's actual $ score (that
 * stays expectedWeeklyScore, unchanged).
 */
export function expectedScoreDistribution(roster: WeeklyRoster, settings: LeagueSettings, decided?: DecidedGameLookup): ScoreDistribution {
  let mean = 0;
  let variance = 0;
  let allocated = 0;
  let emptySlots = 0;

  for (const s of roster.slots) {
    if (!s.wager) {
      emptySlots++;
      continue;
    }
    allocated += s.wager.stake;
    if (s.wager.status !== 'pending') {
      mean += s.wager.settledProfit ?? 0;
      continue;
    }
    if (decided?.isDecided(s.wager.gameId)) {
      const result = decided.resultFor(s.wager.gameId);
      if (result) {
        mean += settleWager(s.wager, result).profit;
        continue;
      }
    }
    const p = americanToImpliedProbability(s.wager.oddsAtPlacement);
    const profit = profitForStake(s.wager.stake, s.wager.oddsAtPlacement);
    mean += p * profit - (1 - p) * s.wager.stake;
    variance += p * (1 - p) * (profit + s.wager.stake) ** 2;
  }

  if (emptySlots > 0) {
    const unallocated = Math.max(0, settings.weeklyCredits - allocated);
    const phantomStake = unallocated / emptySlots;
    // Same variance formula as a real wager above, just evaluated at an assumed
    // p = 0.5 / profit = stake (a neutral, even-odds coin flip of that size) --
    // deliberately NOT the incomplete-lineup penalty (a certain loss, only ever
    // assessed at the actual deadline) -- this is mid-week uncertainty, not yet
    // a foregone conclusion either way.
    variance += emptySlots * phantomStake ** 2;
  }

  return { mean, variance };
}

/** P(team A's final score beats team B's), from each side's (mean, variance) --
 * a normal approximation of the sum-of-independent-bets distribution (reasonable
 * with a handful of slots per side; see chat -- exact enumeration would be
 * heavier for no perceptible difference). Degenerates to a clean step function
 * once both sides have zero variance left (everything settled or decided) --
 * at that point there IS a real winner/loser/tie, not a probability (see chat:
 * "if 2 teams are fully settled and there is no variance, there will be a
 * legitimate winner/loser"). */
/**
 * How much "give" is left in a matchup's win-probability split -- 1.0 when
 * both sides are still fully open (max possible variance for this league's
 * lineup size), draining toward 0 as picks settle and the outcome locks in.
 * Purely a display concept (see chat: soften the divider line between the
 * two team-color bar segments when there's still real uncertainty left,
 * rather than always drawing a crisp boundary). Normalized against this
 * same league's own fully-empty-roster variance rather than a hardcoded
 * constant, so it self-scales with however many lineup slots a league uses
 * and whatever weeklyCredits it's set to.
 */
export function matchupGive(a: ScoreDistribution, b: ScoreDistribution, settings: LeagueSettings): number {
  const totalSlots = Object.values(settings.lineupSlots).reduce((sum, n) => sum + n, 0);
  if (totalSlots <= 0) return 0;
  // Both rosters fully empty: emptySlots === totalSlots, phantomStake ===
  // weeklyCredits / totalSlots, variance === totalSlots * phantomStake^2 ===
  // weeklyCredits^2 / totalSlots -- see expectedScoreDistribution above.
  const maxVarSum = (2 * settings.weeklyCredits ** 2) / totalSlots;
  if (maxVarSum < 1e-9) return 0;
  const varSum = a.variance + b.variance;
  return Math.max(0, Math.min(1, Math.sqrt(varSum / maxVarSum)));
}

export function matchupWinProbability(a: ScoreDistribution, b: ScoreDistribution): number {
  const meanDiff = a.mean - b.mean;
  const varSum = a.variance + b.variance;
  // Genuine ties (equal means -- e.g. two still-empty rosters) must return
  // EXACTLY 0.5, not something normalCdf() would compute. The hand-written
  // erf() approximation below is only accurate to ~1e-7, and its five
  // Abramowitz-Stegun coefficients sum to 0.999999999 rather than exactly 1,
  // so normalCdf(0) evaluates to ~0.5000000005 instead of 0.5. That's an
  // imperceptible display difference (both round to "50%"), but MatchupCard
  // compares prob === 0.5 to decide whether to show "Even" vs. "<Team>
  // leads", and 0.5000000005 fails that check -- see chat: Hunter reported
  // exactly-tied matchups incorrectly showing a leader. Short-circuiting
  // meanDiff (and the no-variance case) here avoids ever handing a tie to
  // normalCdf/erf in the first place.
  if (varSum < 1e-9 || Math.abs(meanDiff) < 1e-9) {
    if (meanDiff > 1e-9) return 1;
    if (meanDiff < -1e-9) return 0;
    return 0.5;
  }
  return normalCdf(meanDiff / Math.sqrt(varSum));
}
