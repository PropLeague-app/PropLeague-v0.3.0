import { describe, it, expect } from 'vitest';
import { computeIncompleteLineupPenalty, computeWeeklyScore, expectedScoreDistribution, matchupWinProbability } from '../scoring';
import { buildEmptyRoster } from '../rosterSlots';
import { DEFAULT_LEAGUE_SETTINGS } from '../../types';
import type { Wager } from '../../types';

function wagerSlot(roster: ReturnType<typeof buildEmptyRoster>, index: number, wager: Partial<Wager>) {
  return {
    ...roster,
    slots: roster.slots.map((s, i) =>
      i === index
        ? { ...s, wager: { id: `w${i}`, slotId: s.slotId, gameId: 'g', marketKey: 'h2h', side: 'X', oddsAtPlacement: -110, stake: 10, placedAt: '', status: 'pending', settledProfit: null, ...wager } as Wager }
        : s,
    ),
  };
}

describe('computeIncompleteLineupPenalty', () => {
  it('penalizes the full unallocated amount for a totally empty, unsubmitted roster', () => {
    const roster = buildEmptyRoster('t1', 1, DEFAULT_LEAGUE_SETTINGS.lineupSlots);
    expect(computeIncompleteLineupPenalty(roster, DEFAULT_LEAGUE_SETTINGS)).toBe(-100);
  });

  it('is zero for a fully-allocated, submitted roster', () => {
    const roster = buildEmptyRoster('t1', 1, DEFAULT_LEAGUE_SETTINGS.lineupSlots);
    const filled = {
      ...roster,
      submitted: true,
      slots: roster.slots.map((s, i) => ({
        ...s,
        wager: { id: `w${i}`, slotId: s.slotId, gameId: 'g', marketKey: 'h2h', side: 'X', oddsAtPlacement: -110, stake: 12.5, placedAt: '', status: 'pending', settledProfit: null } as Wager,
      })),
    };
    expect(computeIncompleteLineupPenalty(filled, DEFAULT_LEAGUE_SETTINGS)).toBe(0);
  });
});

describe('computeWeeklyScore', () => {
  it('sums settled profit across slots plus the incomplete-lineup penalty', () => {
    const roster = buildEmptyRoster('t1', 1, DEFAULT_LEAGUE_SETTINGS.lineupSlots);
    // Fill just one slot with a settled winning wager; leave the rest empty.
    roster.slots[0] = {
      ...roster.slots[0],
      wager: {
        id: 'w0',
        slotId: roster.slots[0].slotId,
        gameId: 'g',
        marketKey: 'player_pass_yds',
        side: 'Over',
        oddsAtPlacement: -110,
        stake: 10,
        placedAt: '',
        status: 'won',
        settledProfit: 9.09,
      },
    };
    const score = computeWeeklyScore(roster, DEFAULT_LEAGUE_SETTINGS);
    // 7 empty slots => $90 unallocated => -90 penalty, plus +9.09 settled.
    expect(score).toBeCloseTo(9.09 - 90, 2);
  });
});

describe('expectedScoreDistribution + matchupWinProbability', () => {
  it('is 50/50 for two identical, fully-empty rosters (all-phantom, equal variance)', () => {
    const roster = buildEmptyRoster('t1', 1, DEFAULT_LEAGUE_SETTINGS.lineupSlots);
    const dist = expectedScoreDistribution(roster, DEFAULT_LEAGUE_SETTINGS);
    expect(dist.mean).toBe(0);
    expect(dist.variance).toBeGreaterThan(0);
    expect(matchupWinProbability(dist, dist)).toBeCloseTo(0.5, 5);
  });

  it('favors the side with the higher expected mean', () => {
    const base = buildEmptyRoster('t1', 1, DEFAULT_LEAGUE_SETTINGS.lineupSlots);
    const ahead = wagerSlot(base, 0, { status: 'won', settledProfit: 50 });
    const behind = wagerSlot(base, 0, { status: 'lost', settledProfit: -50 });
    const distAhead = expectedScoreDistribution(ahead, DEFAULT_LEAGUE_SETTINGS);
    const distBehind = expectedScoreDistribution(behind, DEFAULT_LEAGUE_SETTINGS);
    expect(matchupWinProbability(distAhead, distBehind)).toBeGreaterThan(0.5);
    expect(matchupWinProbability(distBehind, distAhead)).toBeLessThan(0.5);
  });

  it('is a clean step function once both sides are fully settled (zero variance left)', () => {
    const roster = buildEmptyRoster('t1', 1, DEFAULT_LEAGUE_SETTINGS.lineupSlots);
    const full = roster.slots.reduce((r, _s, i) => wagerSlot(r, i, { status: 'won', settledProfit: 10 }), roster);
    const distWinner = expectedScoreDistribution(full, DEFAULT_LEAGUE_SETTINGS);
    const tiedFull = roster.slots.reduce((r, _s, i) => wagerSlot(r, i, { status: 'push', settledProfit: 0 }), roster);
    const distTied = expectedScoreDistribution(tiedFull, DEFAULT_LEAGUE_SETTINGS);
    expect(distWinner.variance).toBe(0);
    expect(matchupWinProbability(distWinner, distTied)).toBe(1);
    expect(matchupWinProbability(distTied, distWinner)).toBe(0);
    expect(matchupWinProbability(distTied, distTied)).toBe(0.5);
  });

  it('a small stake on a heavy favorite contributes little either way vs. a real stake', () => {
    const base = buildEmptyRoster('t1', 1, DEFAULT_LEAGUE_SETTINGS.lineupSlots);
    const tinyFavorite = wagerSlot(base, 0, { stake: 5, oddsAtPlacement: -300 });
    const realFavorite = wagerSlot(base, 0, { stake: 50, oddsAtPlacement: -300 });
    const distTiny = expectedScoreDistribution(tinyFavorite, DEFAULT_LEAGUE_SETTINGS);
    const distReal = expectedScoreDistribution(realFavorite, DEFAULT_LEAGUE_SETTINGS);
    expect(Math.abs(distTiny.mean)).toBeLessThan(Math.abs(distReal.mean));
    expect(distTiny.variance).toBeLessThan(distReal.variance);
  });
});
