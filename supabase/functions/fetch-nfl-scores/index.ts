// SUPERSEDED (Sept 2026, see chat): fetch-balldontlie-player-stats now syncs
// real_games' status/home_score/away_score itself, off the same /games call it
// already makes every 15 min for player stats -- balldontlie's Games endpoint
// includes scores for free (even on the Free tier), so this function's Odds API
// usage was pure waste running around the clock. Disable this function's cron
// job in the Dashboard once the balldontlie sync is confirmed working (check
// its response's gamesNoMatch/gamesNoMatchSample fields after a real run).
// Left deployed but should go idle -- not deleted here, that's your call.
//
// Pulls real final scores from The Odds API's /scores endpoint and writes them
// into real_games (status + home_score + away_score). Meant to run on a cron
// schedule a bit after each day's last kickoff window closes (e.g. hourly on
// game days covers Thu/Sun/Mon without over-polling).
//
// ASSUMPTION (couldn't verify against your live schema from here): real_games.id
// is the same event id The Odds API assigned when your existing pregame-odds
// ingestion wrote these rows. If your ingestion function generated its own ids
// instead, swap the `id: event.id` match below for however you already
// correlate an Odds API event back to a real_games row.
//
// Secrets this needs (set once): supabase secrets set ODDS_API_KEY=... 
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (or the new SUPABASE_SECRET_KEYS,
// see _shared/supabaseAdminKey.ts) are already injected automatically
// for every edge function -- no need to set those yourself.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { getSupabaseAdminKey } from '../_shared/supabaseAdminKey.ts';

const ODDS_API_KEY = Deno.env.get('ODDS_API_KEY')!;
const SPORT_KEY = 'americanfootball_nfl';

interface OddsApiScoreEvent {
  id: string;
  completed: boolean;
  commence_time: string;
  home_team: string;
  away_team: string;
  scores: { name: string; score: string }[] | null;
}

Deno.serve(async (_req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, getSupabaseAdminKey());

  const url = `https://api.the-odds-api.com/v4/sports/${SPORT_KEY}/scores/?apiKey=${ODDS_API_KEY}&daysFrom=3`;
  const res = await fetch(url);
  if (!res.ok) {
    return new Response(JSON.stringify({ ok: false, error: `Odds API ${res.status}: ${await res.text()}` }), { status: 500 });
  }
  const events = (await res.json()) as OddsApiScoreEvent[];

  let finalCount = 0;
  let liveCount = 0;
  let completedCount = 0; // kept for the same response shape as before -- alias of finalCount
  let noMatchCount = 0;
  const errors: string[] = [];
  const noMatchSample: { id: string; home_team: string; away_team: string }[] = [];
  const now = Date.now();

  for (const event of events) {
    const kickoff = new Date(event.commence_time).getTime();
    if (Number.isNaN(kickoff) || kickoff > now) continue; // hasn't kicked off yet -- leave as 'upcoming'

    let patch: Record<string, unknown>;
    if (event.completed && event.scores) {
      const homeScoreRow = event.scores.find((s) => s.name === event.home_team);
      const awayScoreRow = event.scores.find((s) => s.name === event.away_team);
      if (!homeScoreRow || !awayScoreRow) continue;
      patch = { status: 'final', home_score: Number(homeScoreRow.score), away_score: Number(awayScoreRow.score) };
      completedCount++;
    } else {
      // Kicked off, not completed yet -- mark live. If the API is already reporting
      // a live score for it, carry that along too (UNVERIFIED here -- I couldn't
      // confirm from where this was written whether The Odds API populates `scores`
      // for in-progress games before `completed` flips true, or only once final.
      // Harmless either way: home_score/away_score just won't update mid-game if it
      // doesn't, status still correctly flips to 'live').
      const homeScoreRow = event.scores?.find((s) => s.name === event.home_team);
      const awayScoreRow = event.scores?.find((s) => s.name === event.away_team);
      patch = { status: 'live' };
      if (homeScoreRow) patch.home_score = Number(homeScoreRow.score);
      if (awayScoreRow) patch.away_score = Number(awayScoreRow.score);
      liveCount++;
    }

    const { data, error } = await supabase.from('real_games').update(patch).eq('id', event.id).select('id');

    if (error) {
      errors.push(`${event.id}: ${error.message}`);
    } else if (!data || data.length === 0) {
      // Matched an Odds API event, but no real_games row has this id -- the
      // id-matching assumption flagged in the file header may be wrong.
      noMatchCount++;
      if (noMatchSample.length < 5) noMatchSample.push({ id: event.id, home_team: event.home_team, away_team: event.away_team });
    } else if (patch.status === 'final') {
      finalCount++;
    }
  }

  return new Response(
    JSON.stringify({
      ok: errors.length === 0,
      eventsFromApi: events.length,
      completedEvents: completedCount,
      updated: finalCount,
      markedLive: liveCount,
      noMatchInRealGames: noMatchCount,
      noMatchSample,
      errors,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
