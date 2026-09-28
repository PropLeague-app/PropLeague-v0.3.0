-- Immediate, one-time repair for the bug fixed going forward by
-- 0015_sticky_matchup_result.sql. Run this AFTER 0015 is applied (otherwise
-- the very next Sun/Mon settle-week run just wipes these again). Two steps --
-- STEP 1 is read-only, run it first.
--
-- A matchup is "wrongly wiped" if: it has two real, non-null scores; it's
-- currently marked undecided (winner_id null, is_tie false); and the week
-- it belongs to is unambiguously over -- every real_games row for that week
-- is 'final', and the LATEST of those games finished more than 3 days ago
-- (safely past any possible Tuesday-reveal window, so there's no chance
-- this is a week that's still legitimately waiting on its own reveal).
--
-- ============================================================================
-- STEP 1 -- READ ONLY. Should surface the Pooping Pigs Test League Week 2 row
-- you already found, and nothing else (unless another league/week got hit by
-- the same Sun/Mon reprocessing bug -- check any additional rows before
-- running STEP 2).
-- ============================================================================
with real_week_status as (
  select week,
         count(*) as total_games,
         count(*) filter (where status = 'final') as final_games,
         max(final_since) as last_final_since
  from public.real_games
  group by week
)
select
  m.id, m.league_id, l.name as league_name, m.week,
  m.team_a_id, m.team_b_id, m.team_a_score, m.team_b_score, m.winner_id, m.is_tie,
  rws.last_final_since
from public.matchups m
join public.leagues l on l.id = m.league_id
join real_week_status rws on rws.week = m.week
where m.team_a_score is not null
  and m.team_b_score is not null
  and m.winner_id is null
  and m.is_tie = false
  and rws.total_games > 0
  and rws.total_games = rws.final_games
  and rws.last_final_since < now() - interval '3 days'
order by m.league_id, m.week;

-- ============================================================================
-- STEP 2 -- restore the correct decided outcome on every row STEP 1 found,
-- recomputed the exact same way upsert_matchup does (higher score wins; equal
-- scores tie). Standings are NOT touched here on purpose -- settle-week
-- recomputes every league's standings from scratch off ALL of that league's
-- matchups rows on every run, so once this lands, the next normal cron tick
-- self-corrects W-L records/P-L automatically.
-- ============================================================================
with real_week_status as (
  select week,
         count(*) as total_games,
         count(*) filter (where status = 'final') as final_games,
         max(final_since) as last_final_since
  from public.real_games
  group by week
)
update public.matchups m
set is_tie = (m.team_a_score = m.team_b_score),
    winner_id = case
      when m.team_a_score = m.team_b_score then null
      when m.team_a_score > m.team_b_score then m.team_a_id
      else m.team_b_id
    end
from real_week_status rws
where rws.week = m.week
  and m.team_a_score is not null
  and m.team_b_score is not null
  and m.winner_id is null
  and m.is_tie = false
  and rws.total_games > 0
  and rws.total_games = rws.final_games
  and rws.last_final_since < now() - interval '3 days';
