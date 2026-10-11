import { describe, it, expect } from 'vitest';
import { DEFAULT_LEAGUE_SETTINGS } from '../../types';
import {
  DEFERRED_SETTING_KEYS,
  describePendingKeys,
  meaningfulPending,
  nextWeekLabel,
  effectiveSettings,
  maxMinBetFor,
  pendingKeys,
  settingsInfeasibility,
  splitPendingSettings,
} from '../settingsRules';
import { lastSlotPrefill, maxStakeNow, maxStakeRounded, stakeError, type StakeContext } from '../stakeRules';

const base = { ...DEFAULT_LEAGUE_SETTINGS };

describe('settingsInfeasibility', () => {
  it('accepts the defaults', () => {
    expect(settingsInfeasibility(base)).toEqual([]);
  });

  it('rejects a min bet that cannot fit across the slots (8 slots, $100: max $12.50)', () => {
    expect(maxMinBetFor(100, 8)).toBe(12.5);
    expect(settingsInfeasibility({ ...base, minBetPerSlot: 12.5 })).toEqual([]);
    expect(settingsInfeasibility({ ...base, minBetPerSlot: 12.51 })).toHaveLength(1);
  });

  it('rejects max bets that cannot reach the weekly credits', () => {
    // 8 slots: 1 ML at $15 + 7 props capped at 80% of $100 = plenty; tighten props hard
    const tight = { ...base, propBetOverride: { max: 5 } } as typeof base;
    const reasons = settingsInfeasibility(tight);
    expect(reasons.some((r) => r.includes('only allow'))).toBe(true);
  });

  it('rejects a cap percentage that cannot be spread across the slots', () => {
    const reasons = settingsInfeasibility({ ...base, singleBetCapPct: 0.1, maxMLBet: 50 });
    expect(reasons.length).toBeGreaterThan(0);
  });

  it('rejects zero credits, no slots, and a bad cap percentage', () => {
    expect(settingsInfeasibility({ ...base, weeklyCredits: 0 }).length).toBeGreaterThan(0);
    expect(settingsInfeasibility({ ...base, singleBetCapPct: 1.5 }).length).toBeGreaterThan(0);
    expect(
      settingsInfeasibility({ ...base, lineupSlots: { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, ML: 0 } }).length,
    ).toBeGreaterThan(0);
  });
});

describe('pending settings', () => {
  const live = { ...base };
  it('applies everything now when unlocked', () => {
    const next = { ...live, weeklyCredits: 150, leagueName: 'Renamed' };
    const { settings, pending } = splitPendingSettings(live, next, false);
    expect(settings.weeklyCredits).toBe(150);
    expect(pending).toBeNull();
  });

  it('defers gameplay keys but applies cosmetic keys when locked', () => {
    const next = { ...live, weeklyCredits: 150, leagueName: 'Renamed', hidePicks: true };
    const { settings, pending } = splitPendingSettings(live, next, true);
    expect(settings.weeklyCredits).toBe(live.weeklyCredits);
    expect(settings.hidePicks).toBe(live.hidePicks);
    expect(settings.leagueName).toBe('Renamed');
    expect(pending).toEqual({ weeklyCredits: 150, hidePicks: true });
    expect(pendingKeys(pending)).toEqual(['weeklyCredits', 'hidePicks']);
  });

  it('drops a pending key when the value is set back to the live value', () => {
    const edited = effectiveSettings(live, { weeklyCredits: 150 });
    const reverted = { ...edited, weeklyCredits: live.weeklyCredits };
    expect(splitPendingSettings(live, reverted, true).pending).toBeNull();
  });

  it('keeps the deferred key list to real settings keys', () => {
    for (const key of DEFERRED_SETTING_KEYS) expect(key in base).toBe(true);
  });
});

describe('stake rules at placement', () => {
  const ctx = (over: Partial<StakeContext> = {}): StakeContext => ({
    settings: base,
    isMLSlot: false,
    otherStakes: 0,
    emptyOtherSlots: 7,
    replacing: false,
    ...over,
  });

  it('leaves the minimum bet for every other empty slot', () => {
    // $100, $1 min, 7 other empties: first pick max = min(cap 80, 100 - 7) = 80
    expect(maxStakeNow(ctx())).toBe(80);
    // 6 picks already worth $93, 1 empty other slot beyond this one => 100-93-1 = 6
    expect(maxStakeNow(ctx({ otherStakes: 93, emptyOtherSlots: 1 }))).toBe(6);
    expect(stakeError(ctx({ otherStakes: 93, emptyOtherSlots: 1 }), 7)).toContain('Leave $1.00 for your 1 empty slot');
    expect(stakeError(ctx({ otherStakes: 93, emptyOtherSlots: 1 }), 6)).toBeNull();
  });

  it('does not apply the reserve rule when replacing or editing a pick', () => {
    expect(stakeError(ctx({ otherStakes: 93, emptyOtherSlots: 1, replacing: true }), 7)).toBeNull();
  });

  it('applies per-slot max, cap, minimum and remaining credits', () => {
    expect(stakeError(ctx({ isMLSlot: true, emptyOtherSlots: 0 }), 20)).toContain('Maximum bet is $15.00');
    expect(stakeError(ctx({ emptyOtherSlots: 0 }), 0.5)).toContain('Minimum bet');
    expect(stakeError(ctx({ otherStakes: 95, emptyOtherSlots: 0 }), 10)).toContain('Only $5.00 left');
  });

  it('rounds the max stake down to the cent and the rules accept it', () => {
    const odd = ctx({ otherStakes: 93.337, emptyOtherSlots: 0 });
    expect(maxStakeRounded(odd)).toBe(6.66);
    expect(stakeError(odd, maxStakeRounded(odd))).toBeNull();
    for (const c of [ctx(), ctx({ isMLSlot: true }), ctx({ otherStakes: 93, emptyOtherSlots: 1 }), ctx({ replacing: true, otherStakes: 40 })]) {
      expect(stakeError(c, maxStakeRounded(c))).toBeNull();
    }
  });

  it('reports no room to bet when the credits are spent', () => {
    expect(maxStakeRounded(ctx({ otherStakes: 100, emptyOtherSlots: 0 }))).toBe(0);
  });

  it('prefills the last open slot with exactly what is left', () => {
    expect(lastSlotPrefill(ctx({ otherStakes: 90, emptyOtherSlots: 0, isMLSlot: true }))).toBe(10);
    expect(lastSlotPrefill(ctx({ otherStakes: 50, emptyOtherSlots: 2 }))).toBeNull();
    expect(lastSlotPrefill(ctx({ otherStakes: 50, emptyOtherSlots: 0, replacing: true }))).toBeNull();
  });
});

describe('scheduled-change helpers', () => {
  it('meaningfulPending drops keys equal to live and returns null when nothing differs', () => {
    const live = { weeklyCredits: 100, minBetPerSlot: 1 };
    expect(meaningfulPending(live, { weeklyCredits: 100 })).toBeNull();
    expect(meaningfulPending(live, null)).toBeNull();
    expect(meaningfulPending(live, { weeklyCredits: 120, minBetPerSlot: 1 })).toEqual({ weeklyCredits: 120 });
  });

  it('describePendingKeys reads as a sentence fragment', () => {
    expect(describePendingKeys([])).toBe('');
    expect(describePendingKeys(['weeklyCredits'])).toBe('weekly credits');
    expect(describePendingKeys(['weeklyCredits', 'minBetPerSlot'])).toBe('weekly credits and minimum bet');
    expect(describePendingKeys(['weeklyCredits', 'minBetPerSlot', 'hidePicks'])).toBe('weekly credits, minimum bet and pick visibility');
  });

  it('nextWeekLabel handles numeric weeks and playoff rounds', () => {
    expect(nextWeekLabel(5)).toBe('Week 6');
    expect(nextWeekLabel('5')).toBe('Week 6');
    expect(nextWeekLabel(18)).toBe('Wild Card week');
    expect(nextWeekLabel('WC')).toBe('Divisional week');
    expect(nextWeekLabel('CONF')).toBe('next season');
  });
});
