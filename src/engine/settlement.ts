import type { MarketKey, NFLGame, Wager, WagerStatus } from '../types';
import { createRng, rngInt, rngFloat, chance, type Rng } from './random';
import { americanToImpliedProbability, profitForStake } from './oddsMath';

export interface MarketResult {
  marketKey: MarketKey;
  playerId?: string;
  result: string; // 'over' | 'under' | 'push' | 'yes' | 'no' | <team abbrev>
  /** The simulated stat/margin this market's result was decided from, in the market's
   * natural units — undefined for binary yes/no markets (anytime TD) where "how close"
   * isn't a meaningful concept. For h2h/spreads this is the home team's raw score
   * margin (home - away); for totals it's the combined score; for player over/under
   * props it's the simulated stat value. Used by the Worst Beat weekly moment (manual
   * v0.03 §4.3) to find the closest league-wide miss — a consumer with the wager's own
   * side/point compares against this to get a signed distance, since a wager's point
   * may be an alt line that differs from this market's own standard `point`. */
  simulatedValue?: number;
}

export interface GameResult {
  gameId: string;
  homeScore: number;
  awayScore: number;
  marketResults: MarketResult[];
}

function fairProbability(rng: Rng, priceA: number, priceB: number): [number, number] {
  const impA = americanToImpliedProbability(priceA);
  const impB = americanToImpliedProbability(priceB);
  const total = impA + impB; // remove vig
  void rng;
  return [impA / total, impB / total];
}

function resolveOverUnder(rng: Rng, point: number): { result: 'over' | 'under' | 'push'; actual: number } {
  if (Number.isInteger(point) && chance(rng, 0.02)) return { result: 'push', actual: point };
  // Actual stat landed on either side of the line with roughly even odds.
  const actual = point + rngFloat(rng, -1, 1) * Math.max(1, point * 0.18);
  return { result: actual > point ? 'over' : 'under', actual };
}

/** Deterministic-but-random full settlement of one NFL game and every market on its board. */
export function simulateGameResult(game: NFLGame): GameResult {
  const rng = createRng(`${game.id}-result`);
  const homeTeamAbbrev = game.bookmakers[0]?.markets.find((m) => m.key === 'h2h')?.outcomes[0]?.name;
  const awayTeamAbbrev = game.bookmakers[0]?.markets.find((m) => m.key === 'h2h')?.outcomes[1]?.name;

  const h2hMarket = game.bookmakers[0]?.markets.find((m) => m.key === 'h2h');
  const [homeFair] = h2hMarket
    ? fairProbability(rng, h2hMarket.outcomes[0].price, h2hMarket.outcomes[1].price)
    : [0.5, 0.5];
  const homeWins = chance(rng, homeFair);

  const winnerScore = rngInt(rng, 17, 34);
  const loserScore = rngInt(rng, 6, Math.max(6, winnerScore - 1));
  const homeScore = homeWins ? winnerScore : loserScore;
  const awayScore = homeWins ? loserScore : winnerScore;
  const homeMargin = homeScore - awayScore;

  const marketResults: MarketResult[] = [];

  for (const bookmaker of game.bookmakers) {
    for (const market of bookmaker.markets) {
      if (market.key === 'h2h') {
        marketResults.push({
          marketKey: 'h2h',
          result: homeMargin > 0 ? (homeTeamAbbrev ?? 'home') : (awayTeamAbbrev ?? 'away'),
          simulatedValue: homeMargin,
        });
      } else if (market.key === 'spreads') {
        const homeOutcome = market.outcomes.find((o) => o.name === homeTeamAbbrev);
        const homePoint = homeOutcome?.point ?? 0;
        const covered = homeMargin + homePoint;
        marketResults.push({
          marketKey: 'spreads',
          result: covered === 0 ? 'push' : covered > 0 ? (homeTeamAbbrev ?? 'home') : (awayTeamAbbrev ?? 'away'),
          simulatedValue: homeMargin,
        });
      } else if (market.key === 'totals') {
        const point = market.outcomes[0]?.point ?? 0;
        const combined = homeScore + awayScore;
        const diff = combined - point;
        marketResults.push({
          marketKey: 'totals',
          result: diff === 0 ? 'push' : diff > 0 ? 'over' : 'under',
          simulatedValue: combined,
        });
      } else if (market.key === 'player_anytime_td') {
        const price = market.outcomes[0].price;
        const prob = americanToImpliedProbability(price);
        marketResults.push({
          marketKey: market.key,
          playerId: market.playerId,
          result: chance(rng, prob) ? 'yes' : 'no',
        });
      } else {
        const point = market.outcomes[0]?.point ?? 0;
        const { result, actual } = resolveOverUnder(rng, point);
        marketResults.push({
          marketKey: market.key,
          playerId: market.playerId,
          result,
          simulatedValue: actual,
        });
      }
    }
  }

  return { gameId: game.id, homeScore, awayScore, marketResults };
}

/** ~3% of props get scratched (player ruled out) before their game locks. */
export function isWagerScratched(wagerId: string): boolean {
  const rng = createRng(`${wagerId}-scratch`);
  return chance(rng, 0.03);
}

export function findMarketResult(
  gameResult: GameResult,
  marketKey: MarketKey,
  playerId?: string,
): MarketResult | undefined {
  return gameResult.marketResults.find(
    (r) => r.marketKey === marketKey && r.playerId === playerId,
  );
}

export function settleWager(
  wager: Wager,
  gameResult: GameResult,
): { status: WagerStatus; profit: number } {
  const marketResult = findMarketResult(gameResult, wager.marketKey, wager.playerId);
  if (!marketResult) return { status: 'push', profit: 0 };

  let outcome: 'win' | 'lose' | 'push';
  if (marketResult.result === 'push') {
    outcome = 'push';
  } else if (marketResult.result === 'yes' || marketResult.result === 'no') {
    outcome = marketResult.result === 'yes' ? 'win' : 'lose';
  } else if (marketResult.result === 'over' || marketResult.result === 'under') {
    outcome = wager.side.toLowerCase() === marketResult.result ? 'win' : 'lose';
  } else {
    // h2h / spreads: result holds the winning side's team abbrev.
    outcome = wager.side === marketResult.result ? 'win' : 'lose';
  }

  if (outcome === 'push') return { status: 'push', profit: 0 };
  if (outcome === 'win') return { status: 'won', profit: profitForStake(wager.stake, wager.oddsAtPlacement) };
  return { status: 'lost', profit: -wager.stake };
}
