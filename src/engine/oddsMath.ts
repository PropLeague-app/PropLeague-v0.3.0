// Pure odds math shared by the market browser, bet slip, and settlement engine.
// Spec: "win (profit = stake × odds payout, stake NOT included)"
//   $10 @ -150 -> win = +$6.67 (not $16.67)
//   $10 @ +230 -> win = +$23.00

import type { OddsFormat } from '../types';

export function americanToDecimal(odds: number): number {
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}

export function americanToImpliedProbability(odds: number): number {
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

/** Profit only (stake excluded), rounded to cents. */
export function profitForStake(stake: number, americanOdds: number): number {
  const raw =
    americanOdds > 0 ? stake * (americanOdds / 100) : stake * (100 / Math.abs(americanOdds));
  return Math.round(raw * 100) / 100;
}

/** Valid American odds are always <= -100 or >= +100 — there is no such thing as, say,
 * -84 (that band between -99 and +99 inclusive is a gap in the format, not a valid
 * value). Arithmetic that shifts a price by a fixed amount (an alt-line step, session
 * line-movement drift) can walk a price into that gap; when it does, this reinterprets
 * the result via its implied-probability equivalent on the correct side instead of
 * just clamping to an arbitrary boundary, so a shift in that direction still means
 * something (manual v0.03 §5 #12/#13 — e.g. a raw -84 maps to the equivalent +100-and-up
 * underdog price rather than being left invalid or snapped to -100). */
export function normalizeAmericanOdds(price: number): number {
  if (price >= 100 || price <= -100) return price;
  if (price === 0) return 100;
  return price > 0 ? -Math.round(10000 / price) : Math.round(10000 / Math.abs(price));
}

export function formatOdds(odds: number, format: OddsFormat): string {
  if (format === 'decimal') return americanToDecimal(odds).toFixed(2);
  return odds > 0 ? `+${odds}` : `${odds}`;
}

export function formatCents(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(amount).toFixed(2)}`;
}
