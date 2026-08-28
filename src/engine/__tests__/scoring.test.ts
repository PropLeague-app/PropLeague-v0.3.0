import { describe, it, expect } from 'vitest';
import { computeIncompleteLineupPenalty, computeWeeklyScore, winProbability } from '../scoring';
import { buildEmptyRoster } from '../rosterSlots';
import { DEFAULT_LEAGUE_SETTINGS } from '../../types';
import type { Wager } from '../../types';

describe('computeIncompleteLineupPenalty', () => {
  it('penalizes the full unallocated amount for a totally empty, unsubmitted roster', () => {
    const roster = buildEmptyRoster('t1', 1, DEFAULT_LEAGUE_SETTINGS.lineupSlots);
    expect(computeIncompleteLineupPenalty(roster, DEFAULT_LEAGUE_SETTINGS)).toBe(-100);
  });

  it('is zero for a fully-allocated, submitted roster', () => {
    const roster = buildEmptyRoster('t1', 1, DEFAULT_LEAGUE_SETTINGS.lineupSlots);
    const filled = {
      ...roster,
      submitted: true,
      slots: roster.slots.map((s, i) => ({
        ...s,
        wager: { id: `w${i}`, slotId: s.slotId, gameId: 'g', marketKey: 'h2h', side: 'X', oddsAtPlacement: -110, stake: 12.5, placedAt: '', status: 'pending', settledProfit: null } as Wager,
      })),
    };
    expect(computeIncompleteLineupPenalty(filled, DEFAULT_LEAGUE_SETTINGS)).toBe(0);
  });
});

describe('computeWeeklyScore', () => {
  it('sums settled profit across slots plus the incomplete-lineup penalty', () => {
    const roster = buildEmptyRoster('t1', 1, DEFAULT_LEAGUE_SETTINGS.lineupSlots);
    // Fill just one slot with a settled winning wager; leave the rest empty.
    roster.slots[0] = {
      ...roster.slots[0],
      wager: {
        id: 'w0',
        slotId: roster.slots[0].slotId,
        gameId: 'g',
        marketKey: 'player_pass_yds',
        side: 'Over',
        oddsAtPlacement: -110,
        stake: 10,
        placedAt: '',
        status: 'won',
        settledProfit: 9.09,
      },
    };
    const score = computeWeeklyScore(roster, DEFAULT_LEAGUE_SETTINGS);
    // 7 empty slots => $90 unallocated => -90 penalty, plus +9.09 settled.
    expect(score).toBeCloseTo(9.09 - 90, 2);
  });
});

describe('winProbability', () => {
  it('is 50% when both sides have identical expected scores', () => {
    expect(winProbability(10, 10)).toBeCloseTo(0.5, 5);
  });

  it('favors the side with the higher expected score', () => {
    expect(winProbability(50, -50)).toBeGreaterThan(0.5);
    expect(winProbability(-50, 50)).toBeLessThan(0.5);
  });
});
