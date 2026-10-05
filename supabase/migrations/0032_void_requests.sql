-- 0032: void requests. Any league member can ask for a player's picks to be voided (early exit);
-- the commissioner approves or denies from Settings. Build 7.
--
-- Run after 0031. Safe to run more than once.
--
--  * Approving a request runs the existing set_wager_void_flag, so the rules, the feed notice and
--    settle-week are unchanged. A request is just a queued flag.
--  * The commissioner's own requests skip the queue and flag straight away (request_void).
--  * Members need a reason and a short note. Limits: 3 open requests per member per week, and a
--    player the commissioner already denied this week cannot be requested again.
--  * If the commissioner flags a player directly, that player's open requests are marked approved.
--  * All reads and writes go through the functions below (RLS on, no policies).
--  * League members can search players eligible for a request (league_void_search). It only returns
--    player names and counts, never whose picks they are.

create table if not exists public.void_requests (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  week text not null,
  player_name text not null,
  reason text not null check (reason in ('injury', 'ejection', 'other')),
  note text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  requested_by uuid not null default auth.uid(),
  requested_by_team_id uuid references public.teams(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_by uuid,
  resolved_at timestamptz
);

create unique index if not exists void_requests_one_pending_per_player
  on public.void_requests (league_id, week, player_name) where status = 'pending';
create index if not exists void_requests_league_week_idx on public.void_requests (league_id, week);

alter table public.void_requests enable row level security;
-- No policies on purpose: members read through league_void_requests, writes go through the RPCs.

-- Picks that make a player eligible for a void: an Over or Anytime TD on a game that has started.
-- Same rule as league_void_candidates / set_wager_void_flag.

-- Players a member can ask about this week, with whether they are already voided or requested.
-- Counts only; never which teams hold the picks.
drop function if exists public.league_void_search(uuid, text);
create function public.league_void_search(p_league_id uuid, p_week text)
returns table (
  player_name text,
  player_id text,
  pick_count bigint,
  team_count bigint,
  flag_id uuid,
  pending_request_id uuid,
  denied boolean
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    p.player_name,
    p.player_id,
    p.pick_count,
    p.team_count,
    (select f.id from public.wager_void_flags f
       where f.league_id = p_league_id and f.week = p_week and f.player_name = p.player_name
       limit 1) as flag_id,
    (select rq.id from public.void_requests rq
       where rq.league_id = p_league_id and rq.week = p_week and rq.player_name = p.player_name and rq.status = 'pending'
       limit 1) as pending_request_id,
    exists (select 1 from public.void_requests rq
       where rq.league_id = p_league_id and rq.week = p_week and rq.player_name = p.player_name and rq.status = 'denied') as denied
  from (
    select
      w.player_name,
      max(w.player_id) as player_id,
      count(*) as pick_count,
      count(distinct t.id) as team_count
    from public.wagers w
    join public.weekly_rosters r on r.id = w.roster_id
    join public.teams t on t.id = r.team_id
    join public.real_games g on g.id = w.game_id
    where public.is_league_member(p_league_id)
      and t.league_id = p_league_id
      and r.week = p_week
      and w.player_name is not null
      and w.market_key not in ('h2h', 'spreads', 'totals')
      and (w.market_key = 'player_anytime_td' or lower(w.side) = 'over')
      and (g.status <> 'upcoming' or g.kickoff <= now())
    group by w.player_name
  ) p
  order by p.player_name;
$$;

-- Requests for a week. The commissioner sees all of them; a member sees only their own.
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

-- Ask for a void. A member's request is queued; the commissioner's goes straight through.
-- Returns { status: 'pending' | 'approved', request_id }.
create or replace function public.request_void(
  p_league_id uuid,
  p_week text,
  p_player_name text,
  p_reason text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_current text;
  v_team_id uuid;
  v_id uuid;
begin
  if not public.is_league_member(p_league_id) then
    raise exception 'You are not a member of this league';
  end if;

  -- The commissioner skips the queue. set_wager_void_flag does its own validation and posts the notice.
  if public.is_league_commissioner(p_league_id) then
    perform public.set_wager_void_flag(p_league_id, p_week, p_player_name, p_reason, p_note);
    return jsonb_build_object('status', 'approved', 'request_id', null);
  end if;

  if p_reason not in ('injury', 'ejection', 'other') then
    raise exception 'Pick a reason for the early exit';
  end if;
  if v_note is null or char_length(v_note) < 3 then
    raise exception 'Add a short note explaining what happened';
  end if;
  if char_length(v_note) > 200 then
    raise exception 'Keep the note under 200 characters';
  end if;

  select current_week::text into v_current from public.leagues where id = p_league_id;
  if v_current is distinct from p_week then
    raise exception 'Void requests can only be made for the current week';
  end if;

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

  if exists (select 1 from public.wager_void_flags where league_id = p_league_id and week = p_week and player_name = p_player_name) then
    raise exception 'That player is already voided this week';
  end if;
  if exists (select 1 from public.void_requests where league_id = p_league_id and week = p_week and player_name = p_player_name and status = 'pending') then
    raise exception 'A request for that player is already waiting on the commissioner';
  end if;
  if exists (select 1 from public.void_requests where league_id = p_league_id and week = p_week and player_name = p_player_name and status = 'denied') then
    raise exception 'The commissioner already denied a request for that player this week';
  end if;
  if (select count(*) from public.void_requests where league_id = p_league_id and week = p_week and requested_by = auth.uid() and status = 'pending') >= 3 then
    raise exception 'You already have 3 requests waiting. Wait for the commissioner to answer one.';
  end if;

  select t.id into v_team_id
  from public.teams t
  join public.league_memberships lm on lm.id = t.membership_id
  where lm.profile_id = auth.uid() and lm.league_id = p_league_id
  limit 1;

  insert into public.void_requests (league_id, week, player_name, reason, note, requested_by, requested_by_team_id)
  values (p_league_id, p_week, p_player_name, p_reason, v_note, auth.uid(), v_team_id)
  returning id into v_id;

  return jsonb_build_object('status', 'pending', 'request_id', v_id);
end;
$$;

-- Commissioner answers a request. Approving flags the player exactly like the old Game Exits flow.
create or replace function public.resolve_void_request(p_request_id uuid, p_approve boolean)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_req public.void_requests;
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
    -- Raises if the picks no longer qualify; the request stays pending so it can be denied instead.
    perform public.set_wager_void_flag(v_req.league_id, v_req.week, v_req.player_name, v_req.reason, v_req.note);
  end if;

  update public.void_requests
  set status = case when p_approve then 'approved' else 'denied' end,
      resolved_by = auth.uid(),
      resolved_at = now()
  where id = p_request_id;

  return case when p_approve then 'approved' else 'denied' end;
end;
$$;

-- A direct flag by the commissioner settles any open request for the same player.
create or replace function public.void_flag_settles_requests()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  update public.void_requests
  set status = 'approved', resolved_by = coalesce(resolved_by, new.created_by), resolved_at = coalesce(resolved_at, now())
  where league_id = new.league_id and week = new.week and player_name = new.player_name and status = 'pending';
  return new;
end;
$$;

drop trigger if exists wager_void_flags_settle_requests on public.wager_void_flags;
create trigger wager_void_flags_settle_requests
  after insert on public.wager_void_flags
  for each row execute function public.void_flag_settles_requests();

revoke all on function public.league_void_search(uuid, text) from public, anon;
revoke all on function public.league_void_requests(uuid, text) from public, anon;
revoke all on function public.request_void(uuid, text, text, text, text) from public, anon;
revoke all on function public.resolve_void_request(uuid, boolean) from public, anon;
revoke all on function public.void_flag_settles_requests() from public, anon, authenticated;
grant execute on function public.league_void_search(uuid, text) to authenticated;
grant execute on function public.league_void_requests(uuid, text) to authenticated;
grant execute on function public.request_void(uuid, text, text, text, text) to authenticated;
grant execute on function public.resolve_void_request(uuid, boolean) to authenticated;
