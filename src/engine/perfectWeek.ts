// Perfect weeks: a settled week where a team did not lose a single bet.
//
// Counts only a genuine, legal roster: every slot filled, all the weekly credits placed, enough
// different games, at least one win, no losses and nothing still pending. Voids and pushes are
// fine. A roster that is mostly empty, or that was penalized for being incomplete, never
// qualifies, no matter how its few picks did. The week also has to be final (its matchup
// decided), so nothing lights up early or on a partly graded week.
import type { League, LeagueSettings, WeeklyRoster, WeekId } from '../types';
import { rosterKey } from './rosterSlots';
import { rosterPenalties } from './penalties';

const EPS = 0.01;

export function isPerfectWeek(roster: WeeklyRoster | undefined, settings: LeagueSettings, weekFinal: boolean): boolean {
  if (!weekFinal || !roster || roster.slots.length === 0) return false;
  let wins = 0;
  let staked = 0;
  const games = new Set<string>();
  for (const slot of roster.slots) {
    const w = slot.wager;
    if (!w) return false; // an empty slot is an incomplete lineup
    if (w.status === 'pending' || w.status === 'lost') return false;
    if (w.status === 'won') wins++;
    staked += w.stake;
    games.add(w.gameId);
  }
  if (wins === 0) return false;
  if (Math.abs(staked - settings.weeklyCredits) > EPS) return false; // credits left unplaced, or overspent
  if (games.size < (settings.minGamesPerRoster ?? 2)) return false;
  // A roster the invalid-roster penalty hit (when that is on) is not a clean week.
  const pen = rosterPenalties(roster, settings);
  if (pen.invalidSlotIds.size > 0 || pen.fee > 0) return false;
  return true;
}

/** Whether the matchup for this week is decided (settle-week only sets these once the week is done). */
function weekIsFinal(league: League, week: WeekId, teamId: string): boolean {
  const matchups = league.matchupsByWeek[week as keyof typeof league.matchupsByWeek] ?? [];
  const m = matchups.find((x) => x.teamAId === teamId || x.teamBId === teamId);
  return !!m && (m.winnerId != null || m.isTie);
}

export function isTeamWeekPerfect(league: League, teamId: string, week: WeekId): boolean {
  return isPerfectWeek(league.rostersByTeamWeek[rosterKey(teamId, week)], league.settings, weekIsFinal(league, week, teamId));
}

/** Every perfect week a team has, oldest first. Only weeks whose rosters are loaded can be judged. */
export function perfectWeeksForTeam(league: League, teamId: string): WeekId[] {
  const weeks = Object.keys(league.matchupsByWeek) as unknown as WeekId[];
  return weeks.filter((w) => isTeamWeekPerfect(league, teamId, w)).sort((a, b) => Number(a) - Number(b));
}
