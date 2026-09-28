-- One-time data repair for the late-season-start bug (see chat, 0013_season_
-- start_week.sql). Run this AFTER 0012 and 0013 are applied and settle-week
-- has been redeployed. Three steps, meant to be run one at a time -- STEP 1
-- is read-only; look at what it returns before running STEP 2 or STEP 3.
--
-- IMPORTANT: 0013 adds `season_start_week`, but it only ever gets STAMPED by
-- mark_season_started(), which only runs when a commissioner (re-)triggers
-- schedule generation. Every league that already existed before 0013 was
-- deployed -- including ones that started perfectly on time, with no bug --
-- will have season_start_week sitting at NULL. settle-week's new gate treats
-- NULL as "not started yet" and skips the incomplete-lineup penalty entirely,
-- so without this repair, deploying 0013 alone would silently turn OFF the
-- missed-picks penalty for every existing league, not just the one affected
-- league. STEP 2 below backfills season_start_week for every league, not
-- just the affected one -- that's what prevents that regression.

-- ============================================================================
-- STEP 1 -- READ ONLY. Run this first. It should surface exactly the one
-- league/week you already know about (Week 1, phantom -$100 "tie" for every
-- team), and nothing else. If it surfaces additional leagues/weeks you
-- weren't expecting, stop and paste the output back before running STEP 2/3.
--
-- Logic: for each league, "first real week of play" = the earliest week that
-- has at least one weekly_rosters row for any of its teams. A weekly_rosters
-- row only ever gets created the first time a team places a wager for that
-- week, so its existence is direct evidence the league was actually open for
-- picks that week. Any matchup row with a score already written for a week
-- BEFORE that is a phantom result -- settle-week scored a week nobody could
-- have played. Same defensive int cast as 0013's mark_season_started (week
-- may be text or integer live; a plain min()/`<` on text sorts lexicographically
-- and silently breaks past week 9 -- '10' < '2').
-- ============================================================================
with first_real_week as (
  select t.league_id,
         min(nullif(regexp_replace(wr.week::text, '[^0-9]', '', 'g'), '')::int) as week_num
  from public.weekly_rosters wr
  join public.teams t on t.id = wr.team_id
  group by t.league_id
)
select
  m.league_id,
  l.name as league_name,
  m.week as phantom_week,
  frw.week_num as first_real_week,
  m.team_a_id, m.team_b_id, m.team_a_score, m.team_b_score, m.winner_id, m.is_tie
from public.matchups m
join first_real_week frw on frw.league_id = m.league_id
join public.leagues l on l.id = m.league_id
where m.team_a_score is not null
  and nullif(regexp_replace(m.week::text, '[^0-9]', '', 'g'), '')::int < frw.week_num
order by m.league_id, phantom_week;

-- ============================================================================
-- STEP 2 -- backfill season_start_week for EVERY league that doesn't have one
-- yet (not just the affected one -- see the note at the top of this file).
-- Two passes: the first sets it from each league's real first-played week
-- (same CTE as STEP 1); the second catches any league with zero
-- weekly_rosters rows at all (nothing played yet), falling back to its
-- current_week, or '1' if that's somehow null too. That fallback is always
-- safe: with no roster rows in existence yet, there's nothing before "now"
-- that could have been phantom-scored for that league anyway.
-- ============================================================================
with first_real_week as (
  select t.league_id,
         min(nullif(regexp_replace(wr.week::text, '[^0-9]', '', 'g'), '')::int) as week_num
  from public.weekly_rosters wr
  join public.teams t on t.id = wr.team_id
  group by t.league_id
)
update public.leagues l
set season_start_week = coalesce(frw.week_num::text, l.current_week::text, '1')
from first_real_week frw
where frw.league_id = l.id
  and l.season_start_week is null;

update public.leagues
set season_start_week = coalesce(current_week::text, '1')
where season_start_week is null;

-- ============================================================================
-- STEP 3 -- null out the phantom matchup row(s) identified in STEP 1 (only
-- run once STEP 1's output looks right). Standings are NOT touched here on
-- purpose: settle-week recomputes every league's standings from scratch by
-- scanning ALL of that league's matchups rows on every run (see
-- supabase/functions/settle-week/index.ts), so nulling the phantom row(s)
-- below is enough -- the next normal cron tick self-corrects standings
-- automatically, no manual fix needed.
-- ============================================================================
with first_real_week as (
  select t.league_id,
         min(nullif(regexp_replace(wr.week::text, '[^0-9]', '', 'g'), '')::int) as week_num
  from public.weekly_rosters wr
  join public.teams t on t.id = wr.team_id
  group by t.league_id
)
update public.matchups m
set team_a_score = null, team_b_score = null, winner_id = null, is_tie = false
from first_real_week frw
where frw.league_id = m.league_id
  and m.team_a_score is not null
  and nullif(regexp_replace(m.week::text, '[^0-9]', '', 'g'), '')::int < frw.week_num;
