import type { League } from '../types';
import { advanceLeagueWeek } from '../engine/simulateWeek';
import { resetLeagueSeason } from './leagueService';
import { generateAutoLineup } from '../engine/autoLineup';
import { ClaimTracker } from '../engine/duplicatePicks';
import { rosterKey } from '../engine/rosterSlots';
import { gamesForWeek } from '../data/seed';

export function advanceWeek(league: League): League {
  return advanceLeagueWeek(league);
}

/** Multi-week dev jump (manual v0.03 §5 #10) — unlike a single Advance Week click,
 * this auto-fills the user's own lineups for skipped weeks (when the league's
 * autoFillUserLineupsWhenSimulating setting is on) so the jump produces realistic
 * data instead of the user scoring a missed-lineup penalty every week. The current,
 * about-to-be-settled week is filled here first (advanceLeagueWeek's auto-fill only
 * covers weeks it's advancing *into*); every subsequent week is handled by the
 * `autoFillUser` option as the loop advances. */
export function simulateToWeek(league: League, targetWeek: number): League {
  let current = league;

  if (current.settings.autoFillUserLineupsWhenSimulating && current.seasonPhase !== 'complete') {
    const userTeam = current.teams.find((t) => t.isUser);
    if (userTeam) {
      const key = rosterKey(userTeam.id, current.currentWeek);
      const existing = current.rostersByTeamWeek[key];
      if (!existing || !existing.submitted) {
        const games = gamesForWeek(current.currentWeek);
        const claims = new ClaimTracker(current, current.currentWeek);
        const roster = generateAutoLineup(userTeam.id, current.currentWeek, current.settings, games, (g, m, p, s, pt) =>
          claims.isTaken(g, m, p, s, pt),
        );
        current = { ...current, rostersByTeamWeek: { ...current.rostersByTeamWeek, [key]: roster } };
      }
    }
  }

  // Stops once the regular season has passed targetWeek — but once the postseason
  // starts, currentWeek is no longer a number, so this condition simply never fires
  // again and the jump runs on to a champion. That's deliberate: playoff weeks aren't
  // individually addressable by number, so reaching (or exceeding) the regular season's
  // actual length is the signal to "play out the rest of the season", auto-fill and
  // all — otherwise the auto-fill toggle above would be unreachable for every playoff
  // round, since a single Advance Week click never auto-fills (manual v0.03 §5 #10).
  let guard = 0;
  while (guard < 40) {
    guard++;
    if (current.seasonPhase === 'complete') break;
    if (current.seasonPhase === 'regular' && typeof current.currentWeek === 'number' && current.currentWeek > targetWeek) break;
    const next = advanceLeagueWeek(current, { autoFillUser: true });
    if (next === current) break;
    current = next;
  }
  return current;
}

export function resetSeason(league: League): League {
  return resetLeagueSeason(league);
}
