// Odds/schedule data-access layer. Everything reads from the local seeded mock
// dataset today; the function signatures are shaped so a real Odds API fetch
// can replace the bodies later without touching any calling UI code.

import type { AltLine, InjuryTag, NFLGame, OddsMarket, OddsOutcome, PlayerPropGroup, WeekId } from '../types';
import { weekOrder } from '../types';
import { gamesForWeek as gamesForWeekBase, gameById as gameByIdBase, resultForGame } from '../data/seed';
import { playerById } from '../data/players';
import { createRng, chance, rngInt } from '../engine/random';
import { normalizeAmericanOdds } from '../engine/oddsMath';

function deriveInjuryTag(gameId: string, playerId: string): InjuryTag {
  const rng = createRng(`${gameId}-${playerId}-injury`);
  if (chance(rng, 0.02)) return 'O';
  if (chance(rng, 0.04)) return 'D';
  if (chance(rng, 0.12)) return 'Q';
  return null;
}

/** Reveals final score/status for games in weeks already advanced past, or for a game
 * the dev-panel game stepper has manually pushed to 'live'/'final' ahead of the full
 * weekly settlement (manual §6 — demo-only, doesn't touch wager settlement). */
function revealGame(game: NFLGame, currentWeek: WeekId, override?: 'live' | 'final'): NFLGame {
  if (weekOrder(game.week) >= weekOrder(currentWeek)) {
    if (!override) return game;
    const result = resultForGame(game.id);
    if (!result) return game;
    return { ...game, status: override, homeScore: result.homeScore, awayScore: result.awayScore };
  }
  const result = resultForGame(game.id);
  if (!result) return game;
  return { ...game, status: 'final', homeScore: result.homeScore, awayScore: result.awayScore };
}

// --- Line movement (manual §6) -----------------------------------------------
// A new "session" (one full page load) gets its own drift seed, so odds shift a
// little each refresh but stay perfectly stable *within* a load — every read of the
// same market during one session sees identical numbers. Never touches a wager's
// already-stored oddsAtPlacement, only what's displayed for markets not yet bet on.
const LINE_MOVEMENT_SESSION_SEED = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

function driftOutcome(outcome: OddsOutcome, salt: string): OddsOutcome {
  const rng = createRng(`${LINE_MOVEMENT_SESSION_SEED}-${salt}-${outcome.name}-${outcome.point ?? ''}`);
  const delta = rngInt(rng, -8, 8);
  const normalized = normalizeAmericanOdds(outcome.price + delta);
  const clamped = normalized > 0 ? Math.min(300, normalized) : Math.max(-350, normalized);
  return { ...outcome, price: clamped };
}

function driftAltLine(alt: AltLine, salt: string): AltLine {
  return { ...alt, outcomes: alt.outcomes.map((o) => driftOutcome(o, salt)) };
}

function driftMarket(market: OddsMarket, gameId: string): OddsMarket {
  const salt = `${gameId}-${market.key}-${market.playerId ?? ''}`;
  return {
    ...market,
    outcomes: market.outcomes.map((o) => driftOutcome(o, salt)),
    altLines: market.altLines
      ? [driftAltLine(market.altLines[0], `${salt}-alt-lo`), driftAltLine(market.altLines[1], `${salt}-alt-hi`)]
      : undefined,
  };
}

/** Applies this session's line movement to an upcoming game's odds. Games that have
 * already started (live/final) don't move — there's nothing left to bet on them. */
function applyLineMovement(game: NFLGame, enabled: boolean): NFLGame {
  if (!enabled || game.status !== 'upcoming') return game;
  return {
    ...game,
    bookmakers: game.bookmakers.map((bm) => ({ ...bm, markets: bm.markets.map((m) => driftMarket(m, game.id)) })),
  };
}

export function getSlate(
  week: WeekId,
  currentWeek: WeekId,
  lineMovementEnabled = true,
  overrides?: Record<string, 'live' | 'final'>,
): NFLGame[] {
  return gamesForWeekBase(week).map((g) => applyLineMovement(revealGame(g, currentWeek, overrides?.[g.id]), lineMovementEnabled));
}

export function getGame(
  gameId: string,
  currentWeek: WeekId,
  lineMovementEnabled = true,
  overrides?: Record<string, 'live' | 'final'>,
): NFLGame | undefined {
  const game = gameByIdBase(gameId);
  return game ? applyLineMovement(revealGame(game, currentWeek, overrides?.[gameId]), lineMovementEnabled) : undefined;
}

export function getPlayerPropGroups(game: NFLGame): PlayerPropGroup[] {
  const groups = new Map<string, PlayerPropGroup>();
  for (const bookmaker of game.bookmakers) {
    for (const market of bookmaker.markets) {
      if (!market.playerId) continue;
      if (!groups.has(market.playerId)) {
        const player = playerById(market.playerId);
        groups.set(market.playerId, {
          playerId: player.id,
          playerName: player.name,
          position: player.position,
          teamId: player.nflTeamId,
          injury: deriveInjuryTag(game.id, player.id),
          markets: [],
        });
      }
      groups.get(market.playerId)!.markets.push(market);
    }
  }
  return Array.from(groups.values());
}

/** Current live price for the exact outcome a wager was placed on (same market/side/
 * point, checking alt lines too) — used to show movement indicators on roster cards.
 * Null once the game has locked (nothing left to compare against). */
export function currentOddsForWager(
  gameId: string,
  currentWeek: WeekId,
  marketKey: OddsMarket['key'],
  playerId: string | undefined,
  side: string,
  point: number | undefined,
): number | null {
  const game = getGame(gameId, currentWeek);
  if (!game || game.status !== 'upcoming') return null;
  const market = game.bookmakers.flatMap((b) => b.markets).find((m) => m.key === marketKey && m.playerId === playerId);
  if (!market) return null;
  const candidates = [market, ...(market.altLines ?? [])];
  for (const candidate of candidates) {
    const outcome = candidate.outcomes.find((o) => o.name === side && (o.point ?? undefined) === point);
    if (outcome) return outcome.price;
  }
  return null;
}

export function getGameMarkets(game: NFLGame): { h2h: OddsMarket | undefined; spreads: OddsMarket | undefined; totals: OddsMarket | undefined } {
  const all = game.bookmakers.flatMap((b) => b.markets);
  return {
    h2h: all.find((m) => m.key === 'h2h'),
    spreads: all.find((m) => m.key === 'spreads'),
    totals: all.find((m) => m.key === 'totals'),
  };
}
