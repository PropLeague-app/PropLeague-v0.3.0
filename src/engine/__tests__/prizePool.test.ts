import { describe, it, expect } from 'vitest';
import {
  initialPoolAmount,
  realDollarAmount,
  advancePoolForWeek,
  computePayouts,
  championAndRunnerUp,
  validatePayoutSplit,
  payoutPlacementOrder,
  computeStandingMultipliers,
  activeMultipliers,
} from '../prizePool';
import { DEFAULT_LEAGUE_SETTINGS, DEFAULT_POOL_MULTIPLIER_SETTINGS } from '../../types';
import type { League, LeagueTeam, MultiplierBasis, PlayoffBracket, PrizePool, TeamStanding } from '../../types';
import { emptyStanding } from '../standings';

describe('initialPoolAmount', () => {
  it('is teamCount x buyInAmount', () => {
    expect(initialPoolAmount(10, 50)).toBe(500);
  });
});

describe('realDollarAmount', () => {
  it('matches the spec example exactly: $20 of $100 credits, $100 pool / 10 teams -> $2.00', () => {
    expect(realDollarAmount(20, 100, 100, 10)).toBeCloseTo(2.0, 5);
  });
});

describe('advancePoolForWeek', () => {
  const pool: PrizePool = { initial: 100, current: 100, locked: false, history: [] };

  it('grows the pool on net-positive weekly virtual P/L', () => {
    const next = advancePoolForWeek(pool, 1, new Map([['a', 20]]), DEFAULT_LEAGUE_SETTINGS, 10);
    expect(next.current).toBeGreaterThan(100);
    expect(next.history).toHaveLength(1);
  });

  it('never goes negative and locks once it hits ~$0', () => {
    const next = advancePoolForWeek(pool, 1, new Map([['a', -1000]]), DEFAULT_LEAGUE_SETTINGS, 10);
    expect(next.current).toBe(0);
    expect(next.locked).toBe(true);
  });

  it('is a no-op once already locked', () => {
    const locked: PrizePool = { ...pool, locked: true };
    const next = advancePoolForWeek(locked, 1, new Map([['a', 500]]), DEFAULT_LEAGUE_SETTINGS, 10);
    expect(next).toBe(locked);
  });
});

describe('championAndRunnerUp / computePayouts', () => {
  it('splits the pool per settings.payoutSplit*Pct once a champion is decided', () => {
    const bracket: PlayoffBracket = {
      fieldSize: 2,
      eliminationType: 'single',
      seeds: ['a', 'b'],
      matches: [
        { id: 'F', side: 'F', label: 'Championship', sourceA: { type: 'seed', seed: 1 }, sourceB: { type: 'seed', seed: 2 }, teamAId: 'a', teamBId: 'b', teamAScore: 10, teamBScore: 5, winnerId: 'a', weekId: 'CONF' },
      ],
      championId: 'a',
    };
    const { championId, runnerUpId } = championAndRunnerUp(bracket);
    expect(championId).toBe('a');
    expect(runnerUpId).toBe('b');

    const pool: PrizePool = { initial: 100, current: 100, locked: true, history: [] };
    const settings = { ...DEFAULT_LEAGUE_SETTINGS, payoutSplits: [80, 20] };
    const payouts = computePayouts(pool, bracket, settings);
    expect(payouts).toEqual([
      { teamId: 'a', place: 1, pct: 80, amount: 80 },
      { teamId: 'b', place: 2, pct: 20, amount: 20 },
    ]);
  });

  it('returns no payouts before the bracket has a champion', () => {
    expect(championAndRunnerUp(null).championId).toBeNull();
  });
});

// manual v0.3.0 §4: fully customizable payout structure.
describe('validatePayoutSplit', () => {
  it('accepts a valid split', () => {
    expect(validatePayoutSplit([60, 30, 10], 8).valid).toBe(true);
  });

  it('rejects a split that does not sum to 100', () => {
    const result = validatePayoutSplit([60, 30], 8);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/sum to exactly 100/);
  });

  it('rejects a split with a zero or negative place', () => {
    const result = validatePayoutSplit([100, 0], 8);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/more than 0%/);
  });

  it('rejects more paid places than playoff teams', () => {
    const result = validatePayoutSplit([20, 20, 20, 20, 20], 4);
    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/playoff teams/);
  });

  it('rejects an empty split', () => {
    expect(validatePayoutSplit([], 8).valid).toBe(false);
  });
});

describe('payoutPlacementOrder / computePayouts with 3+ paid places', () => {
  const bracket: PlayoffBracket = {
    fieldSize: 4,
    eliminationType: 'single',
    seeds: ['s1', 's2', 's3', 's4'],
    matches: [
      { id: 'W1-1', side: 'W', label: 'Semifinal', sourceA: { type: 'seed', seed: 1 }, sourceB: { type: 'seed', seed: 4 }, teamAId: 's1', teamBId: 's4', teamAScore: 10, teamBScore: 5, winnerId: 's1', weekId: 'WC' },
      { id: 'W1-2', side: 'W', label: 'Semifinal', sourceA: { type: 'seed', seed: 2 }, sourceB: { type: 'seed', seed: 3 }, teamAId: 's2', teamBId: 's3', teamAScore: 3, teamBScore: 12, winnerId: 's3', weekId: 'WC' },
      { id: 'F', side: 'F', label: 'Championship', sourceA: { type: 'winner', matchId: 'W1-1' }, sourceB: { type: 'winner', matchId: 'W1-2' }, teamAId: 's1', teamBId: 's3', teamAScore: 20, teamBScore: 8, winnerId: 's1', weekId: 'CONF' },
    ],
    championId: 's1',
  };

  it('falls back to regular-season seed order for places beyond champion/runner-up, since there are no placement games', () => {
    // s1 champion, s3 runner-up (won its way to the final); s2 and s4 never played each
    // other again after being eliminated, so 3rd/4th fall back to seed order (s2 before s4).
    expect(payoutPlacementOrder(bracket)).toEqual(['s1', 's3', 's2', 's4']);
  });

  it('pays every place in a custom 3-place split against that placement order', () => {
    const pool: PrizePool = { initial: 200, current: 200, locked: true, history: [] };
    const settings = { ...DEFAULT_LEAGUE_SETTINGS, payoutSplits: [60, 30, 10] };
    const payouts = computePayouts(pool, bracket, settings);
    expect(payouts).toEqual([
      { teamId: 's1', place: 1, pct: 60, amount: 120 },
      { teamId: 's3', place: 2, pct: 30, amount: 60 },
      { teamId: 's2', place: 3, pct: 10, amount: 20 },
    ]);
  });
});

// manual v0.3.0 §8: prize pool impact multipliers.
function standingsFor(order: string[]): TeamStanding[] {
  return order.map((id) => emptyStanding(id));
}

describe('computeStandingMultipliers', () => {
  it('is a flat 1.0x for every team at spread 0, regardless of basis', () => {
    const standings = standingsFor(['a', 'b', 'c', 'd', 'e']);
    for (const basis of ['rank', 'record', 'seasonPL'] as MultiplierBasis[]) {
      const result = computeStandingMultipliers(standings, basis, 0);
      expect(Object.values(result)).toEqual([1, 1, 1, 1, 1]);
    }
  });

  it('gives the top-ranked team 1.2x and the bottom-ranked team 0.8x at max spread', () => {
    const standings = standingsFor(['a', 'b', 'c', 'd', 'e']);
    const result = computeStandingMultipliers(standings, 'rank', 1);
    expect(result.a).toBeCloseTo(1.2, 5);
    expect(result.c).toBeCloseTo(1.0, 5); // dead-center of 5 teams
    expect(result.e).toBeCloseTo(0.8, 5);
  });

  it('always averages exactly 1.0 across the league, for any spread', () => {
    const standings = standingsFor(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    for (const spread of [0, 0.25, 0.5, 0.75, 1]) {
      const result = computeStandingMultipliers(standings, 'rank', spread);
      const avg = Object.values(result).reduce((a, b) => a + b, 0) / standings.length;
      expect(avg).toBeCloseTo(1.0, 9);
    }
  });

  it('re-ranks by season P/L, ignoring the array order passed in', () => {
    const standings: TeamStanding[] = [
      { ...emptyStanding('a'), totalPL: -50 },
      { ...emptyStanding('b'), totalPL: 100 },
      { ...emptyStanding('c'), totalPL: 0 },
    ];
    const result = computeStandingMultipliers(standings, 'seasonPL', 1);
    expect(result.b).toBeCloseTo(1.2, 5); // best P/L
    expect(result.a).toBeCloseTo(0.8, 5); // worst P/L
  });

  it('re-ranks by win percentage for the record basis', () => {
    const standings: TeamStanding[] = [
      { ...emptyStanding('a'), wins: 1, losses: 5 },
      { ...emptyStanding('b'), wins: 5, losses: 1 },
    ];
    const result = computeStandingMultipliers(standings, 'record', 1);
    expect(result.b).toBeCloseTo(1.2, 5);
    expect(result.a).toBeCloseTo(0.8, 5);
  });

  it('gives a single-team league a flat 1.0x (no meaningful spread with one team)', () => {
    expect(computeStandingMultipliers(standingsFor(['a']), 'rank', 1)).toEqual({ a: 1 });
  });

  it('returns an empty object for an empty league', () => {
    expect(computeStandingMultipliers([], 'rank', 1)).toEqual({});
  });
});

// This is the spec's own required assertion: "total real dollars wagered under
// multipliers equals the total without them, for any multiplier configuration."
// That's a claim about aggregate exposure, not about any one team's individual
// outcome — amplifying one team's real-dollar impact and shrinking another's is
// the entire point of the feature, and necessarily changes *their* numbers. What
// must stay fixed is the total: each team's multiplier scales its 1/N share of the
// pool (realDollarAmount's `perTeamShare`), and computeStandingMultipliers always
// normalizes those shares to average exactly 1.0, so summed across a league where
// every team wagers/scores the same amount — the case that isolates the share math
// from any particular team's result — the total is provably unchanged.
describe('multiplier conservation (manual v0.3.0 §8 required property)', () => {
  it('produces the same total real-dollar pool movement with multipliers on or off, when every team wagers the same amount', () => {
    const teamIds = ['a', 'b', 'c', 'd', 'e', 'f'];
    const pool: PrizePool = { initial: 500, current: 500, locked: false, history: [] };
    const settings = DEFAULT_LEAGUE_SETTINGS;

    for (const equalScore of [30, -18.5, 0]) {
      const scores = new Map(teamIds.map((id) => [id, equalScore]));
      const baseline = advancePoolForWeek(pool, 1, scores, settings, teamIds.length);

      for (const basis of ['rank', 'record', 'seasonPL'] as MultiplierBasis[]) {
        for (const spread of [0.25, 0.5, 0.75, 1]) {
          const multipliers = computeStandingMultipliers(standingsFor(teamIds), basis, spread);
          const withMultipliers = advancePoolForWeek(pool, 1, scores, settings, teamIds.length, multipliers);
          expect(withMultipliers.current).toBeCloseTo(baseline.current, 6);
        }
      }
    }
  });

  it('always sums each team\'s scaled 1/N pool share back to exactly the full pool, for any configuration', () => {
    const poolValue = 733.5;
    const teamCounts = [1, 2, 3, 5, 8, 16];
    for (const teamCount of teamCounts) {
      const standings = standingsFor(Array.from({ length: teamCount }, (_, i) => `t${i}`));
      for (const basis of ['rank', 'record', 'seasonPL'] as MultiplierBasis[]) {
        for (const spread of [0, 0.5, 1]) {
          const multipliers = computeStandingMultipliers(standings, basis, spread);
          const shareSum = Object.values(multipliers).reduce((sum, mult) => sum + (poolValue / teamCount) * mult, 0);
          expect(shareSum).toBeCloseTo(poolValue, 6);
        }
      }
    }
  });
});

function leagueForMultiplierTest(overrides: Partial<League> = {}): League {
  const teams: LeagueTeam[] = ['a', 'b', 'c'].map((id) => ({
    id,
    ownerName: id,
    teamName: id,
    abbrev: id.toUpperCase(),
    logoMode: 'initials',
    logoEmoji: '🏈',
    logoColor: '#4C8DF5',
    logoDataUrl: null,
    isUser: id === 'a',
    isSimulated: id !== 'a',
    conferenceId: null,
  }));
  return {
    id: 'league-1',
    name: 'Test League',
    inviteCode: 'ABC123',
    commissionerTeamId: 'a',
    settings: { ...DEFAULT_LEAGUE_SETTINGS, poolMultipliers: { ...DEFAULT_POOL_MULTIPLIER_SETTINGS, enabled: true, spread: 1 } },
    targetTeamCount: 3,
    logoMode: 'initials',
    logoEmoji: '🏆',
    logoDataUrl: null,
    logoColor: '#4C8DF5',
    teams,
    currentWeek: 1,
    seasonPhase: 'regular',
    matchupsByWeek: {},
    rostersByTeamWeek: {},
    standings: standingsFor(['a', 'b', 'c']),
    bracket: null,
    activity: [],
    prizePool: null,
    manualGameOverrides: {},
    ...overrides,
  };
}

describe('activeMultipliers', () => {
  it('is a flat 1.0x for every team when the feature is off', () => {
    const league = leagueForMultiplierTest({ settings: { ...DEFAULT_LEAGUE_SETTINGS, poolMultipliers: DEFAULT_POOL_MULTIPLIER_SETTINGS } });
    expect(activeMultipliers(league)).toEqual({ a: 1, b: 1, c: 1 });
  });

  it('is a flat 1.0x for every team during the playoffs, even when enabled', () => {
    const league = leagueForMultiplierTest({ seasonPhase: 'playoffs' });
    expect(activeMultipliers(league)).toEqual({ a: 1, b: 1, c: 1 });
  });

  it('delegates to computeStandingMultipliers using the league\'s current standings when enabled in-season', () => {
    const league = leagueForMultiplierTest();
    const result = activeMultipliers(league);
    expect(result.a).toBeCloseTo(1.2, 5);
    expect(result.c).toBeCloseTo(0.8, 5);
  });
});
