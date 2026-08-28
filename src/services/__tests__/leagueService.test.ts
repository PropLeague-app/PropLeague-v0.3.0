import { describe, it, expect } from 'vitest';
import { createLeague, updateLeagueSettings } from '../leagueService';
import type { LeagueTeam } from '../../types';

function baseLeague() {
  const league = createLeague({
    id: 'league-1',
    name: 'Test League',
    teamCount: 4,
    isPublic: false,
    userTeamName: 'My Team',
    userTeamAbbrev: 'MY',
    userLogoColor: '#4C8DF5',
  });
  const extraTeams: LeagueTeam[] = Array.from({ length: 3 }, (_, i) => ({
    ...league.teams[0],
    id: `sim-${i + 1}`,
    isUser: false,
    isSimulated: true,
  }));
  return { ...league, teams: [...league.teams, ...extraTeams] };
}

// manual v0.2.0 §3 #7: toggling buy-in on must create the pool immediately, not wait
// for the next Advance Week — otherwise "show real $ at stake" has nothing to read
// mid-week and silently renders nothing.
describe('updateLeagueSettings — eager prize pool creation', () => {
  it('creates the pool the moment buyInEnabled turns on', () => {
    const league = baseLeague();
    expect(league.prizePool).toBeNull();
    const updated = updateLeagueSettings(league, { buyInEnabled: true, buyInAmount: 20 });
    expect(updated.prizePool).not.toBeNull();
    expect(updated.prizePool!.current).toBeCloseTo(4 * 20, 5);
  });

  it('does not create a pool for an unrelated settings change', () => {
    const league = baseLeague();
    const updated = updateLeagueSettings(league, { weeklyCredits: 150 });
    expect(updated.prizePool).toBeNull();
  });

  it('does not clobber an already-running pool when settings change again', () => {
    const league = baseLeague();
    const withPool = updateLeagueSettings(league, { buyInEnabled: true, buyInAmount: 20 });
    const again = updateLeagueSettings(withPool, { weeklyCredits: 150 });
    expect(again.prizePool).toEqual(withPool.prizePool);
  });

  it('leaves a pool alone (does not null it out) if buy-in is turned back off', () => {
    const league = baseLeague();
    const withPool = updateLeagueSettings(league, { buyInEnabled: true, buyInAmount: 20 });
    const disabled = updateLeagueSettings(withPool, { buyInEnabled: false });
    expect(disabled.prizePool).toEqual(withPool.prizePool);
  });

  // manual v0.2.1 §5 #7: the natural commissioner order is "toggle buy-in on" (its own
  // click, buyInAmount still the $0 default) *then* "set the per-team amount" (a
  // separate edit) — the pool must not get stuck at the stale $0 it briefly existed
  // at, since nothing has actually happened yet (no week has settled).
  it('picks up a buy-in amount set after the toggle, as long as no week has settled yet', () => {
    const league = baseLeague();
    const toggledOn = updateLeagueSettings(league, { buyInEnabled: true }); // amount still defaults to 0 here
    expect(toggledOn.prizePool!.initial).toBe(0);
    const withAmount = updateLeagueSettings(toggledOn, { buyInAmount: 20 });
    expect(withAmount.prizePool!.initial).toBeCloseTo(4 * 20, 5);
    expect(withAmount.prizePool!.current).toBeCloseTo(4 * 20, 5);
  });

  it('stops recomputing the pool once a week has actually settled', () => {
    const league = baseLeague();
    const withPool = updateLeagueSettings(league, { buyInEnabled: true, buyInAmount: 20 });
    const settled = { ...withPool, prizePool: { ...withPool.prizePool!, history: [{ week: 1, poolBefore: 80, poolAfter: 85, netRealPL: 5 }] } };
    const changedAmount = updateLeagueSettings(settled, { buyInAmount: 999 });
    expect(changedAmount.prizePool!.initial).toBe(80); // untouched — a real week's history exists now
  });
});
