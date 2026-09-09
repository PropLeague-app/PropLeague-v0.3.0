-- Step 2 of real-data settlement: server-side automatic season progression.
--
-- Two new columns on `leagues`:
--   settings   jsonb -- the league's LeagueSettings object (weeklyCredits, playoffTeams,
--                       eliminationType, conferencesEnabled, poolMultipliers, etc). Was
--                       previously 100% client-local (see chat) -- this is the actual
--                       blocker for server-side automation, since the settle-week edge
--                       function needs to know a league's playoff field size/elimination
--                       type/conference setup to decide when and how to advance it.
--   prize_pool jsonb -- mirrors the client's PrizePool shape ({initial, current, locked,
--                       history}). Previously only ever computed and held in-memory on
--                       whichever device last ran the simulation engine.
--
-- Both nullable: existing leagues keep null until the client writes real values
-- (on next Settings save for `settings`; `prize_pool` is created server-side the
-- first time a buy-in-enabled league's week auto-settles). settle-week falls back to
-- sane defaults when `settings` is null so older leagues don't get stuck.
alter table public.leagues add column if not exists settings jsonb;
alter table public.leagues add column if not exists prize_pool jsonb;
