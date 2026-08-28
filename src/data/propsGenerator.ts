import type { AltLine, MarketKey, NFLGame, OddsBookmaker, OddsMarket, Player, Position } from '../types';
import type { ScheduledGame } from './schedule';
import { playersByTeam } from './players';
import { nflTeamById } from './nflTeams';
import { createRng, rngFloat, rngInt, type Rng } from '../engine/random';
import { normalizeAmericanOdds } from '../engine/oddsMath';

export const MARKET_LABELS: Record<MarketKey, string> = {
  h2h: 'Moneyline',
  spreads: 'Spread',
  totals: 'Total Points',
  player_pass_yds: 'Passing Yards',
  player_pass_tds: 'Passing TDs',
  player_pass_interceptions: 'Interceptions',
  player_rush_yds: 'Rushing Yards',
  player_rush_attempts: 'Rush Attempts',
  player_anytime_td: 'Anytime TD',
  player_reception_yds: 'Receiving Yards',
  player_receptions: 'Receptions',
  player_kicking_points: 'Kicking Points',
  player_field_goals: 'Field Goals Made',
};

/** Compact stat-context suffix for player-prop wagers (manual v0.1.1 §3 #6) — used
 * wherever a wager needs to read as a complete sentence in a tight space ("Puka Nacua
 * over 68 rec yds"), instead of the bare number a market's `point` alone would show.
 * Game-level markets (h2h/spreads/totals) aren't included: their side text (a team
 * abbrev, or Over/Under against a whole-game total) is already self-explanatory. */
export const MARKET_SHORT_LABELS: Partial<Record<MarketKey, string>> = {
  player_pass_yds: 'pass yds',
  player_pass_tds: 'pass TDs',
  player_pass_interceptions: 'INTs',
  player_rush_yds: 'rush yds',
  player_rush_attempts: 'rush att',
  player_anytime_td: 'anytime TD',
  player_reception_yds: 'rec yds',
  player_receptions: 'receptions',
  player_kicking_points: 'kicking pts',
  player_field_goals: 'FGs made',
};

/** Renders a wager as a compact, self-explanatory phrase — "Puka Nacua over 68 rec
 * yds" rather than just "Puka Nacua Over 68" (manual v0.1.1 §3 #6). Used wherever
 * wagers display compactly: matchup screen, weekly moments, bet history, activity
 * feed settled-bet items, and payout/leaderboard cards. */
export function wagerCompactLabel(wager: { marketKey: MarketKey; side: string; point?: number; playerName?: string }): string {
  const subject = wager.playerName;
  if (wager.marketKey === 'player_anytime_td') {
    return subject ? `${subject} anytime TD` : 'Anytime TD';
  }
  const shortLabel = MARKET_SHORT_LABELS[wager.marketKey];
  const pointText = wager.point != null ? ` ${wager.point}` : '';
  if (!shortLabel) {
    // h2h / spreads / totals: side + point is already a complete, self-explanatory phrase.
    return subject ? `${subject} ${wager.side}${pointText}` : `${wager.side}${pointText}`;
  }
  const sideText = wager.side.toLowerCase();
  return `${subject ? `${subject} ` : ''}${sideText}${pointText} ${shortLabel}`;
}

/** Same as `wagerCompactLabel` but always omits the player name — for UIs that already
 * show the player as a separate heading and just need "over 68 rec yds" as a subtitle,
 * without repeating the name. */
export function wagerLineDescription(wager: { marketKey: MarketKey; side: string; point?: number }): string {
  return wagerCompactLabel({ ...wager, playerName: undefined });
}

/** Markets that are valid for a given roster slot position, keyed for the Market Browser. */
export const MARKETS_BY_POSITION: Record<Position, MarketKey[]> = {
  QB: ['player_pass_yds', 'player_pass_tds', 'player_pass_interceptions'],
  RB: ['player_rush_yds', 'player_rush_attempts', 'player_anytime_td'],
  WR: ['player_reception_yds', 'player_receptions', 'player_anytime_td'],
  TE: ['player_reception_yds', 'player_receptions', 'player_anytime_td'],
  K: ['player_kicking_points', 'player_field_goals'],
};

function juice(rng: Rng): number {
  return -1 * rngInt(rng, 110, 125);
}

function roundToHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

/** Step size between a market's standard line and its alt lines — coarser for
 * yardage props, finer for count-based ones (attempts/receptions/TDs). */
const ALT_LINE_STEP: Partial<Record<MarketKey, number>> = {
  player_pass_yds: 15,
  player_rush_yds: 10,
  player_reception_yds: 10,
  player_pass_tds: 1,
  player_pass_interceptions: 1,
  player_rush_attempts: 2,
  player_receptions: 1,
  player_kicking_points: 1.5,
  player_field_goals: 1,
};

function altLine(rng: Rng, key: MarketKey, playerId: string, standardLine: number, direction: -1 | 1): AltLine {
  const step = ALT_LINE_STEP[key] ?? 10;
  const point = roundToHalf(standardLine + direction * step);
  // A lower line is easier to clear (Over more favored, Under less); a higher line flips that.
  const oddsShift = direction === -1 ? -rngInt(rng, 20, 40) : rngInt(rng, 20, 40);
  return {
    point,
    outcomes: [
      { name: 'Over', price: clampOdds(juice(rng) + oddsShift), point, playerId },
      { name: 'Under', price: clampOdds(juice(rng) - oddsShift), point, playerId },
    ],
  };
}

function clampOdds(price: number): number {
  const normalized = normalizeAmericanOdds(price);
  return normalized > 0 ? Math.min(300, normalized) : Math.max(-350, normalized);
}

function overUnderMarket(rng: Rng, key: MarketKey, playerId: string, line: number): OddsMarket {
  return {
    key,
    playerId,
    outcomes: [
      { name: 'Over', price: juice(rng), point: line, playerId },
      { name: 'Under', price: juice(rng), point: line, playerId },
    ],
    altLines: [altLine(rng, key, playerId, line, -1), altLine(rng, key, playerId, line, 1)],
  };
}

function anytimeTdMarket(playerId: string, likelihood: number): OddsMarket {
  // likelihood 0 (unlikely) -> +250, 1 (very likely) -> -200
  const price = Math.round(250 - likelihood * 450);
  const clamped = price > 0 ? Math.min(250, Math.max(100, price)) : Math.max(-200, Math.min(-105, price));
  return {
    key: 'player_anytime_td',
    playerId,
    outcomes: [{ name: 'Yes', price: clamped, playerId }],
  };
}

function playerMarkets(rng: Rng, player: Player, depthRank: number): OddsMarket[] {
  const likelihood = Math.max(0.1, 0.75 - depthRank * 0.22); // starter more likely to score than depth
  switch (player.position) {
    case 'QB':
      return [
        overUnderMarket(rng, 'player_pass_yds', player.id, roundToHalf(rngFloat(rng, 205, 315))),
        overUnderMarket(rng, 'player_pass_tds', player.id, rng() < 0.5 ? 1.5 : 2.5),
        overUnderMarket(rng, 'player_pass_interceptions', player.id, rng() < 0.6 ? 0.5 : 1.5),
      ];
    case 'RB':
      return [
        overUnderMarket(rng, 'player_rush_yds', player.id, roundToHalf(rngFloat(rng, 35, 110))),
        overUnderMarket(rng, 'player_rush_attempts', player.id, roundToHalf(rngFloat(rng, 10, 22))),
        anytimeTdMarket(player.id, likelihood),
      ];
    case 'WR':
    case 'TE':
      return [
        overUnderMarket(rng, 'player_reception_yds', player.id, roundToHalf(rngFloat(rng, 25, 95))),
        overUnderMarket(rng, 'player_receptions', player.id, roundToHalf(rngFloat(rng, 3, 8))),
        anytimeTdMarket(player.id, likelihood * 0.8),
      ];
    case 'K':
      return [
        overUnderMarket(rng, 'player_kicking_points', player.id, roundToHalf(rngFloat(rng, 5.5, 9.5))),
        overUnderMarket(rng, 'player_field_goals', player.id, rng() < 0.5 ? 1.5 : 2.5),
      ];
    default:
      return [];
  }
}

function gameMarkets(rng: Rng, homeTeamId: string, awayTeamId: string): OddsMarket[] {
  const homeTeam = nflTeamById(homeTeamId);
  const awayTeam = nflTeamById(awayTeamId);
  const favoriteIsHome = rng() < 0.55; // slight home-field tilt
  const spreadMagnitude = roundToHalf(rngFloat(rng, 1, 10.5));
  const favMlOdds = clampOdds(Math.max(-280, Math.round(-110 - spreadMagnitude * 14)));
  const dogMlOdds = clampOdds(Math.min(250, Math.max(100, Math.round(Math.abs(favMlOdds) * 0.85 - 15))));

  const h2h: OddsMarket = {
    key: 'h2h',
    outcomes: [
      { name: homeTeam.abbrev, price: favoriteIsHome ? favMlOdds : dogMlOdds },
      { name: awayTeam.abbrev, price: favoriteIsHome ? dogMlOdds : favMlOdds },
    ],
  };

  const spreads: OddsMarket = {
    key: 'spreads',
    outcomes: [
      { name: homeTeam.abbrev, price: juice(rng), point: favoriteIsHome ? -spreadMagnitude : spreadMagnitude },
      { name: awayTeam.abbrev, price: juice(rng), point: favoriteIsHome ? spreadMagnitude : -spreadMagnitude },
    ],
  };

  const totalPoints = roundToHalf(rngFloat(rng, 38, 52));
  const totals: OddsMarket = {
    key: 'totals',
    outcomes: [
      { name: 'Over', price: juice(rng), point: totalPoints },
      { name: 'Under', price: juice(rng), point: totalPoints },
    ],
  };

  return [h2h, spreads, totals];
}

export function generateBookmakersForGame(scheduled: ScheduledGame): OddsBookmaker[] {
  const rng = createRng(scheduled.id);
  const markets: OddsMarket[] = [...gameMarkets(rng, scheduled.homeTeamId, scheduled.awayTeamId)];

  for (const teamId of [scheduled.homeTeamId, scheduled.awayTeamId]) {
    const roster = playersByTeam[teamId] ?? [];
    const byPosition: Record<Position, Player[]> = { QB: [], RB: [], WR: [], TE: [], K: [] };
    roster.forEach((p) => byPosition[p.position].push(p));
    (Object.keys(byPosition) as Position[]).forEach((pos) => {
      byPosition[pos].forEach((player, depthRank) => {
        markets.push(...playerMarkets(rng, player, depthRank));
      });
    });
  }

  return [{ key: 'propleague_book', title: 'PropLeague Sportsbook', markets }];
}

export function toNFLGame(scheduled: ScheduledGame): NFLGame {
  return {
    id: scheduled.id,
    week: scheduled.week,
    daySlot: scheduled.daySlot,
    kickoff: scheduled.kickoff,
    homeTeamId: scheduled.homeTeamId,
    awayTeamId: scheduled.awayTeamId,
    homeRecord: '0-0',
    awayRecord: '0-0',
    status: 'upcoming',
    homeScore: null,
    awayScore: null,
    bookmakers: generateBookmakersForGame(scheduled),
  };
}
