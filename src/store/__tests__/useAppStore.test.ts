import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useAppStore } from '../useAppStore';
import * as leagueService from '../../services/leagueService';
import type { LeagueTeam } from '../../types';

// The store talks to Supabase for anything that persists (settings, commissioner, leaving,
// team/league identity). These tests are about what the store does with the result, so the
// network layer is stubbed to succeed and the fixture leagues are built locally.
vi.mock('../../services/supabaseLeague', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/supabaseLeague')>();
  const ok = async () => ({ ok: true as const });
  return {
    ...actual,
    // Echo "nothing changed server-side": the optimistic local edit stands, nothing is pending.
    updateLeagueSettingsRemote: vi.fn(async () => ({
      ok: true as const,
      state: { locked: false, week: '1', settings: {}, pending: null },
    })),
    updateLeagueCommissionerRemote: vi.fn(ok),
    leaveRealLeague: vi.fn(ok),
    updateTeamIdentityRemote: vi.fn(ok),
    updateLeagueIdentityRemote: vi.fn(ok),
    updateTeamConferenceRemote: vi.fn(ok),
  };
});

let nextLeague = 0;

/** Builds a fresh, unstarted league the way the Create League screen does (service builds it,
 * the store adds it and makes it current) and returns its id. */
function createLeague(params: Omit<leagueService.CreateLeagueParams, 'id' | 'inviteCode' | 'userTeamId'>): string {
  const id = `league-${++nextLeague}`;
  const league = leagueService.createLeague({ ...params, id, inviteCode: `CODE${nextLeague}`, userTeamId: 'user' });
  useAppStore.getState().addLeague(league);
  return id;
}

function createTestLeague() {
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

  // The gate is "has a schedule been generated", not team count: real invite-code joins can
  // leave a multi-team league that has not started yet, and that must still be resizable.
  it('still resizes a multi-team league until the season has a schedule', () => {
    const leagueId = createTestLeague();
    useAppStore.setState((s) => ({
      leagues: {
        ...s.leagues,
        [leagueId]: { ...s.leagues[leagueId], teams: [...s.leagues[leagueId].teams, { ...s.leagues[leagueId].teams[0], id: 'joined-1' }] },
      },
    }));
    useAppStore.getState().updateTargetTeamCount(leagueId, 8);
    expect(useAppStore.getState().leagues[leagueId].targetTeamCount).toBe(8);
  });

  it('ignores the resize once the season has been scheduled', () => {
    const leagueId = createTestLeague();
    useAppStore.setState((s) => ({
      leagues: {
        ...s.leagues,
        [leagueId]: {
          ...s.leagues[leagueId],
          matchupsByWeek: { '1': [{ id: 'm1', week: 1, teamAId: 'user', teamBId: 'sim-1' } as never] },
        },
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

// manual v0.2.0 §6 #12: leaving is blocked while the user still holds the commissioner
// role. Both actions persist through Supabase (stubbed above), and a successful leave drops
// the league from local state entirely.
describe('leaveLeague / transferCommissioner', () => {
  /** A league with a second team to hand the commissioner role to. */
  function filledTestLeague() {
    const leagueId = createTestLeague();
    const other: LeagueTeam = {
      ...useAppStore.getState().leagues[leagueId].teams[0],
      id: 'sim-1',
      ownerName: 'Bot',
      teamName: 'Bot Team',
      abbrev: 'BT',
      isUser: false,
      isSimulated: true,
    };
    useAppStore.setState((st) => ({
      leagues: { ...st.leagues, [leagueId]: { ...st.leagues[leagueId], teams: [...st.leagues[leagueId].teams, other] } },
    }));
    return leagueId;
  }

  it('refuses to leave while the user is still commissioner', async () => {
    const leagueId = filledTestLeague();
    const league = useAppStore.getState().leagues[leagueId];
    expect(league.commissionerTeamId).toBe('user');
    const result = await useAppStore.getState().leaveLeague(leagueId);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/commissioner/i);
    // nothing changed
    const userTeam = useAppStore.getState().leagues[leagueId].teams.find((t) => t.id === 'user')!;
    expect(userTeam.isUser).toBe(true);
  });

  it('transferCommissioner moves the role to another team', async () => {
    const leagueId = filledTestLeague();
    await useAppStore.getState().transferCommissioner(leagueId, 'sim-1');
    expect(useAppStore.getState().leagues[leagueId].commissionerTeamId).toBe('sim-1');
  });

  it('allows leaving once the commissioner role has moved elsewhere', async () => {
    const leagueId = filledTestLeague();
    await useAppStore.getState().transferCommissioner(leagueId, 'sim-1');
    const result = await useAppStore.getState().leaveLeague(leagueId);
    expect(result.ok).toBe(true);
  });

  it('drops the league from local state once the leave succeeds', async () => {
    const leagueId = filledTestLeague();
    await useAppStore.getState().transferCommissioner(leagueId, 'sim-1');
    await useAppStore.getState().leaveLeague(leagueId);
    expect(useAppStore.getState().leagues[leagueId]).toBeUndefined();
  });

  it('clears currentLeagueId when leaving the currently-active league', async () => {
    const leagueId = filledTestLeague();
    await useAppStore.getState().transferCommissioner(leagueId, 'sim-1');
    expect(useAppStore.getState().currentLeagueId).toBe(leagueId);
    await useAppStore.getState().leaveLeague(leagueId);
    expect(useAppStore.getState().currentLeagueId).toBeNull();
  });

  it('leaves a non-commissioner free to leave without any transfer', async () => {
    const leagueId = filledTestLeague();
    await useAppStore.getState().transferCommissioner(leagueId, 'sim-1'); // user is no longer commissioner
    const result = await useAppStore.getState().leaveLeague(leagueId);
    expect(result.ok).toBe(true);
  });
});

// manual v0.2.0 §6 #13: switching just swaps the pointer — every league-scoped screen
// reads through currentLeagueId, so this alone is the whole "switch" operation.
describe('setCurrentLeague (switching)', () => {
  it('swaps which league is active without touching either league\'s data', () => {
    const leagueAId = createTestLeague();
    const leagueBId = createLeague({
      name: 'Second League',
      teamCount: 6,
      isPublic: false,
      userTeamName: 'My Other Team',
      userTeamAbbrev: 'MO',
      userLogoColor: '#4C8DF5',
    });
    expect(useAppStore.getState().currentLeagueId).toBe(leagueBId); // adding a league makes it the current one

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
  it('editing the league name then saving the league logo leaves the name untouched', async () => {
    const leagueId = createTestLeague();
    const { updateSettings, updateLeagueLogo } = useAppStore.getState();
    await updateSettings(leagueId, { leagueName: 'Edited League Name' }); // edit A
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

  it('toggling an unrelated advanced setting survives a subsequent logo save', async () => {
    const leagueId = createTestLeague();
    const { updateSettings, updateLeagueLogo } = useAppStore.getState();
    await updateSettings(leagueId, { hidePicks: true, correlationBlockEnabled: true }); // edit A (multiple toggles)
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
