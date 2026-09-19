// Supabase Edge Function: fetch-nfl-player-props
//
// Fetches ALL player prop markets for upcoming games and updates their
// bookmakers data in public.real_games. This is real, necessary infrastructure
// -- not optional -- but genuinely more expensive than fetch-nfl-odds: player
// props are ONLY available via The Odds API's per-EVENT odds endpoint (the bulk
// /odds endpoint used by fetch-nfl-odds doesn't include them at all), meaning
// one API call per game rather than one call for the whole slate.
//
// DELIBERATELY NOT ON THE CRON SCHEDULE. Trigger manually (Dashboard -> Edge
// Functions -> fetch-nfl-player-props -> Test) whenever fresh props are needed,
// rather than an automatic timer burning quota on a fixed interval during the
// test phase.
//
// Deploy: Supabase Dashboard -> Edge Functions -> Deploy a new function -> Via Editor
// Secret needed: ODDS_API_KEY (same one fetch-nfl-odds already uses)
//
// HONEST CAVEAT: The Odds API's per-event response shape is well-documented for
// the bulk endpoint (confirmed against fetch-nfl-odds's real 272-game result),
// but I could not verify the EXACT shape of the per-event endpoint's player-prop
// outcomes against real live data the way I did for the bulk one -- api access
// isn't reachable from where I develop this. Built defensively (one game
// failing doesn't break the batch) and the response reports exactly what
// happened per game, so a real test run will show clearly if anything about the
// shape doesn't match what's coded here.
//
// Player-name resolution to PropLeague's local playerId is deliberately NOT done
// here -- this function just stores whatever player identifier The Odds API
// returns (typically in each outcome's `description` field). The actual
// name-matching (src/engine/playerNameMatch.ts) runs client-side when the app
// reads this data, so the crosswalk logic lives in exactly one place.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { getSupabaseAdminKey } from '../_shared/supabaseAdminKey.ts';

const ODDS_API_KEY = Deno.env.get('ODDS_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ADMIN_KEY = getSupabaseAdminKey();

const PLAYER_PROP_MARKETS = [
  'player_pass_yds',
  'player_pass_tds',
  'player_pass_interceptions',
  'player_rush_yds',
  'player_rush_attempts',
  'player_pass_rush_yds',
  'player_anytime_td',
  'player_reception_yds',
  'player_receptions',
  'player_rush_reception_yds',
  'player_kicking_points',
  'player_field_goals',
].join(',');
const ALL_MARKETS = `h2h,spreads,totals,${PLAYER_PROP_MARKETS}`;

// Only refresh games happening soon -- props for a game 10 weeks out aren't
// actionable yet and would just multiply cost for no real benefit.
const LOOKAHEAD_DAYS = 8;

interface UpcomingGame {
  id: string;
  home_team: string;
  away_team: string;
}

interface OddsApiOutcome {
  name: string;
  description?: string;
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
interface OddsApiEventOdds {
  id: string;
  bookmakers: OddsApiBookmaker[];
}

// Cooldown so this manual-trigger function can't be re-run too often — matters
// most for the in-app "Refresh Odds" button (any of 16-32 testers could click
// it), enforced atomically in Postgres (see 11_refresh_cooldown.sql), not just
// a client-side disable that a page refresh would bypass.
const COOLDOWN_MINUTES = 15;

// Supabase's edge runtime does NOT add CORS headers on its own -- every
// function that's actually called from a browser/webview (via
// supabase.functions.invoke, like this one from the in-app "Refresh Odds"
// button) has to send these itself, including on an OPTIONS preflight, or
// the request never even reaches here: the client's fetch() rejects outright
// with a generic network-style error before any response body exists to
// inspect (see chat -- "Failed to send a request to the Edge Function" every
// single time, not intermittently, is exactly what a missing-CORS failure
// looks like from the client side). This is the ONLY function in this app
// ever invoked this way -- every other one only runs via the Dashboard's own
// Test button, which isn't subject to browser CORS at all, which is why this
// gap never surfaced anywhere else.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (!ODDS_API_KEY) {
    return new Response(JSON.stringify({ error: 'ODDS_API_KEY secret is not set' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ADMIN_KEY);

  const { data: cooldown, error: cooldownError } = await supabase
    .rpc('try_claim_refresh_cooldown', { p_function_name: 'fetch-nfl-player-props', p_cooldown_minutes: COOLDOWN_MINUTES })
    .single();
  if (cooldownError) {
    return new Response(JSON.stringify({ error: cooldownError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  const { claimed, seconds_remaining } = cooldown as { claimed: boolean; seconds_remaining: number };
  if (!claimed) {
    // Deliberately 200, not 429: this is an expected, informative outcome the
    // client needs to read and display, not a server error — and it sidesteps
    // any uncertainty about how the Supabase JS client's functions.invoke()
    // surfaces a non-2xx body, which hasn't been exercised from the app itself
    // yet (unlike every other function so far, called only via the Dashboard).
    return new Response(JSON.stringify({ ok: false, onCooldown: true, secondsRemaining: seconds_remaining }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const cutoff = new Date(Date.now() + LOOKAHEAD_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: games, error: fetchError } = await supabase
    .from('real_games')
    .select('id, home_team, away_team')
    .eq('status', 'upcoming')
    .lte('kickoff', cutoff)
    .returns<UpcomingGame[]>();

  if (fetchError) {
    return new Response(JSON.stringify({ error: fetchError.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!games || games.length === 0) {
    return new Response(JSON.stringify({ ok: true, gamesProcessed: 0, note: 'No upcoming games in the lookahead window.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let succeeded = 0;
  const gameErrors: { gameId: string; matchup: string; error: string }[] = [];

  for (const game of games) {
    try {
      const res = await fetch(
        `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/events/${game.id}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=${ALL_MARKETS}&oddsFormat=american`,
      );
      if (!res.ok) {
        gameErrors.push({ gameId: game.id, matchup: `${game.away_team} @ ${game.home_team}`, error: `${res.status} ${await res.text()}` });
        continue;
      }
      const eventOdds = (await res.json()) as OddsApiEventOdds;
      const bookmakers = eventOdds.bookmakers.map((b) => ({
        key: b.key,
        title: b.title,
        markets: b.markets.map((m) => ({ key: m.key, outcomes: m.outcomes })),
      }));

      // props_updated_at is separate from updated_at on purpose -- updated_at
      // also gets bumped by fetch-nfl-odds's hourly game-lines cron, which
      // would make every game look freshly-refreshed even when props
      // specifically haven't been touched in days (see 0009_props_updated_at.sql
      // and the client's useOddsFreshness -- the "Odds have not been refreshed
      // in N hours" warning needs a timestamp only THIS function ever writes).
      const now = new Date().toISOString();
      const { error: updateError } = await supabase
        .from('real_games')
        .update({ bookmakers, updated_at: now, props_updated_at: now })
        .eq('id', game.id);
      if (updateError) {
        gameErrors.push({ gameId: game.id, matchup: `${game.away_team} @ ${game.home_team}`, error: updateError.message });
        continue;
      }
      succeeded++;
    } catch (err) {
      gameErrors.push({ gameId: game.id, matchup: `${game.away_team} @ ${game.home_team}`, error: String(err) });
    }
  }

  return new Response(
    JSON.stringify({ ok: true, gamesInWindow: games.length, gamesUpdated: succeeded, gameErrors }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});