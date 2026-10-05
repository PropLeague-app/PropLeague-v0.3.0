import { describe, it, expect } from 'vitest';
import { oddsBucket, sortBets, type SortableBet } from '../betFilters';

const b = (o: Partial<SortableBet>): SortableBet => ({ placedAt: '2026-10-01T00:00:00Z', stake: 10, odds: -110, profit: null, week: 1, ...o });

describe('oddsBucket', () => {
  it('splits at the documented edges', () => {
    expect(oddsBucket(-250)).toBe('heavyFav');
    expect(oddsBucket(-200)).toBe('heavyFav');
    expect(oddsBucket(-199)).toBe('favorite');
    expect(oddsBucket(-120)).toBe('favorite');
    expect(oddsBucket(-119)).toBe('pickem');
    expect(oddsBucket(-110)).toBe('pickem');
    expect(oddsBucket(119)).toBe('pickem');
    expect(oddsBucket(120)).toBe('underdog');
    expect(oddsBucket(249)).toBe('underdog');
    expect(oddsBucket(250)).toBe('longshot');
    expect(oddsBucket(900)).toBe('longshot');
  });
});

describe('sortBets', () => {
  const rows = [
    b({ placedAt: '2026-10-01T10:00:00Z', profit: 5, stake: 10, odds: -110, week: 1 }),
    b({ placedAt: '2026-10-02T10:00:00Z', profit: -20, stake: 20, odds: 300, week: 2 }),
    b({ placedAt: '2026-10-03T10:00:00Z', profit: null, stake: 15, odds: -150, week: 2 }),
    b({ placedAt: '2026-10-04T10:00:00Z', profit: 40, stake: 5, odds: 800, week: 3 }),
  ];
  const ids = (sorted: SortableBet[]) => sorted.map((r) => rows.indexOf(r));

  it('newest and oldest go by placed time', () => {
    expect(ids(sortBets(rows, 'newest', (r) => r))).toEqual([3, 2, 1, 0]);
    expect(ids(sortBets(rows, 'oldest', (r) => r))).toEqual([0, 1, 2, 3]);
  });
  it('biggest win and loss put pending bets last', () => {
    expect(ids(sortBets(rows, 'biggestWin', (r) => r))).toEqual([3, 0, 1, 2]);
    expect(ids(sortBets(rows, 'biggestLoss', (r) => r))).toEqual([1, 0, 3, 2]);
  });
  it('highest stake and longest odds', () => {
    expect(ids(sortBets(rows, 'highestStake', (r) => r))).toEqual([1, 2, 0, 3]);
    expect(ids(sortBets(rows, 'longestOdds', (r) => r))).toEqual([3, 1, 0, 2]);
  });
  it('by week is latest week first, newest within a week', () => {
    expect(ids(sortBets(rows, 'week', (r) => r))).toEqual([3, 2, 1, 0]);
  });
  it('does not mutate its input', () => {
    const copy = [...rows];
    sortBets(rows, 'highestStake', (r) => r);
    expect(rows).toEqual(copy);
  });
});
