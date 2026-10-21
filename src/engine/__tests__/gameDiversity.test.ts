import { describe, expect, it } from 'vitest';
import { gameDiversityBlock } from '../validation';
import { buildEmptyRoster } from '../rosterSlots';
import { DEFAULT_LEAGUE_SETTINGS, type LeagueSettings, type WeeklyRoster } from '../../types';

const settings = (min: number | null): LeagueSettings => ({ ...DEFAULT_LEAGUE_SETTINGS, minGamesPerRoster: min });

/** A roster whose first `filled` slots all sit on `gameId`. */
function roster(filled: number, gameId = 'g1'): WeeklyRoster {
  const base = buildEmptyRoster('t1', 1, DEFAULT_LEAGUE_SETTINGS.lineupSlots);
  return {
    ...base,
    slots: base.slots.map((s, i) => (i < filled ? { ...s, wager: { gameId, stake: 12.5 } as never } : s)),
  };
}

describe('gameDiversityBlock', () => {
  it('never blocks at the default minimum of 1', () => {
    const r = roster(7);
    expect(gameDiversityBlock(r, settings(null), r.slots[7].slotId, 'g1')).toBeNull();
  });

  it('allows filling the second-to-last slot from the same game, since the last could still differ', () => {
    const r = roster(6);
    expect(gameDiversityBlock(r, settings(2), r.slots[6].slotId, 'g1')).toBeNull();
  });

  it('blocks the final slot when it would leave the lineup on one game', () => {
    const r = roster(7);
    const reason = gameDiversityBlock(r, settings(2), r.slots[7].slotId, 'g1');
    expect(reason).toContain('at least 2 different games');
  });

  it('allows the final slot when it brings a second game', () => {
    const r = roster(7);
    expect(gameDiversityBlock(r, settings(2), r.slots[7].slotId, 'g2')).toBeNull();
  });

  it('blocks a swap that would collapse a valid lineup onto one game', () => {
    // Every slot filled, the last one on a different game: changing it back is what breaks it.
    const r = roster(8);
    const withTwo = { ...r, slots: r.slots.map((s, i) => (i === 7 ? { ...s, wager: { ...s.wager!, gameId: 'g2' } } : s)) };
    expect(gameDiversityBlock(withTwo, settings(2), withTwo.slots[7].slotId, 'g1')).toContain('at least 2');
  });

  it('counts a higher minimum against the slots still open', () => {
    const r = roster(5);
    // 1 game so far, this pick adds none, 2 slots remain open: 1 + 2 = 3, exactly enough.
    expect(gameDiversityBlock(r, settings(3), r.slots[5].slotId, 'g1')).toBeNull();
    expect(gameDiversityBlock(r, settings(4), r.slots[5].slotId, 'g1')).toContain('at least 4');
  });
});
