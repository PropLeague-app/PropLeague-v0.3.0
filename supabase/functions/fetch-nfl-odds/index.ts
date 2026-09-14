// Supabase Edge Function: fetch-nfl-odds
//
// Fetches live/upcoming NFL game odds (h2h, spreads, totals) from The Odds
// API, and upserts them into public.real_games. This is also the function
// that creates real_games rows in the first place (the pregame odds feed is
// the first place a given week's games show up).
//
// CHANGED (Sept 2026, see chat -- audit after the balldontlie migration):
// this used to ALSO call The Odds API's /scores endpoint every run and write
// status/home_score/away_score here, which (a) kept spending Odds API credits
// on something we deliberately moved off Odds API, contradicting "only use
// The Odds API for the actual odds," and (b) raced against
// fetch-balldontlie-player-stats's much more frequent (every 15 min) sync of
// those same three columns -- this function running every few hours could
// silently stomp fresher balldontlie data with stale/re-derived Odds API
// data. Fixed by dropping the /scores call entirely: status/home_score/
// away_score are now ONLY ever written by fetch-balldontlie-player-stats.
// This function still needs to write *something* into those columns the
// first time a game row is created (before balldontlie or anyone else has
// touched it) -- new rows default to status 'upcoming', scores null, which
// is correct since a game just appearing in the pregame odds feed hasn't
// kicked off yet in the overwhelming majority of cases. For a row that
// already exists, the existing status/home_score/away_score are carried
// forward unchanged (same merge-don't-clobber approach already used for
// bookmakers below, extended to these three columns).
//
// Also removed the "pick up a completed game that dropped out of the /odds
// feed" backfill pass that used to run off the same /scores call -- no
// longer needed, since fetch-balldontlie-player-stats's /games call already
// covers every game for a week regardless of whether it still has an active
// betting market.
//
// Deploy: Supabase Dashboard -> Edge Functions -> Deploy a new function -> Via Editor
// Secret needed: ODDS_API_KEY (Dashboard -> Edge Functions -> Secrets)
// Schedule: Dashboard -> Integrations -> Cron -> call this function every few hours
//
// Deliberately out of scope for this first version: player prop odds. The bulk
// /odds endpoint used below doesn't include them at all -- they require a
// separate API call PER GAME via the /event odds endpoint, which is a materially
// different (larger) quota cost. That's a follow-up increment where the exact
// markets/frequency should be a deliberate choice, not something bundled in here.

import { createClient } from 'npm:@supabase/supabase-js@2';

const ODDS_API_KEY = Deno.env.get('ODDS_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// 2026 NFL Week 1 kicks off Wed Sept 9, 2026 (Seahawks @ Patriots). Later weeks
// are approximated as 7-day blocks from this anchor -- close enough for
// grouping/display; an occasional holiday-shifted game might land a day off at a
// week boundary, which is a cosmetic issue, not a functional one.
const SEASON_WEEK_1_START = new Date('2026-09-09T00:00:00Z').getTime();
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

function computeWeek(commenceTime: string): string {
  const diff = new Date(commenceTime).getTime() - SEASON_WEEK_1_START;
  const week = diff < 0 ? 1 : Math.floor(diff / MS_PER_WEEK) + 1;
  return String(Math.min(Math.max(week, 1), 18));
}

// Uses the real America/New_York timezone (handles the EDT/EST switch
// automatically) rather than a fixed offset — NFL season spans both: September
// games are EDT (UTC-4), games from early November on are EST (UTC-5). A fixed
// offset gets half the season's late-Sunday/SNF boundary wrong.
const ET_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  weekday: 'short',
  hour: 'numeric',
  hour12: false,
});

function computeDaySlot(commenceTime: string): string {
  const parts = ET_PARTS.formatToParts(new Date(commenceTime));
  const weekday = parts.find((p) => p.type === 'weekday')?.value;
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0') % 24;
  // Wed and Sat are both real, recurring parts of the actual NFL schedule --
  // Wed for season-openers/international games (like the 2026 Week 1 NE @ SEA
  // game), Sat for several late-season weeks -- not edge cases to leave
  // falling through to the SUN_EARLY catch-all, which is what happened before
  // this fix and is exactly why that game showed up mis-grouped.
  if (weekday === 'Wed') return 'WED';
  if (weekday === 'Thu') return 'TNF';
  if (weekday === 'Sat') return 'SAT';
  if (weekday === 'Mon') return 'MNF';
  if (weekday === 'Sun') {
    if (hour < 16) return 'SUN_EARLY';
    if (hour < 18) return 'SUN_LATE';
    return 'SNF';
  }
  return 'SUN_EARLY';
}

interface OddsApiOutcome {
  name: string;
  price: number;
  point?: number;
}
interface OddsApiMarket {
  key: string;
  outcomes: OddsApiOutcome[];
}
interface OddsApiBookmaker {
  key: string;
  title: string;
  markets: OddsApiMarket[];
}
interface OddsApiGame {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: OddsApiBookmaker[];
}

interface RealGameRow {
  id: string;
  sport_key: string;
  week: string;
  day_slot: string;
  kickoff: string;
  home_team: string;
  away_team: string;
  status: 'upcoming' | 'live' | 'final';
  home_score: number | null;
  away_score: number | null;
  bookmakers: { key: string; title: string; markets: { key: string; outcomes: OddsApiOutcome[] }[] }[];
  updated_at: string;
}

type BookmakerRow = { key: string; title: string; markets: { key: string; outcomes: OddsApiOutcome[] }[] };

const GAME_LEVEL_KEYS = new Set(['h2h', 'spreads', 'totals']);

// This function only ever fetches game-level markets (h2h/spreads/totals) --
// fetch-nfl-player-props is what adds player-prop markets to the same
// bookmakers column, on its own separate manual trigger. A plain upsert would
// overwrite the whole `bookmakers` value with ONLY this function's game-level
// data, silently destroying any player props already stored there -- which is
// exactly what happened the moment this function's cron (or a manual
// re-trigger, like the one just used to fix day_slot) next ran after someone
// had fetched props. Merging by bookmaker key, keeping any non-game-level
// markets already present, is what actually fixes this rather than papering
// over a single occurrence of it.
function mergeBookmakers(existing: BookmakerRow[], fresh: BookmakerRow[]): BookmakerRow[] {
  const existingByKey = new Map(existing.map((b) => [b.key, b]));
  const freshByKey = new Map(fresh.map((b) => [b.key, b]));
  const allKeys = new Set([...existingByKey.keys(), ...freshByKey.keys()]);

  const merged: BookmakerRow[] = [];
  for (const key of allKeys) {
    const existingBookmaker = existingByKey.get(key);
    const freshBookmaker = freshByKey.get(key);
    const preservedPropMarkets = (existingBookmaker?.markets ?? []).filter((m) => !GAME_LEVEL_KEYS.has(m.key));
    const freshGameLevelMarkets = (freshBookmaker?.markets ?? []).filter((m) => GAME_LEVEL_KEYS.has(m.key));
    merged.push({
      key,
      title: freshBookmaker?.title ?? existingBookmaker?.title ?? key,
      markets: [...freshGameLevelMarkets, ...preservedPropMarkets],
    });
  }
  return merged;
}

Deno.serve(async (_req: Request) => {
  if (!ODDS_API_KEY) {
    return new Response(JSON.stringify({ error: 'ODDS_API_KEY secret is not set' }), { status: 500 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Live/upcoming odds — game-level markets only (see file header for why).
  const oddsRes = await fetch(
    `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`,
  );
  if (!oddsRes.ok) {
    return new Response(JSON.stringify({ error: `Odds fetch failed: ${oddsRes.status} ${await oddsRes.text()}` }), { status: 502 });
  }
  const oddsGames = (await oddsRes.json()) as OddsApiGame[];

  // Fetch existing bookmakers + status/scores for every game about to be
  // upserted. Bookmakers get merged (see mergeBookmakers). status/home_score/
  // away_score are carried forward as-is when a row already exists -- this
  // function no longer derives those from Odds API at all (see file header);
  // fetch-balldontlie-player-stats owns them exclusively now. A brand-new row
  // (no existing data) defaults to 'upcoming'/null/null, correct for a game
  // just now appearing in the pregame odds feed.
  const allIds = [...new Set(oddsGames.map((g) => g.id))];
  const { data: existingRows } = await supabase
    .from('real_games')
    .select('id, bookmakers, status, home_score, away_score')
    .in('id', allIds);
  const existingByid = new Map((existingRows ?? []).map((r) => [r.id as string, r]));

  const nowIso = new Date().toISOString();
  const rows: RealGameRow[] = oddsGames.map((game) => {
    const existing = existingByid.get(game.id);
    const freshBookmakers: BookmakerRow[] = game.bookmakers.map((b) => ({
      key: b.key,
      title: b.title,
      markets: b.markets.map((m) => ({ key: m.key, outcomes: m.outcomes })),
    }));
    return {
      id: game.id,
      sport_key: 'americanfootball_nfl',
      week: computeWeek(game.commence_time),
      day_slot: computeDaySlot(game.commence_time),
      kickoff: game.commence_time,
      home_team: game.home_team,
      away_team: game.away_team,
      status: (existing?.status as RealGameRow['status'] | undefined) ?? 'upcoming',
      home_score: (existing?.home_score as number | null | undefined) ?? null,
      away_score: (existing?.away_score as number | null | undefined) ?? null,
      bookmakers: mergeBookmakers((existing?.bookmakers as BookmakerRow[] | undefined) ?? [], freshBookmakers),
      updated_at: nowIso,
    };
  });

  const { error } = await supabase.from('real_games').upsert(rows, { onConflict: 'id' });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, gamesUpserted: rows.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
