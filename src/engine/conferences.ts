import type { Conference } from '../types';
import type { Rng } from './random';
import { shuffle } from './random';

/** Per manual §3.1: conferences require an even league-wide team count. */
export function conferencesEligible(teamCount: number): boolean {
  return teamCount % 2 === 0 && teamCount >= 4;
}

const TWO_CONF_NAMES = ['East', 'West'];
const FOUR_CONF_NAMES = ['East', 'West', 'North', 'South'];

export function defaultConferences(count: 2 | 4): Conference[] {
  const names = count === 4 ? FOUR_CONF_NAMES : TWO_CONF_NAMES;
  return names.slice(0, count).map((name, i) => ({ id: String.fromCharCode(65 + i), name }));
}

/** Auto-random assignment: shuffles then deals teams round-robin across conferences
 * so sizes differ by at most one. */
export function assignConferencesRandomly(teamIds: string[], conferences: Conference[], rng: Rng): Record<string, string> {
  const shuffled = shuffle(rng, teamIds);
  const assignment: Record<string, string> = {};
  shuffled.forEach((teamId, i) => {
    assignment[teamId] = conferences[i % conferences.length].id;
  });
  return assignment;
}

/** manual v0.2.1 §4 #4: nothing previously stopped a commissioner from reassigning
 * teams one at a time until every team sat in a single conference — the schedule
 * generator and playoff seeding both assume conferences stay the same size, so an
 * unbalanced split isn't just cosmetically wrong, it silently breaks the
 * conference-weighted schedule. Called before committing a batch of reassignments;
 * every defined conference must end up with the exact same team count. */
export function conferencesBalanced(teams: { conferenceId: string | null }[], conferences: Conference[]): boolean {
  if (conferences.length === 0) return true;
  const counts = conferences.map((c) => teams.filter((t) => t.conferenceId === c.id).length);
  return counts.every((count) => count === counts[0]);
}
