-- Voids, both directions, in any week the league has already reached (see chat, Oct 2026).
--
-- Two gaps closed here.
--
-- 1. Everything about voids was pinned to the current week. request_void,
--    set_wager_void_flag and clear_wager_void_flag each carried their own copy of
--    "that week has already moved on", so a mistake found on Wednesday about last
--    Sunday could not be fixed at all. A wrong void is wrong whenever it is found.
--
-- 2. A request could only ever ask to ADD a void. The opposite case is the one that
--    actually bit: Cam Skattebo was auto-voided as a DNP when he had simply taken
--    very few snaps, which is not a void at all. Undoing that was a commissioner-only
--    action on the current week, with no way for the member whose picks were wrongly
--    wiped to even ask. Requests now carry a `kind`, and an approved 'unvoid' clears
--    the flag exactly as the commissioner's own button does.
--
-- Re-grading is not new machinery. clear_wager_void_flag already puts the affected
-- wagers back to 'pending' for settle-week to grade from the real stats, and
-- migration 0015 deliberately left room for "a late stat correction flips who
-- actually won" to take effect on an already-decided matchup. What is new is that
-- settle-week's own auto-discovery only visits current_week and current_week - 1, so
-- for anything older the app calls it with an explicit { week, forceLeagueId } after
-- a change lands, then rebuilds that week's pool. See src/services/voidFlags.ts.

-- Which weeks a league may be asked about: the one it is on, and every numeric week
-- behind it. Playoff round labels have no reliable order, so they are only ever
-- addressable as the current week; a numeric week while the league is in the
-- playoffs is by definition behind it.
create or replace function public.league_week_reached(p_league_id uuid, p_week text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_current text;
begin
  select current_week::text into v_current from public.leagues where id = p_league_id;
  if v_current is null then
    return false;
  end if;
  if v_current = p_week then
    return true;
  end if;
  if p_week !~ '^\d+$' then
    return false;
  end if;
  if v_current !~ '^\d+$' then
    return true;
  end if;
  return p_week::int < v_current::int;
end;
$$;

-- The gate, in all three places that had their own copy of the old one.
create or replace function public.set_wager_void_flag(
  p_league_id uuid,
  p_week text,
  p_player_name text,
  p_reason text,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_team_id uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_label text;
  v_past boolean;
begin
  if not public.is_league_commissioner(p_league_id) then
    raise exception 'Only the commissioner can flag a game exit';
  end if;

  if p_reason not in ('injury', 'ejection', 'other') then
    raise exception 'Pick a reason for the early exit';
  end if;
  if p_reason = 'other' and (v_note is null or char_length(v_note) < 3) then
    raise exception 'Add a short note explaining the early exit';
  end if;
  if v_note is not null and char_length(v_note) > 200 then
    raise exception 'Keep the note under 200 characters';
  end if;

  if not public.league_week_reached(p_league_id, p_week) then
    raise exception 'That week has not been played yet';
  end if;
  v_past := (select current_week::text from public.leagues where id = p_league_id) is distinct from p_week;

  if not exists (
    select 1
    from public.wagers w
    join public.weekly_rosters r on r.id = w.roster_id
    join public.teams t on t.id = r.team_id
    join public.real_games g on g.id = w.game_id
    where t.league_id = p_league_id and r.week = p_week and w.player_name = p_player_name
      and w.market_key not in ('h2h', 'spreads', 'totals')
      and (w.market_key = 'player_anytime_td' or lower(w.side) = 'over')
      and (g.status <> 'upcoming' or g.kickoff <= now())
  ) then
    raise exception 'No Over or Anytime TD picks on that player in a game that has started';
  end if;

  insert into public.wager_void_flags (league_id, week, player_name, reason, note)
  values (p_league_id, p_week, p_player_name, p_reason, v_note)
  on conflict (league_id, week, player_name) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.wager_void_flags
    where league_id = p_league_id and week = p_week and player_name = p_player_name;
    return v_id; -- already flagged, nothing new to announce
  end if;

  -- A flag on a week already settled has to take its picks back to pending itself.
  -- In the current week they are pending anyway and settle-week has not graded them;
  -- in an older week they are sitting on a real result that is now wrong.
  if v_past then
    update public.wagers w
    set status = 'pending', settled_profit = null, void_flag_id = null
    from public.weekly_rosters r, public.teams t
    where w.roster_id = r.id and r.team_id = t.id
      and t.league_id = p_league_id and r.week = p_week and w.player_name = p_player_name;
  end if;

  select t.id into v_team_id
  from public.teams t
  join public.league_memberships lm on lm.id = t.membership_id
  where lm.profile_id = auth.uid() and lm.league_id = p_league_id
  limit 1;

  v_label := case p_reason
    when 'injury' then 'Early exit: injury'
    when 'ejection' then 'Early exit: ejection'
    else 'Early exit'
  end;

  insert into public.activity_items (league_id, type, message, pinned, posted_by_team_id)
  values (
    p_league_id, 'announcement',
    p_player_name || ' (' || v_label || ', no snaps in the 2nd half). His Over and Anytime TD picks that had not hit are voided.'
      || coalesce(' Note: ' || v_note || '.', '')
      || case when v_past then ' Week ' || p_week || ' is being re-graded, so scores and standings may move.' else '' end
      || ' Updates within about 15 minutes.',
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
  v_team_id uuid;
  v_past boolean;
begin
  select league_id, week, player_name into v_league_id, v_week, v_player
  from public.wager_void_flags where id = p_flag_id;
  if v_league_id is null then
    raise exception 'Flag not found';
  end if;

  if not public.is_league_commissioner(v_league_id) then
    raise exception 'Only the commissioner can clear a game exit';
  end if;

  if not public.league_week_reached(v_league_id, v_week) then
    raise exception 'That week has not been played yet';
  end if;
  v_past := (select current_week::text from public.leagues where id = v_league_id) is distinct from v_week;

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
    'The game exit flag on ' || v_player || ' was removed. His picks are being re-graded from the real stats.'
      || case when v_past then ' Week ' || v_week || ' is being re-graded, so scores and standings may move.' else '' end,
    false, v_team_id
  );
end;
$$;

-- Requests gain a direction. Existing rows are all asks to add a void, which is the default.
alter table public.void_requests
  add column if not exists kind text not null default 'void';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'void_requests_kind_check') then
    alter table public.void_requests
      add constraint void_requests_kind_check check (kind in ('void', 'unvoid'));
  end if;
end;
$$;

-- The old 5-argument signature goes; the new one takes the direction as a 6th.
drop function if exists public.request_void(uuid, text, text, text, text);
create or replace function public.request_void(
  p_league_id uuid,
  p_week text,
  p_player_name text,
  p_reason text,
  p_note text,
  p_kind text default 'void'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_team_id uuid;
  v_request_id uuid;
  v_flag_id uuid;
begin
  if not public.is_league_member(p_league_id) then
    raise exception 'You are not a member of this league';
  end if;
  if p_kind not in ('void', 'unvoid') then
    raise exception 'Unknown request type';
  end if;
  if not public.league_week_reached(p_league_id, p_week) then
    raise exception 'That week has not been played yet';
  end if;

  select id into v_flag_id from public.wager_void_flags
  where league_id = p_league_id and week = p_week and player_name = p_player_name;

  -- The commissioner is not asking anyone, so their own request is the action itself.
  if public.is_league_commissioner(p_league_id) then
    if p_kind = 'void' then
      perform public.set_wager_void_flag(p_league_id, p_week, p_player_name, p_reason, v_note);
    else
      if v_flag_id is null then
        raise exception 'That player is not voided that week';
      end if;
      perform public.clear_wager_void_flag(v_flag_id);
    end if;
    return jsonb_build_object('status', 'approved', 'request_id', null);
  end if;

  if p_reason not in ('injury', 'ejection', 'other') then
    raise exception 'Pick a reason';
  end if;
  if v_note is null or char_length(v_note) < 3 then
    raise exception 'Add a short note saying what happened';
  end if;
  if char_length(v_note) > 200 then
    raise exception 'Keep the note under 200 characters';
  end if;

  if p_kind = 'void' and v_flag_id is not null then
    raise exception 'That player is already voided that week';
  end if;
  if p_kind = 'unvoid' and v_flag_id is null then
    raise exception 'That player is not voided that week';
  end if;

  -- The player has to actually be on someone's roster that week, either way round.
  if not exists (
    select 1
    from public.wagers w
    join public.weekly_rosters r on r.id = w.roster_id
    join public.teams t on t.id = r.team_id
    where t.league_id = p_league_id and r.week = p_week and w.player_name = p_player_name
  ) then
    raise exception 'Nobody has a pick on that player that week';
  end if;

  if exists (
    select 1 from public.void_requests
    where league_id = p_league_id and week = p_week and player_name = p_player_name and status = 'pending'
  ) then
    raise exception 'There is already an open request for that player';
  end if;
  -- Denied once is denied, but only for the direction that was asked: a denied void
  -- says nothing about whether an existing void should be lifted.
  if exists (
    select 1 from public.void_requests
    where league_id = p_league_id and week = p_week and player_name = p_player_name
      and status = 'denied' and kind = p_kind
  ) then
    raise exception 'The commissioner already answered that request';
  end if;
  if (select count(*) from public.void_requests
      where league_id = p_league_id and week = p_week and requested_by = auth.uid() and status = 'pending') >= 3 then
    raise exception 'You already have 3 open requests this week';
  end if;

  select t.id into v_team_id
  from public.teams t
  join public.league_memberships lm on lm.id = t.membership_id
  where lm.profile_id = auth.uid() and lm.league_id = p_league_id
  limit 1;

  insert into public.void_requests (league_id, week, player_name, reason, note, requested_by, requested_by_team_id, kind)
  values (p_league_id, p_week, p_player_name, p_reason, v_note, auth.uid(), v_team_id, p_kind)
  returning id into v_request_id;

  return jsonb_build_object('status', 'pending', 'request_id', v_request_id);
end;
$$;

create or replace function public.resolve_void_request(p_request_id uuid, p_approve boolean)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_req public.void_requests;
  v_flag_id uuid;
begin
  select * into v_req from public.void_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception 'Request not found';
  end if;
  if not public.is_league_commissioner(v_req.league_id) then
    raise exception 'Only the commissioner can answer a void request';
  end if;
  if v_req.status <> 'pending' then
    raise exception 'That request was already answered';
  end if;

  if p_approve then
    if v_req.kind = 'unvoid' then
      select id into v_flag_id from public.wager_void_flags
      where league_id = v_req.league_id and week = v_req.week and player_name = v_req.player_name;
      if v_flag_id is null then
        raise exception 'That player is no longer voided that week';
      end if;
      perform public.clear_wager_void_flag(v_flag_id);
    else
      -- Raises if the picks no longer qualify; the request stays pending so it can be denied instead.
      perform public.set_wager_void_flag(v_req.league_id, v_req.week, v_req.player_name, v_req.reason, v_req.note);
    end if;
  end if;

  update public.void_requests
  set status = case when p_approve then 'approved' else 'denied' end,
      resolved_by = auth.uid(),
      resolved_at = now()
  where id = p_request_id;

  return case when p_approve then 'approved' else 'denied' end;
end;
$$;

-- A direct flag settles an open request to ADD one; removing a flag settles an open
-- request to LIFT one. Without the kind filter, clearing a flag would have marked a
-- pending "please void him" as approved, which is the opposite of what happened.
create or replace function public.void_flag_settles_requests()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.void_requests
  set status = 'approved', resolved_by = coalesce(resolved_by, auth.uid()), resolved_at = coalesce(resolved_at, now())
  where league_id = new.league_id and week = new.week and player_name = new.player_name
    and status = 'pending' and kind = 'void';
  return new;
end;
$$;

create or replace function public.void_flag_cleared_settles_requests()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.void_requests
  set status = 'approved', resolved_by = coalesce(resolved_by, auth.uid()), resolved_at = coalesce(resolved_at, now())
  where league_id = old.league_id and week = old.week and player_name = old.player_name
    and status = 'pending' and kind = 'unvoid';
  return old;
end;
$$;

drop trigger if exists wager_void_flags_cleared_settle_requests on public.wager_void_flags;
create trigger wager_void_flags_cleared_settle_requests
  after delete on public.wager_void_flags
  for each row execute function public.void_flag_cleared_settles_requests();

revoke all on function public.league_week_reached(uuid, text) from public, anon;
revoke all on function public.request_void(uuid, text, text, text, text, text) from public, anon;
revoke all on function public.void_flag_cleared_settles_requests() from public, anon, authenticated;
grant execute on function public.league_week_reached(uuid, text) to authenticated;
grant execute on function public.request_void(uuid, text, text, text, text, text) to authenticated;

-- Requests for a week, now carrying the direction of each one. The commissioner sees all of them;
-- a member sees only their own.
drop function if exists public.league_void_requests(uuid, text);
create function public.league_void_requests(p_league_id uuid, p_week text)
returns table (
  id uuid,
  player_name text,
  player_id text,
  reason text,
  note text,
  status text,
  team_name text,
  mine boolean,
  created_at timestamptz,
  resolved_at timestamptz,
  kind text,
  pick_count bigint,
  team_count bigint
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    rq.id,
    rq.player_name,
    (select max(w.player_id) from public.wagers w
       join public.weekly_rosters r on r.id = w.roster_id
       join public.teams t on t.id = r.team_id
       where t.league_id = p_league_id and r.week = p_week and w.player_name = rq.player_name) as player_id,
    rq.reason,
    rq.note,
    rq.status,
    t.team_name,
    (rq.requested_by = auth.uid()) as mine,
    rq.created_at,
    rq.resolved_at,
    rq.kind,
    (select count(*) from public.wagers w
       join public.weekly_rosters r on r.id = w.roster_id
       join public.teams t2 on t2.id = r.team_id
       where t2.league_id = p_league_id and r.week = p_week and w.player_name = rq.player_name
         and w.market_key not in ('h2h', 'spreads', 'totals')
         and (w.market_key = 'player_anytime_td' or lower(w.side) = 'over')) as pick_count,
    (select count(distinct t3.id) from public.wagers w
       join public.weekly_rosters r on r.id = w.roster_id
       join public.teams t3 on t3.id = r.team_id
       where t3.league_id = p_league_id and r.week = p_week and w.player_name = rq.player_name
         and w.market_key not in ('h2h', 'spreads', 'totals')
         and (w.market_key = 'player_anytime_td' or lower(w.side) = 'over')) as team_count
  from public.void_requests rq
  left join public.teams t on t.id = rq.requested_by_team_id
  where rq.league_id = p_league_id
    and rq.week = p_week
    and public.is_league_member(p_league_id)
    and (public.is_league_commissioner(p_league_id) or rq.requested_by = auth.uid())
  order by (rq.status = 'pending') desc, rq.created_at desc;
$$;

revoke all on function public.league_void_requests(uuid, text) from public, anon;
grant execute on function public.league_void_requests(uuid, text) to authenticated;
