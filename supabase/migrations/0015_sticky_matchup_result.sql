-- Fixes a real, live bug (see chat, Sept 2026): confirmed on Pooping Pigs Test
-- League, Week 2 -- a matchup that had already gone final days earlier (all
-- 16 real_games rows for that week were 'final' since Sept 18-22) came back
-- with winner_id=null, is_tie=false on Sunday Sept 27, even though
-- team_a_score/team_b_score were still correctly populated (79.08 / -81.07).
--
-- Root cause: settle-week's weekComplete gate is
--   allGamesFinal && pastResultsRevealCutoff(now)
-- and pastResultsRevealCutoff(now) is a pure function of TODAY's real-world
-- weekday/hour in America/New_York -- it returns false for any Sun, Mon, or
-- pre-10am-Tue call, with NO awareness of which week's games it's actually
-- being asked about. That's correct the FIRST time a week is evaluated (it
-- correctly holds the reveal until Tuesday morning), but settle-week
-- reprocesses old weeks too -- the stray-week catch-up logic explicitly
-- revisits an active league's current_week-1 on every run, and a league that
-- hasn't advanced past a given week keeps having that week reprocessed
-- indefinitely. Every one of those reprocessing runs recomputes winner_id/
-- is_tie from scratch via upsert_matchup, so any Sun/Mon cron tick that
-- revisits an already-decided week -- whether it ended 2 days ago or 2
-- months ago -- silently flips its winner_id/is_tie back to null/false,
-- un-revealing a real result players had already seen.
--
-- Fix: make winner_id/is_tie "sticky" once a matchup has been decided. A
-- call that would set BOTH back to undecided (winner_id null AND is_tie
-- false) is ignored for those two columns when the existing row already has
-- a decided outcome -- but a call reporting a genuinely different decided
-- outcome (e.g. a late stat correction flips who actually won) still always
-- takes effect, since that's a real, intentional use case this file already
-- supports (see the Cam Skattebo/Rams-Giants comment above in
-- supabase/functions/settle-week/index.ts). Scores themselves are untouched
-- by this and keep updating live every run, exactly as before.
--
-- No edge function changes needed -- this lives entirely in the DB function
-- both settle-week and any future caller already go through.
create or replace function public.upsert_matchup(
  p_league_id uuid, p_week text, p_team_a_id uuid, p_team_b_id uuid,
  p_team_a_score numeric, p_team_b_score numeric, p_winner_id uuid, p_is_tie boolean
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_matchup_id uuid;
begin
  if auth.role() <> 'service_role' and not public.is_league_commissioner(p_league_id) then
    raise exception 'Only the commissioner can report matchup results';
  end if;

  insert into public.matchups (league_id, week, team_a_id, team_b_id, team_a_score, team_b_score, winner_id, is_tie)
  values (p_league_id, p_week, p_team_a_id, p_team_b_id, p_team_a_score, p_team_b_score, p_winner_id, p_is_tie)
  on conflict (league_id, week, team_a_id, team_b_id) do update set
    team_a_score = excluded.team_a_score,
    team_b_score = excluded.team_b_score,
    winner_id = case
      when excluded.winner_id is null and excluded.is_tie is false
           and (matchups.winner_id is not null or matchups.is_tie) then matchups.winner_id
      else excluded.winner_id
    end,
    is_tie = case
      when excluded.winner_id is null and excluded.is_tie is false
           and (matchups.winner_id is not null or matchups.is_tie) then matchups.is_tie
      else excluded.is_tie
    end
  returning id into v_matchup_id;

  return v_matchup_id;
end;
$function$;
