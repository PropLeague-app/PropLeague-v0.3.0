import { describe, it, expect } from 'vitest';
import { DEFAULT_LEAGUE_SETTINGS } from '../../types';
import type { League, LeagueSettings, WagerStatus, WeeklyRoster } from '../../types';
import { isPerfectWeek, isTeamOnFire } from '../perfectWeek';

const settings: LeagueSettings = { ...DEFAULT_LEAGUE_SETTINGS, weeklyCredits: 100, minGamesPerRoster: null, lineupSlots: { QB: 1, RB: 1, WR: 1, TE: 1, K: 1, ML: 1 } as LeagueSettings['lineupSlots'] };

function roster(entries: { status: WagerStatus; stake: number; gameId?: string }[], empty = 0): WeeklyRoster {
  const slots = entries.map((e, i) => ({
    slotId: `S-${i}`,
    position: 'WR' as const,
    wager: {
      id: `w${i}`, slotId: `S-${i}`, gameId: e.gameId ?? `g${i % 3}`, marketKey: 'player_reception_yds' as const, side: 'Over', oddsAtPlacement: -110,
      stake: e.stake, placedAt: '', status: e.status, settledProfit: e.status === 'won' ? e.stake * 0.9 : 0,
    },
  }));
  for (let i = 0; i < empty; i++) slots.push({ slotId: `E-${i}`, position: 'WR', wager: null as never });
  return { week: 4, teamId: 't', slots, submitted: true };
}

const full = (statuses: WagerStatus[]) => roster(statuses.map((status) => ({ status, stake: 100 / statuses.length })));

describe('isPerfectWeek', () => {
  it('all wins is perfect', () => {
    expect(isPerfectWeek(full(['won', 'won', 'won', 'won']), settings, true)).toBe(true);
  });
  it('voids and pushes are allowed as long as there is a win', () => {
    expect(isPerfectWeek(full(['won', 'voided', 'push', 'won']), settings, true)).toBe(true);
  });
  it('any loss ruins it', () => {
    expect(isPerfectWeek(full(['won', 'won', 'lost', 'won']), settings, true)).toBe(false);
  });
  it('needs at least one win', () => {
    expect(isPerfectWeek(full(['voided', 'push', 'voided', 'voided']), settings, true)).toBe(false);
  });
  it('a single winning pick with empty slots is NOT perfect', () => {
    expect(isPerfectWeek(roster([{ status: 'won', stake: 100 }], 7), settings, true)).toBe(false);
  });
  it('unplaced credits disqualify it', () => {
    expect(isPerfectWeek(roster([{ status: 'won', stake: 20 }, { status: 'won', stake: 20 }, { status: 'won', stake: 20 }]), settings, true)).toBe(false);
  });
  it('too few distinct games disqualifies it', () => {
    const r = roster([{ status: 'won', stake: 50, gameId: 'g1' }, { status: 'won', stake: 50, gameId: 'g1' }]);
    expect(isPerfectWeek(r, { ...settings, minGamesPerRoster: 2 }, true)).toBe(false);
  });

  it('one game is enough for a perfect week at the default minimum', () => {
    // The default is 1 now, so a clean sweep inside a single game counts (see chat, Oct 2026).
    const r = roster([{ status: 'won', stake: 50, gameId: 'g1' }, { status: 'won', stake: 50, gameId: 'g1' }]);
    expect(isPerfectWeek(r, settings, true)).toBe(true);
  });
  it('a week that is not final yet, or still has a pending pick, never counts', () => {
    expect(isPerfectWeek(full(['won', 'won', 'won', 'won']), settings, false)).toBe(false);
    expect(isPerfectWeek(full(['won', 'pending', 'won', 'won']), settings, true)).toBe(false);
  });
  it('no roster at all is not perfect', () => {
    expect(isPerfectWeek(undefined, settings, true)).toBe(false);
  });
});

// ---- isTeamOnFire: the streak, as opposed to the trophy ----

/** A league with one team, a roster per week, and a decided matchup for each. */
function leagueWith(weeks: Record<number, WagerStatus[]>): League {
  const rostersByTeamWeek: Record<string, WeeklyRoster> = {};
  const matchupsByWeek: Record<number, { id: string; week: number; teamAId: string; teamBId: string; winnerId: string | null; isTie: boolean }[]> = {};
  for (const [weekStr, statuses] of Object.entries(weeks)) {
    const week = Number(weekStr);
    rostersByTeamWeek[`t:${week}`] = { ...full(statuses), week, teamId: 't' };
    matchupsByWeek[week] = [{ id: `m${week}`, week, teamAId: 't', teamBId: 'o', winnerId: 't', isTie: false }];
  }
  return {
    id: 'L',
    settings,
    teams: [{ id: 't' }, { id: 'o' }],
    rostersByTeamWeek,
    matchupsByWeek,
    standings: [],
  } as unknown as League;
}

describe('isTeamOnFire', () => {
  it('is cold without a perfect week', () => {
    expect(isTeamOnFire(leagueWith({ 1: ['won', 'won', 'lost', 'won'] }), 't')).toBe(false);
  });

  it('lights on a perfect week', () => {
    expect(isTeamOnFire(leagueWith({ 1: ['won', 'won', 'won', 'won'] }), 't')).toBe(true);
  });

  it('a loss in a later week puts it out', () => {
    const league = leagueWith({ 1: ['won', 'won', 'won', 'won'], 2: ['won', 'lost', 'won', 'won'] });
    expect(isTeamOnFire(league, 't')).toBe(false);
  });

  // The whole point of the rule Hunter picked: only a loss counts against you.
  it('pushes and voids after it leave it burning', () => {
    const league = leagueWith({ 1: ['won', 'won', 'won', 'won'], 2: ['push', 'voided', 'won', 'push'] });
    expect(isTeamOnFire(league, 't')).toBe(true);
  });

  it('a pick still pending counts neither way', () => {
    const league = leagueWith({ 1: ['won', 'won', 'won', 'won'], 2: ['pending', 'pending', 'won', 'pending'] });
    expect(isTeamOnFire(league, 't')).toBe(true);
  });

  it('a later perfect week relights it after an earlier loss', () => {
    const league = leagueWith({
      1: ['won', 'won', 'won', 'won'],
      2: ['won', 'lost', 'won', 'won'],
      3: ['won', 'won', 'won', 'won'],
    });
    expect(isTeamOnFire(league, 't')).toBe(true);
  });

  it('a loss BEFORE the perfect week does not count against it', () => {
    const league = leagueWith({ 1: ['won', 'lost', 'won', 'won'], 2: ['won', 'won', 'won', 'won'] });
    expect(isTeamOnFire(league, 't')).toBe(true);
  });

  it('reads only the team it was asked about', () => {
    const league = leagueWith({ 1: ['won', 'won', 'won', 'won'] });
    league.rostersByTeamWeek['o:2'] = { ...full(['lost', 'lost', 'lost', 'lost']), week: 2, teamId: 'o' };
    expect(isTeamOnFire(league, 't')).toBe(true);
  });
});
