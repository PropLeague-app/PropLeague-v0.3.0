import type { League, LeagueTeam, Matchup } from '../types';

export interface PendingResultReveal {
  league: League;
  userTeam: LeagueTeam;
  opponentTeam: LeagueTeam;
  matchup: Matchup;
  result: 'won' | 'lost' | 'tied';
}

/** Every one of the signed-in user's own matchups that's now decided (settle-week
 * only ever sets winnerId/isTie once its Tuesday-morning reveal gate has passed --
 * see that function's RESULTS_REVEAL_CUTOFF_HOUR_ET, Sept 2026) but hasn't been
 * shown to them yet (see WeeklyResultReveal, mounted in AppShellLayout). A user in
 * several leagues can have one pending reveal per league at once, so this returns a
 * list rather than a single value, sorted oldest week first so someone who's been
 * away a while sees them in the order they actually happened. matchupsByWeek holds
 * every week the league has ever played (fetchLeagueMatchups has no week filter),
 * not just the current one, so a week that just got its Tuesday reveal is still
 * found here even after currentWeek has already moved on to the next one. */
export function getPendingResultReveals(
  leagues: Record<string, League>,
  seenMatchupResultIds: Record<string, true>,
): PendingResultReveal[] {
  const reveals: PendingResultReveal[] = [];
  for (const league of Object.values(leagues)) {
    const userTeam = league.teams.find((t) => t.isUser);
    if (!userTeam) continue;
    for (const matchups of Object.values(league.matchupsByWeek)) {
      for (const matchup of matchups) {
        if (matchup.winnerId == null && !matchup.isTie) continue; // not decided yet
        if (matchup.teamAId !== userTeam.id && matchup.teamBId !== userTeam.id) continue;
        if (seenMatchupResultIds[matchup.id]) continue;
        const opponentId = matchup.teamAId === userTeam.id ? matchup.teamBId : matchup.teamAId;
        const opponentTeam = league.teams.find((t) => t.id === opponentId);
        if (!opponentTeam) continue;
        const result: PendingResultReveal['result'] = matchup.isTie ? 'tied' : matchup.winnerId === userTeam.id ? 'won' : 'lost';
        reveals.push({ league, userTeam, opponentTeam, matchup, result });
      }
    }
  }
  return reveals.sort((a, b) => Number(a.matchup.week) - Number(b.matchup.week) || a.league.name.localeCompare(b.league.name));
}
