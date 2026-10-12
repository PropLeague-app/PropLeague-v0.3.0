import { describe, expect, it } from 'vitest';
import { DEFAULT_LEAGUE_SETTINGS, type League, type PrizePool } from '../../types';
import { biggestSwing, findWeek, liveWeekEntry, poolHasDetail, poolHighlights, poolWithLiveWeek, seasonImpacts, teamWeeklyImpact, weekImpacts } from '../poolView';

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

describe('highlights and one team week by week', () => {
  it('picks the last, best and worst weeks, ignoring weeks that did not move', () => {
    const marks = poolHighlights(pool);
    expect(marks.last?.week).toBe(3);
    expect(marks.best?.week).toBe(1);
    expect(marks.worst?.week).toBe(2);
    expect(poolHighlights({ history: [] })).toEqual({ last: null, best: null, worst: null });
  });

  it('lists one team week by week, skipping weeks with no detail', () => {
    expect(teamWeeklyImpact(pool, 'a')).toEqual([
      { week: 1, impact: 12, multiplier: 1.2 },
      { week: 2, impact: -1, multiplier: 1 },
    ]);
    expect(teamWeeklyImpact(pool, 'nobody')).toEqual([]);
  });
});

describe('the week still being played', () => {
  // A minimal league: two human teams, one roster each for the current week.
  function leagueWith(slots: { settled: number | null; stake: number }[][]): League {
    const teams = ['a', 'b'].map((id, i) => ({ id, teamName: id, abbrev: id, isUser: i === 0, isSimulated: false }) as never);
    const roster = (teamId: string, picks: { settled: number | null; stake: number }[]) => ({
      week: 4 as const,
      teamId,
      submitted: true,
      slots: picks.map((p, i) => ({
        slotId: `QB-${i}`,
        position: 'QB',
        wager: {
          id: `w${i}`,
          slotId: `QB-${i}`,
          gameId: 'g',
          marketKey: 'h2h',
          side: 'X',
          oddsAtPlacement: -110,
          stake: p.stake,
          placedAt: '',
          status: p.settled == null ? 'pending' : 'won',
          settledProfit: p.settled,
        },
      })),
    });
    return {
      id: 'L',
      currentWeek: 4,
      teams,
      settings: { ...DEFAULT_LEAGUE_SETTINGS, buyInEnabled: true, buyInAmount: 1000, lineupSlots: { QB: slots[0].length } },
      standings: [],
      rostersByTeamWeek: { 'a:4': roster('a', slots[0]), 'b:4': roster('b', slots[1]) },
    } as unknown as League;
  }

  const livePool: PrizePool = { initial: 100, current: 100, locked: false, history: [] };

  it('builds a provisional entry once anything has settled', () => {
    const league = leagueWith([[{ settled: 20, stake: 10 }], [{ settled: -10, stake: 10 }]]);
    const entry = liveWeekEntry(league, livePool);
    expect(entry).not.toBeNull();
    expect(entry?.week).toBe(4);
    expect(entry?.byTeam?.a?.impact).toBeGreaterThan(0);
    expect(entry?.byTeam?.b?.impact).toBeLessThan(0);
  });

  it('shows nothing until a pick has actually settled', () => {
    const league = leagueWith([[{ settled: null, stake: 10 }], [{ settled: null, stake: 10 }]]);
    expect(liveWeekEntry(league, livePool)).toBeNull();
  });

  it('shows nothing once that week is in the stored history, or when the pool is locked', () => {
    const league = leagueWith([[{ settled: 20, stake: 10 }], [{ settled: -10, stake: 10 }]]);
    const settled: PrizePool = { ...livePool, history: [{ week: 4, poolBefore: 100, poolAfter: 101, netRealPL: 1 }] };
    expect(liveWeekEntry(league, settled)).toBeNull();
    expect(liveWeekEntry(league, { ...livePool, locked: true })).toBeNull();
  });

  it('hangs the provisional entry on the end of the history without touching the stored one', () => {
    const league = leagueWith([[{ settled: 20, stake: 10 }], [{ settled: -10, stake: 10 }]]);
    const entry = liveWeekEntry(league, livePool)!;
    const view = poolWithLiveWeek(livePool, entry);
    expect(view.history).toHaveLength(1);
    expect(livePool.history).toHaveLength(0);
    expect(poolWithLiveWeek(livePool, null).history).toHaveLength(0);
  });
});
