import { supabase } from '../lib/supabaseClient';
import { NFL_TEAMS } from '../data/nflTeams';
import { matchPlayerName } from '../engine/playerNameMatch';
import type { DaySlot, GameStatus, MarketKey, NFLGame, OddsBookmaker, OddsMarket, Position, WeekId } from '../types';

const TEAM_NAME_TO_ABBREV = new Map(NFL_TEAMS.map((t) => [`${t.city} ${t.name}`, t.abbrev]));

function resolveTeamAbbrev(fullName: string): string | null {
  return TEAM_NAME_TO_ABBREV.get(fullName) ?? null;
}

interface RosterCandidate {
  id: string;
  playerName: string;
  team: string;
  position: string;
}

// PostgREST (Supabase's API layer) silently caps any unpaginated query at
// 1000 rows -- no error, no warning, it just returns a truncated result. This
// was the actual root cause of Drake Maye (and likely many other players)
// missing from prop options: real_players has 1746 active rows alone, so
// roughly 746 of them -- in whatever arbitrary order Postgres happened to
// return them in -- were silently never making it into the roster crosswalk
// at all, regardless of name spelling or team. Confirmed via direct testing:
// matchPlayerName() itself correctly matches "Drake Maye" against "Drake
// Maye" in isolation; the player was simply never in the candidate list to
// begin with.
//
// Still fetched once per games-for-week call and threaded through, rather
// than queried per outcome -- a week's worth of games can have hundreds of
// prop outcomes, and this avoids turning that into hundreds of round-trips.
// Pagination adds one extra round-trip per 1000 rows (2 total right now),
// which is a much smaller cost than that would be.
const PAGE_SIZE = 1000;

// nflverse's team codes don't always match this app's canonical abbreviations
// (built from the Odds API's full team names via resolveTeamAbbrev above) --
// confirmed two real mismatches by directly diffing nflverse's actual distinct
// team values against this app's 32: nflverse uses "LA" for the Rams (this
// app uses "LAR", the now-more-standard code), and inconsistently tags some
// Cardinals players "AZ" instead of "ARI". Either one would silently exclude
// every player on that team from the roster crosswalk, the same bug class as
// the pagination issue, just at a different stage -- checked comprehensively
// this time (a full diff of all distinct team codes) rather than one player
// at a time, since that's exactly how Drake Maye and Stafford were each found
// separately.
const NFLVERSE_TEAM_CODE_FIXUPS: Record<string, string> = {
  LA: 'LAR',
  AZ: 'ARI',
};

function normalizeTeamCode(code: string): string {
  return NFLVERSE_TEAM_CODE_FIXUPS[code] ?? code;
}

async function loadActiveRoster(): Promise<RosterCandidate[]> {
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
    if (data.length < PAGE_SIZE) break; // last page reached
    from += PAGE_SIZE;
  }
  return all;
}

/** Resolves a player-prop outcome's raw `description` (a real name from the
 * bookmaker) to a real player from the live roster — verified matching logic
 * from Phase 1.5, run in reverse (matching a real name against the real roster
 * instead of the other way around). Candidates are scoped to just this game's
 * two teams, which both narrows the fallback correctly and doesn't need an
 * explicit team on every outcome (the API doesn't provide one per-outcome,
 * only per-game). Returns null for real players the bookmaker prices who
 * aren't resolvable on either team's active roster — should be rare now that
 * the roster itself is live, rather than the common case it was against the
 * old static file. Returns the full roster entry, not just an id, so callers
 * have position/team without a second lookup. */
function resolvePlayer(description: string, homeAbbrev: string | null, awayAbbrev: string | null, roster: RosterCandidate[]): RosterCandidate | null {
  const candidateTeams = [homeAbbrev, awayAbbrev].filter((t): t is string => t != null);
  const candidates = roster.filter((p) => candidateTeams.includes(p.team)).map((p) => ({ playerName: p.playerName, team: p.team }));

  for (const team of candidateTeams) {
    const result = matchPlayerName(description, team, candidates);
    if (result.matchedName) {
      const match = roster.find((p) => p.playerName === result.matchedName && candidateTeams.includes(p.team));
      if (match) return match;
    }
  }
  return null;
}

interface RawOutcome {
  name: string;
  description?: string;
  price: number;
  point?: number;
}
interface RawMarket {
  key: string;
  outcomes: RawOutcome[];
}
interface RawBookmaker {
  key: string;
  title: string;
  markets: RawMarket[];
}
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
  props_updated_at: string | null;
}

const GAME_LEVEL_KEYS = new Set(['h2h', 'spreads', 'totals']);

/** The raw feed groups all players' Over/Under lines under one shared market
 * entry per stat type; the app's model expects one OddsMarket PER PLAYER (see
 * getPlayerPropGroups, which keys off market.playerId) — so this fans one raw
 * market out into several. */
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
      // nflverse's raw position string isn't guaranteed to be one of PropLeague's
      // five roster-slot positions (could be a non-skill position) -- cast rather
      // than validated, but safe: a value that doesn't match any of them simply
      // never matches any slot.position comparison downstream, it doesn't crash.
      playerPosition: player.position as Position,
      playerTeamId: player.team,
      outcomes: outcomes.map((o) => ({ name: o.name, price: o.price, point: o.point, playerId: player.id })),
      // Real data has one line per player per market, no alternates -- altLines
      // stays undefined (already optional on the type).
    });
  }
  return markets;
}

// Real feeds include up to ~9 different bookmakers, each with their own line for
// the same market -- without any filtering, a player's "Passing TDs" market would
// show up once per bookmaker, which is exactly the clutter Hunter originally
// reported. The fix defaults to one preferred book, same as before, but now
// backfills anything that specific book is missing from whichever other book
// actually has it, rather than silently going without (see chat: DraftKings not
// carrying a given market/player is a real, recurring gap -- Hunter hit the same
// thing with Home Run odds in his MLB Edge Finder and solved it the same way
// there: prefer one book, fall through to the next when it doesn't have
// something). Making the preferred book a real, commissioner-only league setting
// is a separate, larger piece of work, not rushed in here.
const PREFERRED_BOOKMAKER_KEY = 'draftkings';

/** Merges every bookmaker in the raw feed into one synthetic "book" per game:
 * the preferred book's own lines win wherever it has them, and anything it's
 * missing gets filled in from the next book (in whatever order the feed
 * returned them) that actually has it. Two different granularities, because
 * game-level and player-prop markets don't fail the same way:
 *  - h2h/spreads/totals have no per-player dimension -- a book either priced
 *    the whole game or it didn't, so the first book with that market key wins
 *    it outright.
 *  - Player-prop markets (e.g. "Passing Yards") bundle every player's Over/
 *    Under into one shared market per book -- the preferred book can have the
 *    market in general but still be missing one specific player that another
 *    book carries (exactly what happened here: DraftKings + everyone else in
 *    this feed simply didn't have Pass + Rush Yards priced for anyone yet, but
 *    the same gap shows up at the single-player level too), so this merges
 *    outcome-by-outcome, keyed by each outcome's player description, rather
 *    than taking or discarding a whole market at once.
 * The result is never less complete than picking one book alone, and title is
 * deliberately generic now that a single game's lines can genuinely be sourced
 * from more than one real book. */
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

function parseWeekId(raw: string): WeekId {
  return raw === 'WC' || raw === 'DIV' || raw === 'CONF' ? raw : Number(raw);
}

function mapRow(row: RealGameRow, roster: RosterCandidate[]): NFLGame {
  const homeAbbrev = resolveTeamAbbrev(row.home_team);
  const awayAbbrev = resolveTeamAbbrev(row.away_team);
  return {
    id: row.id,
    week: parseWeekId(row.week),
    daySlot: (row.day_slot as DaySlot | null) ?? 'SUN_EARLY',
    kickoff: row.kickoff,
    homeTeamId: homeAbbrev ?? row.home_team,
    awayTeamId: awayAbbrev ?? row.away_team,
    // Real NFL team win-loss records aren't tracked anywhere yet -- a known,
    // purely cosmetic gap (blank instead of e.g. "3-1" next to a team name),
    // not a functional one. Separate scope from league standings, which are
    // already real (Step 5).
    homeRecord: '',
    awayRecord: '',
    status: row.status as GameStatus,
    homeScore: row.home_score,
    awayScore: row.away_score,
    bookmakers: mergeBookmakersWithFallback(row.bookmakers).map((b) => mapBookmaker(b, homeAbbrev, awayAbbrev, roster)),
    propsUpdatedAt: row.props_updated_at,
  };
}

export async function fetchRealGamesForWeek(week: WeekId): Promise<NFLGame[]> {
  const [gamesResult, roster] = await Promise.all([
    supabase.from('real_games').select('*').eq('week', String(week)),
    loadActiveRoster(),
  ]);
  if (gamesResult.error || !gamesResult.data) return [];
  return (gamesResult.data as RealGameRow[]).map((row) => mapRow(row, roster));
}

export async function fetchRealGame(gameId: string): Promise<NFLGame | undefined> {
  const [gameResult, roster] = await Promise.all([
    supabase.from('real_games').select('*').eq('id', gameId).single(),
    loadActiveRoster(),
  ]);
  if (gameResult.error || !gameResult.data) return undefined;
  return mapRow(gameResult.data as RealGameRow, roster);
}

interface RefreshPropsResult {
  ok: boolean;
  onCooldown?: boolean;
  secondsRemaining?: number;
  gamesUpdated?: number;
  error?: string;
  /** Per-game failures during the batch (e.g. that specific event's odds call
      errored) -- the edge function has always returned this, it just wasn't
      declared here or read anywhere, so a game silently failing mid-refresh
      was invisible without a direct DB/SQL check (see chat). */
  gameErrors?: { gameId: string; matchup: string; error: string }[];
}

/** Calls the manually-triggered player-props Edge Function (see chat: kept off
 * the automatic cron on purpose, given its real per-game API cost). Server-side
 * cooldown-enforced — see 11_refresh_cooldown.sql — so this is safe to expose
 * as a button any tester can press. */
export async function refreshPlayerProps(): Promise<RefreshPropsResult> {
  const { data, error } = await supabase.functions.invoke('fetch-nfl-player-props', { method: 'POST' });
  if (error) return { ok: false, error: error.message };
  return data as RefreshPropsResult;
}