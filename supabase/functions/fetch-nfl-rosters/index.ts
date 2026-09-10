// Supabase Edge Function: fetch-nfl-rosters
//
// Fetches the real, current NFL roster from nflverse (confirmed genuinely
// current -- unlike player_stats.csv, roster_2026.csv correctly reflects real
// 2026 transactions like the A.J. Brown trade and Romeo Doubs signing to New
// England) and upserts it into public.real_players.
//
// This replaces PropLeague's static data/players.ts as the source of truth for
// player-name/team crosswalk matching (src/services/supabaseOdds.ts) -- that
// file goes stale the moment a real trade happens; this table doesn't, as long
// as this function keeps running.
//
// Deploy: Supabase Dashboard -> Edge Functions -> Deploy a new function -> Via Editor
// No secret needed -- nflverse's files are public.
// Schedule: Dashboard -> Integrations -> Cron -> daily, same as the other nflverse fetch
// (roster moves -- trades, signings, releases, practice-squad activity -- can
// happen any day during the season, not just once)

import { createClient } from 'npm:@supabase/supabase-js@2';
import Papa from 'npm:papaparse@5';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const ROSTER_URL = 'https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_2026.csv';

// Identical to data/players.ts's own slug() -- ids must match that existing
// scheme exactly, since wagers/rosters already reference `${team}-${slug(name)}`
// throughout the app.
function slug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

interface RosterRow {
  team: string;
  position: string;
  depth_chart_position: string;
  status: string;
  full_name: string;
}

interface RealPlayerRow {
  id: string;
  full_name: string;
  team: string;
  position: string;
  depth_chart_position: string | null;
  status: string;
  updated_at: string;
}

Deno.serve(async (_req: Request) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const res = await fetch(ROSTER_URL);
  if (!res.ok) {
    return new Response(JSON.stringify({ error: `Roster fetch failed: ${res.status}` }), { status: 502 });
  }
  const text = await res.text();

  // Streaming (step callback), same memory lesson as fetch-nflverse-player-stats
  // -- this file is much smaller (~3K rows vs ~134K), but there's no reason not
  // to apply the same safe pattern rather than risk it again.
  const nowIso = new Date().toISOString();
  const rows: RealPlayerRow[] = [];
  const seenIds = new Set<string>();
  Papa.parse<RosterRow>(text, {
    header: true,
    skipEmptyLines: true,
    step: (row: Papa.ParseStepResult<RosterRow>) => {
      const r = row.data;
      if (!r.full_name || !r.team) return;
      const id = `${r.team}-${slug(r.full_name)}`;
      // Defensive, not addressing an observed problem: checked directly against
      // the real file and found zero cases of the same (team, name) pair
      // appearing twice. Multiple people sharing a name (e.g. two different
      // "Justin Jefferson"s) naturally produce different ids here since team
      // differs, so both are correctly kept -- this guard is just a safety net,
      // not a fix for something actually seen.
      if (seenIds.has(id)) return;
      seenIds.add(id);
      rows.push({
        id,
        full_name: r.full_name,
        team: r.team,
        position: r.position,
        depth_chart_position: r.depth_chart_position || null,
        status: r.status,
        updated_at: nowIso,
      });
    },
  });

  if (rows.length === 0) {
    return new Response(JSON.stringify({ error: 'Parsed 0 rows -- something is wrong with the fetch or file format' }), { status: 500 });
  }

  const { error } = await supabase.from('real_players').upsert(rows, { onConflict: 'id' });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, playersUpserted: rows.length }), {
    headers: { 'Content-Type': 'application/json' },
  });
});