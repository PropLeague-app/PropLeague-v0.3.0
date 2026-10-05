import { describe, it, expect } from 'vitest';
import { bestAndWorstWeek, matchupStats, playerHighlights, playerRecords, unspentCredits, weeklyPL } from '../statsExtra';
import { computeIndividualStats, type TeamBet } from '../stats';
import type { League } from '../../types';

function bet(o: Partial<TeamBet>): TeamBet {
  return { week: 1, position: 'WR', gameId: 'g', side: 'Over', stake: 10, oddsAtPlacement: -110, status: 'won', settledProfit: 9.09, placedAt: '2026-10-01T00:00:00Z', marketKey: 'player_reception_yds', ...o };
}

describe('by market, odds bucket, and win quality', () => {
  const bets = [
    bet({ marketKey: 'player_reception_yds', status: 'won', settledProfit: 10, oddsAtPlacement: -110 }),
    bet({ marketKey: 'player_reception_yds', status: 'lost', settledProfit: -10, oddsAtPlacement: -110 }),
    bet({ marketKey: 'player_anytime_td', side: 'Yes', status: 'won', settledProfit: 30, oddsAtPlacement: 300 }),
    bet({ marketKey: 'h2h', side: 'KC', status: 'lost', settledProfit: -20, stake: 20, oddsAtPlacement: -250 }),
    bet({ marketKey: 'h2h', side: 'KC', status: 'voided', settledProfit: 0 }),
  ];
  const stats = computeIndividualStats(bets, () => undefined);

  it('groups settled bets by market and leaves voids out', () => {
    expect(stats.byMarket.player_reception_yds).toMatchObject({ wins: 1, losses: 1, pl: 0, wagered: 20 });
    expect(stats.byMarket.player_anytime_td).toMatchObject({ wins: 1, pl: 30 });
    expect(stats.byMarket.h2h).toMatchObject({ losses: 1, wagered: 20 });
  });
  it('buckets by odds range', () => {
    expect(stats.byOddsBucket.pickem.wins).toBe(1);
    expect(stats.byOddsBucket.pickem.losses).toBe(1);
    expect(stats.byOddsBucket.longshot.wins).toBe(1);
    expect(stats.byOddsBucket.heavyFav.losses).toBe(1);
  });
  it('average win, average loss, and actual vs implied win rate', () => {
    expect(stats.avgWin).toBe(20);
    expect(stats.avgLoss).toBe(15);
    expect(stats.winRate).toBe(0.5);
    // implied: -110 (0.5238) x2, +300 (0.25), -250 (0.7143), averaged over 4 decided bets.
    expect(stats.impliedWinRate).toBeCloseTo((0.5238 * 2 + 0.25 + 0.7143) / 4, 3);
  });
});

describe('weekly trend', () => {
  const bets = [
    bet({ week: 1, settledProfit: 10 }),
    bet({ week: 1, status: 'lost', settledProfit: -4 }),
    bet({ week: 2, status: 'lost', settledProfit: -30, stake: 30 }),
    bet({ week: 2, status: 'voided', settledProfit: 0 }),
    bet({ week: 3, status: 'pending', settledProfit: null }),
  ];
  it('sums settled P/L per week, skips pending, and counts voids as $0 outside bet counts', () => {
    const w = weeklyPL(bets);
    expect(w.map((x) => [x.week, x.pl, x.bets])).toEqual([[1, 6, 2], [2, -30, 1]]);
  });
  it('finds best and worst week', () => {
    const { best, worst } = bestAndWorstWeek(weeklyPL(bets));
    expect(best?.week).toBe(1);
    expect(worst?.week).toBe(2);
    expect(bestAndWorstWeek([])).toEqual({ best: null, worst: null });
  });
});

describe('players', () => {
  const bets = [
    bet({ playerName: 'A', settledProfit: 20 }),
    bet({ playerName: 'A', settledProfit: 10 }),
    bet({ playerName: 'B', status: 'lost', settledProfit: -10 }),
    bet({ playerName: 'B', status: 'lost', settledProfit: -10 }),
    bet({ playerName: 'C', settledProfit: 50 }),
    bet({ side: 'KC', marketKey: 'h2h' }),
  ];
  const h = playerHighlights(playerRecords(bets));
  it('most picked ranks by count', () => expect(h.mostPicked[0].playerName).toBe('A'));
  it('best and worst need two settled bets', () => {
    expect(h.best.map((r) => r.playerName)).toEqual(['A']);
    expect(h.worst.map((r) => r.playerName)).toEqual(['B']);
  });
});

function fixtureLeague(): League {
  const m = (week: number, a: string, b: string, sa: number, sb: number, winner: string | null) => ({ id: `${week}${a}${b}`, week, teamAId: a, teamBId: b, teamAScore: sa, teamBScore: sb, winnerId: winner, isTie: winner === null });
  return {
    settings: { weeklyCredits: 100 },
    matchupsByWeek: {
      '1': [m(1, 'x', 'y', 50, -20, 'x'), m(1, 'z', 'w', 10, 30, 'w')],
      '2': [m(2, 'x', 'z', -10, 5, 'z'), m(2, 'y', 'w', 0, 0, null)],
      '3': [{ id: 'p', week: 3, teamAId: 'x', teamBId: 'y', teamAScore: 5, teamBScore: 1, winnerId: null, isTie: false }],
    },
    rostersByTeamWeek: {
      'x:1': { week: 1, teamId: 'x', slots: [{ slotId: 'a', position: 'QB', wager: { stake: 60 } }, { slotId: 'b', position: 'RB', wager: { stake: 30 } }, { slotId: 'c', position: 'WR', wager: null }] },
    },
  } as unknown as League;
}

describe('matchupStats', () => {
  const s = matchupStats(fixtureLeague(), 'x');
  it('record and points count finished weeks only', () => {
    expect(s.record).toEqual({ wins: 1, losses: 1, ties: 0 });
    expect(s.pointsFor).toBe(40);
    expect(s.pointsAgainst).toBe(-15);
    expect(s.weeks).toBe(2);
  });
  it('head to head per opponent', () => {
    const y = s.headToHead.find((h) => h.opponentId === 'y')!;
    expect(y).toMatchObject({ wins: 1, pointsFor: 50, pointsAgainst: -20 });
    expect(s.headToHead.find((h) => h.opponentId === 'z')).toMatchObject({ losses: 1 });
  });
  it('all-play compares each week against every other team', () => {
    // Week 1: 50 beats -20, 10, 30 = 3-0. Week 2: -10 vs 5 (L), 0 (L), 0 (L) = 0-3.
    expect(s.allPlay).toEqual({ wins: 3, losses: 3, ties: 0 });
  });
});

describe('unspentCredits', () => {
  it('counts finished weeks only; a missing roster is a fully unspent week', () => {
    const u = unspentCredits(fixtureLeague(), 'x');
    expect(u.weeks.map((w) => [w.week, w.unspent])).toEqual([[1, 10], [2, 100]]);
    expect(u.total).toBe(110);
  });
});
