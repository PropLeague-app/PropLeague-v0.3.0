import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../useAppStore';

function createTestLeague() {
  const { createLeague } = useAppStore.getState();
  return createLeague({
    name: 'Test League',
    teamCount: 10,
    isPublic: false,
    settingsOverrides: { playoffTeams: 4, eliminationType: 'double' },
    userTeamName: 'My Team',
    userTeamAbbrev: 'MY',
    userLogoColor: '#4C8DF5',
  });
}

beforeEach(() => {
  useAppStore.setState({ profile: null, leagues: {}, currentLeagueId: null });
});

// manual v0.2.0 §2 #3: team count can only be resized pre-season, and must
// auto-correct playoff settings that are no longer valid for the new size.
describe('updateTargetTeamCount', () => {
  it('resizes the team count before the league has been filled', () => {
    const leagueId = createTestLeague();
    useAppStore.getState().updateTargetTeamCount(leagueId, 8);
    expect(useAppStore.getState().leagues[leagueId].targetTeamCount).toBe(8);
  });

  // manual v0.2.1 §3 #2: the playoff field can now reach full league capacity, so
  // shrinking to the minimum of 4 teams no longer invalidates a 4-team playoff by
  // itself — these two use an 8/16-team starting field so there's still a real
  // capacity ceiling to shrink past.
  it('auto-corrects an invalid playoff field size after shrinking below the new full capacity', () => {
    const { createLeague } = useAppStore.getState();
    const leagueId = createLeague({
      name: 'Big Field League',
      teamCount: 10,
      isPublic: false,
      settingsOverrides: { playoffTeams: 8, eliminationType: 'single' },
      userTeamName: 'My Team',
      userTeamAbbrev: 'MY',
      userLogoColor: '#4C8DF5',
    });
    useAppStore.getState().updateTargetTeamCount(leagueId, 7); // 8-team playoff no longer fits an 7-team league
    const settings = useAppStore.getState().leagues[leagueId].settings;
    expect(settings.playoffTeams).toBe(6);
  });

  it('falls back elimination type to single when the corrected field size cannot support double-elim', () => {
    const { createLeague } = useAppStore.getState();
    const leagueId = createLeague({
      name: 'Big Field League',
      teamCount: 10,
      isPublic: false,
      settingsOverrides: { playoffTeams: 8, eliminationType: 'double' },
      userTeamName: 'My Team',
      userTeamAbbrev: 'MY',
      userLogoColor: '#4C8DF5',
    });
    useAppStore.getState().updateTargetTeamCount(leagueId, 7); // corrects to 6-team, which doesn't support double-elim
    const settings1 = useAppStore.getState().leagues[leagueId].settings;
    expect(settings1.playoffTeams).toBe(6);
    expect(settings1.eliminationType).toBe('single');
  });

  it('keeps double-elim when the corrected field size still supports it', () => {
    const { createLeague } = useAppStore.getState();
    const leagueId = createLeague({
      name: 'Big Field League',
      teamCount: 20,
      isPublic: false,
      settingsOverrides: { playoffTeams: 16, eliminationType: 'double' },
      userTeamName: 'My Team',
      userTeamAbbrev: 'MY',
      userLogoColor: '#4C8DF5',
    });
    useAppStore.getState().updateTargetTeamCount(leagueId, 9); // 16 no longer fits, corrects to 8 (still double-elim capable)
    const settings = useAppStore.getState().leagues[leagueId].settings;
    expect(settings.playoffTeams).toBe(8);
    expect(settings.eliminationType).toBe('double');
  });

  it('ignores the resize once the league has been filled with more than one team', () => {
    const leagueId = createTestLeague();
    useAppStore.setState((s) => ({
      leagues: {
        ...s.leagues,
        [leagueId]: { ...s.leagues[leagueId], teams: [...s.leagues[leagueId].teams, { ...s.leagues[leagueId].teams[0], id: 'sim-1' }] },
      },
    }));
    useAppStore.getState().updateTargetTeamCount(leagueId, 8);
    expect(useAppStore.getState().leagues[leagueId].targetTeamCount).toBe(10);
  });

  it('clamps to the 4-32 range', () => {
    const leagueId = createTestLeague();
    useAppStore.getState().updateTargetTeamCount(leagueId, 100);
    expect(useAppStore.getState().leagues[leagueId].targetTeamCount).toBe(32);
    useAppStore.getState().updateTargetTeamCount(leagueId, 1);
    expect(useAppStore.getState().leagues[leagueId].targetTeamCount).toBe(4);
  });
});

// manual v0.2.0 §6 #12: leaving converts the user's team to a simulated one rather
// than deleting it, and is blocked while the user still holds the commissioner role.
describe('leaveLeague / transferCommissioner', () => {
  function filledTestLeague() {
    const leagueId = createTestLeague();
    useAppStore.getState().fillWithSimulatedTeams(leagueId, 10);
    return leagueId;
  }

  it('refuses to leave while the user is still commissioner', () => {
    const leagueId = filledTestLeague();
    const league = useAppStore.getState().leagues[leagueId];
    expect(league.commissionerTeamId).toBe('user');
    const result = useAppStore.getState().leaveLeague(leagueId);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/commissioner/i);
    // nothing changed
    const userTeam = useAppStore.getState().leagues[leagueId].teams.find((t) => t.id === 'user')!;
    expect(userTeam.isUser).toBe(true);
  });

  it('transferCommissioner moves the role to another team', () => {
    const leagueId = filledTestLeague();
    useAppStore.getState().transferCommissioner(leagueId, 'sim-1');
    expect(useAppStore.getState().leagues[leagueId].commissionerTeamId).toBe('sim-1');
  });

  it('allows leaving once the commissioner role has moved elsewhere', () => {
    const leagueId = filledTestLeague();
    useAppStore.getState().transferCommissioner(leagueId, 'sim-1');
    const result = useAppStore.getState().leaveLeague(leagueId);
    expect(result.ok).toBe(true);
  });

  it('converts the departing team to simulated, keeping its identity/history intact', () => {
    const leagueId = filledTestLeague();
    useAppStore.getState().transferCommissioner(leagueId, 'sim-1');
    useAppStore.getState().leaveLeague(leagueId);
    const league = useAppStore.getState().leagues[leagueId];
    const formerUserTeam = league.teams.find((t) => t.id === 'user')!;
    expect(formerUserTeam.isUser).toBe(false);
    expect(formerUserTeam.isSimulated).toBe(true);
    expect(formerUserTeam.teamName).toBe('My Team'); // schedule/standings reference this id, so identity must survive
    // the league itself, its other teams, schedule, and standings are untouched
    expect(league.teams.length).toBe(10);
    expect(Object.keys(league.matchupsByWeek).length).toBeGreaterThan(0);
  });

  it('clears currentLeagueId when leaving the currently-active league', () => {
    const leagueId = filledTestLeague();
    useAppStore.getState().transferCommissioner(leagueId, 'sim-1');
    expect(useAppStore.getState().currentLeagueId).toBe(leagueId);
    useAppStore.getState().leaveLeague(leagueId);
    expect(useAppStore.getState().currentLeagueId).toBeNull();
  });

  it('leaves a non-commissioner free to leave without any transfer', () => {
    const leagueId = filledTestLeague();
    useAppStore.getState().transferCommissioner(leagueId, 'sim-1'); // user is no longer commissioner
    const result = useAppStore.getState().leaveLeague(leagueId);
    expect(result.ok).toBe(true);
  });
});

// manual v0.2.0 §6 #13: switching just swaps the pointer — every league-scoped screen
// reads through currentLeagueId, so this alone is the whole "switch" operation.
describe('setCurrentLeague (switching)', () => {
  it('swaps which league is active without touching either league\'s data', () => {
    const leagueAId = createTestLeague();
    const { createLeague } = useAppStore.getState();
    const leagueBId = createLeague({
      name: 'Second League',
      teamCount: 6,
      isPublic: false,
      userTeamName: 'My Other Team',
      userTeamAbbrev: 'MO',
      userLogoColor: '#4C8DF5',
    });
    expect(useAppStore.getState().currentLeagueId).toBe(leagueBId); // createLeague auto-switches to the new one

    useAppStore.getState().setCurrentLeague(leagueAId);
    expect(useAppStore.getState().currentLeagueId).toBe(leagueAId);
    expect(useAppStore.getState().leagues[leagueAId].name).toBe('Test League');
    expect(useAppStore.getState().leagues[leagueBId].name).toBe('Second League');

    useAppStore.getState().setCurrentLeague(leagueBId);
    expect(useAppStore.getState().currentLeagueId).toBe(leagueBId);
  });
});

// manual v0.2.1 §2 #1: settings-save-clobbering regression — saving one editor (e.g.
// the league/team logo) must never revert an unrelated edit made through a different
// editor (e.g. league name, a toggle). Each store action is a true partial patch, so
// editing A then editing-and-saving B must leave A's value exactly as it was.
describe('cross-editor save sequencing (manual v0.2.1 §2 #1 regression)', () => {
  it('editing the league name then saving the league logo leaves the name untouched', () => {
    const leagueId = createTestLeague();
    const { updateSettings, updateLeagueLogo } = useAppStore.getState();
    updateSettings(leagueId, { leagueName: 'Edited League Name' }); // edit A
    updateLeagueLogo(leagueId, { logoMode: 'emoji', logoEmoji: '⚽', logoColor: '#4C8DF5', logoDataUrl: null }); // save B (clean partial)
    const league = useAppStore.getState().leagues[leagueId];
    expect(league.settings.leagueName).toBe('Edited League Name');
    expect(league.name).toBe('Edited League Name');
    expect(league.logoEmoji).toBe('⚽');
  });

  it('editing the team name then saving the team logo leaves the name untouched', () => {
    const leagueId = createTestLeague();
    const { updateUserTeam } = useAppStore.getState();
    updateUserTeam(leagueId, { teamName: 'Edited Team Name' }); // edit A
    updateUserTeam(leagueId, { logoMode: 'emoji', logoEmoji: '🐉', logoColor: '#9D4EED', logoDataUrl: null }); // save B (clean partial)
    const userTeam = useAppStore.getState().leagues[leagueId].teams.find((t) => t.id === 'user')!;
    expect(userTeam.teamName).toBe('Edited Team Name');
    expect(userTeam.logoEmoji).toBe('🐉');
  });

  it('toggling an unrelated advanced setting survives a subsequent logo save', () => {
    const leagueId = createTestLeague();
    const { updateSettings, updateLeagueLogo } = useAppStore.getState();
    updateSettings(leagueId, { hidePicks: true, correlationBlockEnabled: true }); // edit A (multiple toggles)
    updateLeagueLogo(leagueId, { logoMode: 'initials', logoEmoji: '🏈', logoColor: '#FF0000', logoDataUrl: null }); // save B
    const settings = useAppStore.getState().leagues[leagueId].settings;
    expect(settings.hidePicks).toBe(true);
    expect(settings.correlationBlockEnabled).toBe(true);
  });

  it('saving the league logo does not touch the team roster/settings at all', () => {
    const leagueId = createTestLeague();
    const before = useAppStore.getState().leagues[leagueId];
    useAppStore.getState().updateLeagueLogo(leagueId, { logoMode: 'emoji', logoEmoji: '🏆', logoColor: '#4C8DF5', logoDataUrl: null });
    const after = useAppStore.getState().leagues[leagueId];
    expect(after.teams).toEqual(before.teams);
    expect(after.settings).toEqual(before.settings);
  });
});
