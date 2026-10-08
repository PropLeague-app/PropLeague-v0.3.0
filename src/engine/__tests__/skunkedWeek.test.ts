import { describe, it, expect } from 'vitest';
import type { WagerStatus, WeeklyRoster } from '../../types';
import { isSkunkedWeek } from '../skunkedWeek';

function roster(statuses: WagerStatus[], empty = 0): WeeklyRoster {
  const slots = statuses.map((status, i) => ({
    slotId: `S-${i}`,
    position: 'WR' as const,
    wager: {
      id: `w${i}`, slotId: `S-${i}`, gameId: `g${i % 3}`, marketKey: 'player_reception_yds' as const, side: 'Over', oddsAtPlacement: -110,
      stake: 10, placedAt: '', status, settledProfit: status === 'lost' ? -10 : 0,
    },
  }));
  for (let i = 0; i < empty; i++) slots.push({ slotId: `E-${i}`, position: 'WR', wager: null as never });
  return { week: 4, teamId: 't', slots, submitted: true };
}

describe('isSkunkedWeek', () => {
  it('a full lineup of losses is skunked', () => {
    expect(isSkunkedWeek(roster(['lost', 'lost', 'lost', 'lost', 'lost', 'lost']), true)).toBe(true);
  });
  it('exactly three losses is enough', () => {
    expect(isSkunkedWeek(roster(['lost', 'lost', 'lost']), true)).toBe(true);
  });
  it('fewer than three losses is not', () => {
    expect(isSkunkedWeek(roster(['lost', 'lost']), true)).toBe(false);
    expect(isSkunkedWeek(roster(['lost', 'lost', 'voided']), true)).toBe(false);
  });
  it('voids are ignored: they neither break a skunk nor count toward it', () => {
    expect(isSkunkedWeek(roster(['lost', 'voided', 'lost', 'voided', 'lost']), true)).toBe(true);
    expect(isSkunkedWeek(roster(['voided', 'voided', 'voided', 'voided']), true)).toBe(false);
  });
  it('a single win or push breaks it', () => {
    expect(isSkunkedWeek(roster(['lost', 'lost', 'lost', 'won']), true)).toBe(false);
    expect(isSkunkedWeek(roster(['lost', 'lost', 'lost', 'push']), true)).toBe(false);
  });
  it('anything still pending, or a week that is not final, never counts', () => {
    expect(isSkunkedWeek(roster(['lost', 'lost', 'lost', 'pending']), true)).toBe(false);
    expect(isSkunkedWeek(roster(['lost', 'lost', 'lost', 'lost']), false)).toBe(false);
  });
  it('an empty slot means an incomplete lineup, so it is not skunked', () => {
    expect(isSkunkedWeek(roster(['lost', 'lost', 'lost', 'lost'], 2), true)).toBe(false);
  });
  it('no roster at all is not skunked', () => {
    expect(isSkunkedWeek(undefined, true)).toBe(false);
    expect(isSkunkedWeek({ week: 4, teamId: 't', slots: [], submitted: false }, true)).toBe(false);
  });
});
