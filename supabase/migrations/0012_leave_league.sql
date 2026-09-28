-- Leave League actually leaves the league (see chat): leaveLeague in useAppStore.ts
-- was 100% client-local -- it flipped isUser/isSimulated only in local state and
-- never touched Supabase, so the departing profile stayed a real, active member
-- server-side forever (still got lineup reminders, still showed up on any other
-- device/build that hadn't cached the local edit). leagues/teams/league_memberships
-- predate migration tracking -- confirmed against the live schema/constraints/RLS/
-- existing RPCs (create_league, join_league_by_code, is_league_member,
-- is_league_commissioner) before writing this (see chat).
--
-- Confirmed live: teams.membership_id -> league_memberships.id is ON DELETE SET
-- NULL (not CASCADE), so deleting the membership row below is safe -- it detaches
-- the team from the departed profile without touching the team's own row, its
-- rosters, or its stats. Deleting the membership (not just nulling the team's FK)
-- is what actually matters: is_league_member() gates chat, reactions, wagers, and
-- the private-league SELECT policy on `leagues`, so this is what makes "left"
-- actually mean left everywhere in the app, not just on the roster/matchup screens.
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

  -- Mirrors the client-side guard in useAppStore's leaveLeague: the commissioner
  -- role must be transferred to another team first (transferCommissioner, now
  -- also synced to Supabase -- see chat). Checked here against the real,
  -- server-side commissioner_team_id rather than trusting local state, so a
  -- transfer that never actually landed can't let a commissioner slip out.
  if public.is_league_commissioner(p_league_id) then
    raise exception 'Transfer the commissioner role to another team before leaving';
  end if;

  -- Converts to a simulated/bot team rather than being removed (manual v0.2.0 §6
  -- #12): schedule, standings, and bet history all stay exactly as they are.
  -- is_simulated=true alone is what send-roster-reminders' recipient filter checks
  -- (it excludes any team where is_simulated is true), so this is what actually
  -- stops the departed profile's push reminders, not just the membership delete.
  select id into v_team_id from public.teams where membership_id = v_membership_id;
  if v_team_id is not null then
    update public.teams set is_simulated = true where id = v_team_id;
  end if;

  delete from public.league_memberships where id = v_membership_id;
end;
$$;
