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

  // The regression this guards: liveWeekEntry used computeWeeklyScore, which charges the
  // unspent-credits penalty. Every other fixture here fills its lineup exactly, so that penalty was
  // always zero and the bug stayed invisible in tests while being plainly visible in the app -- a
  // real league with one settled pick showed all eight teams down and the week at -$47.85 (see
  // chat, Oct 2026). A mid-week lineup is mostly empty by nature, which is the case that matters,
  // so this one builds its rosters with the empty slots left in.
  it('ignores unfilled slots mid-week, so only settled picks move the pool', () => {
    const SLOTS = 8;
    const openRoster = (teamId: string, pick: { settled: number | null; stake: number } | null) => ({
      week: 4 as const,
      teamId,
      submitted: false,
      slots: Array.from({ length: SLOTS }, (_, i) => ({
        slotId: `QB-${i}`,
        position: 'QB',
        wager:
          i === 0 && pick
            ? {
                id: `w-${teamId}`,
                slotId: 'QB-0',
                gameId: 'g',
                marketKey: 'h2h',
                side: 'X',
                oddsAtPlacement: -110,
                stake: pick.stake,
                placedAt: '',
                status: pick.settled == null ? 'pending' : 'lost',
                settledProfit: pick.settled,
              }
            : null,
      })),
    });
    const league = {
      id: 'L',
      currentWeek: 4,
      teams: ['a', 'b'].map((id, i) => ({ id, teamName: id, abbrev: id, isUser: i === 0, isSimulated: false })),
      settings: { ...DEFAULT_LEAGUE_SETTINGS, buyInEnabled: true, lineupSlots: { QB: SLOTS } },
      standings: [],
      rostersByTeamWeek: {
        // One settled loss between them; seven empty slots each, and b has not picked at all.
        'a:4': openRoster('a', { settled: -15, stake: 15 }),
        'b:4': openRoster('b', null),
      },
    } as unknown as League;

    const entry = liveWeekEntry(league, livePool)!;
    expect(entry).not.toBeNull();
    // b has settled nothing, so it has not moved the pool at all, empty lineup or not.
    expect(entry.byTeam?.b?.impact).toBe(0);
    // a moved it by its one settled loss and nothing else: its whole roster is otherwise empty, and
    // the old behaviour charged that as roughly the full weekly credit allowance.
    expect(entry.byTeam?.a?.impact).toBeLessThan(0);
    expect(entry.netRealPL).toBeCloseTo(entry.byTeam!.a!.impact, 10);
    // -15 of 100 credits against this team's 1/2 share of a 100 pool.
    expect(entry.byTeam!.a!.impact).toBeCloseTo((-15 / DEFAULT_LEAGUE_SETTINGS.weeklyCredits) * (100 / 2), 6);
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
