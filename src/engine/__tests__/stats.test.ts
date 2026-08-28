import { describe, it, expect } from 'vitest';
import { computeIndividualStats, collectTeamBets, isWagerVisibleToViewer, type TeamBet } from '../stats';
import { DEFAULT_LEAGUE_SETTINGS } from '../../types';
import type { League, LeagueTeam, Wager, WeeklyRoster } from '../../types';

function bet(overrides: Partial<TeamBet>): TeamBet {
  return {
    week: 1,
    position: 'QB',
    gameId: 'g1',
    side: 'Over',
    stake: 10,
    oddsAtPlacement: -110,
    status: 'won',
    settledProfit: 9.09,
    placedAt: new Date().toISOString(),
    marketKey: 'player_pass_yds',
    ...overrides,
  };
}

describe('computeIndividualStats', () => {
  it('computes ROI as totalPL / totalWagered', () => {
    const bets = [bet({ status: 'won', settledProfit: 10, stake: 10 }), bet({ status: 'lost', settledProfit: -10, stake: 10 })];
    const stats = computeIndividualStats(bets, () => undefined);
    expect(stats.totalWagered).toBe(20);
    expect(stats.totalPL).toBe(0);
    expect(stats.roi).toBe(0);
  });

  it('buckets favorite vs underdog by odds sign', () => {
    const bets = [bet({ oddsAtPlacement: -150, status: 'won', settledProfit: 6.67 }), bet({ oddsAtPlacement: 150, status: 'lost', settledProfit: -10 })];
    const stats = computeIndividualStats(bets, () => undefined);
    expect(stats.byOddsRange.favorite.wins).toBe(1);
    expect(stats.byOddsRange.underdog.losses).toBe(1);
  });

  it('tracks the longest active win/loss streak, not just totals', () => {
    const bets = [
      bet({ status: 'won' }),
      bet({ status: 'won' }),
      bet({ status: 'lost', settledProfit: -10 }),
      bet({ status: 'lost', settledProfit: -10 }),
      bet({ status: 'lost', settledProfit: -10 }),
      bet({ status: 'won' }),
    ];
    const stats = computeIndividualStats(bets, () => undefined);
    expect(stats.longestWinStreak).toBe(2);
    expect(stats.longestLossStreak).toBe(3);
  });

  it('does not count pending bets toward settled stats but does toward avg stake', () => {
    const bets = [bet({ status: 'pending', settledProfit: null }), bet({ status: 'won' })];
    const stats = computeIndividualStats(bets, () => undefined);
    expect(stats.settledBets).toBe(1);
    expect(stats.totalBets).toBe(2);
  });
});

// manual v0.3.0 §5: league-wide stats/bets browsing must never leak an opponent's
// hidden current-week pick, exactly matching the matchup screen's own rule.
describe('isWagerVisibleToViewer', () => {
  const base = { hidePicks: true, wagerWeek: 5, currentWeek: 5, wagerStatus: 'pending' as const, gameStarted: false };

  it('always shows a viewer their own team, hide-picks or not', () => {
    expect(isWagerVisibleToViewer({ ...base, isOwnTeam: true })).toBe(true);
  });

  it('hides another team\'s pending current-week pick before kickoff when hide-picks is on', () => {
    expect(isWagerVisibleToViewer({ ...base, isOwnTeam: false })).toBe(false);
  });

  it('reveals it the moment the game starts, even while still pending', () => {
    expect(isWagerVisibleToViewer({ ...base, isOwnTeam: false, gameStarted: true })).toBe(true);
  });

  it('never hides a settled bet, regardless of hide-picks', () => {
    expect(isWagerVisibleToViewer({ ...base, isOwnTeam: false, wagerStatus: 'won' })).toBe(true);
  });

  it('never hides a past week\'s pick, even if somehow still pending', () => {
    expect(isWagerVisibleToViewer({ ...base, isOwnTeam: false, wagerWeek: 4 })).toBe(true);
  });

  it('does not hide anything when the league has hide-picks off', () => {
    expect(isWagerVisibleToViewer({ ...base, isOwnTeam: false, hidePicks: false })).toBe(true);
  });
});

function leagueTeam(id: string): LeagueTeam {
  return {
    id,
    ownerName: id,
    teamName: id,
    abbrev: id.toUpperCase().slice(0, 3),
    logoMode: 'initials',
    logoEmoji: '🏈',
    logoColor: '#4C8DF5',
    logoDataUrl: null,
    isUser: id === 'user',
    isSimulated: id !== 'user',
    conferenceId: null,
  };
}

function pendingWager(overrides: Partial<Wager> = {}): Wager {
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

function buildRosterLeague(hidePicks: boolean, currentWeek: number, roster: WeeklyRoster): League {
  return {
    id: 'league-1',
    name: 'Test League',
    inviteCode: 'ABC123',
    commissionerTeamId: 'user',
    settings: { ...DEFAULT_LEAGUE_SETTINGS, hidePicks },
    targetTeamCount: 2,
    logoMode: 'initials',
    logoEmoji: '🏆',
    logoDataUrl: null,
    logoColor: '#4C8DF5',
    teams: [leagueTeam('user'), leagueTeam('sim-1')],
    currentWeek,
    seasonPhase: 'regular',
    matchupsByWeek: {},
    rostersByTeamWeek: { [`sim-1-${currentWeek}`]: roster },
    standings: [],
    bracket: null,
    activity: [],
    prizePool: null,
    manualGameOverrides: {},
  };
}

describe('collectTeamBets with a visibility context', () => {
  it('omits another team\'s pending current-week pick whose game has not started when hide-picks is on', () => {
    const roster: WeeklyRoster = { week: 5, teamId: 'sim-1', submitted: true, slots: [{ slotId: 's1', position: 'QB', wager: pendingWager() }] };
    const league = buildRosterLeague(true, 5, roster);
    const bets = collectTeamBets(league, 'sim-1', { isOwnTeam: false, isGameStarted: () => false });
    expect(bets).toHaveLength(0);
  });

  it('includes that same pick once its game has started', () => {
    const roster: WeeklyRoster = { week: 5, teamId: 'sim-1', submitted: true, slots: [{ slotId: 's1', position: 'QB', wager: pendingWager() }] };
    const league = buildRosterLeague(true, 5, roster);
    const bets = collectTeamBets(league, 'sim-1', { isOwnTeam: false, isGameStarted: () => true });
    expect(bets).toHaveLength(1);
  });

  it('includes it regardless when no visibility context is passed (self-view call sites)', () => {
    const roster: WeeklyRoster = { week: 5, teamId: 'sim-1', submitted: true, slots: [{ slotId: 's1', position: 'QB', wager: pendingWager() }] };
    const league = buildRosterLeague(true, 5, roster);
    expect(collectTeamBets(league, 'sim-1')).toHaveLength(1);
  });
});
