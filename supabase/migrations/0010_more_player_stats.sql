-- Stat columns for five new player-prop markets (see chat, Sept 2026):
--   player_pass_attempts       -> passing_attempts
--   player_pass_completions    -> passing_completions
--   player_rush_longest        -> long_rushing
--   player_reception_longest   -> long_reception
--   player_pats                -> extra_points_made
--
-- All nullable numerics, no default: NULL means "the stats provider reported
-- nothing for this player on this stat" (e.g. passing_attempts for a
-- linebacker), same convention as every existing stat column here. Existing
-- rows simply stay NULL until fetch-balldontlie-player-stats next upserts them
-- (it re-upserts every final game's rows on each 15-minute run, so they
-- backfill on their own).
--
-- DEPLOY ORDER MATTERS: run this migration BEFORE redeploying
-- fetch-balldontlie-player-stats -- the redeployed function upserts these
-- columns, and an upsert naming a column that doesn't exist yet fails the whole
-- request, which would stop ALL stat ingestion (and therefore all prop grading).
alter table public.real_player_stats
  add column if not exists passing_attempts numeric,
  add column if not exists passing_completions numeric,
  add column if not exists long_rushing numeric,
  add column if not exists long_reception numeric,
  add column if not exists extra_points_made numeric;
