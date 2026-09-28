-- Fix 1 of the "leave then rejoin" gap (see chat, Sept 28 2026): join_league_by_code's
-- capacity check (`select count(*) from teams where league_id = ...`) counts every team
-- row regardless of is_simulated, and leave_league (0012/0017) converts a departing
-- member's team to is_simulated=true rather than deleting it -- so once someone leaves
-- a league that was already full, that team keeps counting against target_team_count
-- forever, and the SAME PERSON trying to come back via the same invite code gets
-- "This league is full", even though nothing about the roster actually changed.
--
-- Fix: remember whose team a vacated team used to be (vacated_by_profile_id), and add a
-- dedicated rejoin path that reclaims that exact team row -- same id, same name/abbrev/
-- logo, same full pick/matchup/standings history -- instead of trying to create a brand
-- new one (which the schedule/bracket, generated for exactly target_team_count teams,
-- was never built to accommodate anyway). This bypasses the capacity check entirely on
-- purpose: reclaiming your own existing slot never changes how many teams are in the
-- league, so target_team_count doesn't apply to it.

alter table public.teams
  add column if not exists vacated_by_profile_id uuid references public.profiles(id);

-- Re-published with the 0017 ownership fix carried forward, plus stamping
-- vacated_by_profile_id in the same statement that flips is_simulated -- every future
-- leave_league call now leaves a trail the new rejoin function below can find.
create or replace function public.leave_league(p_league_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_membership_id uuid;
  v_team_id uuid;
begin
  select id into v_membership_id
  from public.league_memberships
  where league_id = p_league_id and profile_id = auth.uid();

  if v_membership_id is null then
    raise exception 'You are not a member of this league';
  end if;

  if public.is_league_commissioner(p_league_id) then
    raise exception 'Transfer the commissioner role to another team before leaving';
  end if;

  select id into v_team_id from public.teams where membership_id = v_membership_id;
  if v_team_id is not null then
    update public.teams
    set is_simulated = true,
        membership_id = null,
        vacated_by_profile_id = auth.uid()
    where id = v_team_id;
  end if;

  delete from public.league_memberships where id = v_membership_id;
end;
$$;

-- New: reclaim your own vacated team by invite code. Raises the sentinel string
-- 'NO_REJOINABLE_TEAM' (matched by exact text on the client) when this profile has no
-- vacated team waiting in that league, so the client falls back to the normal
-- join_league_by_code create-a-new-team flow -- someone who was never in this league
-- before, or whose old team was already reclaimed by someone else, still joins exactly
-- as before.
create or replace function public.rejoin_league_by_code(p_invite_code text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_league_id uuid;
  v_team_id uuid;
  v_membership_id uuid;
begin
  select id into v_league_id
  from public.leagues
  where invite_code = upper(p_invite_code);

  if v_league_id is null then
    raise exception 'Invalid invite code';
  end if;

  if public.is_league_member(v_league_id, auth.uid()) then
    raise exception 'You are already a member of this league';
  end if;

  select id into v_team_id
  from public.teams
  where league_id = v_league_id
    and vacated_by_profile_id = auth.uid()
    and is_simulated = true
    and membership_id is null
  order by created_at desc
  limit 1;

  if v_team_id is null then
    raise exception 'NO_REJOINABLE_TEAM';
  end if;

  insert into public.league_memberships (league_id, profile_id, role)
  values (v_league_id, auth.uid(), 'member')
  returning id into v_membership_id;

  update public.teams
  set membership_id = v_membership_id,
      is_simulated = false,
      vacated_by_profile_id = null
  where id = v_team_id;

  return v_team_id;
end;
$$;
