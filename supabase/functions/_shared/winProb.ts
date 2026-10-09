// Win probability for the Live Activity. A trimmed port of expectedScoreDistribution and
// matchupWinProbability in src/engine/scoring.ts; duplicated rather than imported so
// `supabase functions deploy` does not reach across directories. Keep the two in step (the
// parity test in src/engine/__tests__/server/sharedModules.test.ts runs both side by side).
//
// One deliberate difference: the app also treats a pick whose game has started (with stats in) as
// already decided. The server has no live game results, so such a pick stays a pending bet here.
// The bar can therefore trail the app a little mid-game, and agrees once picks are graded.

export interface WinProbPick {
  stake: number;
  status: string;
  /** American odds at placement. */
  odds: number | null;
  settledProfit: number | null;
}

export interface WinProbSide {
  picks: WinProbPick[];
  /** Slots in the lineup, filled or not. */
  totalSlots: number;
}

export interface WinProbSettings {
  weeklyCredits: number;
  /** Optional floor each empty slot costs at least once the week is locked (null/0 = off). */
  emptySlotFloor?: number | null;
}

function impliedProbability(odds: number): number {
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

function profitForStake(stake: number, odds: number): number {
  const raw = odds > 0 ? stake * (odds / 100) : stake * (100 / Math.abs(odds));
  return Math.round(raw * 100) / 100;
}

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

export function sideDistribution(side: WinProbSide, settings: WinProbSettings, penaltyLive: boolean): ScoreDistribution {
  let mean = 0;
  let variance = 0;
  let allocated = 0;
  const emptySlots = Math.max(0, side.totalSlots - side.picks.length);

  for (const w of side.picks) {
    allocated += w.stake;
    if (w.status !== 'pending') {
      mean += w.settledProfit ?? 0;
      continue;
    }
    if (w.odds == null || w.odds === 0) continue;
    const p = impliedProbability(w.odds);
    const profit = profitForStake(w.stake, w.odds);
    variance += p * (1 - p) * (profit + w.stake) ** 2;
  }

  const unallocated = Math.max(0, settings.weeklyCredits - allocated);
  if (penaltyLive) {
    if (emptySlots > 0) {
      const floor =
        settings.emptySlotFloor != null && settings.emptySlotFloor > 0 && side.totalSlots > 0
          ? Math.min(settings.emptySlotFloor, settings.weeklyCredits / side.totalSlots)
          : null;
      const floorLoss = floor != null ? floor * emptySlots : 0;
      mean += -Math.max(unallocated, floorLoss);
    }
    return { mean, variance };
  }

  if (emptySlots > 0) {
    const phantomStake = unallocated / emptySlots;
    variance += emptySlots * phantomStake ** 2;
  }
  return { mean, variance };
}

/** P(side A beats side B), 0 to 1. */
export function winProbability(a: ScoreDistribution, b: ScoreDistribution): number {
  const meanDiff = a.mean - b.mean;
  const varSum = a.variance + b.variance;
  if (varSum < 1e-9 || Math.abs(meanDiff) < 1e-9) {
    if (meanDiff > 1e-9) return 1;
    if (meanDiff < -1e-9) return 0;
    return 0.5;
  }
  return normalCdf(meanDiff / Math.sqrt(varSum));
}

/** The loss that counts as full red when P/L colors are scaled: the worst loss in the comparison,
 * never less than a quarter of what was at risk. Mirrors scaleReference in src/engine/plColor.ts. */
export function lossReference(worstLoss: number, atRisk: number): number {
  return Math.max(Math.abs(worstLoss), 0.25 * Math.max(0, atRisk));
}
