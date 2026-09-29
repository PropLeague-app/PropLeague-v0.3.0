// Server-side (Deno edge function) port of the real-games-into-NFLGame[] pipeline
// from src/services/supabaseOdds.ts -- same duplicated-not-imported pattern as
// playoffLogic.ts/playerNameMatch.ts (see chat, Sept 2026, generate-bot-lineups).
//
// This is NOT decorative: real_games.bookmakers stores the RAW odds-feed payload
// (a bookmaker's free-text player description, no playerId at all) -- resolving
// that description to a real player is what mapBookmaker/resolvePlayer below
// actually do, on every read, client-side today. Skipping this and reading
// real_games.bookmakers directly would mean every player-prop market silently
// has no playerId/playerName/playerPosition, which is exactly what
// getPlayerPropGroups (autoLineupReal.ts) keys off of -- so generateAutoLineup
// would silently only ever be able to fill ML slots, never any position slot, if
// this pipeline weren't ported faithfully. loadActiveRoster's pagination and the
// LA/AZ team-code fixups below are both fixes for real bugs that silently dropped
// real players (see the original file's header) -- ported verbatim, not
// re-derived, for exactly that reason.

import { matchPlayerName, type RealStatCandidate } from './playerNameMatch.ts';

export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K';
export type DaySlot = 'WED' | 'TNF' | 'SAT' | 'SUN_EARLY' | 'SUN_LATE' | 'SNF' | 'MNF';
export type GameStatus = 'upcoming' | 'live' | 'final';
export type MarketKey =
  | 'h2h' | 'spreads' | 'totals'
  | 'player_pass_yds' | 'player_pass_tds' | 'player_pass_interceptions'
  | 'player_rush_yds' | 'player_rush_attempts' | 'player_pass_rush_yds' | 'player_anytime_td'
  | 'player_reception_yds' | 'player_receptions' | 'player_rush_reception_yds'
  | 'player_kicking_points' | 'player_field_goals'
  | 'player_pass_attempts' | 'player_pass_completions' | 'player_rush_longest'
  | 'player_reception_longest' | 'player_pats';

export interface OddsOutcome {
  name: string;
  price: number;
  point?: number;
  playerId?: string;
}
export interface OddsMarket {
  key: MarketKey;
  playerId?: string;
  playerName?: string;
  playerPosition?: Position;
  playerTeamId?: string;
  outcomes: OddsOutcome[];
}
export interface OddsBookmaker {
  key: string;
  title: string;
  markets: OddsMarket[];
}
export interface NFLGame {
  id: string;
  week: string | number;
  daySlot: DaySlot;
  kickoff: string;
  homeTeamId: string;
  awayTeamId: string;
  status: GameStatus;
  homeScore: number | null;
  awayScore: number | null;
  bookmakers: OddsBookmaker[];
}

// Same "City Name" -> abbrev pairs as src/data/nflTeams.ts's NFL_TEAMS (colors
// omitted -- irrelevant here). Keep in sync if a franchise ever relocates/renames.
const TEAM_NAME_TO_ABBREV = new Map<string, string>([
  ['Buffalo Bills', 'BUF'], ['Miami Dolphins', 'MIA'], ['New England Patriots', 'NE'], ['New York Jets', 'NYJ'],
  ['Baltimore Ravens', 'BAL'], ['Cincinnati Bengals', 'CIN'], ['Cleveland Browns', 'CLE'], ['Pittsburgh Steelers', 'PIT'],
  ['Houston Texans', 'HOU'], ['Indianapolis Colts', 'IND'], ['Jacksonville Jaguars', 'JAX'], ['Tennessee Titans', 'TEN'],
  ['Denver Broncos', 'DEN'], ['Kansas City Chiefs', 'KC'], ['Las Vegas Raiders', 'LV'], ['Los Angeles Chargers', 'LAC'],
  ['Dallas Cowboys', 'DAL'], ['New York Giants', 'NYG'], ['Philadelphia Eagles', 'PHI'], ['Washington Commanders', 'WAS'],
  ['Chicago Bears', 'CHI'], ['Detroit Lions', 'DET'], ['Green Bay Packers', 'GB'], ['Minnesota Vikings', 'MIN'],
  ['Atlanta Falcons', 'ATL'], ['Carolina Panthers', 'CAR'], ['New Orleans Saints', 'NO'], ['Tampa Bay Buccaneers', 'TB'],
  ['Arizona Cardinals', 'ARI'], ['Los Angeles Rams', 'LAR'], ['San Francisco 49ers', 'SF'], ['Seattle Seahawks', 'SEA'],
]);

function resolveTeamAbbrev(fullName: string): string | null {
  return TEAM_NAME_TO_ABBREV.get(fullName) ?? null;
}

// nflverse's team codes don't always match this app's canonical abbreviations --
// see src/services/supabaseOdds.ts's header (Rams "LA" vs "LAR", Cardinals "AZ"
// vs "ARI"). Kept in sync with that file, not re-derived.
const NFLVERSE_TEAM_CODE_FIXUPS: Record<string, string> = { LA: 'LAR', AZ: 'ARI' };
function normalizeTeamCode(code: string): string {
  return NFLVERSE_TEAM_CODE_FIXUPS[code] ?? code;
}

interface RosterCandidate {
  id: string;
  playerName: string;
  team: string;
  position: string;
}

// PostgREST silently caps an unpaginated query at 1000 rows -- see
// src/services/supabaseOdds.ts's header (the Drake Maye incident). Paginated
// here for the exact same reason; real_players is a few thousand rows.
const PAGE_SIZE = 1000;

// deno-lint-ignore no-explicit-any
async function loadActiveRoster(supabase: any): Promise<RosterCandidate[]> {
  const all: RosterCandidate[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('real_players')
      .select('id, full_name, team, position')
      .eq('status', 'ACT')
      .range(from, from + PAGE_SIZE - 1);
    if (error || !data) break;
    all.push(
      ...(data as { id: string; full_name: string; team: string; position: string }[]).map((p) => ({
        id: p.id,
        playerName: p.full_name,
        team: normalizeTeamCode(p.team),
        position: p.position,
      })),
    );
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

function resolvePlayer(description: string, homeAbbrev: string | null, awayAbbrev: string | null, roster: RosterCandidate[]): RosterCandidate | null {
  const candidateTeams = [homeAbbrev, awayAbbrev].filter((t): t is string => t != null);
  const candidates: RealStatCandidate[] = roster
    .filter((p) => candidateTeams.includes(p.team))
    .map((p) => ({ playerName: p.playerName, team: p.team }));

  for (const team of candidateTeams) {
    const result = matchPlayerName(description, team, candidates);
    if (result.matchedName) {
      const match = roster.find((p) => p.playerName === result.matchedName && candidateTeams.includes(p.team));
      if (match) return match;
    }
  }
  return null;
}

interface RawOutcome { name: string; description?: string; price: number; point?: number }
interface RawMarket { key: string; outcomes: RawOutcome[] }
interface RawBookmaker { key: string; title: string; markets: RawMarket[] }
interface RealGameRow {
  id: string;
  week: string;
  day_slot: string | null;
  kickoff: string;
  home_team: string;
  away_team: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  bookmakers: RawBookmaker[];
}

const GAME_LEVEL_KEYS = new Set(['h2h', 'spreads', 'totals']);

function mapPlayerPropMarkets(rawMarket: RawMarket, homeAbbrev: string | null, awayAbbrev: string | null, roster: RosterCandidate[]): OddsMarket[] {
  const byPlayer = new Map<string, RawOutcome[]>();
  for (const outcome of rawMarket.outcomes) {
    if (!outcome.description) continue;
    const list = byPlayer.get(outcome.description) ?? [];
    list.push(outcome);
    byPlayer.set(outcome.description, list);
  }

  const markets: OddsMarket[] = [];
  for (const [description, outcomes] of byPlayer) {
    const player = resolvePlayer(description, homeAbbrev, awayAbbrev, roster);
    if (!player) continue;
    markets.push({
      key: rawMarket.key as MarketKey,
      playerId: player.id,
      playerName: player.playerName,
      playerPosition: player.position as Position,
      playerTeamId: player.team,
      outcomes: outcomes.map((o) => ({ name: o.name, price: o.price, point: o.point, playerId: player.id })),
    });
  }
  return markets;
}

const PREFERRED_BOOKMAKER_KEY = 'draftkings';

function mergeBookmakersWithFallback(bookmakers: RawBookmaker[]): RawBookmaker[] {
  if (bookmakers.length === 0) return [];
  const preferred = bookmakers.find((b) => b.key === PREFERRED_BOOKMAKER_KEY);
  const priorityOrder = preferred ? [preferred, ...bookmakers.filter((b) => b !== preferred)] : bookmakers;

  const marketsByKey = new Map<string, RawMarket>();
  for (const book of priorityOrder) {
    for (const rawMarket of book.markets) {
      if (GAME_LEVEL_KEYS.has(rawMarket.key)) {
        if (!marketsByKey.has(rawMarket.key)) marketsByKey.set(rawMarket.key, rawMarket);
        continue;
      }
      const existing = marketsByKey.get(rawMarket.key);
      if (!existing) {
        marketsByKey.set(rawMarket.key, { key: rawMarket.key, outcomes: [...rawMarket.outcomes] });
        continue;
      }
      const seenDescriptions = new Set(existing.outcomes.map((o) => o.description));
      for (const outcome of rawMarket.outcomes) {
        if (outcome.description && seenDescriptions.has(outcome.description)) continue;
        existing.outcomes.push(outcome);
      }
    }
  }

  return [{ key: preferred?.key ?? priorityOrder[0].key, title: 'Best Available Odds', markets: Array.from(marketsByKey.values()) }];
}

function mapBookmaker(raw: RawBookmaker, homeAbbrev: string | null, awayAbbrev: string | null, roster: RosterCandidate[]): OddsBookmaker {
  const markets: OddsMarket[] = [];
  for (const rawMarket of raw.markets) {
    if (GAME_LEVEL_KEYS.has(rawMarket.key)) {
      markets.push({
        key: rawMarket.key as MarketKey,
        outcomes: rawMarket.outcomes.map((o) => ({ name: o.name, price: o.price, point: o.point })),
      });
    } else {
      markets.push(...mapPlayerPropMarkets(rawMarket, homeAbbrev, awayAbbrev, roster));
    }
  }
  return { key: raw.key, title: raw.title, markets };
}

function mapRow(row: RealGameRow, roster: RosterCandidate[]): NFLGame {
  const homeAbbrev = resolveTeamAbbrev(row.home_team);
  const awayAbbrev = resolveTeamAbbrev(row.away_team);
  return {
    id: row.id,
    week: row.week,
    daySlot: (row.day_slot as DaySlot | null) ?? 'SUN_EARLY',
    kickoff: row.kickoff,
    homeTeamId: homeAbbrev ?? row.home_team,
    awayTeamId: awayAbbrev ?? row.away_team,
    status: row.status as GameStatus,
    homeScore: row.home_score,
    awayScore: row.away_score,
    bookmakers: mergeBookmakersWithFallback(row.bookmakers).map((b) => mapBookmaker(b, homeAbbrev, awayAbbrev, roster)),
  };
}

/** Server-side equivalent of src/services/supabaseOdds.ts's fetchRealGamesForWeek,
 * using a service-role client instead of the browser one. No caching/cooldown
 * logic here on purpose -- this only ever READS whatever fetch-nfl-odds/
 * fetch-nfl-player-props have already written; refreshing odds is entirely their
 * job, not this function's. */
// deno-lint-ignore no-explicit-any
export async function fetchRealGamesForWeek(supabase: any, week: string): Promise<NFLGame[]> {
  const [gamesResult, roster] = await Promise.all([
    supabase.from('real_games').select('*').eq('week', week),
    loadActiveRoster(supabase),
  ]);
  if (gamesResult.error || !gamesResult.data) return [];
  return (gamesResult.data as RealGameRow[]).map((row) => mapRow(row, roster));
}
