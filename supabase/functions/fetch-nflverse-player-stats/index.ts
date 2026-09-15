// SUPERSEDED (Sept 2026, see chat): fetch-balldontlie-player-stats is now the
// sole source of truth for public.real_player_stats. This function doesn't
// spend Odds API credits (nflverse is a free GitHub file), so it wasn't part of
// the credit-usage problem -- but it upserts to the exact same table on the
// exact same (season, week, player_name) conflict key as balldontlie, with NO
// final-game gating at all (see the balldontlie file's header for why that
// gating matters -- the Mack Hollins incident). Running both is two sources
// racing to write the same wager-grading row, which is worse than either alone.
// Disable this function's cron job in the Dashboard -- balldontlie fully
// replaces it now. Left deployed but should go idle -- not deleted here,
// that's your call.
//
// Supabase Edge Function: fetch-nflverse-player-stats
//
// Fetches real NFL player box-score stats from nflverse (a free, actively-
// maintained open dataset published as CSV files on GitHub releases) and
// upserts them into public.real_player_stats, for grading player-prop wagers.
//
// This REPLACES the ESPN-based approach (fetch-nfl-player-stats): ESPN's
// unofficial API is blocked at the Akamai WAF level for server-side/data-center
// traffic (confirmed via a real 403 with an errors.edgesuite.net reference,
// not fixable with request headers) -- see chat. nflverse's data is served as
// plain files from GitHub's release CDN, which doesn't do this kind of blocking.
//
// Deploy: Supabase Dashboard -> Edge Functions -> Deploy a new function -> Via Editor
// No secret needed -- nflverse's files are public, no API key.
// Schedule: Dashboard -> Integrations -> Cron -> daily, same as fetch-nfl-odds
//
// Verified before writing this: real column names, real file URLs, and the CSV
// parser (papaparse) all confirmed directly against the actual current file --
// including cross-checking one real player's real 2024 stats line to make sure
// the parsed values aren't just error-free but actually correct. The one thing
// that ISN'T yet verified: whether nflverse has added 2026 season data yet --
// as of today it only goes through 2024. This function correctly handles that
// (upserts nothing if the current season isn't in the file yet) rather than
// erroring, but the actual presence of 2026 data still needs a real check once
// Week 1 games happen.

import { createClient } from 'npm:@supabase/supabase-js@2';
import Papa from 'npm:papaparse@5';
import { getSupabaseAdminKey } from '../_shared/supabaseAdminKey.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ADMIN_KEY = getSupabaseAdminKey();

const OFFENSE_URL = 'https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats.csv';
const KICKING_URL = 'https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats_kicking.csv';

// Same anchor as fetch-nfl-odds -- 2026 NFL Week 1 kicks off Wed Sept 9, 2026.
const SEASON_WEEK_1_START = new Date('2026-09-09T00:00:00Z').getTime();
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;
const CURRENT_SEASON = '2026';

function currentWeekEstimate(): number {
  const diff = Date.now() - SEASON_WEEK_1_START;
  return diff < 0 ? 1 : Math.min(Math.max(Math.floor(diff / MS_PER_WEEK) + 1, 1), 18);
}

interface OffenseRow {
  player_display_name: string;
  recent_team: string;
  position: string;
  season: string;
  week: string;
  passing_yards: string;
  passing_tds: string;
  interceptions: string;
  carries: string;
  rushing_yards: string;
  rushing_tds: string;
  receptions: string;
  receiving_yards: string;
  receiving_tds: string;
}
interface KickingRow {
  player_display_name: string;
  team: string;
  position: string;
  season: string;
  week: string;
  fg_made: string;
  pat_made: string;
}

interface PlayerStatRow {
  season: number;
  week: string;
  player_name: string;
  recent_team: string | null;
  position: string | null;
  passing_yards: number | null;
  passing_tds: number | null;
  passing_interceptions: number | null;
  rushing_yards: number | null;
  rushing_tds: number | null;
  rushing_attempts: number | null;
  receiving_yards: number | null;
  receiving_tds: number | null;
  receptions: number | null;
  field_goals_made: number | null;
  kicking_points: number | null;
  updated_at: string;
}

function toNum(raw: string | undefined): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function fetchAndFilterCsv<T extends { season: string }>(url: string, season: string): Promise<T[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed for ${url}: ${res.status}`);
  const text = await res.text();
  // Streaming (step callback) rather than building the full parsed array first:
  // this file has ~134K rows across 26 seasons, and materializing all of them as
  // full JS objects before filtering measured at ~565MB peak heap in testing --
  // comfortably past what an Edge Function can allocate. Filtering row-by-row
  // during parse and only keeping the current season (a few thousand rows)
  // measured at ~23MB instead. Confirmed this is what caused the
  // WORKER_RESOURCE_LIMIT failure -- not a guess.
  const kept: T[] = [];
  Papa.parse<T>(text, {
    header: true,
    skipEmptyLines: true,
    step: (row: Papa.ParseStepResult<T>) => {
      if (row.data.season === season) kept.push(row.data);
    },
  });
  return kept;
}

Deno.serve(async (_req: Request) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ADMIN_KEY);
  const nowIso = new Date().toISOString();
  const approxWeek = currentWeekEstimate();

  let currentSeasonOffense: OffenseRow[];
  let currentSeasonKicking: KickingRow[];
  try {
    [currentSeasonOffense, currentSeasonKicking] = await Promise.all([
      fetchAndFilterCsv<OffenseRow>(OFFENSE_URL, CURRENT_SEASON),
      fetchAndFilterCsv<KickingRow>(KICKING_URL, CURRENT_SEASON),
    ]);
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 502 });
  }

  const rows: PlayerStatRow[] = currentSeasonOffense.map((r) => ({
    season: Number(r.season),
    week: r.week,
    player_name: r.player_display_name,
    recent_team: r.recent_team || null,
    position: r.position || null,
    passing_yards: toNum(r.passing_yards),
    passing_tds: toNum(r.passing_tds),
    passing_interceptions: toNum(r.interceptions),
    rushing_yards: toNum(r.rushing_yards),
    rushing_tds: toNum(r.rushing_tds),
    rushing_attempts: toNum(r.carries),
    receiving_yards: toNum(r.receiving_yards),
    receiving_tds: toNum(r.receiving_tds),
    receptions: toNum(r.receptions),
    field_goals_made: null,
    kicking_points: null,
    updated_at: nowIso,
  }));

  for (const r of currentSeasonKicking) {
    const fgMade = toNum(r.fg_made);
    const patMade = toNum(r.pat_made);
    rows.push({
      season: Number(r.season),
      week: r.week,
      player_name: r.player_display_name,
      recent_team: r.team || null,
      position: r.position || null,
      passing_yards: null,
      passing_tds: null,
      passing_interceptions: null,
      rushing_yards: null,
      rushing_tds: null,
      rushing_attempts: null,
      receiving_yards: null,
      receiving_tds: null,
      receptions: null,
      field_goals_made: fgMade,
      // Standard scoring approximation: 3 pts/FG regardless of distance, 1 pt/PAT.
      // A known simplification -- distance-based FG scoring would need fg_made_*
      // band columns instead; fine for now, worth revisiting if leagues want it.
      kicking_points: fgMade != null && patMade != null ? fgMade * 3 + patMade : null,
      updated_at: nowIso,
    });
  }

  if (rows.length > 0) {
    const { error } = await supabase.from('real_player_stats').upsert(rows, { onConflict: 'season,week,player_name' });
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
  }

  return new Response(
    JSON.stringify({
      ok: true,
      currentSeasonInFile: currentSeasonOffense.length > 0 || currentSeasonKicking.length > 0,
      approxCurrentWeek: approxWeek,
      offenseRowsUpserted: currentSeasonOffense.length,
      kickingRowsUpserted: currentSeasonKicking.length,
      note:
        currentSeasonOffense.length === 0
          ? `No ${CURRENT_SEASON} season data in the file yet -- expected until nflverse rolls in the current season. Not an error.`
          : undefined,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});