import { describe, it, expect } from 'vitest';
import { computeWeeklyMoments } from '../moments';
import { emptyStanding } from '../standings';
import type { GameResult } from '../settlement';
import type { League, LeagueTeam, Matchup, NFLGame, Wager, WeeklyRoster } from '../../types';

function team(id: string, teamName: string): LeagueTeam {
  return {
    id,
    ownerName: teamName,
    teamName,
    abbrev: id.toUpperCase().slice(0, 3),
    logoMode: 'initials',
    logoEmoji: '🏈',
    logoColor: '#4C8DF5',
    logoDataUrl: null,
    isUser: id === 't1',
    isSimulated: id !== 't1',
    conferenceId: null,
  };
}

function wager(overrides: Partial<Wager>): Wager {
  return {
    id: `w-${Math.random()}`,
    slotId: 's1',
    gameId: 'g1',
    marketKey: 'player_pass_yds',
    side: 'Over',
    point: 250,
    oddsAtPlacement: -110,
    stake: 10,
    placedAt: '2024-01-01T00:00:00.000Z',
    status: 'pending',
    settledProfit: null,
    ...overrides,
  };
}

function roster(teamId: string, week: number, wagers: Wager[]): WeeklyRoster {
  return {
    week,
    teamId,
    submitted: true,
    slots: wagers.map((w, i) => ({ slotId: `s${i}`, position: 'QB', wager: w })),
  };
}

function buildLeague(opts: {
  teams: LeagueTeam[];
  rosters: WeeklyRoster[];
  standings?: Record<string, Record<string, number>>; // teamId -> weekKey -> score
  matchupsByWeek?: Record<string, Matchup[]>;
}): League {
  const standings = opts.teams.map((t) => {
    const base = emptyStanding(t.id);
    const scores = opts.standings?.[t.id] ?? {};
    return { ...base, weeklyScores: scores };
  });
  const rostersByTeamWeek: Record<string, WeeklyRoster> = {};
  for (const r of opts.rosters) rostersByTeamWeek[`${r.teamId}-${r.week}`] = r;
  return {
    id: 'league-1',
    name: 'Test League',
    inviteCode: 'ABC123',
    commissionerTeamId: 't1',
    logoDataUrl: null,
    logoColor: '#4C8DF5',
    teams: opts.teams,
    rostersByTeamWeek,
    standings,
    matchupsByWeek: opts.matchupsByWeek ?? {},
  } as unknown as League;
}

function matchup(week: number, teamAId: string, teamBId: string, winnerId: string): Matchup {
  return {
    id: `m-${week}-${teamAId}-${teamBId}`,
    week,
    teamAId,
    teamBId,
    teamAScore: winnerId === teamAId ? 10 : 0,
    teamBScore: winnerId === teamBId ? 10 : 0,
    winnerId,
    isTie: false,
  };
}

const noGame = () => undefined as NFLGame | undefined;
const noResult = () => undefined as GameResult | undefined;

describe('computeWeeklyMoments', () => {
  it('picks the best and worst weekly P/L teams', () => {
    const teams = [team('t1', 'Alpha'), team('t2', 'Beta')];
    const league = buildLeague({ teams, rosters: [], standings: { t1: { '1': 50 }, t2: { '1': -30 } } });
    const scores = new Map([['t1', 50], ['t2', -30]]);
    const moments = computeWeeklyMoments(league, 1, scores, noGame, noResult);
    expect(moments.find((m) => m.category === 'biggestWinner')?.teamId).toBe('t1');
    expect(moments.find((m) => m.category === 'biggestLoser')?.teamId).toBe('t2');
  });

  it('finds the closest lost bet league-wide for worst beat', () => {
    const teams = [team('t1', 'Alpha'), team('t2', 'Beta')];
    const closeLoss = wager({ gameId: 'g1', marketKey: 'player_pass_yds', side: 'Over', point: 250, status: 'lost', settledProfit: -10 });
    const farLoss = wager({ gameId: 'g2', marketKey: 'player_pass_yds', side: 'Over', point: 250, status: 'lost', settledProfit: -10 });
    const rosters = [roster('t1', 1, [closeLoss]), roster('t2', 1, [farLoss])];
    const league = buildLeague({ teams, rosters, standings: { t1: { '1': -10 }, t2: { '1': -10 } } });
    const scores = new Map([['t1', -10], ['t2', -10]]);
    const results: Record<string, GameResult> = {
      g1: { gameId: 'g1', homeScore: 20, awayScore: 17, marketResults: [{ marketKey: 'player_pass_yds', result: 'under', simulatedValue: 249 }] },
      g2: { gameId: 'g2', homeScore: 20, awayScore: 17, marketResults: [{ marketKey: 'player_pass_yds', result: 'under', simulatedValue: 200 }] },
    };
    const games: Record<string, NFLGame> = {
      g1: { id: 'g1' } as NFLGame,
      g2: { id: 'g2' } as NFLGame,
    };
    const moments = computeWeeklyMoments(league, 1, scores, (id) => games[id], (id) => results[id]);
    const worstBeat = moments.find((m) => m.category === 'worstBeat');
    expect(worstBeat?.teamId).toBe('t1'); // missed by 1, not 50
  });

  it('picks the longest-odds won bet for boldest bet and the most-profit bet for best bet', () => {
    const teams = [team('t1', 'Alpha'), team('t2', 'Beta')];
    const underdog = wager({ gameId: 'g1', status: 'won', oddsAtPlacement: 220, stake: 10, settledProfit: 22 });
    const favorite = wager({ gameId: 'g2', status: 'won', oddsAtPlacement: -110, stake: 50, settledProfit: 45.45 });
    const rosters = [roster('t1', 1, [underdog]), roster('t2', 1, [favorite])];
    const league = buildLeague({ teams, rosters, standings: { t1: { '1': 22 }, t2: { '1': 45.45 } } });
    const scores = new Map([['t1', 22], ['t2', 45.45]]);
    const moments = computeWeeklyMoments(league, 1, scores, noGame, noResult);
    expect(moments.find((m) => m.category === 'boldestBet')?.teamId).toBe('t1');
    expect(moments.find((m) => m.category === 'bestBet')?.teamId).toBe('t2');
  });

  it('omits a category entirely when it has no qualifier this week', () => {
    const teams = [team('t1', 'Alpha'), team('t2', 'Beta')];
    // Nobody won anything -> no Boldest Bet, no Best Bet.
    const lost = wager({ gameId: 'g1', status: 'lost', settledProfit: -10 });
    const rosters = [roster('t1', 1, [lost])];
    const league = buildLeague({ teams, rosters, standings: { t1: { '1': -10 }, t2: { '1': 0 } } });
    const scores = new Map([['t1', -10], ['t2', 0]]);
    const moments = computeWeeklyMoments(league, 1, scores, noGame, noResult);
    expect(moments.some((m) => m.category === 'boldestBet')).toBe(false);
    expect(moments.some((m) => m.category === 'bestBet')).toBe(false);
  });

  it('finds the largest week-over-week swing and omits teams with no prior week', () => {
    const teams = [team('t1', 'Alpha'), team('t2', 'Beta')];
    const league = buildLeague({
      teams,
      rosters: [],
      standings: { t1: { '1': -45, '2': 60 }, t2: { '2': 5 } }, // t2 has no week-1 entry
    });
    const scores = new Map([['t1', 60], ['t2', 5]]);
    const moments = computeWeeklyMoments(league, 2, scores, noGame, noResult);
    const swing = moments.find((m) => m.category === 'biggestSwing');
    expect(swing?.teamId).toBe('t1');
  });

  it('breaks ties by higher total stake, then alphabetically', () => {
    const teams = [team('t1', 'Zulu'), team('t2', 'Alpha')];
    const bigStake = roster('t1', 1, [wager({ stake: 90 })]);
    const smallStake = roster('t2', 1, [wager({ stake: 10 })]);
    const league = buildLeague({ teams, rosters: [bigStake, smallStake], standings: { t1: { '1': 20 }, t2: { '1': 20 } } });
    const scores = new Map([['t1', 20], ['t2', 20]]);
    const moments = computeWeeklyMoments(league, 1, scores, noGame, noResult);
    expect(moments.find((m) => m.category === 'biggestWinner')?.teamId).toBe('t1');
  });
});

describe('hottestBettor / coldestBettor use matchup streaks, not bet streaks (manual v0.1.1 §4 #9)', () => {
  it('picks the team on the longest active matchup win streak for hottest, and matchup loss streak for coldest', () => {
    const teams = [team('t1', 'Alpha'), team('t2', 'Beta'), team('t3', 'Gamma')];
    // t1 has won its last 3 matchups; t3 has lost its last 2. t2 is the common opponent.
    const matchupsByWeek: Record<string, Matchup[]> = {
      '1': [matchup(1, 't1', 't2', 't1'), matchup(1, 't3', 't2', 't2')],
      '2': [matchup(2, 't1', 't3', 't1'), matchup(2, 't2', 't3', 't2')],
      '3': [matchup(3, 't1', 't2', 't1'), matchup(3, 't3', 't2', 't2')],
    };
    const league = buildLeague({ teams, rosters: [], standings: { t1: { '3': 0 }, t2: { '3': 0 }, t3: { '3': 0 } }, matchupsByWeek });
    const scores = new Map([['t1', 0], ['t2', 0], ['t3', 0]]);
    const moments = computeWeeklyMoments(league, 3, scores, noGame, noResult);
    expect(moments.find((m) => m.category === 'hottestBettor')?.teamId).toBe('t1');
    expect(moments.find((m) => m.category === 'hottestBettor')?.extra).toBe('W3');
    expect(moments.find((m) => m.category === 'coldestBettor')?.teamId).toBe('t3');
    expect(moments.find((m) => m.category === 'coldestBettor')?.extra).toBe('L3');
  });

  it('breaks a tied matchup win streak by highest ROI', () => {
    const teams = [team('t1', 'Alpha'), team('t2', 'Beta'), team('t3', 'Gamma')];
    // t1 and t2 are both riding a 1-game win streak; t1 has a much better ROI this season.
    const matchupsByWeek: Record<string, Matchup[]> = {
      '1': [matchup(1, 't1', 't3', 't1'), matchup(1, 't2', 't3', 't2')],
    };
    const goodBet = roster('t1', 1, [wager({ status: 'won', stake: 10, settledProfit: 90 })]);
    const badBet = roster('t2', 1, [wager({ status: 'won', stake: 10, settledProfit: 1 })]);
    const league = buildLeague({
      teams,
      rosters: [goodBet, badBet],
      standings: { t1: { '1': 0 }, t2: { '1': 0 }, t3: { '1': 0 } },
      matchupsByWeek,
    });
    const scores = new Map([['t1', 0], ['t2', 0], ['t3', 0]]);
    const moments = computeWeeklyMoments(league, 1, scores, noGame, noResult);
    expect(moments.find((m) => m.category === 'hottestBettor')?.teamId).toBe('t1');
  });
});

// manual v0.2.1 §6 #9: Hot Hand/Ice Box lagged one week behind because the caller
// (engine/simulateWeek.ts) built the moments snapshot from a `matchupsByWeek` that
// hadn't yet been updated with the just-settled week's scores/winner — so a streak
// broken *this* week still looked "active" for one more week, and a genuinely active
// streak was one game short. These tests pin the two scenarios called out by the bug
// report exactly: computeWeeklyMoments must be called with a `matchupsByWeek` that
// already includes the just-settled week, and a broken streak must not qualify at all.
describe('hottestBettor / coldestBettor streak must include the just-settled week (manual v0.2.1 §6 #9)', () => {
  it('a team that won weeks 1-4 then lost week 5 shows no active win streak (and is not Hot Hand) at week 5', () => {
    const teams = [team('t1', 'Alpha'), team('t2', 'Beta')];
    const matchupsByWeek: Record<string, Matchup[]> = {
      '1': [matchup(1, 't1', 't2', 't1')],
      '2': [matchup(2, 't1', 't2', 't1')],
      '3': [matchup(3, 't1', 't2', 't1')],
      '4': [matchup(4, 't1', 't2', 't1')],
      '5': [matchup(5, 't1', 't2', 't2')], // t1 loses this week, breaking its streak
    };
    const league = buildLeague({
      teams,
      rosters: [],
      standings: { t1: { '5': 0 }, t2: { '5': 0 } },
      matchupsByWeek,
    });
    const scores = new Map([['t1', 0], ['t2', 0]]);
    const moments = computeWeeklyMoments(league, 5, scores, noGame, noResult);
    // t1 just lost, so it can't be Hot Hand at all this week — whether or not t2 (a
    // brand-new 1-game streak) qualifies, t1 must never appear with a W-anything.
    const hottest = moments.find((m) => m.category === 'hottestBettor');
    expect(hottest?.teamId).not.toBe('t1');
  });

  it('a team on a 5-game losing streak shows L5 (not L4) as Ice Box at week 5', () => {
    const teams = [team('t1', 'Alpha'), team('t2', 'Beta')];
    const matchupsByWeek: Record<string, Matchup[]> = {
      '1': [matchup(1, 't1', 't2', 't2')],
      '2': [matchup(2, 't1', 't2', 't2')],
      '3': [matchup(3, 't1', 't2', 't2')],
      '4': [matchup(4, 't1', 't2', 't2')],
      '5': [matchup(5, 't1', 't2', 't2')], // t1's 5th consecutive loss, settled this week
    };
    const league = buildLeague({
      teams,
      rosters: [],
      standings: { t1: { '5': 0 }, t2: { '5': 0 } },
      matchupsByWeek,
    });
    const scores = new Map([['t1', 0], ['t2', 0]]);
    const moments = computeWeeklyMoments(league, 5, scores, noGame, noResult);
    const coldest = moments.find((m) => m.category === 'coldestBettor');
    expect(coldest?.teamId).toBe('t1');
    expect(coldest?.extra).toBe('L5');
  });
});
