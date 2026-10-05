// Commissioner market rules for the bot lineup generator. Bots skip any pick the league has blocked
// (the server rejects it anyway, so skipping here keeps the slot from being left empty). Per-pick
// stake caps are not applied to bots.
export interface MarketRuleRow {
  market: string;
  side: string | null;
  maxStake: number | null;
}

export function blockedMarketRules(rawSettings: unknown): MarketRuleRow[] {
  if (!rawSettings || typeof rawSettings !== 'object') return [];
  const s = rawSettings as { marketRulesEnabled?: unknown; marketRules?: unknown };
  if (s.marketRulesEnabled !== true || !Array.isArray(s.marketRules)) return [];
  return (s.marketRules as Array<Partial<MarketRuleRow>>)
    // Moneyline, spread and total cannot be ruled on, so a leftover rule on one of them is ignored.
    .filter((r) => typeof r?.market === 'string' && !['h2h', 'spreads', 'totals'].includes(r.market) && r.maxStake == null)
    .map((r) => ({ market: r.market as string, side: typeof r.side === 'string' ? r.side : null, maxStake: null }));
}

export function isMarketBlocked(rules: MarketRuleRow[], market: string, side: string): boolean {
  return rules.some((r) => r.market === market && (r.side == null || r.side.toLowerCase() === side.toLowerCase()));
}
