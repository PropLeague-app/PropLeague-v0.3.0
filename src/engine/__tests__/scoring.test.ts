import { describe, it, expect } from 'vitest';
import { computeIncompleteLineupPenalty, computeWeeklyScore, displayWeeklyScore, expectedScoreDistribution, matchupWinProbability } from '../scoring';
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

  it('an undecided pick has zero expected value at any stake; only its spread grows with the stake', () => {
    const base = buildEmptyRoster('t1', 1, DEFAULT_LEAGUE_SETTINGS.lineupSlots);
    const tinyFavorite = wagerSlot(base, 0, { stake: 5, oddsAtPlacement: -300 });
    const realFavorite = wagerSlot(base, 0, { stake: 50, oddsAtPlacement: -300 });
    const distTiny = expectedScoreDistribution(tinyFavorite, DEFAULT_LEAGUE_SETTINGS);
    const distReal = expectedScoreDistribution(realFavorite, DEFAULT_LEAGUE_SETTINGS);
    expect(distTiny.mean).toBe(0);
    expect(distReal.mean).toBe(0);
    // Compared after the last kickoff so the empty slots' phantom bets drop out and only the pick's own spread is left.
    const lockedTiny = expectedScoreDistribution(tinyFavorite, DEFAULT_LEAGUE_SETTINGS, undefined, true);
    const lockedReal = expectedScoreDistribution(realFavorite, DEFAULT_LEAGUE_SETTINGS, undefined, true);
    expect(lockedTiny.variance).toBeLessThan(lockedReal.variance);
  });
});

describe('displayWeeklyScore (penalty only after the last kickoff)', () => {
  const base = buildEmptyRoster('t1', 1, DEFAULT_LEAGUE_SETTINGS.lineupSlots);
  const settledWin = wagerSlot(base, 0, { stake: 10, status: 'won', settledProfit: 9 });

  it('an empty lineup reads $0 before lock and the full penalty after', () => {
    const args = { serverScore: null, roster: base, settings: DEFAULT_LEAGUE_SETTINGS, isFinal: false };
    expect(displayWeeklyScore({ ...args, penaltyLive: false })).toBe(0);
    expect(displayWeeklyScore({ ...args, penaltyLive: true })).toBe(-100);
  });

  it('settled P/L shows from $0 before lock, then the unspent credits come off', () => {
    const args = { serverScore: null, roster: settledWin, settings: DEFAULT_LEAGUE_SETTINGS, isFinal: false };
    expect(displayWeeklyScore({ ...args, penaltyLive: false })).toBe(9);
    expect(displayWeeklyScore({ ...args, penaltyLive: true })).toBe(9 - 90);
  });

  it('a mid-week server score gets the penalty added once locked, a final one does not', () => {
    const args = { serverScore: 9, roster: settledWin, settings: DEFAULT_LEAGUE_SETTINGS };
    expect(displayWeeklyScore({ ...args, penaltyLive: false, isFinal: false })).toBe(9);
    expect(displayWeeklyScore({ ...args, penaltyLive: true, isFinal: false })).toBe(-81);
    expect(displayWeeklyScore({ ...args, penaltyLive: true, isFinal: true })).toBe(9);
  });

  it('pending picks add nothing before they settle, however the odds round (no phantom $0.01)', () => {
    let roster = base;
    [-113, -103, 150, -250, 105].forEach((odds, i) => {
      roster = wagerSlot(roster, i, { stake: 7 + i * 3.37, oddsAtPlacement: odds });
    });
    const shown = displayWeeklyScore({ serverScore: null, roster, settings: DEFAULT_LEAGUE_SETTINGS, penaltyLive: false, isFinal: false });
    expect(Object.is(shown, 0)).toBe(true);
    expect(expectedScoreDistribution(roster, DEFAULT_LEAGUE_SETTINGS).mean).toBe(0);
  });

  it('float crumbs round to a clean $0.00, never -0 or a tiny sign', () => {
    const args = { roster: base, settings: DEFAULT_LEAGUE_SETTINGS, penaltyLive: false, isFinal: false };
    expect(Object.is(displayWeeklyScore({ ...args, serverScore: -1e-15 }), 0)).toBe(true);
    expect(Object.is(displayWeeklyScore({ ...args, serverScore: 1e-15 }), 0)).toBe(true);
    expect(displayWeeklyScore({ ...args, serverScore: 12.345 })).toBe(12.35);
  });

  it('win probability folds the penalty in only once locked', () => {
    const a = expectedScoreDistribution(settledWin, DEFAULT_LEAGUE_SETTINGS, undefined, true);
    expect(a.mean).toBe(9 - 90);
    expect(a.variance).toBeLessThan(expectedScoreDistribution(settledWin, DEFAULT_LEAGUE_SETTINGS).variance);
    expect(expectedScoreDistribution(settledWin, DEFAULT_LEAGUE_SETTINGS).mean).toBe(9);
  });
});

describe('a matchup that is already decided reads 0 or 100, never a tail', () => {
  /** Every slot filled, so no phantom bet widens the range. */
  function fullRoster(fill: (slot: number) => Partial<Wager>) {
    let roster = buildEmptyRoster('t1', 1, DEFAULT_LEAGUE_SETTINGS.lineupSlots);
    for (let i = 0; i < roster.slots.length; i++) roster = wagerSlot(roster, i, fill(i));
    return roster;
  }

  it('gives a side with nothing left to play 0 when it cannot catch the floor of the other', () => {
    // The real case (see chat, Oct 2026): everything settled at -$9.92 against a side sitting on
    // +$37.81 with three pending picks worth $35 of stake. Even losing all three leaves them at
    // +$2.81, so the trailing side cannot win, yet the curve still showed 3%.
    const settledBehind = fullRoster(() => ({ status: 'lost', settledProfit: -9.92 / 8, stake: 12.5 }));
    const aheadWithPicksLive = fullRoster((i) =>
      i < 3 ? { status: 'pending', stake: 35 / 3, oddsAtPlacement: -110 } : { status: 'won', settledProfit: 37.81 / 5, stake: 13 },
    );
    const behind = expectedScoreDistribution(settledBehind, DEFAULT_LEAGUE_SETTINGS);
    const ahead = expectedScoreDistribution(aheadWithPicksLive, DEFAULT_LEAGUE_SETTINGS);

    expect(behind.max).toBeCloseTo(-9.92, 2); // nothing pending: the range has collapsed
    expect(ahead.min).toBeCloseTo(2.81, 2); // every pending pick losing still clears it
    expect(matchupWinProbability(behind, ahead)).toBe(0);
    expect(matchupWinProbability(ahead, behind)).toBe(1);
  });

  it('still uses the curve while the gap is reachable', () => {
    const a = fullRoster((i) => (i < 4 ? { status: 'pending', stake: 10, oddsAtPlacement: -110 } : { status: 'lost', settledProfit: -10, stake: 10 }));
    const b = fullRoster((i) => (i < 4 ? { status: 'pending', stake: 10, oddsAtPlacement: -110 } : { status: 'won', settledProfit: 9.09, stake: 10 }));
    const prob = matchupWinProbability(expectedScoreDistribution(a, DEFAULT_LEAGUE_SETTINGS), expectedScoreDistribution(b, DEFAULT_LEAGUE_SETTINGS));
    expect(prob).toBeGreaterThan(0);
    expect(prob).toBeLessThan(0.5);
  });

  it('leaves a week with slots still to fill undecided', () => {
    const empty = buildEmptyRoster('t1', 1, DEFAULT_LEAGUE_SETTINGS.lineupSlots);
    const ahead = fullRoster(() => ({ status: 'won', settledProfit: 5, stake: 12.5 }));
    const prob = matchupWinProbability(expectedScoreDistribution(empty, DEFAULT_LEAGUE_SETTINGS), expectedScoreDistribution(ahead, DEFAULT_LEAGUE_SETTINGS));
    expect(prob).toBeGreaterThan(0);
  });
});
