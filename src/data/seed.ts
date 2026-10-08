import type { NFLGame, WeekId } from '../types';
import { SCHEDULE } from './schedule';
import { toNFLGame } from './propsGenerator';
import { simulateGameResult, type GameResult } from '../engine/settlement';

// The entire season's board (games + prop markets) is generated once at module
// load from the seeded schedule/props generators — deterministic every run.
export const NFL_GAMES: NFLGame[] = SCHEDULE.map(toNFLGame);

export const NFL_GAMES_BY_ID: Record<string, NFLGame> = Object.fromEntries(
  NFL_GAMES.map((g) => [g.id, g]),
);

// Final results for every game are also precomputed up front (deterministic-but-
// random per spec §7) so "Advance Week" only has to *reveal* already-fixed
// outcomes rather than roll new randomness on click.
export const GAME_RESULTS_BY_ID: Record<string, GameResult> = Object.fromEntries(
  NFL_GAMES.map((g) => [g.id, simulateGameResult(g)]),
);

export function gamesForWeek(week: WeekId): NFLGame[] {
  return NFL_GAMES.filter((g) => g.week === week);
}

export function gameById(id: string): NFLGame | undefined {
  return NFL_GAMES_BY_ID[id];
}

export function resultForGame(id: string): GameResult | undefined {
  return GAME_RESULTS_BY_ID[id];
}

