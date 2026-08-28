import type { LeagueSettings, NFLGame, Position, Wager, WeeklyRoster, WeekId } from '../types';
import { buildEmptySlots } from './rosterSlots';
import { getPlayerPropGroups } from '../services/oddsService';
import { createRng, pick, shuffle } from './random';

/**
 * Auto-generates a valid, fully-allocated lineup for a simulated league member.
 * Starts from a guaranteed-valid even split ($100 / 8 slots = $12.50, no
 * remainder) then jitters stakes between slots so lineups don't look identical.
 */
export function generateAutoLineup(
  teamId: string,
  week: WeekId,
  settings: LeagueSettings,
  games: NFLGame[],
  isPickTaken: (gameId: string, marketKey: Wager['marketKey'], playerId: string | undefined, side: string, point: number | undefined) => boolean = () => false,
): WeeklyRoster {
  const rng = createRng(`${teamId}-${week}-autolineup`);
  const slots = buildEmptySlots(settings.lineupSlots);
  const perSlot = settings.weeklyCredits / slots.length;
  const stakes = slots.map(() => perSlot);

  // A few random jitter transfers between slots, staying within bounds.
  const mlIndex = slots.findIndex((s) => s.position === 'ML');
  const maxFor = (i: number) => (i === mlIndex ? settings.maxMLBet : settings.weeklyCredits * settings.singleBetCapPct);
  for (let t = 0; t < 6; t++) {
    const i = Math.floor(rng() * slots.length);
    const j = Math.floor(rng() * slots.length);
    if (i === j) continue;
    const amount = Math.round(rng() * 200) / 100; // up to $2.00
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
      const groups = getPlayerPropGroups(game).filter(
        (g) => g.position === position && !usedPlayerIds.has(g.playerId),
      );
      if (groups.length === 0) continue;
      const group = pick(rng, groups);
      const market = pick(rng, group.markets);
      const outcome = pick(rng, market.outcomes);
      if (isPickTaken(game.id, market.key, group.playerId, outcome.name, outcome.point)) continue;
      usedPlayerIds.add(group.playerId);
      wagers[idx] = makeWager(
        slot.slotId,
        game.id,
        market.key,
        outcome.name,
        outcome.price,
        stake,
        outcome.point,
        group.playerId,
        group.playerName,
      );
      break;
    }
  });

  const filledSlots = slots.map((slot, idx) => ({ ...slot, wager: wagers[idx] }));
  return { week, teamId, slots: filledSlots, submitted: true };
}

function makeWager(
  slotId: string,
  gameId: string,
  marketKey: Wager['marketKey'],
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
