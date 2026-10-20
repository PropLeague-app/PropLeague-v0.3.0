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
  'player_pass_attempts',
  'player_pass_completions',
  'player_rush_longest',
  'player_reception_longest',
  'player_pats',
].join(',');
const ALL_MARKETS = `h2h,spreads,totals,${PLAYER_PROP_MARKETS}`;

// Only refresh games in the PropLeague week currently being played, which ends when results reveal
// on Tuesday morning (RESULTS_REVEAL_CUTOFF_HOUR_ET in settle-week).
//
// This used to be a flat 8-day window. On a Sunday afternoon that reached into the following
// Thursday through Sunday, so the batch asked The Odds API for events it does not publish yet and
// got a 404 for each one: a refresh mid-week returned "13 games failed (404: Event not found)"
// listing most of next week's slate (see chat, Oct 2026). Those games were never actionable anyway,
// since a pick cannot be made for a week that has not opened.
const REVEAL_CUTOFF_HOUR_ET = 10;

/** The end of the week being played now: the coming Tuesday at 10am ET. Tuesday before 10am still
 * belongs to the week that is finishing, so that morning returns the same day's cutoff rather than
 * jumping a week forward.
 *
 * All of the day arithmetic happens on Eastern calendar fields, never on the UTC date. Adding the
 * day offset straight onto the UTC date is wrong for any evening ET time, because after 8pm ET the
 * UTC date is already tomorrow: a Thursday 9pm refresh computed 5 days from an ET Thursday and
 * added them to a UTC Friday, landing the cutoff on a Wednesday.
 *
 * Intl rather than a fixed offset so it does not drift across the EST/EDT change, and the hour is
 * normalized for the ICU quirk where hour12:false can format midnight as "24" (same reasoning as
 * pastResultsRevealCutoff in settle-week). */
function etFields(d: Date): { weekday: string; hour: number; year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const rawHour = get('hour') || '0';
  return {
    weekday: get('weekday') || 'Sun',
    hour: rawHour === '24' ? 0 : Number(rawHour),
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
  };
}

function weekCutoff(now: Date): Date {
  const et = etFields(now);
  const order = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const TUE = 2;
  let days = (TUE - Math.max(0, order.indexOf(et.weekday)) + 7) % 7;
  // Tuesday itself: before the reveal the week is still running and ends today; after it, the new
  // week has opened and runs to next Tuesday.
  if (days === 0 && et.hour >= REVEAL_CUTOFF_HOUR_ET) days = 7;

  // Calendar arithmetic on the ET date, carried out in UTC purely as a counter so month and year
  // rollovers are handled for us, then read back as plain y/m/d.
  const target = new Date(Date.UTC(et.year, et.month - 1, et.day) + days * 86_400_000);

  // That ET date at 10am ET, as an instant. Start from the EST guess and correct once if the date
  // actually falls in EDT, rather than hardcoding either offset.
  let cutoff = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate(), REVEAL_CUTOFF_HOUR_ET + 5));
  const drift = etFields(cutoff).hour - REVEAL_CUTOFF_HOUR_ET;
  if (drift !== 0) cutoff = new Date(cutoff.getTime() - drift * 3_600_000);
  return cutoff;
}


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
  /** Deep link straight to this outcome on that book's bet slip, from includeLinks=true.
   * Passed through to the stored bookmakers blob untouched; see fetch-nfl-odds for the rest. */
  link?: string;
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

  const now = new Date();
  const cutoff = weekCutoff(now).toISOString();
  const { data: games, error: fetchError } = await supabase
    .from('real_games')
    .select('id, home_team, away_team')
    .eq('status', 'upcoming')
    // A game that has already kicked off is gone from The Odds API's events feed, so asking for its
    // odds is a guaranteed 404. status alone does not catch that: it is written by a cron that runs
    // every 15 minutes, so there is always a window where a started game is still marked upcoming.
    .gt('kickoff', now.toISOString())
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
        `https://api.the-odds-api.com/v4/sports/americanfootball_nfl/events/${game.id}/odds?apiKey=${ODDS_API_KEY}&regions=us&markets=${ALL_MARKETS}&oddsFormat=american&includeLinks=true`,
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