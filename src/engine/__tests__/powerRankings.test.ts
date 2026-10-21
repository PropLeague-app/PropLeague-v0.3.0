import { describe, expect, it } from 'vitest';
import { betEdge, powerBreakdown, powerRankings, powerSeries, standingsMovement } from '../powerRankings';
import { buildEmptyRoster, rosterKey } from '../rosterSlots';
import { DEFAULT_LEAGUE_SETTINGS, type League, type Matchup, type WagerStatus, type WeeklyRoster } from '../../types';

const team = (id: string) =>
  ({ id, ownerName: id, teamName: id, abbrev: id.toUpperCase(), isUser: id === 'a', isSimulated: false,
     conferenceId: null, logoMode: 'initials', logoEmoji: '', logoDataUrl: null, logoColor: '#fff' }) as never;

/** A roster of picks described as [status, stake, american odds]. */
function roster(teamId: string, week: number, picks: [WagerStatus, number, number][]): WeeklyRoster {
  const base = buildEmptyRoster(teamId, week, DEFAULT_LEAGUE_SETTINGS.lineupSlots);
  return {
    ...base,
    submitted: true,
    slots: base.slots.map((s, i) => {
      const p = picks[i];
      return p
        ? { ...s, wager: { id: `${teamId}-${week}-${i}`, slotId: s.slotId, gameId: `g${i}`, marketKey: 'player_receptions',
             playerId: `p${i}`, playerName: 'P', side: 'Over', point: 1.5, oddsAtPlacement: p[2], stake: p[1],
             placedAt: '2026-10-10T12:00:00Z', status: p[0], settledProfit: 0 } as never }
        : s;
    }),
  };
}

function league(rosters: Record<string, WeeklyRoster>, weeks: number[], teamIds = ['a', 'b']): League {
  const matchupsByWeek: Record<string, Matchup[]> = {};
  for (const w of weeks) {
    matchupsByWeek[String(w)] = [
      { id: `m${w}`, week: w, teamAId: teamIds[0], teamBId: teamIds[1], teamAScore: 0, teamBScore: 0, winnerId: null, isTie: true } as never,
    ];
  }
  return {
    id: 'L1', name: 'L', inviteCode: 'X', commissionerTeamId: 'a', settings: DEFAULT_LEAGUE_SETTINGS,
    targetTeamCount: teamIds.length, logoMode: 'emoji', logoEmoji: '', logoDataUrl: null, logoColor: '#fff',
    teams: teamIds.map(team), currentWeek: weeks[weeks.length - 1], seasonPhase: 'regular', seasonStartWeek: '1',
    standings: [], matchupsByWeek, rostersByTeamWeek: rosters, activity: [], chat: [], bracket: null, prizePool: null,
  } as never;
}

describe('betEdge', () => {
  it('pays less for landing a favourite than for landing a longshot', () => {
    // -200 is priced to win 66.7%, so winning it earns a third of the stake in credit.
    expect(betEdge({ status: 'won', stake: 30, oddsAtPlacement: -200 })).toBeCloseTo(30 * (1 - 2 / 3), 6);
    // +300 is priced at 25%, so the same stake on a winner is worth more than twice as much.
    expect(betEdge({ status: 'won', stake: 30, oddsAtPlacement: 300 })).toBeCloseTo(30 * (1 - 0.25), 6);
  });

  it('charges more for missing a favourite than for missing a longshot', () => {
    expect(betEdge({ status: 'lost', stake: 30, oddsAtPlacement: -200 })).toBeCloseTo(-30 * (2 / 3), 6);
    expect(betEdge({ status: 'lost', stake: 30, oddsAtPlacement: 300 })).toBeCloseTo(-30 * 0.25, 6);
  });

  it('scores pushes, voids and pending picks as nothing', () => {
    for (const status of ['push', 'voided', 'pending'] as const) {
      expect(betEdge({ status, stake: 30, oddsAtPlacement: -110 })).toBe(0);
    }
  });

  it('weights by stake, so the same call backed harder counts for more', () => {
    const small = betEdge({ status: 'won', stake: 5, oddsAtPlacement: 100 });
    const large = betEdge({ status: 'won', stake: 20, oddsAtPlacement: 100 });
    expect(large).toBeCloseTo(small * 4, 6);
  });

  it('leaves a bettor who hits exactly at the price slightly negative, because of the vig', () => {
    // Two -110 picks, one hit one missed: the fair rate is 50% but the price implied 52.4%.
    const net = betEdge({ status: 'won', stake: 10, oddsAtPlacement: -110 }) + betEdge({ status: 'lost', stake: 10, oddsAtPlacement: -110 });
    expect(net).toBeLessThan(0);
    expect(net).toBeCloseTo(-0.476, 2);
  });
});

describe('powerSeries', () => {
  it('accumulates across weeks and ranks the league at each one', () => {
    const rosters = {
      [rosterKey('a', 1)]: roster('a', 1, [['won', 10, 100]]),       // +5.0
      [rosterKey('b', 1)]: roster('b', 1, [['lost', 10, 100]]),      // -5.0
      [rosterKey('a', 2)]: roster('a', 2, [['lost', 10, 100]]),      // -5.0 -> 0.0
      [rosterKey('b', 2)]: roster('b', 2, [['won', 10, 100]]),       // +5.0 -> 0.0
    };
    const series = powerSeries(league(rosters, [1, 2]));
    expect(series.a[0].score).toBeCloseTo(5, 6);
    expect(series.a[0].rank).toBe(1);
    expect(series.b[0].rank).toBe(2);
    // Level after two weeks, so they share the better rank.
    expect(series.a[1].score).toBeCloseTo(0, 6);
    expect(series.b[1].score).toBeCloseTo(0, 6);
    expect(series.a[1].rank).toBe(1);
    expect(series.b[1].rank).toBe(1);
  });

  it('counts only settled bets toward the sample', () => {
    const rosters = {
      [rosterKey('a', 1)]: roster('a', 1, [['won', 10, 100], ['pending', 10, 100], ['push', 10, 100]]),
      [rosterKey('b', 1)]: roster('b', 1, []),
    };
    const series = powerSeries(league(rosters, [1]));
    expect(series.a[0].bets).toBe(1);
    expect(series.b[0].bets).toBe(0);
  });

  it('separates two teams on the same record by the prices they took', () => {
    // Both go 1-1. Going 1-1 on +300 longshots beats what the prices said (they were meant to hit
    // once every four), while going 1-1 on -300 favourites falls well short (they were meant to hit
    // three times in four). Record alone cannot tell these apart; this is the whole point of the
    // metric.
    const rosters = {
      [rosterKey('a', 1)]: roster('a', 1, [['won', 10, 300], ['lost', 10, 300]]),
      [rosterKey('b', 1)]: roster('b', 1, [['won', 10, -300], ['lost', 10, -300]]),
    };
    const rows = powerRankings(league(rosters, [1]));
    expect(rows[0].teamId).toBe('a');
    expect(rows[0].score).toBeCloseTo(5, 6);
    expect(rows[1].score).toBeCloseTo(-5, 6);
  });

  it('is unmoved by swapping which of two identical lines happened to win', () => {
    // A sanity property rather than a feature: summing (result - implied) over the same pair of
    // prices gives 1 - p1 - p2 whichever one landed. The metric scores the prices taken, not which
    // particular ticket came in, so this case must tie.
    const rosters = {
      [rosterKey('a', 1)]: roster('a', 1, [['won', 10, 300], ['lost', 10, -300]]),
      [rosterKey('b', 1)]: roster('b', 1, [['lost', 10, 300], ['won', 10, -300]]),
    };
    const rows = powerRankings(league(rosters, [1]));
    expect(rows[0].score).toBeCloseTo(rows[1].score, 6);
  });
});

describe('powerRankings movement', () => {
  it('reports a climb as positive and has no movement in the first week', () => {
    const first = powerRankings(league({
      [rosterKey('a', 1)]: roster('a', 1, [['won', 10, 100]]),
      [rosterKey('b', 1)]: roster('b', 1, [['lost', 10, 100]]),
    }, [1]));
    expect(first.every((r) => r.movement === null)).toBe(true);

    const rows = powerRankings(league({
      [rosterKey('a', 1)]: roster('a', 1, [['won', 10, 100]]),
      [rosterKey('b', 1)]: roster('b', 1, [['lost', 10, 100]]),
      [rosterKey('a', 2)]: roster('a', 2, [['lost', 20, 100]]),
      [rosterKey('b', 2)]: roster('b', 2, [['won', 20, 100]]),
    }, [1, 2]));
    const b = rows.find((r) => r.teamId === 'b')!;
    const a = rows.find((r) => r.teamId === 'a')!;
    expect(b.rank).toBe(1);
    expect(b.movement).toBe(1); // climbed from 2nd to 1st
    expect(a.movement).toBe(-1);
  });
});

describe('standingsMovement', () => {
  it('has no movement to report in a one-week season', () => {
    const l = league({}, [1]);
    expect(Object.values(standingsMovement(l)).every((v) => v === null)).toBe(true);
  });

  it('reports a climb as positive once a team passes another', () => {
    const l = league({}, [1, 2]);
    // Week 1 'b' wins, week 2 'a' wins: level on record, so the tiebreak decides and nobody moves far.
    l.matchupsByWeek['1'] = [{ id: 'm1', week: 1, teamAId: 'a', teamBId: 'b', teamAScore: -5, teamBScore: 5, winnerId: 'b', isTie: false } as never];
    l.matchupsByWeek['2'] = [{ id: 'm2', week: 2, teamAId: 'a', teamBId: 'b', teamAScore: 20, teamBScore: -1, winnerId: 'a', isTie: false } as never];
    const moved = standingsMovement(l);
    // 'a' was last after week 1 and is level on record but ahead on P/L after week 2.
    expect(moved.a).toBe(1);
    expect(moved.b).toBe(-1);
  });
});

describe('powerBreakdown', () => {
  it('splits the score into what the winners earned and what the losers gave back', () => {
    const rosters = {
      [rosterKey('a', 1)]: roster('a', 1, [['won', 10, 100], ['lost', 20, -200], ['push', 10, 100]]),
      [rosterKey('b', 1)]: roster('b', 1, []),
    };
    const b = powerBreakdown(league(rosters, [1]), 'a');
    expect(b.settled).toBe(2); // the push is not a judgment on the pick
    expect(b.wins).toBe(1);
    expect(b.losses).toBe(1);
    expect(b.staked).toBe(30);
    expect(b.fromWins).toBeCloseTo(10 * (1 - 0.5), 6);
    expect(b.fromLosses).toBeCloseTo(20 * -(2 / 3), 6);
    expect(b.score).toBeCloseTo(b.fromWins + b.fromLosses, 6);
  });

  it('reports the hit rate against what the prices implied', () => {
    // Four picks at even money, three landed: priced at 50%, hit at 75%.
    const rosters = {
      [rosterKey('a', 1)]: roster('a', 1, [['won', 10, 100], ['won', 10, 100], ['won', 10, 100], ['lost', 10, 100]]),
      [rosterKey('b', 1)]: roster('b', 1, []),
    };
    const b = powerBreakdown(league(rosters, [1]), 'a');
    expect(b.impliedRate).toBeCloseTo(0.5, 6);
    expect(b.hitRate).toBeCloseTo(0.75, 6);
    expect(b.edgePts).toBeCloseTo(25, 6);
  });

  it('is all zeroes for a team with nothing settled', () => {
    const b = powerBreakdown(league({}, [1]), 'a');
    expect(b).toMatchObject({ settled: 0, score: 0, hitRate: 0, impliedRate: 0 });
  });
});

describe('powerSeries stepped by game day', () => {
  const games = {
    g0: { id: 'g0', daySlot: 'TNF' } as never,
    g1: { id: 'g1', daySlot: 'SUN_EARLY' } as never,
    g2: { id: 'g2', daySlot: 'MNF' } as never,
  };

  /** roster() assigns pick i to game `g${i % 5}`, so picks 0,1,2 land on TNF, Sunday and Monday. */
  it('gives a week one point per day window its picks actually used', () => {
    const rosters = {
      [rosterKey('a', 1)]: roster('a', 1, [['won', 10, 100], ['won', 10, 100], ['lost', 10, 100]]),
      [rosterKey('b', 1)]: roster('b', 1, [['lost', 10, 100], ['lost', 10, 100], ['won', 10, 100]]),
    };
    const l = league(rosters, [1]);
    expect(powerSeries(l, games).a.map((p) => p.slot)).toEqual(['TNF', 'SUN_EARLY', 'MNF']);
    // Without games there is nothing to step by, so the week stays a single point.
    expect(powerSeries(l).a).toHaveLength(1);
  });

  it('moves the line on the day the pick settled, not at the end of the week', () => {
    const rosters = {
      [rosterKey('a', 1)]: roster('a', 1, [['won', 10, 100], ['lost', 10, 100]]),
      [rosterKey('b', 1)]: roster('b', 1, []),
    };
    const pts = powerSeries(league(rosters, [1]), games).a;
    expect(pts[0].score).toBeCloseTo(5, 6); // Thursday win
    expect(pts[1].score).toBeCloseTo(0, 6); // given back on Sunday
  });

  it('ends at the same total whether or not it is stepped by day', () => {
    const rosters = {
      [rosterKey('a', 1)]: roster('a', 1, [['won', 10, 300], ['lost', 20, -150], ['won', 15, 120]]),
      [rosterKey('b', 1)]: roster('b', 1, [['lost', 10, 300]]),
    };
    const l = league(rosters, [1]);
    const stepped = powerSeries(l, games).a;
    const weekly = powerSeries(l).a;
    expect(stepped[stepped.length - 1].score).toBeCloseTo(weekly[weekly.length - 1].score, 6);
  });

  it('still counts a pick whose game is not loaded', () => {
    const rosters = {
      [rosterKey('a', 1)]: roster('a', 1, [['won', 10, 100]]),
      [rosterKey('b', 1)]: roster('b', 1, []),
    };
    // g0 missing from the map entirely.
    const pts = powerSeries(league(rosters, [1]), {}).a;
    expect(pts[pts.length - 1].score).toBeCloseTo(5, 6);
    expect(pts[pts.length - 1].bets).toBe(1);
  });
});

describe('powerBreakdown agrees with the trajectory', () => {
  const games = {
    g0: { id: 'g0', daySlot: 'TNF' } as never,
    g1: { id: 'g1', daySlot: 'SUN_EARLY' } as never,
    g2: { id: 'g2', daySlot: 'MNF' } as never,
  };

  it('matches the series at every point, including mid-week', () => {
    // The figures under the graph have to equal the point the graph is showing. They disagreed
    // once a week held several points, because the breakdown was cut at the week (see chat).
    const rosters = {
      [rosterKey('a', 1)]: roster('a', 1, [['won', 10, 120], ['lost', 15, -140], ['won', 12, 250]]),
      [rosterKey('b', 1)]: roster('b', 1, [['lost', 10, 120], ['won', 15, -140], ['lost', 12, 250]]),
      [rosterKey('a', 2)]: roster('a', 2, [['lost', 20, -200], ['won', 10, 180]]),
      [rosterKey('b', 2)]: roster('b', 2, [['won', 20, -200], ['lost', 10, 180]]),
    };
    const l = league(rosters, [1, 2]);
    const pts = powerSeries(l, games).a;
    expect(pts.length).toBeGreaterThan(2); // genuinely stepped by day
    for (const point of pts) {
      const b = powerBreakdown(l, 'a', point, games);
      expect(b.score).toBeCloseTo(point.score, 6);
      expect(b.settled).toBe(point.bets);
    }
  });

  it('matches the final total when given no cut at all', () => {
    const rosters = {
      [rosterKey('a', 1)]: roster('a', 1, [['won', 10, 120], ['lost', 15, -140]]),
      [rosterKey('b', 1)]: roster('b', 1, []),
    };
    const l = league(rosters, [1]);
    const pts = powerSeries(l, games).a;
    expect(powerBreakdown(l, 'a').score).toBeCloseTo(pts[pts.length - 1].score, 6);
  });
});
