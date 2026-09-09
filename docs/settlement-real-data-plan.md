# Replacing the simulation engine with real settlement data

Fresh-eyes pass on the "how do we get real settled results instead of the sim engine" question. This is based on actually reading the current code, not on where the earlier conversation was leaning.

## TL;DR

Your suspicion is right: every wager, every weekly score, every matchup winner, and every standings update currently comes from a client-side seeded-random generator, with zero connection to a real game, even though you already have real pregame odds flowing in from The Odds API. The good news: the settlement *math* is already cleanly separated from where results come from, so this isn't a rewrite. It's a swap at one seam, plus moving that seam server-side and picking a real stats source for player props (which the Odds API can't give you).

## What's actually happening today (traced through the code)

**The slate you bet on is 100% fake.** `oddsService.getSlate()` / `getGame()` read from `data/seed.ts`, which builds an entire season's games and prop boards once at module load from `SCHEDULE` + `propsGenerator.ts` — a static, seeded dataset. Every screen that shows games (`LeagueHome`, `MarketBrowser`, `NFLSlate`) goes through this path.

**The result of every game is precomputed the same way, before anyone even places a bet.** Also in `data/seed.ts`:

```ts
export const GAME_RESULTS_BY_ID: Record<string, GameResult> = Object.fromEntries(
  NFL_GAMES.map((g) => [g.id, simulateGameResult(g)]),
);
```

`simulateGameResult()` (in `engine/settlement.ts`) invents a winner/loser score (winner 17-34, loser 6 to winner-1), derives home/away from that, and grades every market on the board — h2h, spreads, totals, and every player prop — against that invented score. It's a seeded RNG (`createRng(`${game.id}-result`)`), so it's stable across reloads, but it's not the real game. No network call happens anywhere in this file.

**Settlement only ever reads from that fake source.** `engine/simulateWeek.ts`'s `settleRoster()` calls `resultForGame(wager.gameId)`, which is just a lookup into `GAME_RESULTS_BY_ID`. This is the *only* thing feeding wager grading, and wager grading is the *only* thing feeding weekly team score:

```ts
// engine/scoring.ts
export function computeWeeklyScore(roster: WeeklyRoster, settings: LeagueSettings): number {
  const settledPL = roster.slots.reduce((sum, s) => sum + (s.wager?.settledProfit ?? 0), 0);
  return settledPL + computeIncompleteLineupPenalty(roster, settings);
}
```

Worth being explicit about, since it affects the data you need: **a team's weekly score in PropLeague is the sum of that team's settled bet profit/loss, not a stat-accumulation fantasy score.** So "settling a matchup" means "grading every wager against a real outcome," full stop — there's no separate stats layer to also get right.

That weekly score is what decides the matchup winner (`scoreMatchup()` in `simulateWeek.ts`), which feeds standings, the prize pool, and playoff bracket advancement. All of that only ever runs when someone clicks "Advance Week" or "Simulate to Week N" in `DevPanel.tsx`, which calls `simulationService.advanceWeek()` / `simulateToWeek()` straight into `advanceLeagueWeek()`. It's a dev/testing control, not something tied to real games finishing.

**There's a real path already built, just not wired into any of this.** `services/supabaseOdds.ts` has `fetchRealGamesForWeek()` / `fetchRealGame()`, reading a `real_games` table whose row shape (`RealGameRow`) already has `status`, `home_score`, `away_score` columns, plus a `real_players` roster crosswalk table fed from nflverse (the LA→LAR / AZ→ARI team-code fixups in that file are nflverse-specific, so that's confirmed). These are called from `useAppStore.loadRealGamesForWeek/loadRealGame`, which populate `realGamesByWeek`/`realGamesById` in the store — but nothing reads those slices back out. No screen renders them, and nothing in the settlement path touches them. It looks like the pregame-odds phase (and the player roster crosswalk) landed, and the "grade it after the fact" phase is the missing piece, which matches exactly what you described.

## The core insight: you don't need to touch the settlement math

Everything downstream of a result funnels through one shape:

```ts
interface GameResult {
  gameId: string;
  homeScore: number;
  awayScore: number;
  marketResults: MarketResult[];
}
```

`settleWager`, `computeWeeklyScore`, `scoreMatchup`, `computeStandings`, the prize pool math, playoff advancement, the weekly "moments" (biggest winner, worst beat, etc.) — none of them care whether that `GameResult` came from a random-number generator or a real box score. They just consume the shape. That means the actual fix is: **write a real producer of `GameResult`, and point the pipeline at it instead of `simulateGameResult()`.** Nothing in `engine/settlement.ts`'s grading logic, `scoring.ts`, `matchups.ts`, `standings.ts`, `prizePool.ts`, or `playoffs.ts` needs to change.

## Decision tree: where does each market's real data come from

Two very different data needs hide inside "settle the game," and it's worth treating them separately rather than looking for one provider that does both.

**Game-level markets (`h2h`, `spreads`, `totals`) — need only the final score.**

- Does the MLB/NFL/NBA Edge Finder already pull a final score for grading? → Reuse that exact call. You've said it works; don't stand up a second pattern for the same job.
- If not, or if you want PropLeague on its own pipeline: The Odds API has a `/scores` endpoint on the same account you're already paying for pregame lines with (`?daysFrom=` for completed games). One vendor, one key, one rate limit to watch, and it settles against scores from the same source your spreads/totals came from pregame — which is the cleanest story if a tester ever asks "why did this push/not push."
- ESPN's public scoreboard JSON is the free fallback if you'd rather not spend Odds API credits on scores, at the cost of a second integration pattern.

**Player props (`player_pass_yds`, `player_pass_tds`, `player_pass_interceptions`, `player_rush_yds`, `player_rush_attempts`, `player_reception_yds`, `player_receptions`, `player_anytime_td`, `player_kicking_points`, `player_field_goals`) — need real per-player box score stats. The Odds API doesn't have these at all.**

- Same first question: does an Edge Finder already resolve these for props? If yes, port that mapping rather than re-deriving it.
- Otherwise, default to **nflverse's weekly player stats** (the `nflreadr::load_player_stats()` family). This is the same data family `real_players` already comes from, so the ingestion pattern (edge function pulls nflverse's published data, normalizes team codes — you've already hit and fixed the LA/AZ mismatch once) is proven in this codebase already. It's usually available within an hour or two of the last game in a slate finishing.
- Column mapping is direct for six of the ten: `passing_yards`, `passing_tds`, `interceptions`, `rushing_yards`, `carries`, `receiving_yards`, `receptions`.
- `player_anytime_td` needs deriving: `rushing_tds + receiving_tds` (add return TDs too if you want those graded as anytime-TD hits).
- `player_kicking_points` / `player_field_goals` need deriving from `field_goals_made` / `extra_points_made` using whatever scoring rule the prop assumes (check `propsGenerator.ts`'s kicking market for the implied rule — it's currently synthetic, so confirm the real one matches before you ship it).
- ESPN's gamelog JSON (already used in the NFL Edge Finder) is the fallback here too, same reuse-over-rebuild logic.

## The other real change: who pulls the trigger, and where it runs

Swapping the data source alone still leaves two problems:

1. **Timing.** Games in a week finish on different days (Thu/Sun/Mon). A human clicking "Advance Week" whenever they remember isn't how a real season settles — it needs to be "once every real game in this week is final."
2. **Trust.** `advanceLeagueWeek()` runs entirely in the browser today, and the results get pushed up via `upsert_matchup` / `upsert_standing` / `settle_wager` RPCs in `services/supabaseSettlement.ts` — RPCs that, as far as this repo shows, any authenticated client can call directly. That's fine for a synthetic dev league. It's not something you want to be true once real standings and a real prize pool are on the line — nothing stops a client from just calling `upsert_standing` with whatever numbers it wants.

Both point at the same fix: move settlement into a scheduled Supabase Edge Function (Deno), triggered by cron, that checks "are this week's `real_games` all `status: final`," and if so runs the grading and writes the results itself using the service-role key. The pure engine functions (`settleWager`, `computeWeeklyScore`, `scoreMatchup`, `computeStandings`, `prizePool.ts`, `playoffs.ts`) are plain TypeScript with no browser dependency, so they can be imported into that function as-is — only the result *source* changes, same as on the client side. Tighten the `upsert_*` / `settle_wager` RPCs at the same time so they're not callable with arbitrary results from a plain client session.

Keep the simulated path alive behind a flag rather than deleting it — a "sandbox" league mode that still uses `data/seed.ts` and the DevPanel controls is genuinely useful for demos and for testers who don't want to wait on a real week to finish. `isSimulated` already exists on teams; the same idea extended to a league-level flag is a small addition, not new architecture.

## Concrete steps, in the order I'd do them

1. Add a `real_player_stats` table (game_id, player_id, stat columns) fed from nflverse, mirroring how `real_players` is fed today.
2. Add/extend an edge function that writes final `status` / `home_score` / `away_score` into `real_games` once a game ends (Odds API `/scores` or ESPN, per the decision tree above), and one that writes `real_player_stats` from nflverse — both cron-scheduled shortly after each week's last game.
3. Write `buildRealGameResult(gameRow, playerStatRows): GameResult`, matching `simulateGameResult`'s output shape, mapping each `MarketKey` per the table above (including the anytime-TD union and the kicking derivation).
4. Add the settlement edge function: loads the week's real games + stats, builds a `GameResult` per game, runs the existing `engine/` grading and scoring functions server-side, persists via the (now-tightened) `upsert_matchup` / `upsert_standing` / `settle_wager` RPCs.
5. Point the client at real games for browsing too: `oddsService.getSlate()` / `getGame()` should read `fetchRealGamesForWeek()` / `fetchRealGame()` (already written, already wired into the store, just not into the slate screens) instead of `data/seed.ts`, so what testers bet on pregame is the same game that gets graded postgame.
6. Repoint the two remaining `resultForGame()` UI call sites (`MatchupDetail.tsx`, `MatchupCard.tsx` — both use it for the live "already decided" expected-score heuristic) at the same real source once it exists.
7. Leave `data/seed.ts` / `DevPanel` in place behind a sandbox-league flag rather than removing them.

## For MLB/NBA later

Once this NFL pattern is solid, it's a template rather than a re-solve for the other sports: your Edge Finders have already worked out "where do settled stats come from" per sport (Statcast for MLB, whatever NBA lands on), so when PropLeague grows into those sports, port those exact sources over rather than re-researching a provider from scratch.
