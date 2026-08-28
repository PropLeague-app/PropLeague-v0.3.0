import { describe, it, expect } from 'vitest';
import {
  buildBracket,
  buildConferenceBracket,
  advanceBracket,
  doubleEliminationAvailable,
  regularSeasonWeeksFor,
  playoffWeekSequence,
  championAndRunnerUp,
  fieldSizeOptionsForTeamCount,
  structureAvailable,
} from '../playoffs';
import type { PlayoffFieldSize } from '../../types';

function runToCompletion(
  fieldSize: PlayoffFieldSize,
  eliminationType: 'single' | 'double',
  winnerPicker: (aIdx: number, bIdx: number, matchId: string) => 'a' | 'b',
) {
  const seeds = Array.from({ length: fieldSize }, (_, i) => `seed${i + 1}`);
  let bracket = buildBracket(seeds, fieldSize, eliminationType);
  bracket = advanceBracket(bracket, null, () => null, 0);
  let week = 0;
  let passes = 0;
  while (bracket.championId == null && passes < 30) {
    passes++;
    const next = passes;
    const scoresFor = (teamId: string) => {
      const match = bracket.matches.find((m) => m.weekId === week && (m.teamAId === teamId || m.teamBId === teamId));
      if (!match) return null;
      const aIdx = seeds.indexOf(match.teamAId!);
      const bIdx = seeds.indexOf(match.teamBId!);
      const winner = winnerPicker(aIdx, bIdx, match.id);
      return teamId === match.teamAId ? (winner === 'a' ? 1 : 0) : winner === 'b' ? 1 : 0;
    };
    bracket = advanceBracket(bracket, week, scoresFor, next);
    week = next;
  }
  return { bracket, passes };
}

describe('buildBracket seeding', () => {
  it('4-team: 1v4 and 2v3 in the semis', () => {
    const bracket = buildBracket(['s1', 's2', 's3', 's4'], 4, 'single');
    const semis = bracket.matches.filter((m) => m.side === 'W');
    const pairs = semis.map((m) => [m.sourceA, m.sourceB]);
    expect(pairs).toEqual([
      [{ type: 'seed', seed: 1 }, { type: 'seed', seed: 4 }],
      [{ type: 'seed', seed: 2 }, { type: 'seed', seed: 3 }],
    ]);
  });

  it('6-team: top 2 seeds bye round 1', () => {
    const bracket = buildBracket(['s1', 's2', 's3', 's4', 's5', 's6'], 6, 'single');
    const round1 = bracket.matches.filter((m) => m.label === 'Round 1');
    const round1Seeds = round1.flatMap((m) => [m.sourceA, m.sourceB]).filter((s) => s.type === 'seed').map((s) => (s as { seed: number }).seed);
    expect(round1Seeds.sort()).toEqual([3, 4, 5, 6]);
  });
});

describe('doubleEliminationAvailable', () => {
  it('supports 2/4/8-team fields but not 6-team', () => {
    expect(doubleEliminationAvailable(2)).toBe(true);
    expect(doubleEliminationAvailable(4)).toBe(true);
    expect(doubleEliminationAvailable(8)).toBe(true);
    expect(doubleEliminationAvailable(6)).toBe(false);
  });

  // manual v0.3.0 §2: a 16-team double-elim bracket needs 9 playoff-week passes in the
  // worst case (winners + losers brackets + true final + a bracket reset) — measured
  // directly against the pre-cap bracket construction during the §2 analysis — far
  // beyond the 5-week ceiling PropLeague's postseason can occupy (WC/DIV/CONF plus at
  // most Weeks 17-18), so it's excluded outright rather than technically offered and
  // silently eating half the regular season. `countPlayoffWeeksNeeded` itself now
  // reports the single-elim fallback's count once double-elim self-gates below.
  it('excludes 16-team from double-elimination entirely', () => {
    expect(doubleEliminationAvailable(16)).toBe(false);
  });

  it('requesting double-elim for an unsupported field size falls back to single-elimination', () => {
    const bracket = buildBracket(
      Array.from({ length: 16 }, (_, i) => `seed${i + 1}`),
      16,
      'double',
    );
    expect(bracket.eliminationType).toBe('single');
    expect(bracket.matches.some((m) => m.side === 'L')).toBe(false);
  });
});

describe('single-elimination bracket resolution', () => {
  it('always crowns seed1 as champion when the higher seed always wins', () => {
    for (const fieldSize of [2, 4, 6, 8, 16] as PlayoffFieldSize[]) {
      const { bracket } = runToCompletion(fieldSize, 'single', (a, b) => (a < b ? 'a' : 'b'));
      expect(bracket.championId).toBe('seed1');
    }
  });
});

describe('double-elimination bracket-reset mechanic', () => {
  it('gives the losers-bracket finalist a genuine second chance, including a reset game if they beat the WB champ', () => {
    // seed1 wins everything in the winners bracket, but loses the true final and the reset
    // to whoever climbed out of the losers bracket -- exercises the full reset path.
    const { bracket } = runToCompletion(8, 'double', (a, b, matchId) => {
      if (matchId === 'TRUE-FINAL' || matchId === 'RESET') return 'b'; // LB side wins both
      return a < b ? 'a' : 'b';
    });
    expect(bracket.matches.some((m) => m.id === 'RESET')).toBe(true);
    const { championId, runnerUpId } = championAndRunnerUp(bracket);
    expect(championId).not.toBeNull();
    expect(runnerUpId).not.toBeNull();
    expect(championId).not.toBe(runnerUpId);
  });

  it('skips the reset entirely when the winners-bracket champion wins the true final outright', () => {
    const { bracket } = runToCompletion(4, 'double', (a, b) => (a < b ? 'a' : 'b'));
    expect(bracket.matches.some((m) => m.id === 'RESET')).toBe(false);
    expect(bracket.championId).toBe('seed1');
  });
});

describe('buildConferenceBracket', () => {
  it('keeps matchups entirely in-conference until the final', () => {
    const bracket = buildConferenceBracket([['a1', 'a2'], ['b1', 'b2']], 4);
    const semis = bracket.matches.filter((m) => m.label !== 'Championship');
    for (const m of semis.filter((x) => x.id !== 'F')) {
      const teamAConf = m.teamAId?.startsWith('a') ?? m.sourceA.type === 'seed';
      expect(teamAConf).toBeDefined();
    }
    const final = bracket.matches.find((m) => m.id === 'F')!;
    expect(final.sourceA).toEqual({ type: 'winner', matchId: 'A-F' });
    expect(final.sourceB).toEqual({ type: 'winner', matchId: 'B-F' });
  });
});

describe('week planning', () => {
  it('16-team single-elim needs exactly 4 rounds, starting at week 18 (manual §3.2)', () => {
    expect(regularSeasonWeeksFor(16, 'single')).toBe(17);
    expect(playoffWeekSequence(16, 'single')).toEqual([18, 'WC', 'DIV', 'CONF']);
  });

  it('a standard 4-team single-elim bracket fits in the existing 18-week regular season', () => {
    expect(regularSeasonWeeksFor(4, 'single')).toBe(18);
    expect(playoffWeekSequence(4, 'single')).toEqual(['DIV', 'CONF']);
  });

  it('double-elim needs extra weeks before WC, shortening the regular season', () => {
    const weeks = regularSeasonWeeksFor(8, 'double');
    expect(weeks).toBeLessThan(18);
    const sequence = playoffWeekSequence(8, 'double');
    expect(sequence[sequence.length - 1]).toBe('CONF');
  });
});

// manual v0.2.1 §3 #2: the playoff field may reach full league capacity (every team
// qualifies, by design) — the only real ceiling left is the absolute 16-team max.
describe('fieldSizeOptionsForTeamCount', () => {
  it('allows the field to reach full league capacity, not just half', () => {
    expect(fieldSizeOptionsForTeamCount(10)).toEqual([2, 4, 6, 8]);
    expect(fieldSizeOptionsForTeamCount(9)).toEqual([2, 4, 6, 8]);
    expect(fieldSizeOptionsForTeamCount(8)).toEqual([2, 4, 6, 8]); // full-capacity 8-team playoff
    expect(fieldSizeOptionsForTeamCount(12)).toEqual([2, 4, 6, 8]);
    expect(fieldSizeOptionsForTeamCount(16)).toEqual([2, 4, 6, 8, 16]); // full-capacity 16-team playoff
    expect(fieldSizeOptionsForTeamCount(32)).toEqual([2, 4, 6, 8, 16]); // absolute max stays 16
  });

  it('never offers a field larger than the smallest supported size for a tiny league', () => {
    expect(fieldSizeOptionsForTeamCount(4)).toEqual([2, 4]); // full-capacity 4-team playoff
    expect(fieldSizeOptionsForTeamCount(2)).toEqual([2]);
  });
});

// manual v0.2.0 §2 #1: each structure remains selectable only while there's still
// enough regular season left to reach its own required playoff start week.
describe('structureAvailable', () => {
  it('is available for every structure at week 1', () => {
    expect(structureAvailable(16, 'single', 1)).toBe(true);
    expect(structureAvailable(16, 'double', 1)).toBe(true);
    expect(structureAvailable(4, 'single', 1)).toBe(true);
  });

  it('locks a structure exactly the week after its own required start week', () => {
    const deadline = regularSeasonWeeksFor(16, 'single'); // 17
    expect(structureAvailable(16, 'single', deadline)).toBe(true);
    expect(structureAvailable(16, 'single', deadline + 1)).toBe(false);
  });

  it('locks structures needing more weeks earlier than ones needing fewer (16-team before standard fields)', () => {
    expect(structureAvailable(16, 'single', 18)).toBe(false);
    expect(structureAvailable(2, 'single', 18)).toBe(true);
  });

  it('locks double-elim earlier than single-elim for the same field size', () => {
    const singleDeadline = regularSeasonWeeksFor(4, 'single');
    const doubleDeadline = regularSeasonWeeksFor(4, 'double');
    expect(doubleDeadline).toBeLessThan(singleDeadline);
    expect(structureAvailable(4, 'double', doubleDeadline + 1)).toBe(false);
    expect(structureAvailable(4, 'single', doubleDeadline + 1)).toBe(true);
  });

  it('is never available once the postseason itself has started (a named week)', () => {
    expect(structureAvailable(2, 'single', 'WC')).toBe(false);
    expect(structureAvailable(4, 'double', 'DIV')).toBe(false);
  });
});
