// Skunked weeks: a settled week where a team's whole lineup went the wrong way.
//
// The mirror of a perfect week, and deliberately rarer than the weekly Bagel Watch moment:
// every slot filled, nothing pending, at least three losses and not a single win or push. Voids
// are ignored (a void is a pick that never counted either way). A roster that is mostly empty
// never qualifies, so a team that simply forgot to play is not "skunked". The week also has to be
// final (its matchup decided), so nothing shows up early or on a partly graded week.
import type { League, WeeklyRoster, WeekId } from '../types';
import { rosterKey } from './rosterSlots';

/** The fewest losing picks that can make a week a skunk. */
export const SKUNKED_MIN_LOSSES = 3;

export function isSkunkedWeek(roster: WeeklyRoster | undefined, weekFinal: boolean): boolean {
  if (!weekFinal || !roster || roster.slots.length === 0) return false;
  let losses = 0;
  for (const slot of roster.slots) {
    const w = slot.wager;
    if (!w) return false; // an empty slot is an incomplete lineup
    if (w.status === 'pending' || w.status === 'won' || w.status === 'push') return false;
    if (w.status === 'lost') losses++;
  }
  return losses >= SKUNKED_MIN_LOSSES;
}

/** Whether the matchup for this week is decided (settle-week only sets these once the week is done). */
function weekIsFinal(league: League, week: WeekId, teamId: string): boolean {
  const matchups = league.matchupsByWeek[week as keyof typeof league.matchupsByWeek] ?? [];
  const m = matchups.find((x) => x.teamAId === teamId || x.teamBId === teamId);
  return !!m && (m.winnerId != null || m.isTie);
}

export function isTeamWeekSkunked(league: League, teamId: string, week: WeekId): boolean {
  return isSkunkedWeek(league.rostersByTeamWeek[rosterKey(teamId, week)], weekIsFinal(league, week, teamId));
}
