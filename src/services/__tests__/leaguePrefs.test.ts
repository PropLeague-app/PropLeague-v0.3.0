import { describe, it, expect } from 'vitest';
import { DEFAULT_NOTIFICATION_PREFS, applyLeaguePrefChange } from '../notificationPrefs';
import { favoriteLeagueId, leagueMuted } from '../../../supabase/functions/_shared/leaguePrefs';

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
