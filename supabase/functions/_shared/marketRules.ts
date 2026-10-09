// Commissioner market rules for the bot lineup generator. Bots skip any pick the league has blocked
// (the server rejects it anyway, so skipping here keeps the slot from being left empty), skip any pick that
// would use more slots than a slot cap allows, and keep each pick's stake at or under a per-pick stake cap.
// The server exempts bots from the slot and stake checks, so the generator has to hold the line itself.
export interface MarketRuleRow {
  market: string;
  side: string | null;
  maxStake: number | null;
  maxSlots?: number | null;
}

function activeRows(rawSettings: unknown): Array<Partial<MarketRuleRow>> {
  if (!rawSettings || typeof rawSettings !== 'object') return [];
  const s = rawSettings as { marketRulesEnabled?: unknown; marketRules?: unknown };
  if (s.marketRulesEnabled !== true || !Array.isArray(s.marketRules)) return [];
  // Moneyline, spread and total cannot be ruled on, so a leftover rule on one of them is ignored.
  return (s.marketRules as Array<Partial<MarketRuleRow>>).filter(
    (r) => typeof r?.market === 'string' && !['h2h', 'spreads', 'totals'].includes(r.market),
  );
}

export function blockedMarketRules(rawSettings: unknown): MarketRuleRow[] {
  return activeRows(rawSettings)
    .filter((r) => r.maxStake == null && r.maxSlots == null)
    .map((r) => ({ market: r.market as string, side: typeof r.side === 'string' ? r.side : null, maxStake: null }));
}

export function slotCapRules(rawSettings: unknown): MarketRuleRow[] {
  return activeRows(rawSettings)
    .filter((r) => typeof r.maxSlots === 'number' && r.maxSlots >= 1)
    .map((r) => ({
      market: r.market as string,
      side: typeof r.side === 'string' ? r.side : null,
      maxStake: typeof r.maxStake === 'number' ? r.maxStake : null,
      maxSlots: r.maxSlots as number,
    }));
}

export function stakeCapRules(rawSettings: unknown): MarketRuleRow[] {
  return activeRows(rawSettings)
    .filter((r) => typeof r.maxStake === 'number' && r.maxStake > 0)
    .map((r) => ({
      market: r.market as string,
      side: typeof r.side === 'string' ? r.side : null,
      maxStake: r.maxStake as number,
      maxSlots: typeof r.maxSlots === 'number' ? r.maxSlots : null,
    }));
}

/** The tightest per-pick stake cap that applies to this market and side, or null when there is none.
 * Mirrors marketMaxStake in src/engine/marketRules.ts. */
export function stakeCapFor(rules: MarketRuleRow[], market: string, side: string): number | null {
  let best: number | null = null;
  for (const r of rules) {
    if (r.market !== market || (r.side != null && r.side.toLowerCase() !== side.toLowerCase())) continue;
    if (r.maxStake == null) continue;
    if (best == null || r.maxStake < best) best = r.maxStake;
  }
  return best;
}

export function isMarketBlocked(rules: MarketRuleRow[], market: string, side: string): boolean {
  return rules.some((r) => r.market === market && (r.side == null || r.side.toLowerCase() === side.toLowerCase()));
}

/** True when adding a pick on this market and side would break a slot cap, given the picks already in the lineup. */
export function breaksSlotCap(rules: MarketRuleRow[], market: string, side: string, picksSoFar: Array<{ marketKey: string; side: string }>): boolean {
  return rules.some((r) => {
    if (r.market !== market || (r.side != null && r.side.toLowerCase() !== side.toLowerCase())) return false;
    const used = picksSoFar.filter((p) => p.marketKey === r.market && (r.side == null || r.side.toLowerCase() === p.side.toLowerCase())).length;
    return used >= (r.maxSlots as number);
  });
}
