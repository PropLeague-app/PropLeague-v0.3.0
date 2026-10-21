import type { LeagueSettings, RosterSlotState, WeeklyRoster } from '../types';
import { americanToImpliedProbability, profitForStake } from './oddsMath';
import { settleWager, type GameResult } from './settlement';
import { effectiveEmptyFloor, rosterPenalties } from './penalties';

/**
 * Spec §4: an incomplete lineup scores as a lost bet averaged across the empty/
 * unallocated slots. Mathematically that average-loss always nets out to simply
 * the unallocated dollar amount (e.g. 2 empty slots / $20 unallocated / -$10 each
 * = -$20 total), so we just negate whatever credits never got staked.
 */
export function computeIncompleteLineupPenalty(roster: WeeklyRoster, settings: LeagueSettings): number {
  const allocated = roster.slots.reduce((sum, s) => sum + (s.wager?.stake ?? 0), 0);
  const unallocated = Math.max(0, settings.weeklyCredits - allocated);
  const emptySlots = roster.slots.filter((s) => !s.wager).length;
  if (!roster.submitted || emptySlots > 0) {
    // Optional floor: each empty slot costs at least a set amount (engine/penalties.ts).
    const floor = effectiveEmptyFloor(settings);
    const floorLoss = floor != null ? floor * emptySlots : 0;
    return -Math.max(unallocated, floorLoss);
  }
  return 0;
}

/** Weekly team score = sum of all settled wager P/L, plus the incomplete-lineup penalty. A pick
 * voided by the invalid-roster penalty counts as a lost stake whatever it did, and the flat fee
 * comes off once (both only when that penalty is on). */
export function computeWeeklyScore(roster: WeeklyRoster, settings: LeagueSettings): number {
  const pen = rosterPenalties(roster, settings);
  const settledPL = roster.slots.reduce((sum, s) => {
    if (!s.wager) return sum;
    return sum + (pen.invalidSlotIds.has(s.slotId) ? -s.wager.stake : (s.wager.settledProfit ?? 0));
  }, 0);
  return settledPL + computeIncompleteLineupPenalty(roster, settings) - pen.fee;
}

/**
 * What a team has actually banked this week: the profit of every pick that has already settled, and
 * nothing else.
 *
 * Deliberately not computeWeeklyScore. That one folds in the unspent-credits penalty and the
 * invalid-roster penalties, which are the right answer for a week that is over and the wrong one
 * for a week still in progress: before the last kickoff those credits can still be spent and an
 * invalid pick can still be swapped, so charging for them turns "has not picked yet" into a real
 * movement of the prize pool.
 *
 * That is what the Prize Pool screen was showing mid-week (see chat, Oct 2026): a league with one
 * settled pick, a $15 loss, reported every one of its eight teams down and the week at -$47.85,
 * because what it was really drawing was seven mostly-empty lineups being penalized. It also moved
 * in the wrong direction for the wrong reason, easing as people placed bets rather than as results
 * came in. A pick's share of the pool should track that pick, and an unfilled slot should simply
 * not move the pool at all until the week closes and the penalty becomes real.
 */
/** The best this lineup can still do: every pick that has settled at what it actually returned, every
 * pick still live at what it would return if it lands.
 *
 * The ceiling for the week, correct at any point in it. At kickoff it is the whole lineup's potential
 * profit; by Monday night it has converged on the real result. Deliberately not the gross potential
 * of every pick ever placed, which keeps promising a payout from picks that have already lost. */
export function lineupUpside(roster: WeeklyRoster): number {
  return roster.slots.reduce((sum, s) => {
    const w = s.wager;
    if (!w) return sum;
    if (w.status === 'pending') return sum + profitForStake(w.stake, w.oddsAtPlacement);
    return sum + (w.settledProfit ?? 0);
  }, 0);
}

export function settledWeeklyPL(roster: WeeklyRoster): number {
  return roster.slots.reduce(
    (sum, s) => (s.wager && s.wager.status !== 'pending' ? sum + (s.wager.settledProfit ?? 0) : sum),
    0,
  );
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
  // The unspent-credits penalty is only a real loss once nothing more can be filled (the week's
  // last kickoff). Before that the live score is just settled P/L from $0, so callers pass false.
  includeIncompletePenalty = true,
): number {
  const pen = rosterPenalties(roster, settings);
  const expected = roster.slots.reduce((sum, s) => {
    if (!s.wager) return sum;
    if (isSlotHidden?.(s)) return sum;
    if (pen.invalidSlotIds.has(s.slotId)) return sum - s.wager.stake;
    if (s.wager.status !== 'pending') return sum + (s.wager.settledProfit ?? 0);
    if (decided?.isDecided(s.wager.gameId)) {
      const result = decided.resultFor(s.wager.gameId);
      if (result) return sum + settleWager(s.wager, result).profit;
    }
    // An undecided pick is worth exactly $0 until it settles: its expected value at its own implied
    // probability is zero by definition. Computing it anyway left rounding crumbs (profit is rounded to
    // cents) that added up across a lineup to a phantom $0.01 before anything had played.
    return sum;
  }, 0);
  return expected + (includeIncompletePenalty ? computeIncompleteLineupPenalty(roster, settings) : 0) - pen.fee;
}

/**
 * The $ score the matchup screens show. Before the week's last kickoff it is settled P/L from $0
 * (no unspent-credits penalty yet, since slots can still be filled). Once the week locks the
 * penalty folds in. A server score is graded picks only until the week finalizes, so it gets the
 * penalty added here; a final score already carries it.
 */
export function displayWeeklyScore(params: {
  serverScore: number | null | undefined;
  roster: WeeklyRoster | undefined;
  settings: LeagueSettings;
  decided?: DecidedGameLookup;
  isSlotHidden?: (slot: RosterSlotState) => boolean;
  penaltyLive: boolean;
  isFinal: boolean;
}): number {
  const { serverScore, roster, settings, decided, isSlotHidden, penaltyLive, isFinal } = params;
  let score: number;
  if (serverScore != null) {
    score = isFinal || !penaltyLive || !roster ? serverScore : serverScore + computeIncompleteLineupPenalty(roster, settings);
  } else {
    score = roster ? expectedWeeklyScore(roster, settings, decided, isSlotHidden, penaltyLive) : 0;
  }
  // Whole cents, with -0 folded to 0: the sum of pick EVs carries float crumbs (a tiny negative or
  // positive for a team that is exactly even), which showed as "-$0.00" or a green "$0.00".
  return Math.round(score * 100) / 100 + 0;
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
  /** The worst and best totals this side can still finish on, counting settled picks as fixed and
   * every pending pick at its two real outcomes. The normal curve above has infinite tails, so
   * without these a side with nothing left to play still showed a few percent of winning a matchup
   * it cannot reach (see chat, Oct 2026). matchupWinProbability uses them to answer the decided
   * cases exactly, before any curve is involved. */
  min: number;
  max: number;
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
export function expectedScoreDistribution(
  roster: WeeklyRoster,
  settings: LeagueSettings,
  decided?: DecidedGameLookup,
  // Once the week's last game has kicked off, an unfilled lineup is a certain loss rather than a
  // coin flip still to come: the penalty joins the mean and the phantom bet's variance drops out.
  penaltyLive = false,
): ScoreDistribution {
  let mean = 0;
  let variance = 0;
  let allocated = 0;
  let emptySlots = 0;
  // The hard range of what this side can still finish on, alongside the curve.
  let min = 0;
  let max = 0;

  for (const s of roster.slots) {
    if (!s.wager) {
      emptySlots++;
      continue;
    }
    allocated += s.wager.stake;
    if (s.wager.status !== 'pending') {
      const known = s.wager.settledProfit ?? 0;
      mean += known;
      min += known;
      max += known;
      continue;
    }
    if (decided?.isDecided(s.wager.gameId)) {
      const result = decided.resultFor(s.wager.gameId);
      if (result) {
        const known = settleWager(s.wager, result).profit;
        mean += known;
        min += known;
        max += known;
        continue;
      }
    }
    const p = americanToImpliedProbability(s.wager.oddsAtPlacement);
    const profit = profitForStake(s.wager.stake, s.wager.oddsAtPlacement);
    // Mean contribution is exactly 0 (see expectedWeeklyScore); only the spread is real.
    variance += p * (1 - p) * (profit + s.wager.stake) ** 2;
    // A pending pick either wins its profit or loses its whole stake. Nothing else is reachable.
    min += -s.wager.stake;
    max += profit;
  }

  if (penaltyLive) {
    const penalty = computeIncompleteLineupPenalty(roster, settings);
    mean += penalty;
    return { mean, variance, min: min + penalty, max: max + penalty };
  }

  if (emptySlots > 0) {
    const unallocated = Math.max(0, settings.weeklyCredits - allocated);
    const phantomStake = unallocated / emptySlots;
    // A slot still to be filled could go either way by about its own size, so it widens the range
    // rather than deciding anything: a week with picks left to make is never already over.
    min -= phantomStake * emptySlots;
    max += phantomStake * emptySlots;
    // Same variance formula as a real wager above, just evaluated at an assumed
    // p = 0.5 / profit = stake (a neutral, even-odds coin flip of that size) --
    // deliberately NOT the incomplete-lineup penalty (a certain loss, only ever
    // assessed at the actual deadline) -- this is mid-week uncertainty, not yet
    // a foregone conclusion either way.
    variance += emptySlots * phantomStake ** 2;
  }

  return { mean, variance, min, max };
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
  // Decided first, curve second. Once A's best possible finish still falls short of B's worst, or
  // A's worst already clears B's best, the matchup is over and no amount of normal-curve tail
  // should suggest otherwise (see ScoreDistribution.min/max).
  if (a.max < b.min - 1e-9) return 0;
  if (a.min > b.max + 1e-9) return 1;
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
