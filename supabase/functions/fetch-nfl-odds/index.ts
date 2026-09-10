// Supabase Edge Function: fetch-nfl-odds
//
// Fetches live/upcoming NFL game odds (h2h, spreads, totals) and recent scores
// from The Odds API, and upserts them into public.real_games.
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
interface ScoreApiGame {
  id: string;
  commence_time: string;
  completed: boolean;
  home_team: string;
  away_team: string;
  scores: { name: string; score: string }[] | null;
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

function scoreFor(game: { home_team: string; away_team: string }, score: ScoreApiGame | undefined) {
  const home = score?.scores?.find((s) => s.name === game.home_team)?.score;
  const away = score?.scores?.find((s) => s.name === game.away_team)?.score;
  return {
    home: home != null ? Number(home) : null,
    away: away != null ? Number(away) : null,
  };
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

  // 1. Live/upcoming odds — game-level markets only (see file header for why).
  const oddsRes = await fetch(
    `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds/?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`,
  );
  if (!oddsRes.ok) {
    return new Response(JSON.stringify({ error: `Odds fetch failed: ${oddsRes.status} ${await oddsRes.text()}` }), { status: 502 });
  }
  const oddsGames = (await oddsRes.json()) as OddsApiGame[];

  // 2. Live + recently-completed scores (up to 3 days back).
  const scoresRes = await fetch(`https://api.the-odds-api.com/v4/sports/americanfootball_nfl/scores/?apiKey=${ODDS_API_KEY}&daysFrom=3`);
  if (!scoresRes.ok) {
    return new Response(JSON.stringify({ error: `Scores fetch failed: ${scoresRes.status} ${await scoresRes.text()}` }), { status: 502 });
  }
  const scoreGames = (await scoresRes.json()) as ScoreApiGame[];
  const scoresById = new Map(scoreGames.map((g) => [g.id, g]));

  // Fetch existing bookmakers data for every game about to be upserted, so
  // fresh game-level markets can be merged into it rather than replacing it
  // outright -- see mergeBookmakers above for why this matters.
  const allIds = [...new Set([...oddsGames.map((g) => g.id), ...scoreGames.map((g) => g.id)])];
  const { data: existingRows } = await supabase.from('real_games').select('id, bookmakers').in('id', allIds);
  const existingBookmakersById = new Map((existingRows ?? []).map((r) => [r.id as string, (r.bookmakers ?? []) as BookmakerRow[]]));

  const nowIso = new Date().toISOString();
  const rows: RealGameRow[] = oddsGames.map((game) => {
    const score = scoresById.get(game.id);
    const { home, away } = scoreFor(game, score);
    const status: RealGameRow['status'] = score?.completed ? 'final' : home != null ? 'live' : 'upcoming';
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
      status,
      home_score: home,
      away_score: away,
      bookmakers: mergeBookmakers(existingBookmakersById.get(game.id) ?? [], freshBookmakers),
      updated_at: nowIso,
    };
  });

  // The /odds endpoint stops returning a game once it's no longer upcoming/live
  // (confirmed in The Odds API's own docs), so a just-finished game would never
  // get its final score saved without this: pick up any completed game from the
  // scores response that already dropped out of the odds response.
  const oddsIds = new Set(oddsGames.map((g) => g.id));
  for (const score of scoreGames) {
    if (oddsIds.has(score.id) || !score.completed) continue;
    const { home, away } = scoreFor(score, score);
    rows.push({
      id: score.id,
      sport_key: 'americanfootball_nfl',
      week: computeWeek(score.commence_time),
      day_slot: computeDaySlot(score.commence_time),
      kickoff: score.commence_time,
      home_team: score.home_team,
      away_team: score.away_team,
      status: 'final',
      home_score: home,
      away_score: away,
      bookmakers: [],
      updated_at: nowIso,
    });
  }

  const { error } = await supabase.from('real_games').upsert(rows, { onConflict: 'id' });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, gamesUpserted: rows.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});