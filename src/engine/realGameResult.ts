import type { MarketKey } from '../types';
import type { GameResult, MarketResult } from './settlement';

/** One real player's box-score line for one week, matching a `real_player_stats`
 * row (season, week, player_name, recent_team + stat columns). Note the two
 * columns whose names diverge from nflverse's own raw CSV headers -- this
 * table renames them: nflverse's `interceptions` -> `passing_interceptions`,
 * nflverse's `carries` -> `rushing_attempts`. `kicking_points` is already a
 * derived column here (computed at ingestion time), not raw FG/XP counts. */
export interface RealPlayerStatLine {
  playerName: string;
  recentTeam: string;
  passingYards?: number;
  passingTds?: number;
  passingInterceptions?: number;
  rushingYards?: number;
  rushingTds?: number;
  rushingAttempts?: number;
  receivingYards?: number;
  receivingTds?: number;
  receptions?: number;
  fieldGoalsMade?: number;
  kickingPoints?: number;
}

const STAT_FIELD_FOR_MARKET: Partial<Record<MarketKey, keyof RealPlayerStatLine>> = {
  player_pass_yds: 'passingYards',
  player_pass_tds: 'passingTds',
  player_pass_interceptions: 'passingInterceptions',
  player_rush_yds: 'rushingYards',
  player_rush_attempts: 'rushingAttempts',
  player_reception_yds: 'receivingYards',
  player_receptions: 'receptions',
  player_kicking_points: 'kickingPoints',
  player_field_goals: 'fieldGoalsMade',
  // player_pass_rush_yds and player_rush_reception_yds are each two stat fields
  // added together -- handled as dedicated branches in buildRealGameResult below,
  // same as player_anytime_td, rather than through this single-field lookup.
};

/** Combined-stat markets that sum two RealPlayerStatLine fields rather than reading
 * one directly (see STAT_FIELD_FOR_MARKET's comment). Was previously only handled
 * for settle-week's own copy of this logic (supabase/functions/settle-week/index.ts,
 * which can't import this file) -- this client-side copy fell through to the
 * generic single-field branch below, which silently graded every real
 * player_rush_reception_yds wager as "under" (STAT_FIELD_FOR_MARKET had no entry
 * for it, so statValue() always returned 0) regardless of actual performance. Not
 * currently reachable from any live code path (buildRealGameResult has no callers
 * yet), but fixed here so it isn't a landmine for whatever wires it up next. */
const COMBINED_STAT_FIELDS_FOR_MARKET: Partial<Record<MarketKey, (keyof RealPlayerStatLine)[]>> = {
  player_pass_rush_yds: ['passingYards', 'rushingYards'],
  player_rush_reception_yds: ['rushingYards', 'receivingYards'],
};

function anytimeTdHit(stat: RealPlayerStatLine | undefined): boolean {
  if (!stat) return false;
  return (stat.rushingTds ?? 0) + (stat.receivingTds ?? 0) > 0;
}

function statValue(marketKey: MarketKey, stat: RealPlayerStatLine | undefined): number {
  const combinedFields = COMBINED_STAT_FIELDS_FOR_MARKET[marketKey];
  if (combinedFields) {
    if (!stat) return 0;
    return combinedFields.reduce((sum, field) => sum + ((stat[field] as number | undefined) ?? 0), 0);
  }
  const field = STAT_FIELD_FOR_MARKET[marketKey];
  if (!field || !stat) return 0;
  return (stat[field] as number | undefined) ?? 0;
}

/** What settle-week reads off `real_games` for one finished game. `homeTeam`/
 * `awayTeam` are used exactly as stored (full team name strings, e.g. "Seattle
 * Seahawks") -- no abbreviation conversion needed, because real market
 * outcomes (and therefore `wager.side` for a real h2h/spreads bet) are already
 * named with the full team name, not the abbreviation. See findTeamOutcome's
 * comment in services/oddsService.ts for how that convention was confirmed. */
export interface RealGameLine {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
}

/** The handful of fields settlement actually needs off a wager row. `side`/
 * `point` are the wager's own frozen values from placement time (same idea as
 * `oddsAtPlacement`) -- grading always uses these, never anything re-derived
 * from the board's current odds. */
export interface WagerToGrade {
  marketKey: MarketKey;
  playerId?: string | null;
  playerName?: string | null;
  side: string;
  point?: number | null;
}

/** Purely for display -- the settled-wager result "ticker" next to a Won/Lost
 * pill (Sept 2026 chat: "some frame of reference for how much someone
 * won/lost by ... will also make it easier to track the Lamar Jackson
 * pass+rush bug if we can see the result"). Reuses this file's own
 * statValue/anytimeTdHit so the number shown is guaranteed to be the exact
 * figure grading itself used -- including the two combined-stat markets
 * (player_pass_rush_yds, player_rush_reception_yds) this file's own history
 * comment above already documents a real bug for.
 *
 * Returns null when there's genuinely nothing to show yet: no stat row
 * ingested for a player market (see this file's header -- "not ingested
 * yet" is not the same as "recorded a zero"), or no score posted yet for a
 * game-level market. A plain integer is used for every numeric stat
 * (yards/attempts/receptions/FGs made are always whole numbers in practice,
 * unlike the .5 lines they're compared against) rather than a "21/18.5"
 * fraction, which read noisier without adding information. */
export function describeWagerResult(
  marketKey: MarketKey,
  stat: RealPlayerStatLine | undefined,
  game?: { homeScore: number | null | undefined; awayScore: number | null | undefined },
): string | null {
  if (marketKey === 'h2h' || marketKey === 'spreads' || marketKey === 'totals') {
    if (!game || game.homeScore == null || game.awayScore == null) return null;
    return `${game.awayScore}-${game.homeScore}`;
  }
  if (marketKey === 'player_anytime_td') {
    if (!stat) return null;
    const tds = (stat.rushingTds ?? 0) + (stat.receivingTds ?? 0);
    return tds > 0 ? `${tds} TD${tds > 1 ? 's' : ''}` : '0 TD';
  }
  if (!stat) return null;
  return String(statValue(marketKey, stat));
}

/**
 * Builds a single-market GameResult for one wager against real data -- the
 * real-data replacement for the per-market branches inside
 * engine/settlement.ts's simulateGameResult. Deliberately returns the exact
 * same GameResult/MarketResult shape so it can be handed straight to the
 * existing, unchanged settleWager() -- the win/lose/push decision itself
 * isn't reimplemented here, only how `result` gets computed changes.
 *
 * `statForPlayer` should resolve by player name (nflverse-cased) -- both
 * real_players.full_name and real_player_stats.player_name are sourced from
 * nflverse, so an exact (case-insensitive) match is expected to work without
 * the fuzzy bookmaker-description matching services/supabaseOdds.ts needs for
 * a different problem (resolving a sportsbook's own wording to a real player).
 */
export function buildRealGameResult(
  wager: WagerToGrade,
  game: RealGameLine,
  statForPlayer: (playerName: string) => RealPlayerStatLine | undefined,
): GameResult {
  const homeMargin = game.homeScore - game.awayScore;
  let marketResult: MarketResult;

  if (wager.marketKey === 'h2h') {
    marketResult = { marketKey: 'h2h', result: homeMargin > 0 ? game.homeTeam : game.awayTeam, simulatedValue: homeMargin };
  } else if (wager.marketKey === 'spreads') {
    const sideIsHome = wager.side === game.homeTeam;
    const sideMargin = sideIsHome ? homeMargin : -homeMargin;
    const covered = sideMargin + (wager.point ?? 0);
    const other = sideIsHome ? game.awayTeam : game.homeTeam;
    marketResult = { marketKey: 'spreads', result: covered === 0 ? 'push' : covered > 0 ? wager.side : other, simulatedValue: homeMargin };
  } else if (wager.marketKey === 'totals') {
    const combined = game.homeScore + game.awayScore;
    const diff = combined - (wager.point ?? 0);
    marketResult = { marketKey: 'totals', result: diff === 0 ? 'push' : diff > 0 ? 'over' : 'under', simulatedValue: combined };
  } else if (wager.marketKey === 'player_anytime_td') {
    const stat = wager.playerName ? statForPlayer(wager.playerName) : undefined;
    marketResult = { marketKey: wager.marketKey, playerId: wager.playerId ?? undefined, result: anytimeTdHit(stat) ? 'yes' : 'no' };
  } else {
    const stat = wager.playerName ? statForPlayer(wager.playerName) : undefined;
    const actual = statValue(wager.marketKey, stat);
    const diff = actual - (wager.point ?? 0);
    marketResult = {
      marketKey: wager.marketKey,
      playerId: wager.playerId ?? undefined,
      result: diff === 0 ? 'push' : diff > 0 ? 'over' : 'under',
      simulatedValue: actual,
    };
  }

  return { gameId: game.gameId, homeScore: game.homeScore, awayScore: game.awayScore, marketResults: [marketResult] };
}
