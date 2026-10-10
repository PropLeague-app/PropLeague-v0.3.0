import { describe, it, expect } from 'vitest';
import {
  DEFAULT_NOTIFICATION_PREFS,
  applyLeagueChoicesToAll,
  applyLeagueOverride,
  applyLeaguePrefChange,
  leagueHasOverrides,
  notificationAllowed,
  type LeagueNotifType,
  type NotificationPrefs,
} from '../notificationPrefs';
import { favoriteLeagueId, leagueMuted, notifAllowed } from '../../../supabase/functions/_shared/leaguePrefs';

const base = DEFAULT_NOTIFICATION_PREFS;

describe('applyLeaguePrefChange', () => {
  it('favorites one league at a time', () => {
    const a = applyLeaguePrefChange(base, 'A', { favorite: true });
    expect(a.favoriteLeagueId).toBe('A');
    const b = applyLeaguePrefChange(a, 'B', { favorite: true });
    expect(b.favoriteLeagueId).toBe('B');
  });

  it('unfavoriting only clears the star on that league', () => {
    const a = applyLeaguePrefChange(base, 'A', { favorite: true });
    expect(applyLeaguePrefChange(a, 'B', { favorite: false }).favoriteLeagueId).toBe('A');
    expect(applyLeaguePrefChange(a, 'A', { favorite: false }).favoriteLeagueId).toBeNull();
  });

  it('muting the favorite clears the star', () => {
    const a = applyLeaguePrefChange(base, 'A', { favorite: true });
    const muted = applyLeaguePrefChange(a, 'A', { muted: true });
    expect(muted.mutedLeagueIds).toEqual(['A']);
    expect(muted.favoriteLeagueId).toBeNull();
  });

  it('favoriting a muted league unmutes it', () => {
    const muted = applyLeaguePrefChange(base, 'A', { muted: true });
    const fav = applyLeaguePrefChange(muted, 'A', { favorite: true });
    expect(fav.mutedLeagueIds).toEqual([]);
    expect(fav.favoriteLeagueId).toBe('A');
  });

  it('mutes and unmutes without duplicates or touching other leagues', () => {
    let p = applyLeaguePrefChange(base, 'A', { muted: true });
    p = applyLeaguePrefChange(p, 'A', { muted: true });
    p = applyLeaguePrefChange(p, 'B', { muted: true });
    expect(p.mutedLeagueIds).toEqual(['A', 'B']);
    p = applyLeaguePrefChange(p, 'A', { muted: false });
    expect(p.mutedLeagueIds).toEqual(['B']);
  });

  it('a favorite-only change keeps an existing mute on other leagues', () => {
    const muted = applyLeaguePrefChange(base, 'B', { muted: true });
    expect(applyLeaguePrefChange(muted, 'A', { favorite: true }).mutedLeagueIds).toEqual(['B']);
  });
});

describe('server league prefs readers', () => {
  it('read what the client writes', () => {
    let p = applyLeaguePrefChange(base, 'A', { favorite: true });
    p = applyLeaguePrefChange(p, 'B', { muted: true });
    expect(favoriteLeagueId(p)).toBe('A');
    expect(leagueMuted(p, 'B')).toBe(true);
    expect(leagueMuted(p, 'A')).toBe(false);
  });

  it('treat missing or odd prefs as no favorite and nothing muted', () => {
    for (const raw of [null, undefined, {}, 'x', { mutedLeagueIds: 'A', favoriteLeagueId: 5 }]) {
      expect(favoriteLeagueId(raw)).toBeNull();
      expect(leagueMuted(raw, 'A')).toBe(false);
    }
  });
});

const TYPES: LeagueNotifType[] = ['lineupReminders', 'wagerSettled', 'weekResults', 'liveActivities', 'voidRequests'];

describe('per-league notification overrides', () => {
  it('a league follows the global switches until it is changed', () => {
    const p: NotificationPrefs = { ...base, wagerSettled: false };
    expect(notificationAllowed(p, 'A', 'wagerSettled')).toBe(false);
    expect(notificationAllowed(p, 'A', 'weekResults')).toBe(true);
    expect(notificationAllowed(p, 'A', 'voidRequests')).toBe(true);
    expect(leagueHasOverrides(p, 'A')).toBe(false);
  });

  it('stores only differences from the global switch', () => {
    let p = applyLeagueOverride(base, 'A', 'weekResults', false);
    expect(p.leagueOverrides).toEqual({ A: { weekResults: false } });
    expect(notificationAllowed(p, 'A', 'weekResults')).toBe(false);
    expect(notificationAllowed(p, 'B', 'weekResults')).toBe(true);
    expect(leagueHasOverrides(p, 'A')).toBe(true);
    p = applyLeagueOverride(p, 'A', 'weekResults', true); // back to the default: nothing stored
    expect(p.leagueOverrides).toEqual({});
  });

  it('mute wins over any league choice', () => {
    let p = applyLeagueOverride({ ...base, liveActivities: false }, 'A', 'liveActivities', true);
    expect(notificationAllowed(p, 'A', 'liveActivities')).toBe(true);
    p = applyLeaguePrefChange(p, 'A', { muted: true });
    for (const t of TYPES) expect(notificationAllowed(p, 'A', t)).toBe(false);
  });

  it('use for all: this league becomes the default, other overrides clear, void requests and mutes stay', () => {
    let p: NotificationPrefs = { ...base, mutedLeagueIds: ['C'], favoriteLeagueId: 'B' };
    p = applyLeagueOverride(p, 'A', 'wagerSettled', false);
    p = applyLeagueOverride(p, 'A', 'voidRequests', false);
    p = applyLeagueOverride(p, 'B', 'lineupReminders', false);
    p = applyLeagueOverride(p, 'B', 'voidRequests', false);
    const all = applyLeagueChoicesToAll(p, 'A');
    expect(all.wagerSettled).toBe(false);
    expect(all.lineupReminders).toBe(true);
    expect(all.leagueOverrides).toEqual({ A: { voidRequests: false }, B: { voidRequests: false } });
    expect(all.mutedLeagueIds).toEqual(['C']);
    expect(all.favoriteLeagueId).toBe('B');
    for (const t of TYPES.filter((x) => x !== 'voidRequests')) {
      expect(notificationAllowed(all, 'A', t)).toBe(notificationAllowed(p, 'A', t));
      expect(notificationAllowed(all, 'B', t)).toBe(notificationAllowed(all, 'A', t));
    }
  });

  it('the server reads saved prefs the same way the app does', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const pickBool = () => (rnd() < 0.5);
    for (let i = 0; i < 300; i++) {
      let p: NotificationPrefs = {
        ...base,
        lineupReminders: pickBool(),
        wagerSettled: pickBool(),
        weekResults: pickBool(),
        liveActivities: pickBool(),
        mutedLeagueIds: rnd() < 0.3 ? ['A'] : [],
      };
      for (const t of TYPES) if (rnd() < 0.4) p = applyLeagueOverride(p, rnd() < 0.5 ? 'A' : 'B', t, pickBool());
      const saved = JSON.parse(JSON.stringify(p));
      for (const league of ['A', 'B', 'C']) for (const t of TYPES) expect(notifAllowed(saved, league, t)).toBe(notificationAllowed(p, league, t));
    }
    // Old or missing prefs: everything on.
    for (const raw of [null, undefined, {}, { leagueOverrides: 'x' }, { leagueOverrides: { A: 'x' } }]) {
      for (const t of TYPES) expect(notifAllowed(raw, 'A', t)).toBe(true);
    }
  });
});
