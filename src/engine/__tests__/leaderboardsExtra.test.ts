import { describe, it, expect } from 'vitest';
import { computeSkillBoards, weekScoreboard } from '../leaderboardsExtra';
import { DEFAULT_LEAGUE_SETTINGS } from '../../types';
import type { League } from '../../types';

function wager(i: number, o: Record<string, unknown>) {
  return { id: `w${i}`, slotId: `s${i}`, gameId: 'g', marketKey: 'player_reception_yds', side: 'Over', oddsAtPlacement: -110, stake: 10, placedAt: '2026-10-01T00:00:00Z', status: 'won', settledProfit: 9, ...o };
}

function league(): League {
  const roster = (teamId: string, week: number, wagers: Record<string, unknown>[]) => ({
    week,
    teamId,
    slots: wagers.map((w, i) => ({ slotId: `s${i}`, position: 'WR', wager: wager(i, w) })),
  });
  const hot = Array.from({ length: 6 }, () => ({ status: 'won', settledProfit: 9 }));
  const cold = Array.from({ length: 6 }, (_, i) => (i === 0 ? { status: 'won', settledProfit: 9 } : { status: 'lost', settledProfit: -10 }));
  return {
    settings: { ...DEFAULT_LEAGUE_SETTINGS },
    currentWeek: 2,
    teams: [{ id: 'a' }, { id: 'b' }],
    rostersByTeamWeek: { 'a:1': roster('a', 1, hot), 'b:1': roster('b', 1, cold) },
    matchupsByWeek: { '2': [{ id: 'm', week: 2, teamAId: 'a', teamBId: 'b', teamAScore: -12, teamBScore: 30, winnerId: null, isTie: false }] },
    standings: [],
  } as unknown as League;
}

describe('computeSkillBoards', () => {
  const boards = computeSkillBoards(league(), () => undefined);
  it('hit rate edge ranks teams that beat the odds first, and needs enough decided bets', () => {
    expect(boards.hitRateEdge.map((r) => r.teamId)).toEqual(['a', 'b']);
    expect(boards.hitRateEdge[0].value).toBeGreaterThan(0);
    expect(boards.hitRateEdge[1].value).toBeLessThan(0);
  });
  it('streak and biggest win skip teams with none', () => {
    expect(boards.longestWinStreak[0]).toEqual({ teamId: 'a', value: 6 });
    expect(boards.biggestWin.every((r) => r.value > 0)).toBe(true);
  });
  it('market specialist is the best ROI team with enough bets', () => {
    expect(boards.marketSpecialists[0]).toMatchObject({ market: 'player_reception_yds', teamId: 'a', bets: 6 });
  });
});

describe('weekScoreboard', () => {
  it('lists both sides best first and skips scores that are not in yet', () => {
    expect(weekScoreboard(league(), 2)).toEqual([{ teamId: 'b', value: 30 }, { teamId: 'a', value: -12 }]);
    expect(weekScoreboard(league(), 9)).toEqual([]);
  });
});
