// Pure rules about league settings, shared by the Settings UI. The same rules are enforced on
// the server (supabase/migrations/0027_settings_lock_and_stake_rules.sql: settings_infeasibility,
// update_league_settings), so keep the two in step. Nothing here touches the store or network.
import type { LeagueSettings } from '../types';

const EPS = 0.005;

/** Settings that change how a week is played. While any pick exists in the league's current
 * week they cannot change mid-week: edits are saved as PENDING and apply when the week rolls
 * over (after Tuesday's settlement). Anything not listed here (league name, moments, alt
 * lines, line movement, playoff format, payout splits, conference names, display options)
 * applies immediately. MUST match v_deferred in update_league_settings (migration 0027). */
export const DEFERRED_SETTING_KEYS = [
  'lineupSlots',
  'weeklyCredits',
  'minBetPerSlot',
  'maxMLBet',
  'maxPropBet',
  'minOdds',
  'singleBetCapPct',
  'wagerPrecision',
  'hidePicks',
  'maxDuplicatePicks',
  'waiverMode',
  'correlationBlockEnabled',
  'correlationRules',
  'minGamesPerRoster',
  'buyInEnabled',
  'buyInAmount',
  'poolMultipliers',
  'propBetOverride',
  'mlBetOverride',
  'emptySlotFloor',
  'invalidRosterPenaltyEnabled',
  'invalidRosterFee',
] as const satisfies readonly (keyof LeagueSettings)[];

export type DeferredSettingKey = (typeof DEFERRED_SETTING_KEYS)[number];

export function isDeferredKey(key: string): key is DeferredSettingKey {
  return (DEFERRED_SETTING_KEYS as readonly string[]).includes(key);
}

export function totalSlotsOf(lineupSlots: Record<string, number>): number {
  return Object.values(lineupSlots).reduce((a, b) => a + b, 0);
}

const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;

/** Largest minimum bet that still lets every slot be filled: credits split evenly across slots. */
export function maxMinBetFor(weeklyCredits: number, slots: number): number {
  if (slots <= 0) return 0;
  return Math.floor((weeklyCredits / slots) * 100 + 1e-9) / 100;
}

export type FeasibilityInput = Pick<
  LeagueSettings,
  'weeklyCredits' | 'lineupSlots' | 'minBetPerSlot' | 'maxMLBet' | 'maxPropBet' | 'singleBetCapPct' | 'propBetOverride' | 'mlBetOverride'
>;

/** Reasons these betting limits can never produce a full, legal roster (empty = fine). Each
 * reason names what to change. A full legal roster must always be reachable. */
export function settingsInfeasibility(s: FeasibilityInput): string[] {
  const reasons: string[] = [];
  const credits = s.weeklyCredits;
  const slots = totalSlotsOf(s.lineupSlots);
  const mlSlots = s.lineupSlots.ML ?? 0;
  const propSlots = slots - mlSlots;

  if (!(credits > 0)) reasons.push('Weekly credits must be more than $0.');
  if (slots <= 0) reasons.push('The lineup needs at least one slot.');
  if (!(s.singleBetCapPct > 0) || s.singleBetCapPct > 1) reasons.push('Max % of credits on one pick must be between 1% and 100%.');
  if (reasons.length > 0) return reasons;

  if (s.minBetPerSlot * slots > credits + EPS) {
    reasons.push(
      `Minimum bet ${money(s.minBetPerSlot)} across ${slots} slots is ${money(s.minBetPerSlot * slots)}, more than the ${money(credits)} weekly credits. Use ${money(maxMinBetFor(credits, slots))} or less.`,
    );
  }

  const capAmount = credits * s.singleBetCapPct;
  const mlMax = Math.min(s.mlBetOverride?.max ?? s.maxMLBet, capAmount);
  const propMax = Math.min(s.propBetOverride?.max ?? s.maxPropBet ?? Infinity, capAmount);

  if (mlSlots > 0 && s.minBetPerSlot > mlMax + EPS) {
    reasons.push(`Minimum bet ${money(s.minBetPerSlot)} is above the highest allowed moneyline/spread bet (${money(mlMax)}).`);
  }
  if (propSlots > 0 && s.minBetPerSlot > propMax + EPS) {
    reasons.push(`Minimum bet ${money(s.minBetPerSlot)} is above the highest allowed prop bet (${money(propMax)}).`);
  }

  const capacity = mlSlots * mlMax + propSlots * (Number.isFinite(propMax) ? propMax : credits);
  if (capacity < credits - EPS) {
    reasons.push(
      `The max bets only allow ${money(capacity)} of the ${money(credits)} weekly credits to be used across ${slots} slots. Raise a max bet or the max % on one pick.`,
    );
  }
  return reasons;
}

type SettingsLike = Record<string, unknown>;
// Real settings types are interfaces (no index signature), so the generic helpers accept any object
// and view it as a string-keyed record internally.
type AnyObj = object;

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Splits an edited settings object into what applies now vs. what waits for rollover, exactly
 * like update_league_settings does on the server. `locked` = a pick already exists this week.
 * Unlocked: everything is live, nothing pending. Locked: deferred keys keep their live value and
 * any that differ become pending. */
export function splitPendingSettings<T extends AnyObj>(
  live: T,
  next: T,
  locked: boolean,
): { settings: T; pending: Partial<T> | null } {
  if (!locked) return { settings: next, pending: null };
  const n = next as SettingsLike;
  const l = live as SettingsLike;
  const settings: SettingsLike = { ...n };
  const pending: SettingsLike = {};
  for (const key of DEFERRED_SETTING_KEYS) {
    if (!(key in n)) continue;
    if (!same(n[key], l[key])) pending[key] = n[key];
    if (key in l) settings[key] = l[key];
    else delete settings[key];
  }
  return { settings: settings as T, pending: Object.keys(pending).length > 0 ? (pending as Partial<T>) : null };
}

/** Live settings with any scheduled changes laid over them: what the commissioner is working
 * with in the editor, and what the league becomes at rollover. */
export function effectiveSettings<T extends AnyObj>(live: T, pending: Partial<T> | null | undefined): T {
  return pending ? { ...live, ...pending } : live;
}

/** Keys currently scheduled to change, for the pending banner and the per-group pills. */
export function pendingKeys(pending: AnyObj | null | undefined): DeferredSettingKey[] {
  return pending ? DEFERRED_SETTING_KEYS.filter((k) => k in pending) : [];
}

/** Pending keys whose value actually differs from what is live. A key set back to its live
 * value (or never really changed) is not a scheduled change, so it must not light up a
 * banner or a pill. */
export function meaningfulPending<T extends AnyObj>(live: T, pending: Partial<T> | null | undefined): Partial<T> | null {
  if (!pending) return null;
  const out: SettingsLike = {};
  const p = pending as SettingsLike;
  const l = live as SettingsLike;
  for (const key of Object.keys(p)) {
    if (!same(p[key], l[key])) out[key] = p[key];
  }
  return Object.keys(out).length > 0 ? (out as Partial<T>) : null;
}

/** Keys that decide whether a combination of limits is reachable (see settingsInfeasibility). */
export const FEASIBILITY_KEYS = [
  'lineupSlots',
  'weeklyCredits',
  'minBetPerSlot',
  'maxMLBet',
  'maxPropBet',
  'singleBetCapPct',
  'propBetOverride',
  'mlBetOverride',
] as const;

export function touchesFeasibility(partial: AnyObj): boolean {
  return FEASIBILITY_KEYS.some((k) => k in partial);
}

export const SETTING_LABELS: Record<DeferredSettingKey, string> = {
  lineupSlots: 'lineup slots',
  weeklyCredits: 'weekly credits',
  minBetPerSlot: 'minimum bet',
  maxMLBet: 'max moneyline/spread bet',
  maxPropBet: 'max prop bet',
  minOdds: 'minimum odds',
  singleBetCapPct: 'max % on one pick',
  wagerPrecision: 'bet precision',
  hidePicks: 'pick visibility',
  maxDuplicatePicks: 'duplicate pick cap',
  waiverMode: 'contested pick order',
  correlationBlockEnabled: 'correlated picks',
  correlationRules: 'correlation rules',
  minGamesPerRoster: 'minimum games',
  buyInEnabled: 'buy-in',
  buyInAmount: 'buy-in amount',
  poolMultipliers: 'standing multipliers',
  propBetOverride: 'prop bet limits',
  mlBetOverride: 'moneyline bet limits',
  emptySlotFloor: 'empty slot penalty',
  invalidRosterPenaltyEnabled: 'invalid roster penalty',
  invalidRosterFee: 'invalid roster fee',
};

/** "weekly credits, minimum bet and pick visibility" */
export function describePendingKeys(keys: readonly DeferredSettingKey[]): string {
  const labels = keys.map((k) => SETTING_LABELS[k]);
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/** "Week 6" for a numeric week, otherwise a generic phrase (playoff rounds). */
export function nextWeekLabel(currentWeek: string | number): string {
  const n = Number(currentWeek);
  return Number.isFinite(n) ? `Week ${n + 1}` : 'the next round';
}
