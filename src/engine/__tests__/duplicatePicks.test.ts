import { describe, it, expect } from 'vitest';
import { ClaimTracker, findClaimingTeam, claimBlockReason, findCorrelationViolation, claimHolders } from '../duplicatePicks';
import { DEFAULT_CORRELATION_RULES } from '../../types';
import type { League, LeagueTeam, Wager, WeeklyRoster } from '../../types';

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

function buildLeague(opts: { teams: LeagueTeam[]; rosters: WeeklyRoster[]; maxDuplicatePicks: number | null }): League {
  const rostersByTeamWeek: Record<string, WeeklyRoster> = {};
  for (const r of opts.rosters) rostersByTeamWeek[`${r.teamId}-${r.week}`] = r;
  return {
    id: 'league-1',
    name: 'Test League',
    teams: opts.teams,
    rostersByTeamWeek,
    settings: { maxDuplicatePicks: opts.maxDuplicatePicks },
  } as unknown as League;
}

const pick = (over: Partial<{ gameId: string; marketKey: 'player_pass_yds'; playerId: string; side: string; point: number }> = {}) => ({
  gameId: 'g1',
  marketKey: 'player_pass_yds' as const,
  playerId: 'p1',
  side: 'Over',
  point: 250,
  ...over,
});

describe('manual v0.1.1 §5 A — maxDuplicatePicks cap', () => {
  it('leaves picks fully open when the cap is null (OFF/unlimited)', () => {
    const league = buildLeague({
      teams: [team('t1', 'A'), team('t2', 'B')],
      rosters: [roster('t1', 1, [wager({ gameId: 'g1', marketKey: 'player_pass_yds', playerId: 'p1', side: 'Over', point: 250 })])],
      maxDuplicatePicks: null,
    });
    const claimant = findClaimingTeam(league, 1, pick(), 't2');
    expect(claimant).toBeNull();
  });

  it('blocks a pick at cap 1 once one other team already holds it (old exclusive behavior)', () => {
    const league = buildLeague({
      teams: [team('t1', 'A'), team('t2', 'B')],
      rosters: [roster('t1', 1, [wager({ gameId: 'g1', marketKey: 'player_pass_yds', playerId: 'p1', side: 'Over', point: 250 })])],
      maxDuplicatePicks: 1,
    });
    const claimant = findClaimingTeam(league, 1, pick(), 't2');
    expect(claimant).toBe('t1');
  });

  it('leaves a pick open under a cap of 2 until two teams already hold it', () => {
    const league = buildLeague({
      teams: [team('t1', 'A'), team('t2', 'B'), team('t3', 'C')],
      rosters: [roster('t1', 1, [wager({ gameId: 'g1', marketKey: 'player_pass_yds', playerId: 'p1', side: 'Over', point: 250 })])],
      maxDuplicatePicks: 2,
    });
    expect(findClaimingTeam(league, 1, pick(), 't2')).toBeNull();
  });

  it('blocks under a cap of 2 once two other teams already hold the pick', () => {
    const league = buildLeague({
      teams: [team('t1', 'A'), team('t2', 'B'), team('t3', 'C')],
      rosters: [
        roster('t1', 1, [wager({ gameId: 'g1', marketKey: 'player_pass_yds', playerId: 'p1', side: 'Over', point: 250 })]),
        roster('t2', 1, [wager({ gameId: 'g1', marketKey: 'player_pass_yds', playerId: 'p1', side: 'Over', point: 250 })]),
      ],
      maxDuplicatePicks: 2,
    });
    expect(findClaimingTeam(league, 1, pick(), 't3')).not.toBeNull();
  });

  it('ignores picks from a different week', () => {
    const league = buildLeague({
      teams: [team('t1', 'A'), team('t2', 'B')],
      rosters: [roster('t1', 2, [wager({ gameId: 'g1', marketKey: 'player_pass_yds', playerId: 'p1', side: 'Over', point: 250 })])],
      maxDuplicatePicks: 1,
    });
    expect(findClaimingTeam(league, 1, pick(), 't2')).toBeNull();
  });

  it('excludes the requesting team\'s own picks from the count', () => {
    const league = buildLeague({
      teams: [team('t1', 'A')],
      rosters: [roster('t1', 1, [wager({ gameId: 'g1', marketKey: 'player_pass_yds', playerId: 'p1', side: 'Over', point: 250 })])],
      maxDuplicatePicks: 1,
    });
    expect(findClaimingTeam(league, 1, pick(), 't1')).toBeNull();
  });

  it('claimBlockReason names the claiming team when the cap is 1', () => {
    const league = buildLeague({ teams: [team('t1', 'Falcons FC')], rosters: [], maxDuplicatePicks: 1 });
    expect(claimBlockReason(league, 't1')).toBe('Claimed by Falcons FC');
  });

  it('claimBlockReason gives a generic limit message when the cap is greater than 1', () => {
    const league = buildLeague({ teams: [team('t1', 'A')], rosters: [], maxDuplicatePicks: 3 });
    expect(claimBlockReason(league, 't1')).toContain('max 3');
  });

  it('ClaimTracker seeds counts from existing rosters and respects the cap across claims', () => {
    const league = buildLeague({
      teams: [team('t1', 'A')],
      rosters: [roster('t1', 1, [wager({ gameId: 'g1', marketKey: 'player_pass_yds', playerId: 'p1', side: 'Over', point: 250 })])],
      maxDuplicatePicks: 2,
    });
    const tracker = new ClaimTracker(league, 1);
    expect(tracker.isTaken('g1', 'player_pass_yds', 'p1', 'Over', 250)).toBe(false);
    tracker.claim('g1', 'player_pass_yds', 'p1', 'Over', 250);
    expect(tracker.isTaken('g1', 'player_pass_yds', 'p1', 'Over', 250)).toBe(true);
  });

  it('ClaimTracker never marks anything taken when the cap is null', () => {
    const league = buildLeague({ teams: [], rosters: [], maxDuplicatePicks: null });
    const tracker = new ClaimTracker(league, 1);
    tracker.claim('g1', 'player_pass_yds', 'p1', 'Over', 250);
    expect(tracker.isTaken('g1', 'player_pass_yds', 'p1', 'Over', 250)).toBe(false);
  });
});

// manual v0.2.0 §3 #4: claimHolders backs the "N of cap claimed" progress indicator,
// so it must report every current holder even while the pick is still pickable
// (unlike findClaimingTeam, which only returns something once the cap is fully hit).
describe('claimHolders', () => {
  it('lists every team holding a pick, even below the cap', () => {
    const league = buildLeague({
      teams: [team('t1', 'A'), team('t2', 'B'), team('t3', 'C')],
      rosters: [roster('t1', 1, [wager({ gameId: 'g1', marketKey: 'player_pass_yds', playerId: 'p1', side: 'Over', point: 250 })])],
      maxDuplicatePicks: 3,
    });
    expect(claimHolders(league, 1, pick(), 't2')).toEqual(['t1']);
  });

  it('returns an empty list when nobody holds the pick', () => {
    const league = buildLeague({ teams: [team('t1', 'A')], rosters: [], maxDuplicatePicks: 3 });
    expect(claimHolders(league, 1, pick(), 't1')).toEqual([]);
  });

  it('excludes the requesting team and other weeks, same as findClaimingTeam', () => {
    const league = buildLeague({
      teams: [team('t1', 'A'), team('t2', 'B')],
      rosters: [
        roster('t1', 1, [wager({ gameId: 'g1', marketKey: 'player_pass_yds', playerId: 'p1', side: 'Over', point: 250 })]),
        roster('t2', 2, [wager({ gameId: 'g1', marketKey: 'player_pass_yds', playerId: 'p1', side: 'Over', point: 250 })]),
      ],
      maxDuplicatePicks: 3,
    });
    expect(claimHolders(league, 1, pick(), 't1')).toEqual([]);
  });
});

describe('manual v0.1.1 §5 B — correlated-picks blocklist', () => {
  const playerTeamId = (id: string) => ({ 'NE-maye': 'NE', 'NE-diggs': 'NE', 'KC-mahomes': 'KC' })[id];

  it('flags the default same-team QB pass yds Over + teammate rec yds Over rule', () => {
    const picks = [
      { slotId: 'QB-1', marketKey: 'player_pass_yds' as const, side: 'Over', playerId: 'NE-maye', gameId: 'g1' },
      { slotId: 'WR-1', marketKey: 'player_reception_yds' as const, side: 'Over', playerId: 'NE-diggs', gameId: 'g1' },
    ];
    const violation = findCorrelationViolation(picks, DEFAULT_CORRELATION_RULES, playerTeamId);
    expect(violation?.rule.id).toBe('qb-pass-yds-teammate-rec-yds');
  });

  it('reports both offending slot ids (manual v0.2.0 §3 #6)', () => {
    const picks = [
      { slotId: 'QB-1', marketKey: 'player_pass_yds' as const, side: 'Over', playerId: 'NE-maye', gameId: 'g1' },
      { slotId: 'WR-1', marketKey: 'player_reception_yds' as const, side: 'Over', playerId: 'NE-diggs', gameId: 'g1' },
    ];
    const violation = findCorrelationViolation(picks, DEFAULT_CORRELATION_RULES, playerTeamId);
    expect(violation?.slotIds.sort()).toEqual(['QB-1', 'WR-1']);
  });

  it('does not flag the same market pair across two different teams', () => {
    const picks = [
      { slotId: 'QB-1', marketKey: 'player_pass_yds' as const, side: 'Over', playerId: 'NE-maye', gameId: 'g1' },
      { slotId: 'WR-1', marketKey: 'player_reception_yds' as const, side: 'Over', playerId: 'KC-mahomes', gameId: 'g2' },
    ];
    const violation = findCorrelationViolation(picks, DEFAULT_CORRELATION_RULES, playerTeamId);
    expect(violation).toBeNull();
  });

  it('does not flag when only one leg of the pair is present', () => {
    const picks = [{ slotId: 'QB-1', marketKey: 'player_pass_yds' as const, side: 'Over', playerId: 'NE-maye', gameId: 'g1' }];
    expect(findCorrelationViolation(picks, DEFAULT_CORRELATION_RULES, playerTeamId)).toBeNull();
  });

  it('respects an empty/custom ruleset (commissioner removed all rules)', () => {
    const picks = [
      { slotId: 'QB-1', marketKey: 'player_pass_yds' as const, side: 'Over', playerId: 'NE-maye', gameId: 'g1' },
      { slotId: 'WR-1', marketKey: 'player_reception_yds' as const, side: 'Over', playerId: 'NE-diggs', gameId: 'g1' },
    ];
    expect(findCorrelationViolation(picks, [], playerTeamId)).toBeNull();
  });
});
