import { describe, expect, it } from 'vitest';
import type { PrizePool } from '../../types';
import { biggestSwing, findWeek, poolHasDetail, seasonImpacts, weekImpacts } from '../poolView';

const pool: PrizePool = {
  initial: 100,
  current: 104,
  locked: false,
  history: [
    { week: 1, poolBefore: 100, poolAfter: 110, netRealPL: 10, byTeam: { a: { impact: 12, multiplier: 1.2 }, b: { impact: -2, multiplier: 0.8 } } },
    { week: 2, poolBefore: 110, poolAfter: 104, netRealPL: -6, byTeam: { a: { impact: -1, multiplier: 1 }, b: { impact: -5, multiplier: 1 } } },
    { week: 3, poolBefore: 104, poolAfter: 104, netRealPL: 0 }, // saved before 1.2.11
  ],
};

describe('pool history reading', () => {
  it('knows when per-team detail exists', () => {
    expect(poolHasDetail(pool)).toBe(true);
    expect(poolHasDetail({ history: [pool.history[2]] })).toBe(false);
    expect(poolHasDetail(null)).toBe(false);
  });

  it('lists a week biggest gain first, and nothing for a week with no detail', () => {
    expect(weekImpacts(findWeek(pool, 1))).toEqual([
      { teamId: 'a', impact: 12, multiplier: 1.2, weeks: 1 },
      { teamId: 'b', impact: -2, multiplier: 0.8, weeks: 1 },
    ]);
    expect(weekImpacts(findWeek(pool, 3))).toEqual([]);
    expect(weekImpacts(findWeek(pool, 'WC'))).toEqual([]);
  });

  it('totals the season and averages each team multiplier', () => {
    const rows = seasonImpacts(pool);
    expect(rows.map((r) => r.teamId)).toEqual(['a', 'b']);
    expect(rows[0]).toEqual({ teamId: 'a', impact: 11, multiplier: 1.1, weeks: 2 });
    expect(rows[1].impact).toBe(-7);
  });

  it('finds the week that moved the pool most, either way', () => {
    expect(biggestSwing(pool)?.week).toBe(1);
    expect(biggestSwing({ history: [pool.history[1]] })?.week).toBe(2);
    expect(biggestSwing(null)).toBeNull();
  });
});
