// Server-side (Deno edge function) port of src/engine/autoLineup.ts +
// src/engine/random.ts + src/engine/rosterSlots.ts's buildEmptySlots, plus a
// trimmed getPlayerPropGroups from src/services/oddsService.ts -- same
// duplicated-not-imported pattern as playoffLogic.ts (see chat, Sept 2026,
// generate-bot-lineups).
//
// getPlayerPropGroups is trimmed, not ported verbatim: the client version falls
// back to a static mock player dataset (src/data/players.ts) when a market
// doesn't already carry playerName/playerPosition/playerTeamId -- that fallback
// exists for the simulated dev-panel dataset, and is unreachable for real data,
// since realGamesForBots.ts's mapPlayerPropMarkets always sets those three
// fields when it creates a market in the first place (real markets "carry their
// own player info", per the original file's comment). Omitting it avoids pulling
// the whole mock dataset into this function's bundle for a branch that can never
// fire here. Same reasoning for the injury tag the client version also attaches:
// nothing in generateAutoLineup's picking logic below reads PlayerPropGroup.injury
// at all, so it's dropped rather than faked with a random tag that would mean
// nothing.

import type { MarketKey, NFLGame, Position } from './realGamesForBots.ts';

export type Rng = () => number;

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function stringToSeed(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

function createRng(seedInput: number | string): Rng {
  const seed = typeof seedInput === 'string' ? stringToSeed(seedInput) : seedInput;
  return mulberry32(seed);
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function shuffle<T>(rng: Rng, items: readonly T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const SLOT_ORDER: (Position | 'ML')[] = ['QB', 'RB', 'WR', 'TE', 'K', 'ML'];

interface RosterSlotState {
  slotId: string;
  position: Position | 'ML';
  wager: Wager | null;
}

export interface Wager {
  id: string;
  slotId: string;
  gameId: string;
  marketKey: MarketKey;
  playerId?: string;
  playerName?: string;
  side: string;
  point?: number;
  oddsAtPlacement: number;
  stake: number;
  placedAt: string;
  status: 'pending';
  settledProfit: null;
}

export interface AutoLineupSettings {
  weeklyCredits: number;
  lineupSlots: Record<Position | 'ML', number>;
  minBetPerSlot: number;
  maxMLBet: number;
  singleBetCapPct: number;
}

function buildEmptySlots(lineupSlots: Record<Position | 'ML', number>): RosterSlotState[] {
  const slots: RosterSlotState[] = [];
  for (const position of SLOT_ORDER) {
    const count = lineupSlots[position] ?? 0;
    for (let i = 0; i < count; i++) {
      slots.push({ slotId: `${position}-${i + 1}`, position, wager: null });
    }
  }
  return slots;
}

interface PlayerPropGroup {
  playerId: string;
  playerName: string;
  position: Position;
  teamId: string;
  markets: { key: MarketKey; outcomes: { name: string; price: number; point?: number; playerId?: string }[] }[];
}

function getPlayerPropGroups(game: NFLGame): PlayerPropGroup[] {
  const groups = new Map<string, PlayerPropGroup>();
  for (const bookmaker of game.bookmakers) {
    for (const market of bookmaker.markets) {
      if (!market.playerId) continue;
      if (!market.playerName || !market.playerPosition || !market.playerTeamId) continue; // see header -- unreachable for real data
      if (!groups.has(market.playerId)) {
        groups.set(market.playerId, {
          playerId: market.playerId,
          playerName: market.playerName,
          position: market.playerPosition,
          teamId: market.playerTeamId,
          markets: [],
        });
      }
      groups.get(market.playerId)!.markets.push({ key: market.key, outcomes: market.outcomes });
    }
  }
  return Array.from(groups.values());
}

/** Server-side port of src/engine/autoLineup.ts's generateAutoLineup, same
 * signature/behavior, just against real games/odds instead of simulated ones. */
export function generateAutoLineup(
  teamId: string,
  week: string,
  settings: AutoLineupSettings,
  games: NFLGame[],
  isPickTaken: (gameId: string, marketKey: MarketKey, playerId: string | undefined, side: string, point: number | undefined) => boolean = () => false,
): { slots: RosterSlotState[] } {
  const rng = createRng(`${teamId}-${week}-autolineup`);
  const slots = buildEmptySlots(settings.lineupSlots);
  const perSlot = settings.weeklyCredits / slots.length;
  const stakes = slots.map(() => perSlot);

  const mlIndex = slots.findIndex((s) => s.position === 'ML');
  const maxFor = (i: number) => (i === mlIndex ? settings.maxMLBet : settings.weeklyCredits * settings.singleBetCapPct);
  for (let t = 0; t < 6; t++) {
    const i = Math.floor(rng() * slots.length);
    const j = Math.floor(rng() * slots.length);
    if (i === j) continue;
    const amount = Math.round(rng() * 200) / 100;
    const newI = stakes[i] - amount;
    const newJ = stakes[j] + amount;
    if (newI < settings.minBetPerSlot || newJ > maxFor(j)) continue;
    stakes[i] = newI;
    stakes[j] = newJ;
  }

  const usedPlayerIds = new Set<string>();
  const gamesShuffled = shuffle(rng, games);
  const wagers: (Wager | null)[] = slots.map(() => null);

  slots.forEach((slot, idx) => {
    const stake = Math.round(stakes[idx] * 100) / 100;
    if (slot.position === 'ML') {
      for (let attempt = 0; attempt < 15; attempt++) {
        const game = pick(rng, gamesShuffled);
        if (!game.bookmakers[0]) continue;
        const useSpread = rng() < 0.5;
        const market = game.bookmakers[0].markets.find((m) => m.key === (useSpread ? 'spreads' : 'h2h'));
        if (!market) continue;
        const outcome = pick(rng, market.outcomes);
        if (isPickTaken(game.id, market.key, undefined, outcome.name, outcome.point)) continue;
        wagers[idx] = makeWager(slot.slotId, game.id, market.key, outcome.name, outcome.price, stake, outcome.point);
        break;
      }
      return;
    }

    const position = slot.position as Position;
    for (let attempt = 0; attempt < 25; attempt++) {
      const game = pick(rng, gamesShuffled);
      const groups = getPlayerPropGroups(game).filter((g) => g.position === position && !usedPlayerIds.has(g.playerId));
      if (groups.length === 0) continue;
      const group = pick(rng, groups);
      const market = pick(rng, group.markets);
      const outcome = pick(rng, market.outcomes);
      if (isPickTaken(game.id, market.key, group.playerId, outcome.name, outcome.point)) continue;
      usedPlayerIds.add(group.playerId);
      wagers[idx] = makeWager(slot.slotId, game.id, market.key, outcome.name, outcome.price, stake, outcome.point, group.playerId, group.playerName);
      break;
    }
  });

  return { slots: slots.map((slot, idx) => ({ ...slot, wager: wagers[idx] })) };
}

function makeWager(
  slotId: string,
  gameId: string,
  marketKey: MarketKey,
  side: string,
  price: number,
  stake: number,
  point?: number,
  playerId?: string,
  playerName?: string,
): Wager {
  return {
    id: `${slotId}-${gameId}-${playerId ?? 'game'}`,
    slotId,
    gameId,
    marketKey,
    playerId,
    playerName,
    side,
    point,
    oddsAtPlacement: price,
    stake,
    placedAt: new Date().toISOString(),
    status: 'pending',
    settledProfit: null,
  };
}
