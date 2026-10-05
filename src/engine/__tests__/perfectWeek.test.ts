import { describe, it, expect } from 'vitest';
import { DEFAULT_LEAGUE_SETTINGS } from '../../types';
import type { LeagueSettings, WagerStatus, WeeklyRoster } from '../../types';
import { isPerfectWeek } from '../perfectWeek';

const settings: LeagueSettings = { ...DEFAULT_LEAGUE_SETTINGS, weeklyCredits: 100, minGamesPerRoster: null, lineupSlots: { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, ML: 1 } as LeagueSettings['lineupSlots'] };

function roster(entries: { status: WagerStatus; stake: number; gameId?: string }[], empty = 0): WeeklyRoster {
  const slots = entries.map((e, i) => ({
    slotId: `S-${i}`,
    position: 'WR' as const,
    wager: {
      id: `w${i}`, slotId: `S-${i}`, gameId: e.gameId ?? `g${i % 3}`, marketKey: 'player_reception_yds' as const, side: 'Over', oddsAtPlacement: -110,
      stake: e.stake, placedAt: '', status: e.status, settledProfit: e.status === 'won' ? e.stake * 0.9 : 0,
    },
  }));
  for (let i = 0; i < empty; i++) slots.push({ slotId: `E-${i}`, position: 'WR', wager: null as never });
  return { week: 4, teamId: 't', slots, submitted: true };
}

const full = (statuses: WagerStatus[]) => roster(statuses.map((status) => ({ status, stake: 100 / statuses.length })));

describe('isPerfectWeek', () => {
  it('all wins is perfect', () => {
    expect(isPerfectWeek(full(['won', 'won', 'won', 'won']), settings, true)).toBe(true);
  });
  it('voids and pushes are allowed as long as there is a win', () => {
    expect(isPerfectWeek(full(['won', 'voided', 'push', 'won']), settings, true)).toBe(true);
  });
  it('any loss ruins it', () => {
    expect(isPerfectWeek(full(['won', 'won', 'lost', 'won']), settings, true)).toBe(false);
  });
  it('needs at least one win', () => {
    expect(isPerfectWeek(full(['voided', 'push', 'voided', 'voided']), settings, true)).toBe(false);
  });
  it('a single winning pick with empty slots is NOT perfect', () => {
    expect(isPerfectWeek(roster([{ status: 'won', stake: 100 }], 7), settings, true)).toBe(false);
  });
  it('unplaced credits disqualify it', () => {
    expect(isPerfectWeek(roster([{ status: 'won', stake: 20 }, { status: 'won', stake: 20 }, { status: 'won', stake: 20 }]), settings, true)).toBe(false);
  });
  it('too few distinct games disqualifies it', () => {
    const r = roster([{ status: 'won', stake: 50, gameId: 'g1' }, { status: 'won', stake: 50, gameId: 'g1' }]);
    expect(isPerfectWeek(r, settings, true)).toBe(false);
  });
  it('a week that is not final yet, or still has a pending pick, never counts', () => {
    expect(isPerfectWeek(full(['won', 'won', 'won', 'won']), settings, false)).toBe(false);
    expect(isPerfectWeek(full(['won', 'pending', 'won', 'won']), settings, true)).toBe(false);
  });
  it('no roster at all is not perfect', () => {
    expect(isPerfectWeek(undefined, settings, true)).toBe(false);
  });
});
