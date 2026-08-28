import type { DaySlot, WeekId } from '../types';
import { NFL_TEAMS } from './nflTeams';
import { createRng, shuffle } from '../engine/random';

export interface ScheduledGame {
  id: string;
  week: WeekId;
  daySlot: DaySlot;
  kickoff: string; // ISO
  homeTeamId: string;
  awayTeamId: string;
}

// 2026 NFL regular season opens Thursday, Sept 10 2026 (the Thursday after Labor Day).
const SEASON_OPENER = new Date('2026-09-10T00:15:00.000Z'); // 8:15pm ET Thu

function weekStart(week: number): Date {
  const d = new Date(SEASON_OPENER);
  d.setUTCDate(d.getUTCDate() + (week - 1) * 7);
  return d;
}

function kickoffFor(week: number, daySlot: DaySlot): string {
  const start = weekStart(week);
  const d = new Date(start);
  switch (daySlot) {
    case 'TNF':
      d.setUTCHours(0, 15, 0, 0); // Thu 8:15pm ET
      break;
    case 'SUN_EARLY':
      d.setUTCDate(d.getUTCDate() + 3);
      d.setUTCHours(17, 0, 0, 0); // Sun 1:00pm ET
      break;
    case 'SUN_LATE':
      d.setUTCDate(d.getUTCDate() + 3);
      d.setUTCHours(20, 5, 0, 0); // Sun 4:05pm ET
      break;
    case 'SNF':
      d.setUTCDate(d.getUTCDate() + 3);
      d.setUTCHours(0, 20, 0, 0); // Sun 8:20pm ET (next UTC day)
      d.setUTCDate(d.getUTCDate() + 1);
      break;
    case 'MNF':
      d.setUTCDate(d.getUTCDate() + 4);
      d.setUTCHours(0, 15, 0, 0); // Mon 8:15pm ET
      d.setUTCDate(d.getUTCDate() + 1);
      break;
  }
  return d.toISOString();
}

/**
 * Circle-method round robin across all 32 teams. A true bye-free schedule only
 * exists for 31 unique rounds; we take the first 18 as the regular season. This
 * is a simplification (real NFL teams get bye weeks) made so every fantasy week
 * has a full 16-game slate to generate props from.
 */
function roundRobinRounds(teamIds: string[]): [string, string][][] {
  const rotating = teamIds.slice(1);
  const fixed = teamIds[0];
  const rounds: [string, string][][] = [];
  for (let round = 0; round < teamIds.length - 1; round++) {
    const order = [fixed, ...rotating];
    const pairings: [string, string][] = [];
    for (let i = 0; i < order.length / 2; i++) {
      pairings.push([order[i], order[order.length - 1 - i]]);
    }
    rounds.push(pairings);
    rotating.unshift(rotating.pop()!);
  }
  return rounds;
}

const DAY_SLOT_ORDER: DaySlot[] = [
  'TNF',
  'SUN_EARLY', 'SUN_EARLY', 'SUN_EARLY', 'SUN_EARLY', 'SUN_EARLY',
  'SUN_EARLY', 'SUN_EARLY', 'SUN_EARLY', 'SUN_EARLY',
  'SUN_LATE', 'SUN_LATE', 'SUN_LATE', 'SUN_LATE',
  'SNF',
  'MNF',
];

function buildWeekGames(week: number, pairings: [string, string][], seed: string): ScheduledGame[] {
  const rng = createRng(seed);
  const shuffledPairings = shuffle(rng, pairings);
  return shuffledPairings.map(([teamA, teamB], i) => {
    const daySlot = DAY_SLOT_ORDER[i] ?? 'SUN_EARLY';
    const homeFirst = rng() < 0.5;
    const homeTeamId = homeFirst ? teamA : teamB;
    const awayTeamId = homeFirst ? teamB : teamA;
    return {
      id: `W${week}_${awayTeamId}_AT_${homeTeamId}`,
      week,
      daySlot,
      kickoff: kickoffFor(week, daySlot),
      homeTeamId,
      awayTeamId,
    };
  });
}

function buildPlayoffWeekGames(
  weekLabel: WeekId,
  weekNumber: number,
  gameCount: number,
  teamPool: string[],
  seed: string,
): ScheduledGame[] {
  const rng = createRng(seed);
  const teams = shuffle(rng, teamPool).slice(0, gameCount * 2);
  const slots: DaySlot[] = ['SUN_EARLY', 'SUN_EARLY', 'SUN_LATE', 'SUN_LATE', 'SNF', 'MNF'];
  const games: ScheduledGame[] = [];
  for (let i = 0; i < gameCount; i++) {
    const homeTeamId = teams[i * 2];
    const awayTeamId = teams[i * 2 + 1];
    const daySlot = slots[i % slots.length];
    games.push({
      id: `${weekLabel}_${awayTeamId}_AT_${homeTeamId}`,
      week: weekLabel,
      daySlot,
      kickoff: kickoffFor(weekNumber, daySlot),
      homeTeamId,
      awayTeamId,
    });
  }
  return games;
}

export function generateFullSchedule(): ScheduledGame[] {
  const teamIds = NFL_TEAMS.map((t) => t.id);
  const rounds = roundRobinRounds(teamIds);
  const games: ScheduledGame[] = [];

  for (let week = 1; week <= 18; week++) {
    games.push(...buildWeekGames(week, rounds[week - 1], `schedule-week-${week}`));
  }

  // Playoff-week NFL slates (flavor/browsing only — the PropLeague bracket itself
  // only spans DIV + CONF per spec §4, WC is shown on the Slate tab for realism).
  games.push(...buildPlayoffWeekGames('WC', 19, 6, teamIds, 'schedule-wc'));
  games.push(...buildPlayoffWeekGames('DIV', 20, 4, teamIds, 'schedule-div'));
  games.push(...buildPlayoffWeekGames('CONF', 21, 2, teamIds, 'schedule-conf'));

  return games;
}

export const SCHEDULE = generateFullSchedule();

export function gamesForWeek(week: WeekId): ScheduledGame[] {
  return SCHEDULE.filter((g) => g.week === week);
}
