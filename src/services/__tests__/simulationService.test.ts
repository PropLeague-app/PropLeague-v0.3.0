import { describe, it, expect } from 'vitest';
import { createLeague, fillWithSimulatedTeams } from '../leagueService';
import { simulateToWeek } from '../simulationService';
import { rosterKey } from '../../engine/rosterSlots';

function buildTestLeague(teamCount: number) {
  let league = createLeague({
    id: 'test-league',
    name: 'Test League',
    teamCount,
    isPublic: false,
    userTeamName: 'My Team',
    userTeamAbbrev: 'MYT',
    userLogoColor: '#4C8DF5',
    settingsOverrides: { playoffTeams: teamCount },
  });
  league = fillWithSimulatedTeams(league, teamCount);
  return league;
}

describe('simulateToWeek (manual v0.03 §5 #10/#11)', () => {
  it('a single call with the default target runs the whole season through to a champion, not just the regular season', () => {
    const league = buildTestLeague(6);
    const result = simulateToWeek(league, 18);
    expect(result.seasonPhase).toBe('complete');
    expect(result.bracket?.championId).toBeTruthy();
  });

  it('auto-fills the user a submitted lineup for every playoff round they are still active in', () => {
    const league = buildTestLeague(6);
    const result = simulateToWeek(league, 18);
    for (const week of ['WC', 'DIV', 'CONF'] as const) {
      const roster = result.rostersByTeamWeek[rosterKey('user', week)];
      // Either the user was auto-filled for that round, or they were already
      // eliminated (or on a bye) and simply never needed a roster that round.
      if (roster) {
        expect(roster.submitted).toBe(true);
        expect(roster.slots.every((s) => s.wager != null)).toBe(true);
      }
    }
  });

  it('stops mid-season at a small target without rolling into the playoffs', () => {
    const league = buildTestLeague(6);
    const result = simulateToWeek(league, 3);
    expect(result.seasonPhase).toBe('regular');
    expect(result.currentWeek).toBe(4);
  });

  it('never auto-fills the user when the setting is off, even across a full-season jump', () => {
    let league = buildTestLeague(6);
    league = { ...league, settings: { ...league.settings, autoFillUserLineupsWhenSimulating: false } };
    const result = simulateToWeek(league, 18);
    // The week gets settled either way (falling back to an empty roster, which is the
    // normal missed-lineup penalty), but it should never have been auto-filled.
    const week2Roster = result.rostersByTeamWeek[rosterKey('user', 2)];
    expect(week2Roster?.slots.every((s) => s.wager == null)).toBe(true);
  });
});
