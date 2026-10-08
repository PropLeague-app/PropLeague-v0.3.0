import { describe, it, expect } from 'vitest';
import {
  claimMomentOnce,
  computeRealWeeklyMoments,
  weekOrderReal,
  MOMENT_CATEGORIES_REAL,
  DEFAULT_MOMENT_SETTINGS_REAL,
  MOMENT_ICONS_REAL,
  type MomentTeamWeekInput,
  type MomentWagerInput,
  type RealMomentInput,
} from '../../../../supabase/functions/_shared/momentsReal';

// settle-week posts these as the weekly award cards. Nothing else covers the rules, so each of the
// eight categories gets its win condition, its tie-break, and its "nobody qualifies" case here.

const wager = (over: Partial<MomentWagerInput> = {}): MomentWagerInput => ({
  status: 'won',
  stake: 10,
  oddsAtPlacement: 100,
  settledProfit: 10,
  playerName: null,
  marketKey: 'h2h',
  side: 'KC',
  point: null,
  lostDistance: null,
  lostDistanceRatio: null,
  ...over,
});

const team = (teamId: string, teamName: string, weeklyScore: number, wagers: MomentWagerInput[] = []): MomentTeamWeekInput => ({ teamId, teamName, weeklyScore, wagers });

function input(over: Partial<RealMomentInput> & Pick<RealMomentInput, 'teams'>): RealMomentInput {
  return { week: '5', standings: [], matchups: [], weekOrderOf: weekOrderReal, ...over };
}

const find = (moments: ReturnType<typeof computeRealWeeklyMoments>, category: string) => moments.find((m) => m.category === category);

describe('weekOrderReal', () => {
  it('sorts regular-season weeks numerically and the playoff rounds after week 18, in order', () => {
    expect(weekOrderReal('1')).toBe(1);
    expect(weekOrderReal('18')).toBe(18);
    const order = ['3', '17', 'WC', 'DIV', 'CONF'].map(weekOrderReal);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(weekOrderReal('WC')).toBeGreaterThan(18);
    expect(weekOrderReal('CONF')).toBeGreaterThan(weekOrderReal('DIV'));
  });
});

describe('moment defaults', () => {
  it('has a name, an icon and an enabled flag for every category', () => {
    expect(MOMENT_CATEGORIES_REAL).toHaveLength(8);
    for (const cat of MOMENT_CATEGORIES_REAL) {
      expect(DEFAULT_MOMENT_SETTINGS_REAL[cat].enabled).toBe(true);
      expect(DEFAULT_MOMENT_SETTINGS_REAL[cat].displayName.length).toBeGreaterThan(0);
      expect(MOMENT_ICONS_REAL[cat].length).toBeGreaterThan(0);
    }
  });
});

describe('biggest winner and loser (weekly P/L)', () => {
  const teams = [team('a', 'Alpha', 50), team('b', 'Bravo', -80), team('c', 'Charlie', 10)];

  it('names the best and worst week, with a signed dollar amount', () => {
    const m = computeRealWeeklyMoments(input({ teams }));
    expect(find(m, 'biggestWinner')).toEqual({ category: 'biggestWinner', teamId: 'a', extra: '+$50.00' });
    expect(find(m, 'biggestLoser')).toEqual({ category: 'biggestLoser', teamId: 'b', extra: '-$80.00' });
  });

  it('breaks a tie by who staked more this week, then alphabetically by team name', () => {
    const tied = [
      team('a', 'Alpha', 40, [wager({ stake: 10 })]),
      team('b', 'Bravo', 40, [wager({ stake: 30 })]),
      team('c', 'Charlie', 40, [wager({ stake: 30 })]),
    ];
    // b and c staked the same, so Bravo comes before Charlie.
    expect(find(computeRealWeeklyMoments(input({ teams: tied })), 'biggestWinner')?.teamId).toBe('b');
  });

  it('with one team, that team is both the winner and the loser', () => {
    const m = computeRealWeeklyMoments(input({ teams: [team('a', 'Alpha', 5)] }));
    expect(find(m, 'biggestWinner')?.teamId).toBe('a');
    expect(find(m, 'biggestLoser')?.teamId).toBe('a');
  });

  it('produces nothing at all for an empty week', () => {
    expect(computeRealWeeklyMoments(input({ teams: [] }))).toEqual([]);
  });
});

describe('worst beat (the lost bet that missed by the least)', () => {
  it('ranks on the proportional miss, not the raw distance', () => {
    // 0.5 off a 2.5 line is a 20% miss; 4 yards off an 80 yard line is a 5% miss. The yards bet is closer.
    const teams = [
      team('a', 'Alpha', -10, [wager({ status: 'lost', settledProfit: -10, marketKey: 'player_field_goals', playerName: 'K One', side: 'Over', point: 2.5, lostDistance: 0.5, lostDistanceRatio: 0.2 })]),
      team('b', 'Bravo', -10, [wager({ status: 'lost', settledProfit: -10, marketKey: 'player_reception_yds', playerName: 'W Two', side: 'Over', point: 80, lostDistance: 4, lostDistanceRatio: 0.05 })]),
    ];
    const beat = find(computeRealWeeklyMoments(input({ teams })), 'worstBeat');
    expect(beat?.teamId).toBe('b');
    expect(beat?.extra).toMatch(/missed by 4\.0/);
    expect(beat?.extra).toMatch(/W Two over 80 rec yds/);
  });

  it('skips lost bets with no measurable distance, and bets that did not lose', () => {
    const teams = [
      team('a', 'Alpha', 0, [
        wager({ status: 'lost', marketKey: 'player_anytime_td', lostDistance: null, lostDistanceRatio: null }),
        wager({ status: 'won', lostDistance: 1, lostDistanceRatio: 0.01 }),
        wager({ status: 'pending', lostDistance: 1, lostDistanceRatio: 0.01 }),
      ]),
    ];
    expect(find(computeRealWeeklyMoments(input({ teams })), 'worstBeat')).toBeUndefined();
  });
});

describe('boldest bet and best bet (winning tickets only)', () => {
  const teams = [
    team('a', 'Alpha', 0, [wager({ status: 'won', oddsAtPlacement: 450, settledProfit: 45, stake: 10, playerName: 'Long Shot', marketKey: 'player_anytime_td' })]),
    team('b', 'Bravo', 0, [wager({ status: 'won', oddsAtPlacement: -110, settledProfit: 90, stake: 100 }), wager({ status: 'lost', oddsAtPlacement: 2000, settledProfit: -5 })]),
  ];

  it('boldest is the longest price that cashed; a losing long shot does not count', () => {
    const m = computeRealWeeklyMoments(input({ teams }));
    expect(find(m, 'boldestBet')?.teamId).toBe('a');
    expect(find(m, 'boldestBet')?.extra).toBe('Long Shot anytime TD @ +450, $10.00 stake, +$45.00');
  });

  it('best is the most profit from a single ticket', () => {
    const best = find(computeRealWeeklyMoments(input({ teams })), 'bestBet');
    expect(best?.teamId).toBe('b');
    expect(best?.extra).toMatch(/@ -110, \$100\.00 stake, \+\$90\.00/);
  });

  it('is absent when nothing won', () => {
    const m = computeRealWeeklyMoments(input({ teams: [team('a', 'Alpha', -5, [wager({ status: 'lost' })])] }));
    expect(find(m, 'boldestBet')).toBeUndefined();
    expect(find(m, 'bestBet')).toBeUndefined();
  });
});

describe('hottest and coldest bettor (matchup streaks)', () => {
  const matchups = [
    { week: '3', teamAId: 'a', teamBId: 'b', winnerId: 'a', isTie: false },
    { week: '4', teamAId: 'a', teamBId: 'b', winnerId: 'a', isTie: false },
    { week: '5', teamAId: 'a', teamBId: 'b', winnerId: 'a', isTie: false },
    { week: '3', teamAId: 'c', teamBId: 'd', winnerId: 'c', isTie: false },
    { week: '4', teamAId: 'c', teamBId: 'd', winnerId: 'd', isTie: false },
    { week: '5', teamAId: 'c', teamBId: 'd', winnerId: 'd', isTie: false },
  ];
  const teams = [team('a', 'Alpha', 0), team('b', 'Bravo', 0), team('c', 'Charlie', 0), team('d', 'Delta', 0)];

  it('reports the longest active win streak and the longest active loss streak', () => {
    const m = computeRealWeeklyMoments(input({ teams, matchups }));
    expect(find(m, 'hottestBettor')).toEqual({ category: 'hottestBettor', teamId: 'a', extra: 'W3' });
    expect(find(m, 'coldestBettor')).toEqual({ category: 'coldestBettor', teamId: 'b', extra: 'L3' });
  });

  it('counts the streak in week order even if the rows arrive shuffled, and ends it at a loss', () => {
    const shuffled = [matchups[2], matchups[0], matchups[1]].map((m) => ({ ...m }));
    shuffled[0] = { ...shuffled[0], winnerId: 'b' }; // week 5: a loses, so a's streak is broken
    const m = computeRealWeeklyMoments(input({ teams: teams.slice(0, 2), matchups: shuffled }));
    expect(find(m, 'hottestBettor')?.teamId).toBe('b');
    expect(find(m, 'hottestBettor')?.extra).toBe('W1');
    expect(find(m, 'coldestBettor')?.teamId).toBe('a');
    expect(find(m, 'coldestBettor')?.extra).toBe('L1');
  });

  it('puts playoff rounds after the regular season when ordering a streak', () => {
    const rows = [
      { week: 'WC', teamAId: 'a', teamBId: 'b', winnerId: 'b', isTie: false },
      { week: '18', teamAId: 'a', teamBId: 'b', winnerId: 'a', isTie: false },
    ];
    const m = computeRealWeeklyMoments(input({ teams: teams.slice(0, 2), week: 'WC', matchups: rows }));
    // 18 happened first (a wins), then the wild card (a loses): a is on L1, b on W1.
    expect(find(m, 'coldestBettor')?.teamId).toBe('a');
    expect(find(m, 'hottestBettor')?.teamId).toBe('b');
  });

  it('breaks equal streaks by ROI: hot goes to the better ROI, cold to the worse', () => {
    const rows = [
      { week: '5', teamAId: 'a', teamBId: 'x', winnerId: 'a', isTie: false },
      { week: '5', teamAId: 'c', teamBId: 'y', winnerId: 'c', isTie: false },
    ];
    const standings = [
      { teamId: 'a', totalPL: 10, totalWagered: 100, weeklyScores: {} },
      { teamId: 'c', totalPL: 50, totalWagered: 100, weeklyScores: {} },
      { teamId: 'x', totalPL: -5, totalWagered: 100, weeklyScores: {} },
      { teamId: 'y', totalPL: -50, totalWagered: 100, weeklyScores: {} },
    ];
    const all = [team('a', 'Alpha', 0), team('c', 'Charlie', 0), team('x', 'Xray', 0), team('y', 'Yankee', 0)];
    const m = computeRealWeeklyMoments(input({ teams: all, matchups: rows, standings }));
    expect(find(m, 'hottestBettor')?.teamId).toBe('c');
    expect(find(m, 'coldestBettor')?.teamId).toBe('y');
  });

  it('ignores ties and unplayed matchups, and yields nothing when no streak exists', () => {
    const rows = [
      { week: '5', teamAId: 'a', teamBId: 'b', winnerId: null, isTie: true },
      { week: '5', teamAId: 'c', teamBId: 'd', winnerId: null, isTie: false },
    ];
    const m = computeRealWeeklyMoments(input({ teams, matchups: rows }));
    expect(find(m, 'hottestBettor')).toBeUndefined();
    expect(find(m, 'coldestBettor')).toBeUndefined();
  });
});

describe('biggest swing (week over week P/L reversal)', () => {
  it('uses each team\'s most recent earlier week, in either direction', () => {
    const teams = [team('a', 'Alpha', -40), team('b', 'Bravo', 30)];
    const standings = [
      { teamId: 'a', totalPL: 0, totalWagered: 0, weeklyScores: { '3': 10, '4': 60 } }, // 60 -> -40 = swing 100
      { teamId: 'b', totalPL: 0, totalWagered: 0, weeklyScores: { '4': 20 } }, // 20 -> 30 = swing 10
    ];
    const swing = find(computeRealWeeklyMoments(input({ teams, standings })), 'biggestSwing');
    expect(swing).toEqual({ category: 'biggestSwing', teamId: 'a', extra: '+$60.00 → -$40.00' });
  });

  it('ignores the current week and later ones when finding the previous score', () => {
    const teams = [team('a', 'Alpha', 10)];
    const standings = [{ teamId: 'a', totalPL: 0, totalWagered: 0, weeklyScores: { '5': 999, '6': -999, '4': 0 } }];
    expect(find(computeRealWeeklyMoments(input({ teams, standings })), 'biggestSwing')?.extra).toBe('+$0.00 → +$10.00');
  });

  it('is absent in a team\'s first week', () => {
    const teams = [team('a', 'Alpha', 10)];
    const standings = [{ teamId: 'a', totalPL: 0, totalWagered: 0, weeklyScores: {} }];
    expect(find(computeRealWeeklyMoments(input({ teams, standings })), 'biggestSwing')).toBeUndefined();
  });
});

describe('claimMomentOnce (post each moment only once)', () => {
  const fake = (result: { data?: unknown; error?: { message: string } | null }) => ({
    from: () => ({ insert: () => ({ select: async () => ({ data: result.data ?? null, error: result.error ?? null }) }) }),
  });

  it('returns true on the first claim', async () => {
    expect(await claimMomentOnce(fake({ data: [{ key: 'k' }] }), 'k')).toBe(true);
  });
  it('returns false when another run already claimed it', async () => {
    expect(await claimMomentOnce(fake({ error: { message: 'duplicate key value violates unique constraint "notification_dedup_pkey"' } }), 'k')).toBe(false);
  });
  it('throws on any other database error, so a real failure is never mistaken for "already posted"', async () => {
    await expect(claimMomentOnce(fake({ error: { message: 'connection reset' } }), 'k')).rejects.toThrow(/claimMomentOnce\(k\)/);
  });
  it('treats an empty result as not claimed', async () => {
    expect(await claimMomentOnce(fake({ data: [] }), 'k')).toBe(false);
  });
});
