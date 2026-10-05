-- Game exits (void flags), Build 6. See chat, Oct 2026 (Mariota / Ja'Marr Chase).
--
-- A sportsbook voids an Over or Anytime TD prop when the player has 0 snaps in the
-- 2nd half (an early exit), unless the bet had already hit. Our stats feed has no
-- snap counts, so detection is manual: the league's commissioner flags the player
-- for the current week, and settle-week applies the rule on its next run:
--   Over / Anytime TD that hit        -> stays won
--   Over / Anytime TD that did not    -> voided at $0 (even if already graded lost)
--   Under, moneyline, spread, total   -> never touched (an Under is honored with
--                                        an early exit; one that already missed stays lost)
-- Flags are per league (the commissioner controls their own league's results) and
-- every flag/un-flag posts a line in the league's Activity feed, so nothing is silent.
--
-- Un-flagging puts every pick that THIS flag voided back to 'pending'; settle-week
-- then re-grades it from the real stats on its next run. wagers.void_flag_id is what
-- ties a voided pick to the flag that voided it, so unrelated voids (a player with no
-- stat row at all) are never reinstated by mistake.
--
-- DEPLOY ORDER: run this migration BEFORE redeploying settle-week. (The reverse is
-- also safe: settle-week treats a missing table as "no flags".)

create table if not exists public.wager_void_flags (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  week text not null,
  player_name text not null,
  reason text not null default '0 snaps in the 2nd half',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (league_id, week, player_name)
);

alter table public.wager_void_flags enable row level security;

drop policy if exists "league members can see void flags" on public.wager_void_flags;
create policy "league members can see void flags"
  on public.wager_void_flags for select
  using (is_league_member(league_id));
-- No insert/update/delete policy on purpose: every write goes through the RPCs below.

alter table public.wagers
  add column if not exists void_flag_id uuid references public.wager_void_flags(id) on delete set null;

-- Picks the commissioner can act on: Over and Anytime TD picks for the given week that
-- either sit on a final game and have not won (lost, or not graded yet), or already
-- belong to a flagged player (so the flag stays visible and can be undone). One row
-- per pick; the client groups by player_name.
create or replace function public.league_void_candidates(p_league_id uuid, p_week text)
returns table (
  player_name text,
  flag_id uuid,
  team_id uuid,
  team_name text,
  wager_id uuid,
  market_key text,
  side text,
  point numeric,
  stake numeric,
  status text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select w.player_name, f.id, t.id, t.team_name, w.id, w.market_key, w.side, w.point, w.stake, w.status
  from public.wagers w
  join public.weekly_rosters r on r.id = w.roster_id
  join public.teams t on t.id = r.team_id
  left join public.real_games g on g.id = w.game_id
  left join public.wager_void_flags f
    on f.league_id = p_league_id and f.week = p_week and f.player_name = w.player_name
  where public.is_league_commissioner(p_league_id)
    and t.league_id = p_league_id
    and r.week = p_week
    and w.player_name is not null
    and w.market_key not in ('h2h', 'spreads', 'totals')
    and (w.market_key = 'player_anytime_td' or lower(w.side) = 'over')
    and (f.id is not null or (g.status = 'final' and w.status in ('lost', 'pending')))
  order by w.player_name, t.team_name;
$$;

create or replace function public.set_wager_void_flag(p_league_id uuid, p_week text, p_player_name text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_current text;
  v_id uuid;
  v_team_id uuid;
begin
  if not public.is_league_commissioner(p_league_id) then
    raise exception 'Only the commissioner can flag a game exit';
  end if;

  select current_week::text into v_current from public.leagues where id = p_league_id;
  if v_current is distinct from p_week then
    raise exception 'Game exits can only be flagged for the current week';
  end if;

  if not exists (
    select 1
    from public.wagers w
    join public.weekly_rosters r on r.id = w.roster_id
    join public.teams t on t.id = r.team_id
    where t.league_id = p_league_id and r.week = p_week and w.player_name = p_player_name
      and w.market_key not in ('h2h', 'spreads', 'totals')
      and (w.market_key = 'player_anytime_td' or lower(w.side) = 'over')
  ) then
    raise exception 'No Over or Anytime TD picks on that player in this league this week';
  end if;

  insert into public.wager_void_flags (league_id, week, player_name)
  values (p_league_id, p_week, p_player_name)
  on conflict (league_id, week, player_name) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.wager_void_flags
    where league_id = p_league_id and week = p_week and player_name = p_player_name;
    return v_id; -- already flagged, nothing new to announce
  end if;

  select t.id into v_team_id
  from public.teams t
  join public.league_memberships lm on lm.id = t.membership_id
  where lm.profile_id = auth.uid() and lm.league_id = p_league_id
  limit 1;

  insert into public.activity_items (league_id, type, message, pinned, posted_by_team_id)
  values (
    p_league_id, 'announcement',
    p_player_name || ' had 0 snaps in the 2nd half. His Over and Anytime TD picks that had not hit are voided. Updates within about 15 minutes.',
    false, v_team_id
  );

  return v_id;
end;
$$;

create or replace function public.clear_wager_void_flag(p_flag_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_league_id uuid;
  v_week text;
  v_player text;
  v_current text;
  v_team_id uuid;
begin
  select league_id, week, player_name into v_league_id, v_week, v_player
  from public.wager_void_flags where id = p_flag_id;
  if v_league_id is null then
    raise exception 'Flag not found';
  end if;

  if not public.is_league_commissioner(v_league_id) then
    raise exception 'Only the commissioner can clear a game exit';
  end if;

  select current_week::text into v_current from public.leagues where id = v_league_id;
  if v_current is distinct from v_week then
    raise exception 'That week has already moved on';
  end if;

  -- Back to pending: settle-week re-grades them from the real stats on its next run.
  update public.wagers
  set status = 'pending', settled_profit = null, void_flag_id = null
  where void_flag_id = p_flag_id;

  delete from public.wager_void_flags where id = p_flag_id;

  select t.id into v_team_id
  from public.teams t
  join public.league_memberships lm on lm.id = t.membership_id
  where lm.profile_id = auth.uid() and lm.league_id = v_league_id
  limit 1;

  insert into public.activity_items (league_id, type, message, pinned, posted_by_team_id)
  values (
    v_league_id, 'announcement',
    'The game exit flag on ' || v_player || ' was removed. His picks are being re-graded from the real stats.',
    false, v_team_id
  );
end;
$$;

revoke all on function public.league_void_candidates(uuid, text) from public, anon;
revoke all on function public.set_wager_void_flag(uuid, text, text) from public, anon;
revoke all on function public.clear_wager_void_flag(uuid) from public, anon;
grant execute on function public.league_void_candidates(uuid, text) to authenticated;
grant execute on function public.set_wager_void_flag(uuid, text, text) to authenticated;
grant execute on function public.clear_wager_void_flag(uuid) to authenticated;
