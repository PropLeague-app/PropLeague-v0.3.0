import { describe, it, expect } from 'vitest';
import * as client from '../../playoffs';
import * as clientPool from '../../prizePool';
import { sortStandings as clientSortStandings } from '../../standings';
import * as server from '../../../../supabase/functions/_shared/playoffLogic';
import type { PlayoffFieldSize } from '../../../types';

// The edge function settle-week runs the season with supabase/functions/_shared/playoffLogic.ts, a
// hand copy of the client engine (the deploy bundle cannot import from src/). Nothing else keeps the
// two in step, so these tests run both on the same inputs and require identical results, and also pin
// the server's own invariants. If a rule changes on one side only, this file fails.

const SIZES: PlayoffFieldSize[] = [2, 4, 6, 8, 16];
const ELIMS = ['single', 'double'] as const;
const seedsFor = (n: number) => Array.from({ length: n }, (_, i) => `t${i + 1}`);

/** Small deterministic generator so every run sees the same "scores". */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('server playoffLogic matches the client engine', () => {
  it('builds the same bracket for every field size and elimination type', () => {
    for (const size of SIZES) {
      for (const elim of ELIMS) {
        expect(server.buildBracket(seedsFor(size), size, elim)).toEqual(client.buildBracket(seedsFor(size), size, elim));
      }
    }
  });

  it('agrees on which structures exist', () => {
    for (const size of SIZES) {
      expect(server.doubleEliminationAvailable(size)).toBe(client.doubleEliminationAvailable(size));
      for (const elim of ELIMS) {
        for (const confs of [0, 1, 2, 3]) {
          expect(server.conferenceBracketSupported(size, elim, confs)).toBe(client.conferenceBracketSupported(size, elim, confs));
        }
      }
    }
  });

  it('builds the same conference brackets', () => {
    for (const size of SIZES) {
      if (!server.conferenceBracketSupported(size, 'single', 2)) continue;
      const half = size / 2;
      const seeds: [string[], string[]] = [Array.from({ length: half }, (_, i) => `a${i + 1}`), Array.from({ length: half }, (_, i) => `b${i + 1}`)];
      expect(server.buildConferenceBracket(seeds, size)).toEqual(client.buildConferenceBracket(seeds, size));
    }
  });

  it('agrees on how many playoff weeks each structure needs and what they are called', () => {
    for (const size of SIZES) {
      for (const elim of ELIMS) {
        expect(server.countPlayoffWeeksNeeded(size, elim)).toBe(client.countPlayoffWeeksNeeded(size, elim));
        expect(server.regularSeasonWeeksFor(size, elim)).toBe(client.regularSeasonWeeksFor(size, elim));
        expect(server.playoffWeekSequence(size, elim)).toEqual(client.playoffWeekSequence(size, elim));
      }
    }
  });

  it('plays a whole postseason identically, week by week, across many score sets', () => {
    for (const size of SIZES) {
      for (const elim of ELIMS) {
        for (let trial = 0; trial < 12; trial++) {
          const rand = lcg(size * 100 + trial * 7 + (elim === 'double' ? 1 : 0));
          const seq = server.playoffWeekSequence(size, elim);
          let s = server.advanceBracket(server.buildBracket(seedsFor(size), size, elim), null, () => null, seq[0]);
          let c = client.advanceBracket(client.buildBracket(seedsFor(size), size, elim), null, () => null, seq[0]);
          expect(s).toEqual(c);
          // Allow extra weeks so a bracket reset (double elimination) can finish.
          const weeks = [...seq, ...Array.from({ length: 4 }, (_, i) => 100 + i)];
          for (let w = 0; w < weeks.length && s.championId == null; w++) {
            const scores = new Map<string, number>();
            const scoresFor = (id: string) => {
              if (!scores.has(id)) scores.set(id, Math.round(rand() * 400 - 100));
              return scores.get(id) ?? null;
            };
            const next = weeks[w + 1] ?? 999;
            s = server.advanceBracket(s, weeks[w], scoresFor, next);
            c = client.advanceBracket(c, weeks[w], scoresFor, next);
            expect(s).toEqual(c);
            expect(server.teamsActiveInWeek(s, next).sort()).toEqual(client.teamsActiveInWeek(c, next).sort());
          }
          expect(s.championId).not.toBeNull();
          expect(server.championAndRunnerUp(s)).toEqual(client.championAndRunnerUp(c));
        }
      }
    }
  });
});

describe('server playoffLogic invariants', () => {
  it('seeds one champion who is among the seeds, with a distinct runner-up', () => {
    for (const size of SIZES) {
      for (const elim of ELIMS) {
        const seq = server.playoffWeekSequence(size, elim);
        let b = server.advanceBracket(server.buildBracket(seedsFor(size), size, elim), null, () => null, seq[0]);
        let guard = 0;
        // Higher seed number always scores more, so the lowest seed number never wins: a bracket with no upsets
        // still has to crown someone.
        const scoreOf = (id: string) => -Number(id.slice(1));
        for (let w = 0; b.championId == null && guard < 40; w++, guard++) {
          const week = w < seq.length ? seq[w] : 100 + w;
          const next = w + 1 < seq.length ? seq[w + 1] : 100 + w + 1;
          b = server.advanceBracket(b, week, scoreOf, next);
        }
        const { championId, runnerUpId } = server.championAndRunnerUp(b);
        expect(championId).toBe('t1');
        expect(runnerUpId).not.toBeNull();
        expect(runnerUpId).not.toBe(championId);
        expect(seedsFor(size)).toContain(runnerUpId as string);
      }
    }
  });

  it('breaks a tied playoff score in favor of team A (the better seed)', () => {
    const b0 = server.advanceBracket(server.buildBracket(seedsFor(2), 2, 'single'), null, () => null, 'CONF');
    const b1 = server.advanceBracket(b0, 'CONF', () => 50, 'DONE');
    expect(b1.championId).toBe('t1');
  });

  it('a double-elimination decider decides the title, with no bracket reset', () => {
    // 2-team double elimination: the championship, then a decider between its winner and its loser.
    let b = server.advanceBracket(server.buildBracket(seedsFor(2), 2, 'double'), null, () => null, 1);
    expect(b.matches.map((m) => m.id)).toEqual(['F', 'TRUE-FINAL']);
    b = server.advanceBracket(b, 1, (id) => (id === 't1' ? 10 : 0), 2); // t1 wins the championship game
    expect(b.championId).toBeNull();
    b = server.advanceBracket(b, 2, (id) => (id === 't2' ? 10 : 0), 3); // t2, with one loss, wins the decider
    expect(b.matches.some((m) => m.id === 'RESET')).toBe(false);
    expect(b.championId).toBe('t2');
    expect(server.championAndRunnerUp(b)).toEqual({ championId: 't2', runnerUpId: 't1' });
  });

  it('the decider winner takes the title outright when the undefeated team wins it', () => {
    let b = server.advanceBracket(server.buildBracket(seedsFor(2), 2, 'double'), null, () => null, 1);
    b = server.advanceBracket(b, 1, (id) => (id === 't1' ? 10 : 0), 2);
    b = server.advanceBracket(b, 2, (id) => (id === 't1' ? 10 : 0), 3);
    expect(b.championId).toBe('t1');
    expect(b.matches.some((m) => m.id === 'RESET')).toBe(false);
  });
});

describe('server standings tiebreaker matches the client', () => {
  const rand = lcg(42);
  const mk = (i: number) => ({
    teamId: `t${i}`,
    wins: Math.floor(rand() * 4),
    losses: Math.floor(rand() * 4),
    ties: Math.floor(rand() * 2),
    totalPL: Math.round(rand() * 6) * 25 - 75,
    betsWon: Math.floor(rand() * 5),
    betsLost: Math.floor(rand() * 5),
    betsPushed: 0,
    bestWeekPL: Math.round(rand() * 4) * 20,
    totalWagered: 0,
    weeklyScores: {},
  });

  it('orders the same way across many tie-heavy tables', () => {
    for (let trial = 0; trial < 60; trial++) {
      const standings = Array.from({ length: 8 }, (_, i) => mk(i + 1));
      const matchups = Array.from({ length: 14 }, (_, i) => {
        const a = `t${(i % 8) + 1}`;
        const b = `t${((i * 3 + 1) % 8) + 1}`;
        return { id: `m${i}`, teamAId: a, teamBId: b, teamAScore: 0, teamBScore: 0, winnerId: i % 5 === 0 ? null : rand() > 0.5 ? a : b, isTie: false };
      });
      const byWeek = { '1': matchups.slice(0, 7), '2': matchups.slice(7) } as never;
      const sOrder = server.sortStandings(standings, matchups).map((x) => x.teamId);
      const cOrder = clientSortStandings(standings, byWeek).map((x) => x.teamId);
      expect(sOrder).toEqual(cOrder);
    }
  });

  it('applies the documented chain: record, then season P/L, then bet record, then head to head', () => {
    const base = { ties: 0, betsPushed: 0, totalWagered: 0, weeklyScores: {}, bestWeekPL: 0 };
    const rows = [
      { ...base, teamId: 'a', wins: 2, losses: 2, totalPL: 10, betsWon: 5, betsLost: 5 },
      { ...base, teamId: 'b', wins: 3, losses: 1, totalPL: -50, betsWon: 1, betsLost: 9 },
      { ...base, teamId: 'c', wins: 2, losses: 2, totalPL: 90, betsWon: 5, betsLost: 5 },
      { ...base, teamId: 'd', wins: 2, losses: 2, totalPL: 90, betsWon: 8, betsLost: 2 },
    ];
    expect(server.sortStandings(rows, []).map((r) => r.teamId)).toEqual(['b', 'd', 'c', 'a']);
  });
});

describe('server prize pool math matches the client', () => {
  const settings = { weeklyCredits: 100 } as never;

  it('pool sizing and real-dollar conversion agree', () => {
    for (const teams of [2, 5, 10, 16]) {
      expect(server.initialPoolAmount(teams, 20)).toBe(clientPool.initialPoolAmount(teams, 20));
      for (const virtual of [-100, -37.5, 0, 12.25, 200]) {
        expect(server.realDollarAmount(virtual, 100, 400, teams)).toBeCloseTo(clientPool.realDollarAmount(virtual, 100, 400, teams), 10);
      }
    }
    expect(server.realDollarAmount(10, 0, 100, 4)).toBe(0);
    expect(server.realDollarAmount(10, 100, 100, 0)).toBe(0);
  });

  it('advances the pool week by week the same way, with and without multipliers', () => {
    const rand = lcg(7);
    for (const useMult of [false, true]) {
      let s: server.PrizePool = { initial: 200, current: 200, locked: false, history: [] };
      let c: server.PrizePool = { initial: 200, current: 200, locked: false, history: [] };
      for (let week = 1; week <= 10; week++) {
        const scores = new Map<string, number>();
        const mult: Record<string, number> = {};
        for (let t = 1; t <= 8; t++) {
          scores.set(`t${t}`, Math.round(rand() * 200 - 100));
          if (useMult) mult[`t${t}`] = 0.8 + t * 0.05;
        }
        s = server.advancePoolForWeek(s, week, scores, 100, 8, mult);
        c = clientPool.advancePoolForWeek(c, week, scores, settings, 8, mult) as server.PrizePool;
        expect(s.locked).toBe(c.locked);
        expect(s.current).toBeCloseTo(c.current, 8);
        expect(s.history.length).toBe(c.history.length);
      }
    }
  });

  it('a locked pool never moves, and lockPool is idempotent', () => {
    const locked: server.PrizePool = { initial: 100, current: 40, locked: true, history: [] };
    expect(server.advancePoolForWeek(locked, 1, new Map([['t1', 100]]), 100, 4)).toBe(locked);
    const open: server.PrizePool = { initial: 100, current: 40, locked: false, history: [] };
    expect(server.lockPool(open).locked).toBe(true);
    expect(server.lockPool(server.lockPool(open))).toEqual(server.lockPool(open));
  });

  it('the pool can drain to zero and locks there instead of going negative', () => {
    const pool: server.PrizePool = { initial: 100, current: 100, locked: false, history: [] };
    const drained = server.advancePoolForWeek(pool, 1, new Map([['t1', -1000]]), 100, 1);
    expect(drained.current).toBe(0);
    expect(drained.locked).toBe(true);
  });

  it('standing multipliers agree with the client and keep the pool neutral (they average to 1)', () => {
    const base = { ties: 0, betsWon: 0, betsLost: 0, betsPushed: 0, bestWeekPL: 0, totalWagered: 0, weeklyScores: {} };
    const rows = Array.from({ length: 7 }, (_, i) => ({ ...base, teamId: `t${i + 1}`, wins: 7 - i, losses: i, totalPL: (3 - i) * 40 }));
    for (const basis of ['rank', 'record', 'seasonPL'] as const) {
      for (const spread of [0, 0.25, 0.5, 1, 2, -1]) {
        const s = server.computeStandingMultipliers(rows, basis, spread);
        const c = clientPool.computeStandingMultipliers(rows, basis, spread);
        expect(Object.keys(s).sort()).toEqual(Object.keys(c).sort());
        for (const id of Object.keys(s)) expect(s[id]).toBeCloseTo(c[id], 10);
        const avg = Object.values(s).reduce((a, b) => a + b, 0) / rows.length;
        expect(avg).toBeCloseTo(1, 8);
      }
    }
    expect(server.computeStandingMultipliers([], 'rank', 0.5)).toEqual({});
  });
});

describe('playoff games as matchups', () => {
  it('lists the games set for a week, in bracket order, the same on both sides', () => {
    for (const size of SIZES) {
      for (const elim of ELIMS) {
        let b = server.buildBracket(seedsFor(size), size, elim);
        const seq = server.playoffWeekSequence(size, elim);
        b = server.advanceBracket(b, null, () => null, seq[0]);
        const first = String(seq[0]);
        const pairs = server.playoffPairingsForWeek(b, first);
        expect(pairs.length).toBeGreaterThan(0);
        expect(client.playoffPairingsForWeek(b, first)).toEqual(pairs);
        for (const p of pairs) {
          expect(server.isPlayoffPairing(b, first, p.teamAId, p.teamBId)).toBe(true);
          expect(server.isPlayoffPairing(b, first, p.teamBId, p.teamAId)).toBe(true);
        }
        expect(server.isPlayoffPairing(b, '5', pairs[0].teamAId, pairs[0].teamBId)).toBe(false);
      }
    }
  });

  it('never ties: team A advances on equal scores, like advanceBracket', () => {
    expect(server.playoffWinner('a', 'b', 10, 10)).toBe('a');
    expect(server.playoffWinner('a', 'b', 5, 10)).toBe('b');
    let b = server.buildBracket(seedsFor(4), 4, 'single');
    b = server.advanceBracket(b, null, () => null, 'DIV');
    b = server.advanceBracket(b, 'DIV', () => 7, 'CONF');
    for (const m of b.matches.filter((x) => x.weekId === 'DIV')) {
      expect(m.winnerId).toBe(server.playoffWinner(m.teamAId!, m.teamBId!, 7, 7));
    }
  });

  it('has nothing for a league with no bracket yet', () => {
    expect(server.playoffPairingsForWeek(null, 'WC')).toEqual([]);
  });
});

describe('season calendar', () => {
  const sizes: PlayoffFieldSize[] = [2, 4, 6, 8, 16];
  it('fills every week from the start to the championship, with no gaps, the same on both sides', () => {
    for (const size of sizes) {
      for (const elim of ELIMS) {
        for (const start of [1, 2, 9, 'WC'] as const) {
          for (const champ of [10, 18, 'WC', 'DIV', 'CONF'] as const) {
            // A start too late for the field (e.g. Wild Card week with 3+ rounds) cannot fit a season.
            if (server.calendarIndex(start) + server.countPlayoffWeeksNeeded(size, elim) >= server.SEASON_CALENDAR.length) continue;
            const plan = server.seasonPlan(start, champ, size, elim);
            expect(client.seasonPlan(start, champ, size, elim)).toEqual(plan);
            const all = [...plan.regularWeeks, ...plan.playoffWeeks].map(String);
            const from = server.calendarIndex(plan.regularWeeks[0] ?? plan.playoffWeeks[0]);
            expect(all).toEqual(server.SEASON_CALENDAR.slice(from, from + all.length).map(String));
            expect(plan.playoffWeeks.length).toBe(server.countPlayoffWeeksNeeded(size, elim));
            expect(String(plan.playoffWeeks[plan.playoffWeeks.length - 1])).toBe(String(plan.championshipWeek));
            expect(plan.regularWeeks.length).toBeGreaterThanOrEqual(1);
          }
        }
      }
    }
  });

  it('lets a 4-team league play regular-season games in Wild Card week before a CONF final', () => {
    const plan = server.seasonPlan(1, 'CONF', 4, 'single');
    expect(plan.regularWeeks[plan.regularWeeks.length - 1]).toBe('WC');
    expect(plan.playoffWeeks).toEqual(['DIV', 'CONF']);
  });

  it('allows a short season, like a 3-round playoff ending in Week 10', () => {
    const plan = server.seasonPlan(2, 10, 8, 'single');
    expect(plan.playoffWeeks).toEqual([8, 9, 10]);
    expect(plan.regularWeeks).toEqual([2, 3, 4, 5, 6, 7]);
    expect(server.championshipWeekOptions(2, 5, 8, 'single')[0]).toBe(8);
  });
});

describe('prize pool rebuilt from history', () => {
  const teams = ['a', 'b', 'c', 'd'];
  const weekPL = (vals: number[]) => new Map(teams.map((t, i) => [t, vals[i]]));
  const standings = (order: string[]) => order.map((teamId) => ({ teamId, wins: 0, losses: 0, ties: 0, totalPL: 0, betsWon: 0, betsLost: 0, bestWeekPL: 0 }));
  const weeks = [
    { week: 1, regular: true, betPL: weekPL([10, -20, 5, 0]), standings: standings(['a', 'c', 'd', 'b']) },
    { week: 2, regular: true, betPL: weekPL([-5, 15, -30, 8]), standings: standings(['b', 'a', 'd', 'c']) },
    { week: 'WC' as const, regular: false, betPL: weekPL([3, 3, -3, -3]), standings: [] },
  ];
  const rules = { buyInAmount: 25, weeklyCredits: 100, teamIds: teams, multipliers: { enabled: false, basis: 'rank' as const, spread: 0 }, multipliersFromWeek: null, lock: false };

  it('matches stepping the pool week by week (the old live behavior)', () => {
    let pool = { initial: 100, current: 100, locked: false, history: [] as server.PrizePool['history'] };
    for (const w of weeks) pool = server.advancePoolForWeek(pool, w.week, w.betPL, 100, 4, {});
    expect(server.rebuildPrizePool(weeks, rules)).toEqual(pool);
  });

  it('applies multipliers only in regular weeks, and from a start week when not backfilled', () => {
    const on = { ...rules, multipliers: { enabled: true, basis: 'rank' as const, spread: 1 } };
    const all = server.rebuildPrizePool(weeks, on);
    const fromWeek2 = server.rebuildPrizePool(weeks, { ...on, multipliersFromWeek: 2 });
    const off = server.rebuildPrizePool(weeks, rules);
    expect(all.history[0].netRealPL).not.toBeCloseTo(off.history[0].netRealPL, 6);
    expect(fromWeek2.history[0].netRealPL).toBeCloseTo(off.history[0].netRealPL, 6);
    expect(fromWeek2.history[1].netRealPL).not.toBeCloseTo(off.history[1].netRealPL, 6);
  });

  it('ranks standings through a week from regular-season results', () => {
    const ms = [
      { week: '1', teamAId: 'a', teamBId: 'b', teamAScore: 10, teamBScore: 5, winnerId: 'a', isTie: false },
      { week: '2', teamAId: 'b', teamBId: 'a', teamAScore: 30, teamBScore: 1, winnerId: 'b', isTie: false },
    ];
    expect(server.standingsThrough(['a', 'b'], 1, ms, []).map((s) => s.teamId)).toEqual(['a', 'b']);
    expect(server.standingsThrough(['a', 'b'], 2, ms, [])[0].teamId).toBe('b'); // 1-1 each, b has more P/L
  });
});

describe('per-team pool impact (1.2.11)', () => {
  const settings = { weeklyCredits: 100 } as never;
  it('records each team impact and multiplier, summing to the week change, the same on both sides', () => {
    const pool = { initial: 100, current: 100, locked: false, history: [] as server.PrizePool['history'] };
    const scores = new Map([['a', 40], ['b', -20], ['c', 0]]);
    const mult = { a: 1.25, b: 0.75 };
    const next = server.advancePoolForWeek(pool, 3, scores, 100, 4, mult);
    const entry = next.history[0];
    expect(Object.keys(entry.byTeam ?? {}).sort()).toEqual(['a', 'b', 'c']);
    expect(entry.byTeam!.a.multiplier).toBe(1.25);
    expect(entry.byTeam!.c.multiplier).toBe(1); // no multiplier set for this team
    const sum = Object.values(entry.byTeam!).reduce((t, x) => t + x.impact, 0);
    expect(sum).toBeCloseTo(entry.netRealPL, 9);
    expect(clientPool.advancePoolForWeek(pool, 3, scores, settings, 4, mult)).toEqual(next);
  });
});
