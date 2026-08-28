import { describe, it, expect } from 'vitest';
import { advanceLeagueWeek } from '../simulateWeek';
import { createLeague, fillWithSimulatedTeams } from '../../services/leagueService';
import { rosterKey, buildEmptySlots } from '../rosterSlots';
import { computeTeamStreak } from '../stats';
import type { League, WeeklyRoster } from '../../types';

function buildTestLeague() {
  let league = createLeague({
    id: 'test-league',
    name: 'Test League',
    teamCount: 4,
    isPublic: false,
    userTeamName: 'My Team',
    userTeamAbbrev: 'MYT',
    userLogoColor: '#4C8DF5',
  });
  league = fillWithSimulatedTeams(league, 4);
  return league;
}

describe('advanceLeagueWeek auto-fill-user option (manual v0.03 §5 #10)', () => {
  it('leaves the user without a next-week lineup when autoFillUser is not passed (normal single Advance Week)', () => {
    const league = buildTestLeague();
    const next = advanceLeagueWeek(league);
    const key = rosterKey('user', 2);
    expect(next.rostersByTeamWeek[key]).toBeUndefined();
  });

  it('auto-fills the user a submitted next-week lineup when autoFillUser is true and the setting is on', () => {
    const league = buildTestLeague();
    expect(league.settings.autoFillUserLineupsWhenSimulating).toBe(true);
    const next = advanceLeagueWeek(league, { autoFillUser: true });
    const key = rosterKey('user', 2);
    const roster = next.rostersByTeamWeek[key];
    expect(roster).toBeDefined();
    expect(roster!.submitted).toBe(true);
    expect(roster!.slots.every((s) => s.wager != null)).toBe(true);
  });

  it('does not auto-fill the user even with autoFillUser: true when the league setting is off', () => {
    let league = buildTestLeague();
    league = { ...league, settings: { ...league.settings, autoFillUserLineupsWhenSimulating: false } };
    const next = advanceLeagueWeek(league, { autoFillUser: true });
    const key = rosterKey('user', 2);
    expect(next.rostersByTeamWeek[key]).toBeUndefined();
  });

  it('still auto-fills simulated members regardless of the autoFillUser option', () => {
    const league = buildTestLeague();
    const next = advanceLeagueWeek(league);
    const simKey = rosterKey('sim-1', 2);
    expect(next.rostersByTeamWeek[simKey]).toBeDefined();
    expect(next.rostersByTeamWeek[simKey].submitted).toBe(true);
  });
});

// manual v0.2.1 §6 #9: end-to-end regression for the Hot Hand/Ice Box off-by-one — the
// bug lived specifically in advanceLeagueWeek's snapshot for moment generation, so a
// pure computeWeeklyMoments unit test (which is always handed a complete
// matchupsByWeek by the test itself) can't catch it. This exercises the real
// advanceLeagueWeek path with fully deterministic (pre-settled, not randomly
// simulated) weekly scores so each week's winner is under test control.
describe('advanceLeagueWeek moment streaks stay in sync with the just-settled week (manual v0.2.1 §6 #9)', () => {
  function forcedRoster(teamId: string, week: number, league: League, profit: number): WeeklyRoster {
    const slots = buildEmptySlots(league.settings.lineupSlots).map((slot, i) => ({
      ...slot,
      wager: {
        id: `forced-${teamId}-${week}-${i}`,
        slotId: slot.slotId,
        gameId: 'forced-game',
        marketKey: 'player_pass_yds' as const,
        side: 'Over',
        point: 250,
        oddsAtPlacement: -110,
        stake: 1,
        placedAt: new Date().toISOString(),
        status: (profit >= 0 ? 'won' : 'lost') as 'won' | 'lost',
        settledProfit: i === 0 ? profit : 0,
      },
    }));
    return { week, teamId, submitted: true, slots };
  }

  /** Forces the user's matchup for `week` to resolve with the user winning (profit>0)
   * or losing (profit<0), by pre-settling both sides' rosters — advanceLeagueWeek's
   * settleRoster leaves already-non-pending wagers untouched, so these scores are
   * exactly what computeWeeklyScore will report, no randomness involved. */
  function forceUserResult(league: League, week: number, userWins: boolean): League {
    const matchup = league.matchupsByWeek[String(week)]?.find((m) => m.teamAId === 'user' || m.teamBId === 'user');
    if (!matchup) throw new Error(`no week ${week} matchup for user`);
    const opponentId = matchup.teamAId === 'user' ? matchup.teamBId : matchup.teamAId;
    const userRoster = forcedRoster('user', week, league, userWins ? 100 : -100);
    const oppRoster = forcedRoster(opponentId, week, league, userWins ? -100 : 100);
    return {
      ...league,
      rostersByTeamWeek: {
        ...league.rostersByTeamWeek,
        [rosterKey('user', week)]: userRoster,
        [rosterKey(opponentId, week)]: oppRoster,
      },
    };
  }

  it('a user who wins 4 straight then loses is not Hot Hand the week they lose', () => {
    let league = buildTestLeague();
    for (let week = 1; week <= 4; week++) {
      league = forceUserResult(league, week, true);
      league = advanceLeagueWeek(league);
    }
    // sanity: standings/matchups agree the user is on a 4-game win streak going in
    expect(computeTeamStreak(league, 'user')).toEqual({ type: 'W', count: 4 });

    league = forceUserResult(league, 5, false);
    const settled = advanceLeagueWeek(league);

    const hotHandMoment = settled.activity.find((a) => a.momentCategory === 'hottestBettor');
    expect(hotHandMoment?.momentTeamId).not.toBe('user');
    // and the streak itself must already reflect the just-settled loss, not lag a week
    expect(computeTeamStreak(settled, 'user')).toEqual({ type: 'L', count: 1 });
  });

  it('a user on a 5-game losing streak shows Ice Box as L5, not L4, the week the 5th loss settles', () => {
    let league = buildTestLeague();
    for (let week = 1; week <= 4; week++) {
      league = forceUserResult(league, week, false);
      league = advanceLeagueWeek(league);
    }
    expect(computeTeamStreak(league, 'user')).toEqual({ type: 'L', count: 4 });

    league = forceUserResult(league, 5, false);
    const settled = advanceLeagueWeek(league);

    expect(computeTeamStreak(settled, 'user')).toEqual({ type: 'L', count: 5 });
    const iceBoxMoment = settled.activity.find((a) => a.momentCategory === 'coldestBettor');
    expect(iceBoxMoment?.momentTeamId).toBe('user');
    expect(iceBoxMoment?.momentExtra).toBe('L5');
  });
});
