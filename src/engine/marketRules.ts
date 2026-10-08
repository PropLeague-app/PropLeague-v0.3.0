// Commissioner market rules: block a market outright, or cap what one pick on it can stake. Mirrors
// wager_market_rule_error in supabase/migrations/0031_market_rules.sql (the server decides; this lets
// the market browser and bet slip explain a problem before the request is sent).
import type { LeagueSettings, MarketKey, MarketRule } from '../types';
import { MARKET_ALLOWED_SIDES } from '../types';
import { MARKET_LABELS, MARKETS_BY_POSITION } from '../data/propsGenerator';

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

/** A rule with neither a stake cap nor a slot cap shuts the market. */
export function isBlockRule(rule: Pick<MarketRule, 'maxStake' | 'maxSlots'>): boolean {
  return rule.maxStake == null && rule.maxSlots == null;
}

/** How many lineup slots could hold a pick on this market, given the league's slot counts. Receiving
 * yards fits RB, WR and TE slots (5 in the default league); interceptions only QB slots. The ML slot
 * takes moneyline, spread and total, which cannot be ruled on, so it never counts. */
export function eligibleSlotCount(market: MarketKey, lineupSlots: Partial<Record<string, number>>): number {
  let n = 0;
  for (const [pos, markets] of Object.entries(MARKETS_BY_POSITION)) {
    if (markets.includes(market)) n += lineupSlots[pos] ?? 0;
  }
  return n;
}

/** The largest slot cap worth offering: one below the eligible total (a cap equal to it limits nothing).
 * 0 means there is nothing to cap (one eligible slot or none). */
export function maxSlotCapFor(eligible: number): number {
  return Math.max(0, eligible - 1);
}

/** "2/5 slots". */
export function slotCapLabel(cap: number, eligible: number): string {
  return `${cap}/${eligible} slots`;
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
  const hit = matching(rules, market, side).find(isBlockRule);
  return hit ? `${marketRuleLabel(hit)} picks are blocked in this league.` : null;
}

/** The tightest per-pick stake cap that applies to this pick, or null when there is none. */
export function marketMaxStake(rules: MarketRule[], market: string, side: string): { max: number; label: string } | null {
  let best: { max: number; label: string } | null = null;
  for (const r of matching(rules, market, side)) {
    if (r.maxStake == null) continue; // a block, or a slot-only limit
    if (!best || r.maxStake < best.max) best = { max: r.maxStake, label: marketRuleLabel(r) };
  }
  return best;
}

export function marketMaxMessage(cap: { max: number; label: string }): string {
  return `Max stake on ${cap.label} is ${money(cap.max)}.`;
}

/** A pick already in the lineup, as far as slot caps care. */
export interface PickRef {
  marketKey: string;
  side: string;
}

/** Why a pick on this market and side cannot go in another slot, because the slots a rule allows are
 * already used. `otherPicks` are the picks in the OTHER slots of the same roster (not the slot being
 * filled or swapped). Null when no slot cap is hit. Mirrors enforce_market_slot_cap in
 * supabase/migrations/0035_market_slot_caps.sql. */
export function marketSlotCapReason(rules: MarketRule[], market: string, side: string, otherPicks: PickRef[]): string | null {
  for (const r of matching(rules, market, side)) {
    if (r.maxSlots == null) continue;
    const used = otherPicks.filter((p) => p.marketKey === r.market && (r.side == null || r.side.toLowerCase() === p.side.toLowerCase())).length;
    if (used >= r.maxSlots) {
      return `Only ${r.maxSlots} of your slots can use ${marketRuleLabel(r)}, and ${r.maxSlots === 1 ? 'it is' : 'they are'} taken.`;
    }
  }
  return null;
}
