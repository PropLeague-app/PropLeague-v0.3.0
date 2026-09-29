-- RPC5 of the RPC-lockdown pass (see chat, Sept 29 2026): post_system_activity only
-- ever checked is_league_commissioner(p_league_id), with no restriction on WHICH
-- activity type a commissioner could post. 'moment' and 'settled' are supposed to be
-- system-generated from real results -- but grepping every edge function confirms
-- settle-week and _shared/momentsReal.ts both write those types DIRECTLY to
-- activity_items as service_role, deliberately bypassing this RPC (their own comments
-- say so: this RPC "requires auth.uid() to resolve a commissioner -- there is none
-- under this function's service-role key"). So in the app as it stands today, nothing
-- legitimate has ever posted a 'moment'/'settled'/'reminder' item through this RPC --
-- only a commissioner calling it directly could, and doing so lets them fabricate a
-- fake system event (arbitrary message, arbitrary moment_team_id) dressed up as
-- something that actually happened, about any team in their own league.
--
-- Fix: restrict a non-service-role caller to p_type = 'announcement' only -- the one
-- type the live client actually generates this way today (leagueService.ts's "Welcome
-- to <league>!" / "The season is underway!" messages, posted via syncNewActivity at
-- league creation / season start) -- and require every moment_* field to be empty for
-- it, since a real announcement never sets them. service_role keeps access to every
-- type, in case a future edge function moves off the direct-table-write pattern onto
-- this RPC instead -- zero behavior change today either way, since none currently do.
create or replace function public.post_system_activity(
  p_league_id uuid,
  p_type text,
  p_message text,
  p_pinned boolean default false,
  p_moment_category text default null,
  p_moment_display_name text default null,
  p_moment_week text default null,
  p_moment_team_id uuid default null,
  p_moment_extra text default null,
  p_moment_position text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if p_type not in ('reminder', 'settled', 'moment', 'announcement') then
    raise exception 'Invalid activity type: %', p_type;
  end if;

  if not public.is_league_commissioner(p_league_id) then
    raise exception 'Only the commissioner can post system activity';
  end if;

  if auth.role() <> 'service_role' then
    if p_type <> 'announcement' then
      raise exception 'Only the automated system can post a % item', p_type;
    end if;
    if p_moment_category is not null or p_moment_display_name is not null or p_moment_week is not null
       or p_moment_team_id is not null or p_moment_extra is not null or p_moment_position is not null then
      raise exception 'An announcement cannot carry moment fields';
    end if;
  end if;

  insert into public.activity_items (league_id, type, message, pinned, moment_category, moment_display_name, moment_week, moment_team_id, moment_extra, moment_position)
  values (p_league_id, p_type, p_message, p_pinned, p_moment_category, p_moment_display_name, p_moment_week, p_moment_team_id, p_moment_extra, p_moment_position)
  returning id into v_id;

  return v_id;
end;
$$;
