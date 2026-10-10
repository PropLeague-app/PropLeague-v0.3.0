import { describe, it, expect } from 'vitest';
import { buildSettledAlert, buildWeekResult, matchupLine, money, shortPick, type SettledPick } from '../../../../supabase/functions/_shared/settleAlerts';

const pick = (p: Partial<SettledPick>): SettledPick => ({
  market_key: 'player_reception_longest',
  side: 'Over',
  point: 16.5,
  player_name: 'Brenton Strange',
  status: 'won',
  settled_profit: 59.63,
  ...p,
});

describe('settled-bet alert text', () => {
  it('writes short pick lines for props and game lines', () => {
    expect(shortPick(pick({}))).toBe('Strange O16.5 longest rec');
    expect(shortPick(pick({ market_key: 'player_anytime_td', side: 'Yes', point: null, player_name: 'Travis Kelce' }))).toBe('Kelce anytime TD');
    expect(shortPick(pick({ market_key: 'h2h', side: 'Philadelphia Eagles', point: null, player_name: null }))).toBe('Eagles ML');
    expect(shortPick(pick({ market_key: 'spreads', side: 'Tampa Bay Buccaneers', point: 3.5, player_name: null }))).toBe('Buccaneers +3.5');
    expect(shortPick(pick({ market_key: 'spreads', side: 'Tampa Bay Buccaneers', point: -3.5, player_name: null }))).toBe('Buccaneers -3.5');
    expect(shortPick(pick({ market_key: 'totals', side: 'Under', point: 44.5, player_name: null }))).toBe('Under 44.5 total pts');
  });

  it('formats money and the matchup line', () => {
    expect(money(59.634)).toBe('+$59.63');
    expect(money(-20)).toBe('-$20.00');
    expect(money(0)).toBe('$0.00');
    expect(matchupLine(50, 37.6, 'FLK')).toBe('Up $12.40 on FLK.');
    expect(matchupLine(10, 18.1, 'FLK')).toBe('Down $8.10 to FLK.');
    expect(matchupLine(5, 5, 'FLK')).toBe('Even with FLK.');
  });

  it('one pick: the title says the result', () => {
    expect(buildSettledAlert([pick({})], null)).toEqual({ title: 'Bet won', body: 'Won: Strange O16.5 longest rec +$59.63.' });
    expect(buildSettledAlert([pick({ status: 'lost', settled_profit: -20 })], null).title).toBe('Bet lost');
    expect(buildSettledAlert([pick({ status: 'push', settled_profit: 0 })], null).body).toBe('Push: Strange O16.5 longest rec.');
    expect(buildSettledAlert([pick({ status: 'voided', settled_profit: 0 })], null).title).toBe('Bet voided');
  });

  it('lists up to three picks and adds the matchup line', () => {
    const a = buildSettledAlert(
      [pick({}), pick({ market_key: 'player_pass_tds', point: 1.5, player_name: 'Jalen Hurts', status: 'lost', settled_profit: -20 })],
      { mine: 39.63, theirs: 27.23, oppName: 'FLK' },
    );
    expect(a.title).toBe('2 bets settled');
    expect(a.body).toBe('Won: Strange O16.5 longest rec +$59.63. Lost: Hurts O1.5 pass TDs -$20.00. Up $12.40 on FLK.');
  });

  it('sums up four or more picks as a record and net', () => {
    const a = buildSettledAlert(
      [pick({}), pick({ status: 'lost', settled_profit: -10 }), pick({ status: 'lost', settled_profit: -5 }), pick({ status: 'push', settled_profit: 0 })],
      { mine: 0, theirs: 10, oppName: 'FLK' },
    );
    expect(a.title).toBe('4 bets settled');
    expect(a.body).toBe('1 won, 2 lost, 1 push or void. Net +$44.63. Down $10.00 to FLK.');
  });
});

describe('week results text', () => {
  const base = { weekLabel: 'Week 5', oppName: 'FLK', standing: { wins: 4, losses: 1, ties: 0, rank: 2, teamCount: 8 } };
  it('says who won with the score and the standing', () => {
    expect(buildWeekResult({ ...base, mine: 142.3, theirs: 98.1 })).toEqual({ title: 'Week 5 final', body: 'You beat FLK, 142.30 to 98.10. Now 4-1, 2nd of 8.' });
    expect(buildWeekResult({ ...base, mine: -12, theirs: 3 }).body).toBe('You lost to FLK, -12.00 to 3.00. Now 4-1, 2nd of 8.');
    expect(buildWeekResult({ ...base, mine: 3, theirs: 3, standing: { wins: 2, losses: 2, ties: 1, rank: 11, teamCount: 12 } }).body).toBe(
      'You tied FLK, 3.00 to 3.00. Now 2-2-1, 11th of 12.',
    );
  });
  it('drops the standing in the playoffs and adds perfect or skunked', () => {
    expect(buildWeekResult({ ...base, mine: 10, theirs: 5, standing: null, perfect: true }).body).toBe('You beat FLK, 10.00 to 5.00. Perfect week!');
    expect(buildWeekResult({ ...base, mine: -50, theirs: 5, standing: null, skunked: true }).body).toBe('You lost to FLK, -50.00 to 5.00. Skunked this week.');
  });
  it('uses the right ordinal', () => {
    const rank = (r: number) => buildWeekResult({ ...base, mine: 1, theirs: 0, standing: { wins: 1, losses: 0, ties: 0, rank: r, teamCount: 32 } }).body;
    expect(rank(1)).toContain('1st of');
    expect(rank(3)).toContain('3rd of');
    expect(rank(12)).toContain('12th of');
    expect(rank(22)).toContain('22nd of');
  });
});
