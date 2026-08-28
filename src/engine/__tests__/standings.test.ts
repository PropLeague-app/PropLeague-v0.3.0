import { describe, it, expect } from 'vitest';
import { computeStandings, emptyStanding, sortStandings } from '../standings';
import type { Matchup, TeamStanding } from '../../types';

function matchup(week: number, teamAId: string, teamBId: string, teamAScore: number, teamBScore: number): Matchup {
  const isTie = teamAScore === teamBScore;
  return {
    id: `w${week}-${teamAId}-${teamBId}`,
    week,
    teamAId,
    teamBId,
    teamAScore,
    teamBScore,
    winnerId: isTie ? null : teamAScore > teamBScore ? teamAId : teamBId,
    isTie,
  };
}

describe('computeStandings', () => {
  it('tallies wins/losses/P/L/best-week from scored matchups', () => {
    const matchupsByWeek = {
      '1': [matchup(1, 'a', 'b', 20, 10)],
      '2': [matchup(2, 'a', 'b', -5, 30)],
    };
    const standings = computeStandings(['a', 'b'], matchupsByWeek, {});
    const a = standings.find((s) => s.teamId === 'a')!;
    const b = standings.find((s) => s.teamId === 'b')!;
    expect(a.wins).toBe(1);
    expect(a.losses).toBe(1);
    expect(a.totalPL).toBeCloseTo(15, 5);
    expect(a.bestWeekPL).toBe(20);
    expect(b.wins).toBe(1);
    expect(b.losses).toBe(1);
  });
});

describe('sortStandings tiebreakers', () => {
  function standing(overrides: Partial<TeamStanding>): TeamStanding {
    return { ...emptyStanding('x'), bestWeekPL: 0, ...overrides };
  }

  it('sorts by win% first', () => {
    const a = standing({ teamId: 'a', wins: 5, losses: 5 });
    const b = standing({ teamId: 'b', wins: 8, losses: 2 });
    const sorted = sortStandings([a, b], {});
    expect(sorted[0].teamId).toBe('b');
  });

  it('breaks a win% tie by total season P/L', () => {
    const a = standing({ teamId: 'a', wins: 5, losses: 5, totalPL: 10 });
    const b = standing({ teamId: 'b', wins: 5, losses: 5, totalPL: 50 });
    const sorted = sortStandings([a, b], {});
    expect(sorted[0].teamId).toBe('b');
  });

  it('breaks a P/L tie by bet win/loss record', () => {
    const a = standing({ teamId: 'a', wins: 5, losses: 5, totalPL: 10, betsWon: 20, betsLost: 20 });
    const b = standing({ teamId: 'b', wins: 5, losses: 5, totalPL: 10, betsWon: 30, betsLost: 10 });
    const sorted = sortStandings([a, b], {});
    expect(sorted[0].teamId).toBe('b');
  });

  it('finally breaks a full tie by head-to-head record', () => {
    const a = standing({ teamId: 'a', wins: 5, losses: 5, totalPL: 10, betsWon: 20, betsLost: 20 });
    const b = standing({ teamId: 'b', wins: 5, losses: 5, totalPL: 10, betsWon: 20, betsLost: 20 });
    const matchupsByWeek = { '1': [matchup(1, 'a', 'b', 20, 10)] };
    const sorted = sortStandings([a, b], matchupsByWeek);
    expect(sorted[0].teamId).toBe('a');
  });
});
