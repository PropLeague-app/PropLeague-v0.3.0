import { describe, it, expect } from 'vitest';
import { rankMarkets, MIN_PICKS } from '../ProfileMiniViews';
import type { RecordPL } from '../../../engine/stats';
import type { MarketKey } from '../../../types';

const rec = (wins: number, losses: number, pl: number): RecordPL => ({
  wins,
  losses,
  pushes: 0,
  pl,
  wagered: (wins + losses) * 10,
});
const of = (m: Record<string, RecordPL>) => m as Partial<Record<MarketKey, RecordPL>>;

describe('rankMarkets', () => {
  it('leaves out a market with too few settled picks', () => {
    // The 500 belongs to a single pick, which is a coin toss wearing a label.
    const rows = rankMarkets(of({ player_pass_yds: rec(1, 0, 500), player_rush_yds: rec(2, 2, 100) }));
    expect(rows.map(([k]) => k)).toEqual(['player_rush_yds']);
  });

  it('names the most profitable qualifying market and nothing else', () => {
    const rows = rankMarkets(
      of({
        player_pass_yds: rec(3, 0, 400),
        player_rush_yds: rec(3, 1, 300),
        player_receptions: rec(2, 2, 50),
        h2h: rec(1, 3, -600),
      }),
    );
    expect(rows.map(([k]) => k)).toEqual(['player_pass_yds']);
  });

  it('can name a losing market when every qualifying one is down', () => {
    // Better an honest worst than an empty card: this is still the best of what they have.
    const rows = rankMarkets(of({ h2h: rec(1, 3, -600), player_rush_yds: rec(1, 2, -100) }));
    expect(rows.map(([k]) => k)).toEqual(['player_rush_yds']);
  });

  it('is empty when nothing clears the floor', () => {
    expect(rankMarkets(of({ h2h: rec(1, 1, 20) }))).toEqual([]);
    expect(MIN_PICKS).toBe(3);
  });

  it('counts pushes toward the floor', () => {
    expect(rankMarkets(of({ h2h: { wins: 1, losses: 1, pushes: 1, pl: 20, wagered: 30 } }))).toHaveLength(1);
  });
});
