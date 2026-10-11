import { describe, expect, it } from 'vitest';
import type { League, PlayoffFieldSize, TeamStanding } from '../../types';
import { DEFAULT_LEAGUE_SETTINGS } from '../../types';
import { advanceBracket, buildBracket, playoffWeekSequence, seasonPlan } from '../playoffs';
import {
  eliminations,
  layoutBracket,
  leagueBracketModel,
  leagueWeekMatchups,
  scheduledMatchWeeks,
  weekRoundShort,
  weekStatus,
  BOX_W,
  COL_GAP,
} from '../bracketModel';

function standing(teamId: string, wins: number): TeamStanding {
  return { teamId, wins, losses: 10 - wins, ties: 0, totalPL: 0, betsWon: 0, betsLost: 0, betsPushed: 0, bestWeekPL: 0, totalWagered: 0, weeklyScores: {} } as unknown as TeamStanding;
}

function league(n: number, size: PlayoffFieldSize, elim: 'single' | 'double' = 'single', extra: Partial<League> = {}): League {
  const teams = Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, conferenceId: null }));
  return {
    settings: { ...DEFAULT_LEAGUE_SETTINGS, playoffTeams: size, eliminationType: elim },
    teams,
    standings: teams.map((t, i) => standing(t.id, 10 - i)),
    matchupsByWeek: {},
    bracket: null,
    seasonPhase: 'regular',
    currentWeek: 5,
    ...extra,
  } as unknown as League;
}

describe('bracket model', () => {
  it('projects a bracket from the standings before the playoffs', () => {
    const model = leagueBracketModel(league(8, 4))!;
    expect(model.projected).toBe(true);
    expect(model.bracket.seeds).toEqual(['t1', 't2', 't3', 't4']);
    const first = model.bracket.matches.filter((m) => m.weekId === model.weeks[0]);
    expect(first.map((m) => [m.teamAId, m.teamBId])).toEqual([['t1', 't4'], ['t2', 't3']]);
  });

  it('places every game of every structure in a playoff week', () => {
    for (const size of [2, 4, 6, 8, 16] as PlayoffFieldSize[]) {
      for (const elim of ['single', 'double'] as const) {
        const seqW = seasonPlan(1, 'CONF', size, elim).playoffWeeks;
        const weeks = scheduledMatchWeeks(size, elim, false, seqW);
        const seq = seqW.map(String);
        for (const w of weeks.values()) expect(seq).toContain(String(w));
      }
    }
  });

  it('shows the top two seeds of a 6-team field as byes in round 1, feeding the semifinals', () => {
    const model = leagueBracketModel(league(8, 6))!;
    const status = weekStatus(model, league(8, 6), model.weeks[0]);
    expect(status.byes.map((b) => b.teamId)).toEqual(['t1', 't2']);
    expect(status.byes[0].nextLabel).toBe('Final 4');
    expect(status.out.map((o) => o.reason)).toEqual(['Missed the playoffs', 'Missed the playoffs']);
    const layout = layoutBracket(model);
    const byes = layout.nodes.filter((n) => n.kind === 'bye');
    expect(byes).toHaveLength(2);
    expect(byes.every((b) => b.col === 0)).toBe(true);
    const final = layout.nodes.find((n) => n.id === 'F')!;
    expect(final.x).toBe(2 * (BOX_W + COL_GAP));
  });

  it('only knocks a team out when no later game takes its loss (double elimination)', () => {
    const seq = playoffWeekSequence(4, 'double');
    let b = buildBracket(['a', 'b', 'c', 'd'], 4, 'double');
    b = advanceBracket(b, null, () => null, seq[0]);
    b = advanceBracket(b, seq[0], (id) => (id === 'a' || id === 'b' ? 10 : 0), seq[1]);
    expect(eliminations(b).size).toBe(0); // the two round-1 losers drop to the losers bracket
    b = advanceBracket(b, seq[1], (id) => (id === 'c' ? 10 : 0), seq[2]);
    expect([...eliminations(b).keys()]).toEqual(['d']);
  });

  it('labels weeks for chips', () => {
    const model = leagueBracketModel(league(8, 8))!;
    expect(model.weeks.map((w) => weekRoundShort(model, w))).toEqual(['E8', 'F4', 'Bowl']);
  });

  it('keeps only bracket games in a playoff week', () => {
    let b = buildBracket(['t1', 't2'], 2, 'single');
    b = advanceBracket(b, null, () => null, 'CONF');
    const l = league(4, 2, 'single', {
      bracket: b,
      seasonPhase: 'playoffs',
      matchupsByWeek: {
        CONF: [
          { id: 'x', week: 'CONF', teamAId: 't1', teamBId: 't2', teamAScore: null, teamBScore: null, winnerId: null, isTie: false },
          { id: 'y', week: 'CONF', teamAId: 't3', teamBId: 't4', teamAScore: null, teamBScore: null, winnerId: null, isTie: false },
        ],
      },
    });
    expect(leagueWeekMatchups(l, 'CONF').map((m) => m.id)).toEqual(['x']);
  });
});
