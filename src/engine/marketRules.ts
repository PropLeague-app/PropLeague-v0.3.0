// Commissioner market rules: block a market outright, or cap what one pick on it can stake. Mirrors
// wager_market_rule_error in supabase/migrations/0031_market_rules.sql (the server decides; this lets
// the market browser and bet slip explain a problem before the request is sent).
import type { LeagueSettings, MarketKey, MarketRule } from '../types';
import { MARKET_ALLOWED_SIDES } from '../types';
import { MARKET_LABELS } from '../data/propsGenerator';

type RuleSettings = Partial<Pick<LeagueSettings, 'marketRulesEnabled' | 'marketRules'>>;

/** At most this many market rules per league. */
export const MAX_MARKET_RULES = 5;

/** Moneyline, spread and total fill the ML slot, which has too few markets to start with, so they
 * cannot be blocked or limited. */
export const ML_SLOT_MARKETS: readonly MarketKey[] = ['h2h', 'spreads', 'totals'];

export function isRuleMarketAllowed(market: MarketKey): boolean {
  return !ML_SLOT_MARKETS.includes(market);
}

const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;

/** The rules in force: none while the toggle is off (the list is kept either way). */
export function activeMarketRules(settings: RuleSettings): MarketRule[] {
  return settings.marketRulesEnabled ? (settings.marketRules ?? []).filter((r) => isRuleMarketAllowed(r.market)) : [];
}

/** True when this market has an Over/Under to choose between. */
export function marketHasSides(market: MarketKey): boolean {
  const sides = MARKET_ALLOWED_SIDES[market];
  return sides.includes('Over') && sides.includes('Under');
}

/** "Passing Yards Over", "Anytime TD", "Passing Yards" (both sides). */
export function marketRuleLabel(rule: Pick<MarketRule, 'market' | 'side'>): string {
  return `${MARKET_LABELS[rule.market]}${rule.side ? ` ${rule.side}` : ''}`;
}

function matching(rules: MarketRule[], market: string, side: string): MarketRule[] {
  return rules.filter((r) => r.market === market && (r.side == null || r.side.toLowerCase() === side.toLowerCase()));
}

/** Why this pick cannot be placed at all, or null. */
export function marketBlockReason(rules: MarketRule[], market: string, side: string): string | null {
  const hit = matching(rules, market, side).find((r) => r.maxStake == null);
  return hit ? `${marketRuleLabel(hit)} picks are blocked in this league.` : null;
}

/** The tightest per-pick stake cap that applies to this pick, or null when there is none. */
export function marketMaxStake(rules: MarketRule[], market: string, side: string): { max: number; label: string } | null {
  let best: { max: number; label: string } | null = null;
  for (const r of matching(rules, market, side)) {
    if (r.maxStake == null) continue;
    if (!best || r.maxStake < best.max) best = { max: r.maxStake, label: marketRuleLabel(r) };
  }
  return best;
}

export function marketMaxMessage(cap: { max: number; label: string }): string {
  return `Max stake on ${cap.label} is ${money(cap.max)}.`;
}
