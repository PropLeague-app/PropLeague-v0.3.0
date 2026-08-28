import { describe, it, expect } from 'vitest';
import { settleWager, findMarketResult, type GameResult } from '../settlement';
import type { Wager } from '../../types';

function baseWager(overrides: Partial<Wager> = {}): Wager {
  return {
    id: 'w1',
    slotId: 'QB-1',
    gameId: 'game1',
    marketKey: 'player_pass_yds',
    side: 'Over',
    point: 250,
    oddsAtPlacement: -110,
    stake: 10,
    placedAt: new Date().toISOString(),
    status: 'pending',
    settledProfit: null,
    ...overrides,
  };
}

function resultWith(result: string): GameResult {
  return {
    gameId: 'game1',
    homeScore: 24,
    awayScore: 17,
    marketResults: [{ marketKey: 'player_pass_yds', result }],
  };
}

describe('settleWager', () => {
  it('wins when the wagered side matches the settled result', () => {
    const { status, profit } = settleWager(baseWager({ side: 'Over' }), resultWith('over'));
    expect(status).toBe('won');
    expect(profit).toBeCloseTo(9.09, 2); // $10 @ -110
  });

  it('loses when the wagered side does not match', () => {
    const { status, profit } = settleWager(baseWager({ side: 'Over' }), resultWith('under'));
    expect(status).toBe('lost');
    expect(profit).toBe(-10);
  });

  it('pushes with zero profit on an exact-line push', () => {
    const { status, profit } = settleWager(baseWager(), resultWith('push'));
    expect(status).toBe('push');
    expect(profit).toBe(0);
  });

  it('treats a missing market result as a push (voided prop after lock)', () => {
    const emptyResult: GameResult = { gameId: 'game1', homeScore: 0, awayScore: 0, marketResults: [] };
    const { status, profit } = settleWager(baseWager(), emptyResult);
    expect(status).toBe('push');
    expect(profit).toBe(0);
  });

  it('h2h/spreads settle by matching the winning side abbrev, not over/under', () => {
    const wager = baseWager({ marketKey: 'h2h', side: 'NE', point: undefined });
    const result: GameResult = { gameId: 'game1', homeScore: 24, awayScore: 17, marketResults: [{ marketKey: 'h2h', result: 'NE' }] };
    expect(settleWager(wager, result).status).toBe('won');
  });
});

describe('findMarketResult', () => {
  it('disambiguates by playerId for player props sharing a market key', () => {
    const result: GameResult = {
      gameId: 'game1',
      homeScore: 0,
      awayScore: 0,
      marketResults: [
        { marketKey: 'player_anytime_td', playerId: 'p1', result: 'yes' },
        { marketKey: 'player_anytime_td', playerId: 'p2', result: 'no' },
      ],
    };
    expect(findMarketResult(result, 'player_anytime_td', 'p1')?.result).toBe('yes');
    expect(findMarketResult(result, 'player_anytime_td', 'p2')?.result).toBe('no');
  });
});
