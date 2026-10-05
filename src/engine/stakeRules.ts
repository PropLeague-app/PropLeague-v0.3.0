// Per-pick stake rules at placement. Mirrors wager_stake_error in
// supabase/migrations/0027_settings_lock_and_stake_rules.sql (the server is the source of truth;
// this lets the bet slip explain a problem before the request is sent).
import type { LeagueSettings } from '../types';

const EPS = 0.005;

export interface StakeContext {
  settings: Pick<LeagueSettings, 'weeklyCredits' | 'minBetPerSlot' | 'maxMLBet' | 'maxPropBet' | 'singleBetCapPct' | 'mlBetOverride' | 'propBetOverride'>;
  isMLSlot: boolean;
  /** Stakes already on this roster, NOT counting the slot being placed or edited. */
  otherStakes: number;
  /** Slots with no pick, NOT counting the slot being placed. Only used for a new pick. */
  emptyOtherSlots: number;
  /** True when the slot already holds a pick (a swap or a stake edit): the reserve rule is
   * skipped, so moving dollars between picks is never blocked by order of operations. */
  replacing: boolean;
}

const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;

/** Largest legal stake right now: the tightest of the slot's max, the single-pick cap, what is
 * left of the weekly credits, and (new picks only) what must stay behind so every other empty
 * slot can still get at least the minimum bet. Never negative. */
export function maxStakeNow(ctx: StakeContext): number {
  const { settings: s } = ctx;
  const slotMax = ctx.isMLSlot ? (s.mlBetOverride?.max ?? s.maxMLBet) : (s.propBetOverride?.max ?? s.maxPropBet);
  const remaining = s.weeklyCredits - ctx.otherStakes;
  const reserve = ctx.replacing ? 0 : s.minBetPerSlot * ctx.emptyOtherSlots;
  return Math.max(0, Math.min(slotMax ?? Infinity, s.weeklyCredits * s.singleBetCapPct, remaining - reserve));
}

/** The first thing wrong with this stake, or null. Order matches the server's messages. */
export function stakeError(ctx: StakeContext, stake: number): string | null {
  const { settings: s } = ctx;
  if (!(stake > 0)) return 'Stake must be more than $0.';
  if (stake < s.minBetPerSlot - EPS) return `Minimum bet is ${money(s.minBetPerSlot)}.`;
  const slotMax = ctx.isMLSlot ? (s.mlBetOverride?.max ?? s.maxMLBet) : (s.propBetOverride?.max ?? s.maxPropBet);
  if (slotMax != null && stake > slotMax + EPS) return `Maximum bet is ${money(slotMax)}.`;
  const cap = s.weeklyCredits * s.singleBetCapPct;
  if (stake > cap + EPS) return `Exceeds the ${Math.round(s.singleBetCapPct * 100)}% single-pick cap (${money(cap)}).`;
  const remaining = s.weeklyCredits - ctx.otherStakes;
  if (stake > remaining + EPS) return `Only ${money(Math.max(0, remaining))} left this week.`;
  if (!ctx.replacing && ctx.emptyOtherSlots > 0) {
    const leaveFor = s.minBetPerSlot * ctx.emptyOtherSlots;
    if (remaining - stake < leaveFor - EPS) {
      const slots = ctx.emptyOtherSlots;
      return `Leave ${money(leaveFor)} for your ${slots} empty slot${slots > 1 ? 's' : ''} (max ${money(maxStakeNow(ctx))}).`;
    }
  }
  return null;
}

/** For the last open slot the only sensible stake is exactly what is left (within the slot's limits),
 * so the bet slip can prefill it. Returns null when it is not the last slot. */
export function lastSlotPrefill(ctx: StakeContext): number | null {
  if (ctx.replacing || ctx.emptyOtherSlots !== 0) return null;
  const remaining = ctx.settings.weeklyCredits - ctx.otherStakes;
  const max = maxStakeNow(ctx);
  const value = Math.min(remaining, max);
  return value >= ctx.settings.minBetPerSlot - EPS ? Math.round(value * 100) / 100 : null;
}
