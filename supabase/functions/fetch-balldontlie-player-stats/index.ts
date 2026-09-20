// Supabase Edge Function: fetch-balldontlie-player-stats
//
// Fetches real per-player box-score stats from balldontlie's NFL API and
// upserts them into public.real_player_stats, for grading player-prop wagers.
// Replaces fetch-sportsdata-player-stats: SportsDataIO's trial key was
// confirmed (not assumed) to return perturbed numbers for real stat fields,
// not just the fields it explicitly labels "Scrambled" -- verified against a
// known-true result (Mack Hollins' real 4 receptions / 51 yards came back as
// 3.7 / 49.1, and Hunter Henry's receptions came back as a fractional 2.8,
// which can't be a real single-game count). balldontlie was verified the same
// way before this was written: a real curl with a real All-Star-tier key
// returned Hollins' exact real line -- 4 receptions, 51 yards, clean integers,
// no scrambling -- for the real Sept 9 2026 SEA @ NE game.
//
// ALSO (added Sept 2026, see chat): keeps public.real_games' status/home_score/
// away_score in sync, for every game this same /games call returns -- not just
// the final ones used for stats below. This replaces fetch-nfl-scores, which
// pulled from The Odds API's /scores endpoint and was burning credits running
// every 15 min around the clock for something balldontlie already includes at
// no extra cost (the /games endpoint is available even on balldontlie's Free
// tier, per their docs). fetch-nfl-scores' cron job should be disabled once
// this is confirmed working -- left in the repo for now, not deleted.
//
// real_games has no balldontlie id to join against -- its id/home_team/
// away_team were written by the Odds-API-based pregame ingestion
// (fetch-nfl-odds), which stores full team names ("Seattle Seahawks"), not
// abbreviations. So the sync below matches on (week, home_team full name,
// away_team full name) instead, using balldontlie's own home_team.full_name /
// visitor_team.full_name fields -- confirmed via balldontlie's own docs to be
// the full "City Name" form (e.g. "Kansas City Chiefs"), same convention The
// Odds API uses. NOT yet verified against a real live API response from
// here (no network path to balldontlie's actual API from this environment) --
// check the `results[].gamesNoMatch` / `gamesNoMatchSample` fields in this
// function's response after the next real run to confirm every game matched;
// a non-zero gamesNoMatch means a team-name spelling mismatch to fix here.
//
// Deploy: Supabase Dashboard -> Edge Functions -> Deploy a new function -> Via Editor
// Secret needed: BALLDONTLIE_API_KEY (Dashboard -> Edge Functions -> Secrets) --
// NEVER hardcode the real key here or anywhere that gets committed to git.
// Requires the All-Star tier or above -- the Stats endpoint (what this function
// actually needs for player stats) is not available on balldontlie's free tier.
// Schedule: Dashboard -> Integrations -> Cron -> every 15 min, every day (see
// chat) -- safe to run this often, no cooldown here and no meaningful rate
// limit at this volume.
//
// IMPORTANT: only games balldontlie itself marks final (game.status_state ===
// 'final') get their player rows upserted into real_player_stats. Every other
// game's stat rows are skipped entirely, not stored with a placeholder --
// same defensive posture as the SportsDataIO version, guarding against the
// exact defaulting-to-zero bug that mis-graded real wagers (see chat, the
// Mack Hollins incident). Rerunning this for a week already in the table
// safely overwrites any bad data a prior run wrote, via the same (season,
// week, player_name) upsert key. The real_games sync above is separate and
// deliberately less strict -- it also reflects 'in_progress' games as 'live'
// with whatever score balldontlie currently reports, since a live score
// display isn't wager-grading-sensitive the way player stats are.
//
// The /stats endpoint has no direct week filter -- it's fetched by game_ids[],
// so this fetches that week's games first (which DOES support weeks[]), keeps
// only the final ones, then fetches stats scoped to just those game ids.
// Both endpoints paginate via a `meta.next_cursor` field; both are paged all
// the way through here rather than assuming everything fits on one page.
//
// KNOWN GAP: playoff weeks (WC/DIV/CONF) aren't handled. balldontlie does
// support postseason via season_types[]=3, but how its own week numbering
// maps onto this app's WC/DIV/CONF week ids wasn't verified against real
// data, so those weeks are skipped with a note in the response rather than
// guessed at -- worth a real look once the postseason is closer. (The
// real_games score sync above is skipped for those weeks too, same reason.)

import { createClient } from 'npm:@supabase/supabase-js@2';
import { getSupabaseAdminKey } from '../_shared/supabaseAdminKey.ts';

const BALLDONTLIE_API_KEY = Deno.env.get('BALLDONTLIE_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ADMIN_KEY = getSupabaseAdminKey();
const API_BASE = 'https://api.balldontlie.io/nfl/v1';

// Same anchor as the other fetch-* functions -- 2026 NFL Week 1 kicks off Wed
// Sept 9, 2026. Bump this (and CURRENT_SEASON) each new season.
const CURRENT_SEASON = 2026;

interface BdlTeam {
  abbreviation: string;
}
interface BdlGameTeam {
  full_name: string;
}
interface BdlPlayer {
  first_name: string;
  last_name: string;
  position_abbreviation: string | null;
}
interface BdlGame {
  id: number;
  week: number;
  season: number;
  status_state: string; // 'final' | 'in_progress' | 'scheduled' | ...
  home_team: BdlGameTeam;
  visitor_team: BdlGameTeam;
  home_team_score: number | null;
  visitor_team_score: number | null;
}
interface BdlStatRow {
  player: BdlPlayer;
  team: BdlTeam;
  game: BdlGame;
  passing_yards: number | null;
  passing_touchdowns: number | null;
  passing_interceptions: number | null;
  rushing_yards: number | null;
  rushing_touchdowns: number | null;
  rushing_attempts: number | null;
  receiving_yards: number | null;
  receiving_touchdowns: number | null;
  receptions: number | null;
  field_goals_made: number | null;
  extra_points_made: number | null;
  // Added with the pass attempts/completions, longest rush/reception and XP markets.
  // Typed loosely (number | string) so an unexpected string value degrades gracefully
  // via nLoose() below instead of silently becoming null.
  passing_attempts?: number | string | null;
  passing_completions?: number | string | null;
  long_rushing?: number | string | null;
  long_reception?: number | string | null;
}
interface BdlMeta {
  next_cursor?: string | number | null;
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
  passing_attempts: number | null;
  passing_completions: number | null;
  long_rushing: number | null;
  long_reception: number | null;
  extra_points_made: number | null;
  updated_at: string;
}

function n(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// For the newer columns only: also accepts a numeric string ("23"), which n() above
// would silently turn into null.
function nLoose(v: number | string | null | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

async function fetchAllPages<T>(path: string, params: Record<string, string | string[]>): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | number | undefined;
  for (;;) {
    const url = new URL(`${API_BASE}${path}`);
    for (const [key, val] of Object.entries(params)) {
      for (const v of Array.isArray(val) ? val : [val]) url.searchParams.append(key, v);
    }
    url.searchParams.set('per_page', '100');
    if (cursor != null) url.searchParams.set('cursor', String(cursor));

    const res = await fetch(url.toString(), { headers: { Authorization: BALLDONTLIE_API_KEY! } });
    if (!res.ok) throw new Error(`${path} fetch failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { data: T[]; meta?: BdlMeta };
    out.push(...body.data);
    if (!body.meta?.next_cursor) break;
    cursor = body.meta.next_cursor;
  }
  return out;
}

Deno.serve(async (req: Request) => {
  // Top-level safety net (added Sept 2026, see chat, same reasoning as
  // settle-week's own copy of this comment) -- catches anything that isn't
  // already one of the explicit try/catches below, so a genuinely
  // unexpected throw returns a diagnosable JSON error instead of a bare,
  // contentless 500. Not re-indented for the same reason.
  try {
  if (!BALLDONTLIE_API_KEY) {
    return new Response(JSON.stringify({ error: 'BALLDONTLIE_API_KEY secret is not set' }), { status: 500 });
  }

  let body: { week?: string | number; season?: number } = {};
  try {
    body = await req.json();
  } catch {
    // Cron invocations send no body -- normal case.
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ADMIN_KEY);
  const season = body.season ?? CURRENT_SEASON;

  // Auto-discover every week currently "live" for at least one league, unless
  // the caller explicitly asked for one (manual/testing invocation) -- same
  // pattern settle-week itself uses.
  let weeksToProcess: string[];
  if (body.week != null) {
    weeksToProcess = [String(body.week)];
  } else {
    const { data: activeLeagues, error: activeErr } = await supabase
      .from('leagues')
      .select('current_week')
      .in('season_phase', ['regular', 'playoffs']);
    if (activeErr) return new Response(JSON.stringify({ ok: false, error: activeErr.message }), { status: 500 });
    weeksToProcess = [...new Set((activeLeagues ?? []).map((l) => String(l.current_week)))];
  }

  const nowIso = new Date().toISOString();
  const perWeek: Record<string, unknown>[] = [];

  for (const weekStr of weeksToProcess) {
    const weekNum = Number(weekStr);
    if (!Number.isInteger(weekNum) || weekNum < 1) {
      // Playoff week ids (WC/DIV/CONF) -- see file header KNOWN GAP.
      perWeek.push({ week: weekStr, skipped: true, reason: 'non-numeric week (playoffs) -- balldontlie postseason week mapping not yet verified, see file header' });
      continue;
    }

    let games: BdlGame[];
    try {
      games = await fetchAllPages<BdlGame>('/games', { 'seasons[]': String(season), 'weeks[]': weekStr, 'season_types[]': '2' });
    } catch (err) {
      perWeek.push({ week: weekStr, error: String(err) });
      continue;
    }

    // Keep real_games' status/score fresh from this same /games call -- see
    // file header. Runs for every game regardless of final/live/scheduled,
    // independent of the player-stats path below.
    //
    // Also stamps final_since the FIRST time (and only the first time) a game
    // is observed as final -- settle-week uses this to wait out a grace
    // period after a game goes final before trusting real_player_stats for
    // grading. Needed because balldontlie can still revise a player's box
    // score for a few minutes after posting the final score/status, and a
    // wager is only ever graded once (see chat: the Lamar Jackson pass+rush
    // yds incident, Sept 2026 -- his real total was well over the line, but
    // an early/incomplete stat snapshot got graded as a loss and, since
    // settle-week never re-grades an already-settled wager, stayed wrong
    // until manually corrected). Requires the real_games.final_since column
    // (migration below, run this yourself in the SQL editor):
    //   alter table real_games add column if not exists final_since timestamptz;
    const { data: existingGameRows } = await supabase
      .from('real_games')
      .select('home_team, away_team, final_since')
      .eq('week', weekStr);
    const existingFinalSinceByKey = new Map(
      (existingGameRows ?? []).map((r) => [`${r.home_team}::${r.away_team}`, r.final_since as string | null]),
    );

    let gamesUpdated = 0;
    let gamesNoMatch = 0;
    const gamesNoMatchSample: { home: string; away: string }[] = [];
    for (const g of games) {
      // Per-game try/catch (added Sept 2026, see chat): this loop previously
      // had no error boundary of its own at all -- a thrown exception on any
      // single game (a transient network blip on one of these N sequential
      // awaited Supabase calls, a malformed game object, etc.) crashed the
      // ENTIRE Deno.serve handler as a bare 500 with no error text anywhere,
      // which also meant the /stats fetch + real_player_stats upsert further
      // down NEVER ran for that week -- exactly the symptom that showed up as
      // games sitting "final" for hours with none of their wagers grading.
      // Recording the failure and moving on to the next game keeps one bad
      // game from taking the whole week's stats ingestion down with it.
      try {
        let status: 'final' | 'live' | null = null;
        if (g.status_state === 'final') status = 'final';
        else if (g.status_state && g.status_state !== 'scheduled') status = 'live';
        if (!status) continue; // still pregame -- nothing to update yet

        const patch: Record<string, unknown> = { status };
        const homeScore = n(g.home_team_score);
        const awayScore = n(g.visitor_team_score);
        if (homeScore != null) patch.home_score = homeScore;
        if (awayScore != null) patch.away_score = awayScore;

        if (status === 'final') {
          const existingFinalSince = existingFinalSinceByKey.get(`${g.home_team.full_name}::${g.visitor_team.full_name}`);
          if (!existingFinalSince) patch.final_since = nowIso;
        }

        const { data: matched, error: syncErr } = await supabase
          .from('real_games')
          .update(patch)
          .eq('week', weekStr)
          .eq('home_team', g.home_team.full_name)
          .eq('away_team', g.visitor_team.full_name)
          .select('id');

        if (syncErr) {
          gamesNoMatch++; // counts as unmatched for visibility; message goes in perWeek below
          gamesNoMatchSample.push({ home: g.home_team.full_name, away: `${g.visitor_team.full_name} (error: ${syncErr.message})` });
        } else if (!matched || matched.length === 0) {
          gamesNoMatch++;
          if (gamesNoMatchSample.length < 5) gamesNoMatchSample.push({ home: g.home_team.full_name, away: g.visitor_team.full_name });
        } else {
          gamesUpdated++;
        }
      } catch (err) {
        gamesNoMatch++;
        gamesNoMatchSample.push({
          home: g.home_team?.full_name ?? '?',
          away: `${g.visitor_team?.full_name ?? '?'} (threw: ${err instanceof Error ? err.message : String(err)})`,
        });
      }
    }
    const scoreSync = { gamesUpdated, gamesNoMatch, gamesNoMatchSample: gamesNoMatchSample.slice(0, 5) };

    const finalGameIds = games.filter((g) => g.status_state === 'final').map((g) => String(g.id));

    if (finalGameIds.length === 0) {
      perWeek.push({ week: weekStr, gamesThisWeek: games.length, finalGames: 0, upserted: 0, note: 'no games final yet for this week', ...scoreSync });
      continue;
    }

    let statRows: BdlStatRow[];
    try {
      statRows = await fetchAllPages<BdlStatRow>('/stats', { 'game_ids[]': finalGameIds, 'seasons[]': String(season), 'season_types[]': '2' });
    } catch (err) {
      perWeek.push({ week: weekStr, error: String(err), ...scoreSync });
      continue;
    }

    const rows: PlayerStatRow[] = statRows.map((r) => {
      const fgMade = n(r.field_goals_made);
      const xpMade = n(r.extra_points_made);
      return {
        season,
        week: weekStr,
        player_name: `${r.player.first_name} ${r.player.last_name}`.trim(),
        recent_team: r.team?.abbreviation ?? null,
        position: r.player.position_abbreviation ?? null,
        passing_yards: n(r.passing_yards),
        passing_tds: n(r.passing_touchdowns),
        passing_interceptions: n(r.passing_interceptions),
        rushing_yards: n(r.rushing_yards),
        rushing_tds: n(r.rushing_touchdowns),
        rushing_attempts: n(r.rushing_attempts),
        receiving_yards: n(r.receiving_yards),
        receiving_tds: n(r.receiving_touchdowns),
        receptions: n(r.receptions),
        field_goals_made: fgMade,
        passing_attempts: nLoose(r.passing_attempts),
        passing_completions: nLoose(r.passing_completions),
        long_rushing: nLoose(r.long_rushing),
        long_reception: nLoose(r.long_reception),
        extra_points_made: xpMade,
        // Same standard-scoring approximation the earlier fetch-* functions
        // used: 3 pts/FG regardless of distance, 1 pt/XP.
        kicking_points: fgMade != null && xpMade != null ? fgMade * 3 + xpMade : null,
        updated_at: nowIso,
      };
    });

    if (rows.length === 0) {
      perWeek.push({ week: weekStr, gamesThisWeek: games.length, finalGames: finalGameIds.length, upserted: 0, note: 'final games but no stat rows returned', ...scoreSync });
      continue;
    }

    // Two different real players can share an exact name (see
    // engine/playerNameMatch.ts's own comment on this same risk) -- rare, but
    // real_player_stats is keyed only on (season, week, player_name), with no
    // player id or team in the conflict target to disambiguate. When the
    // /stats response contains two rows that collide on that key, Postgres's
    // multi-row ON CONFLICT DO UPDATE doesn't just drop the colliding pair --
    // it fails the ENTIRE upsert statement, which is exactly what blocked
    // every player from all of this week's final games (not just the
    // collision) and left two real, final games' wagers sitting ungraded for
    // hours (see chat, Sept 2026 -- confirmed via this function's own
    // now-caught error: "ON CONFLICT DO UPDATE command cannot affect row a
    // second time"). Deduping here trades "the colliding player(s) might get
    // the wrong one of the two lines" for "everyone else's real stats still
    // get saved" -- the right call until real_player_stats has a better key.
    const seen = new Map<string, PlayerStatRow>();
    const duplicateNames: string[] = [];
    for (const row of rows) {
      const key = `${row.season}|${row.week}|${row.player_name.trim().toLowerCase()}`;
      if (seen.has(key)) duplicateNames.push(row.player_name);
      seen.set(key, row); // last one wins
    }
    const dedupedRows = [...seen.values()];

    const { error: upsertErr } = await supabase.from('real_player_stats').upsert(dedupedRows, { onConflict: 'season,week,player_name' });
    if (upsertErr) {
      perWeek.push({ week: weekStr, error: upsertErr.message, ...scoreSync });
      continue;
    }
    perWeek.push({
      week: weekStr,
      gamesThisWeek: games.length,
      finalGames: finalGameIds.length,
      upserted: dedupedRows.length,
      ...(duplicateNames.length > 0 ? { duplicateNames } : {}),
      ...scoreSync,
    });
  }

  return new Response(JSON.stringify({ ok: true, season, weeksProcessed: weeksToProcess, results: perWeek }), {
    headers: { 'Content-Type': 'application/json' },
  });
  } catch (err) {
    console.error('fetch-balldontlie-player-stats uncaught error:', err);
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err), stack: err instanceof Error ? err.stack : undefined }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
