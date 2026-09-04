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

/** Loads the live, current NFL roster (real_players — see the chat: PropLeague's
 * old static data/players.ts went stale the moment a real trade happened; this
 * table doesn't, as long as fetch-nfl-rosters keeps running). Fetched once per
 * games-for-week call and threaded through, rather than queried per outcome —
 * a week's worth of games can have hundreds of prop outcomes, and this avoids
 * turning that into hundreds of round-trips. */
async function loadActiveRoster(): Promise<RosterCandidate[]> {
  const { data, error } = await supabase.from('real_players').select('id, full_name, team, position').eq('status', 'ACT');
  if (error || !data) return [];
  return (data as { id: string; full_name: string; team: string; position: string }[]).map((p) => ({
    id: p.id,
    playerName: p.full_name,
    team: p.team,
    position: p.position,
  }));
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
// the same market -- without filtering, a player's "Passing TDs" market would
// show up once per bookmaker, which is exactly the clutter Hunter reported.
// Simulated data never had this problem (it only ever generated one bookmaker's
// worth of lines). This is the immediate fix: default to one preferred book.
// Making this a real, commissioner-only league setting (with a UI to pick it) is
// a separate, larger piece of work -- tied to a broader point about
// commissioner-locked settings in general, worth doing but not rushed in here.
const PREFERRED_BOOKMAKER_KEY = 'draftkings';

function pickPreferredBookmaker(bookmakers: RawBookmaker[]): RawBookmaker[] {
  const preferred = bookmakers.find((b) => b.key === PREFERRED_BOOKMAKER_KEY);
  if (preferred) return [preferred];
  // DraftKings didn't have a line for this specific game (rare, but possible) --
  // fall back to whichever bookmaker is first, rather than showing zero odds.
  return bookmakers.length > 0 ? [bookmakers[0]] : [];
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
    bookmakers: pickPreferredBookmaker(row.bookmakers).map((b) => mapBookmaker(b, homeAbbrev, awayAbbrev, roster)),
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