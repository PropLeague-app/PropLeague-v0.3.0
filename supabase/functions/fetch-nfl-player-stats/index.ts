// Pulls real per-player box scores into real_player_stats for one week.
//
// Rewritten to match the table's REAL columns (found by querying
// information_schema directly -- don't trust the shape assumed on a first
// pass without checking): id, season, week, player_name, recent_team,
// position, passing_yards, passing_tds, passing_interceptions,
// rushing_yards, rushing_tds, rushing_attempts, receiving_yards,
// receiving_tds, receptions, field_goals_made, kicking_points, updated_at.
// No game_id/player_id -- rows are matched elsewhere by week + player_name.
//
// Two names here diverge from nflverse's own raw CSV headers -- mapped below:
//   nflverse `interceptions`  -> this table's `passing_interceptions`
//   nflverse `carries`        -> this table's `rushing_attempts`
// `kicking_points` isn't a raw nflverse column either -- it's derived here
// at ingestion time (3 pts/FG + 1 pt/XP, the standard-scoring default the
// simulated propsGenerator assumed -- adjust if your real kicker props use a
// different table). nflverse's main player_stats CSV doesn't carry field
// goal/extra point counts (those are believed to live in a separate kicking-
// specific nflverse asset) -- field_goals_made/kicking_points are left at 0
// until that's wired in; the TODO below marks exactly where.
//
// STILL UNVERIFIED (no network access from where this was written -- confirm
// before deploying): the exact current nflverse release URL and column names.
// Go to https://github.com/nflverse/nflverse-data/releases, find the current
// "player_stats" release, and check the CSV asset's actual header row against
// RAW_COLUMNS below.
//
// Uses delete-then-insert per (season, week) rather than upsert, since this
// table's unique constraints (if any) weren't visible from here either --
// safe to rerun for the same week without needing to know that.

import { createClient } from 'npm:@supabase/supabase-js@2';

// TODO: confirm against the current nflverse release before deploying.
const NFLVERSE_PLAYER_STATS_CSV_URL = 'https://github.com/nflverse/nflverse-data/releases/download/player_stats/player_stats.csv';

function parseCsv(text: string): Record<string, string>[] {
  const [headerLine, ...lines] = text.trim().split('\n');
  const headers = headerLine.split(',');
  return lines.filter(Boolean).map((line) => {
    const cells = line.split(',');
    return Object.fromEntries(headers.map((h, i) => [h, cells[i]]));
  });
}

Deno.serve(async (req) => {
  const { week, season } = await req.json().catch(() => ({ week: null, season: null }));
  if (week == null || season == null) {
    return new Response(JSON.stringify({ ok: false, error: 'missing week and/or season' }), { status: 400 });
  }
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const res = await fetch(NFLVERSE_PLAYER_STATS_CSV_URL);
  if (!res.ok) {
    return new Response(JSON.stringify({ ok: false, error: `nflverse fetch ${res.status}` }), { status: 500 });
  }
  const rows = parseCsv(await res.text());

  const toInsert: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (String(row.season) !== String(season)) continue;
    if (String(row.week) !== String(week)) continue;

    // FG/XP made -- TODO: wire to nflverse's kicking-specific asset; 0 until then.
    const fieldGoalsMade = 0;
    const extraPointsMade = 0;

    toInsert.push({
      season: Number(season),
      week: String(week),
      player_name: row.player_display_name ?? row.player_name,
      recent_team: row.recent_team,
      position: row.position,
      passing_yards: Number(row.passing_yards ?? 0),
      passing_tds: Number(row.passing_tds ?? 0),
      passing_interceptions: Number(row.interceptions ?? 0),
      rushing_yards: Number(row.rushing_yards ?? 0),
      rushing_tds: Number(row.rushing_tds ?? 0),
      rushing_attempts: Number(row.carries ?? 0),
      receiving_yards: Number(row.receiving_yards ?? 0),
      receiving_tds: Number(row.receiving_tds ?? 0),
      receptions: Number(row.receptions ?? 0),
      field_goals_made: fieldGoalsMade,
      kicking_points: fieldGoalsMade * 3 + extraPointsMade * 1,
      updated_at: new Date().toISOString(),
    });
  }

  if (toInsert.length === 0) {
    return new Response(JSON.stringify({ ok: true, inserted: 0, note: 'no matching rows -- check week/season and the CSV URL/columns' }));
  }

  const { error: delErr } = await supabase.from('real_player_stats').delete().eq('season', Number(season)).eq('week', String(week));
  if (delErr) return new Response(JSON.stringify({ ok: false, error: delErr.message }), { status: 500 });

  const { error: insErr } = await supabase.from('real_player_stats').insert(toInsert);
  return new Response(JSON.stringify({ ok: !insErr, inserted: toInsert.length, error: insErr?.message }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
