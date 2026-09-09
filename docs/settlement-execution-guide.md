# Execution guide: real settlement pipeline

Everything that's pure code is already written into your repo (see "Already done" below). Everything left needs your Supabase login/secrets/network, so it's written as exact commands for you to run in Terminal. Go through this in order — each step assumes the previous one worked.

## Already done (in this repo right now)

- `src/engine/realGameResult.ts` — `buildRealGameResult()`, a real-data version of `simulateGameResult()`. Same grading rules, same `GameResult` shape, just fed a real score + real stat lines instead of an RNG. Nothing else in `engine/` needed to change.
- `supabase/migrations/0001_real_settlement.sql` — adds the one new table you need, `real_player_stats`.
- `supabase/functions/fetch-nfl-scores/index.ts` — pulls final scores from The Odds API's `/scores` endpoint into `real_games`.
- `supabase/functions/fetch-nfl-player-stats/index.ts` — pulls real player box scores from nflverse into `real_player_stats`.
- `supabase/functions/settle-week/index.ts` — the orchestrator: grades every pending wager for a finished week against real results, scores that week's matchups, recomputes standings.

Three things in these files are flagged with `TODO`/`ASSUMPTION` comments because I wrote them without a live connection to your Supabase project (no network access from where this ran) — read those three before you deploy, they're each a two-minute check:

1. `fetch-nfl-scores/index.ts` assumes `real_games.id` is the same id The Odds API gave that event when your existing pregame-odds ingestion wrote the row. If your ingestion uses a different id scheme, fix the match there.
2. `fetch-nfl-player-stats/index.ts` has a placeholder nflverse CSV URL — go to nflverse's GitHub releases and confirm the current `player_stats` asset URL and column names before relying on it.
3. `settle-week/index.ts` doesn't apply the incomplete-lineup penalty (`computeIncompleteLineupPenalty` in `engine/scoring.ts`) yet — it needs each league's `weeklyCredits`/`lineupSlots` settings, and I don't know where those live in your schema. Fine to defer; just know partial lineups won't get penalized through this path until you wire that in.

Also **scope note**: `settle-week` settles wagers, scores matchups, and updates standings. It does not advance `current_week`/`season_phase`, touch the playoff bracket, or run the prize pool/moments logic — those still live in `engine/simulateWeek.ts`. That's a deliberate, separate follow-up once this piece is verified working; see the bottom of this doc.

## Step 1 — Install and link the Supabase CLI

```bash
brew install supabase/tap/supabase
cd ~/PropLeague-v0.3.0   # or wherever this clone lives
supabase login
supabase link --project-ref <your-project-ref>
```

Your project ref is the string in your Supabase project's URL (`https://app.supabase.com/project/<ref>`) or in `VITE_SUPABASE_URL` in `.env.local` (the subdomain before `.supabase.co`).

## Step 2 — Set the one new secret

```bash
supabase secrets set ODDS_API_KEY=<your odds api key>
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically into every edge function — you don't set those.

## Step 3 — Run the migration

Review `supabase/migrations/0001_real_settlement.sql` once (it's additive-only, but sanity check the RLS policy against whatever `real_games`/`real_players` already use), then:

```bash
supabase db push
```

If that command isn't available in your CLI version, paste the file's contents into the Supabase dashboard's SQL Editor and run it there instead.

## Step 4 — Deploy the three functions

```bash
supabase functions deploy fetch-nfl-scores
supabase functions deploy fetch-nfl-player-stats
supabase functions deploy settle-week
```

## Step 5 — Test each one by hand before trusting cron with it

Pick a real NFL week that's already fully finished (so you have known-correct final scores/stats to check your work against), and run these one at a time, checking the response and the actual table rows after each:

```bash
curl -i -X POST "$VITE_SUPABASE_URL/functions/v1/fetch-nfl-scores" \
  -H "Authorization: Bearer <your service role key, from the dashboard>"
```
→ check `real_games` for that week: are `status`/`home_score`/`away_score` now correct?

```bash
curl -i -X POST "$VITE_SUPABASE_URL/functions/v1/fetch-nfl-player-stats" \
  -H "Authorization: Bearer <service role key>" \
  -H "Content-Type: application/json" \
  -d '{"week": "3", "season": "2025"}'
```
→ check `real_player_stats`: spot-check two or three players you know the real stat line for.

```bash
curl -i -X POST "$VITE_SUPABASE_URL/functions/v1/settle-week" \
  -H "Authorization: Bearer <service role key>" \
  -H "Content-Type: application/json" \
  -d '{"week": "3"}'
```
→ check `wagers` (status/settled_profit), `matchups` (scores/winner_id), and `standings` for a test league at that week. This is the one worth checking carefully by hand against a wager or two you can grade yourself — it's grading real money-adjacent outcomes.

Do this against a test/sandbox league first, not a league with real testers in it, until you trust the numbers.

## Step 6 — Schedule them

Once step 5 looks right, add cron triggers in the Supabase dashboard (Database → Cron, or Edge Functions → your function → Cron) or via CLI:

```bash
supabase functions deploy fetch-nfl-scores --schedule "15 * * * *"   # hourly, catches Thu/Sun/Mon finishes
supabase functions deploy fetch-nfl-player-stats --schedule "0 */4 * * *"
supabase functions deploy settle-week --schedule "30 */4 * * *"      # after the two above have a chance to land
```

(Exact cron support varies by CLI version — if `--schedule` isn't recognized, use the dashboard's Cron UI instead, same idea: scores → player stats → settle-week, in that order, each with a few minutes of buffer.)

## Step 7 — Flip the client over, once you trust it

Right now every screen that shows the slate (`LeagueHome`, `MarketBrowser`, `NFLSlate`) reads from `oddsService.getSlate()`/`getGame()`, which reads the simulated `data/seed.ts` dataset — not `real_games`. `fetchRealGamesForWeek()`/`fetchRealGame()` in `services/supabaseOdds.ts` already exist and are already wired into the store (`loadRealGamesForWeek`/`loadRealGame`), just not read by any screen.

Do this swap last, deliberately, once you've verified a couple of real weeks settle correctly — it changes what testers actually see and bet on:

- Replace `getSlate`/`getGame`'s bodies in `services/oddsService.ts` (or the call sites in `LeagueHome.tsx`, `MarketBrowser.tsx`, `NFLSlate.tsx`) to use `fetchRealGamesForWeek`/`fetchRealGame` instead of `gamesForWeekBase`/`gameByIdBase`. Note these become async — the call sites currently expect a synchronous array/object back, so this touches the calling components too, not just the service.
- Repoint the two `resultForGame()` call sites used for the live "already decided" heuristic (`MatchupDetail.tsx`, `MatchupCard.tsx`) at real results the same way.
- Leave `data/seed.ts` and the `DevPanel` simulate buttons in place behind a sandbox-league flag rather than deleting them — still useful for demos/testing without waiting on a real week.

I'd treat this swap as its own follow-up conversation once steps 1-6 are proven out, since it's a bigger behavior change than the backend plumbing.

## What's deliberately still open after all of this

- `current_week`/`season_phase` advancement, playoff bracket progression, and the prize pool/moments logic still run through the old simulated `advanceLeagueWeek` path. Once `settle-week` is proven, the natural next step is porting just that state-machine piece (which doesn't need real data, just needs to run *after* `settle-week` instead of instead of it) into a scheduled function too.
- The incomplete-lineup penalty and scratched-wager handling (both flagged above) for the real path.
- Locking down the `settle_wager`/`upsert_matchup`/`upsert_standing` RPCs so they're not directly callable by an ordinary authenticated client anymore, now that a service-role edge function is the intended caller.
