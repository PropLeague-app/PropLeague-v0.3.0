-- Fixes a real bug (see chat): a league whose commissioner presses the
-- existing "Start Season" action (leagueService.startSeason, wired through
-- fillWithSimulatedTeams/startSeason in useAppStore.ts) after the real NFL
-- season is already underway generates a schedule starting at week 1 while
-- leagues.current_week is still stuck at its creation default of '1' -- so
-- settle-week's cron picks the league up on week 1, finds those already-final
-- real games with zero rosters submitted (nobody could submit before the
-- schedule existed), and eats a full incomplete-lineup penalty (the whole
-- weeklyCredits amount, e.g. -$100) for a week the league never actually
-- played. Confirmed live: one real league already hit by this (Week 1
-- auto-scored -$100/-$100 "tie" for every team, before its actual first real
-- week of play at Week 2).
--
-- season_start_week is null until a schedule is first generated for the
-- league (mark_season_started below, called from the same client code path
-- as the existing "Start Season" action -- no new button, no user-facing
-- change). While null, settle-week (see the accompanying edit to
-- supabase/functions/settle-week/index.ts) never scores or penalizes ANY
-- week for that league. Once set, every week from that point forward scores
-- exactly as it always has; nothing before it ever will, permanently.
alter table public.leagues add column if not exists season_start_week text;

-- Stamps season_start_week AND current_week with the real live NFL week right
-- now -- not week 1, and not whatever current_week happened to default to --
-- so a league started mid-season correctly begins scoring from today's real
-- week onward instead of a phantom week 1 it never actually played, and never
-- even gets auto-discovered by settle-week for those earlier weeks in the
-- first place (current_week is what drives its auto-discovery query).
-- Idempotent: a second call just returns the already-stamped value rather
-- than erroring or re-stamping, since this is meant to be called
-- unconditionally alongside the existing schedule-generation flow, which can
-- itself run from more than one code path (fillWithSimulatedTeams AND the
-- standalone Start Season action).
--
-- "Real live week right now" = the earliest still-not-final week on record in
-- real_games, falling back to the latest known week if literally everything
-- on record is already final, and to '1' if real_games has no rows at all.
-- Cast defensively via week::text -> regexp_replace -> ::int for the sort
-- (rather than assuming week's own column type or relying on min()/max()
-- directly, which sorts lexicographically on a text column -- '10' < '2' --
-- and would silently pick the wrong week on any real season past week 9) so
-- this works regardless of whether the live real_games.week column turns out
-- to be text or integer; non-numeric rows (playoff round labels) sort last
-- via NULLS LAST and are never picked as "the current live week" here.
create or replace function public.mark_season_started(p_league_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_existing_start text;
  v_real_week text;
begin
  if not public.is_league_commissioner(p_league_id) then
    raise exception 'Only the commissioner can start the season';
  end if;

  select season_start_week into v_existing_start from public.leagues where id = p_league_id;
  if v_existing_start is not null then
    return v_existing_start;
  end if;

  select week::text into v_real_week
  from public.real_games
  where status <> 'final'
  order by nullif(regexp_replace(week::text, '[^0-9]', '', 'g'), '')::int asc nulls last
  limit 1;

  if v_real_week is null then
    select week::text into v_real_week
    from public.real_games
    order by nullif(regexp_replace(week::text, '[^0-9]', '', 'g'), '')::int desc nulls last
    limit 1;
  end if;

  v_real_week := coalesce(v_real_week, '1');

  update public.leagues
  set season_start_week = v_real_week, current_week = v_real_week
  where id = p_league_id;

  return v_real_week;
end;
$$;
