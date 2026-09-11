-- Two fixes bundled together since both touch upsert_standing (see chat):
--
-- 1. BUG FIX (urgent): upsert_standing and upsert_matchup only ever allowed an
-- authenticated commissioner to call them (public.is_league_commissioner(...)),
-- with no carve-out for the service role. settle-week calls both of these using
-- the service role key, not as a logged-in commissioner, so every single write
-- from settle-week was being rejected with "Only the commissioner can report
-- standings/matchup results" -- real leagues' scores and standings have been
-- silently stuck since whichever earlier pass added that commissioner check.
-- settle_wager already has the correct carve-out (`auth.role() <> 'service_role'
-- and not is_league_commissioner(...)`) -- both functions below now mirror that
-- exact pattern rather than inventing a new one.
--
-- 2. ROI fix: FullStandings.tsx computed ROI client-side as totalPL / (stake
-- summed from the client's local rostersByTeamWeek cache) -- same bug class as
-- Moments (see chat): that cache only has whatever weeks the app happened to
-- load locally, not the whole season for every team. total_wagered is now
-- computed server-side by settle-week the same way everything else in
-- `standings` already is (recomputed from scratch across the whole season on
-- every run), so ROI can read it directly instead of trusting a partial local
-- cache.
alter table public.standings add column if not exists total_wagered numeric not null default 0;

create or replace function public.upsert_standing(
  p_team_id uuid, p_wins integer, p_losses integer, p_ties integer, p_total_pl numeric,
  p_bets_won integer, p_bets_lost integer, p_bets_pushed integer, p_best_week_pl numeric,
  p_weekly_scores jsonb, p_total_wagered numeric default 0
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_league_id uuid;
begin
  select league_id into v_league_id from public.teams where id = p_team_id;
  if v_league_id is null or (auth.role() <> 'service_role' and not public.is_league_commissioner(v_league_id)) then
    raise exception 'Only the commissioner can report standings';
  end if;

  insert into public.standings (team_id, league_id, wins, losses, ties, total_pl, bets_won, bets_lost, bets_pushed, best_week_pl, weekly_scores, total_wagered, updated_at)
  values (p_team_id, v_league_id, p_wins, p_losses, p_ties, p_total_pl, p_bets_won, p_bets_lost, p_bets_pushed, p_best_week_pl, p_weekly_scores, p_total_wagered, now())
  on conflict (team_id) do update set
    wins = excluded.wins,
    losses = excluded.losses,
    ties = excluded.ties,
    total_pl = excluded.total_pl,
    bets_won = excluded.bets_won,
    bets_lost = excluded.bets_lost,
    bets_pushed = excluded.bets_pushed,
    best_week_pl = excluded.best_week_pl,
    weekly_scores = excluded.weekly_scores,
    total_wagered = excluded.total_wagered,
    updated_at = now();
end;
$function$;

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
    winner_id = excluded.winner_id,
    is_tie = excluded.is_tie
  returning id into v_matchup_id;

  return v_matchup_id;
end;
$function$;
