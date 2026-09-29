-- Fix 2, step 1 of 2 (see chat, Sept 2026): generate-bot-lineups needs to call
-- place_wager/submit_roster on behalf of is_simulated teams, the same way a real
-- commissioner already can by hand -- can_manage_team already has exactly that
-- precedent (`t.is_simulated and is_league_commissioner(...)`), so this adds one
-- more narrow branch alongside it rather than a generic service-role bypass.
--
-- Deliberately requires t.is_simulated = true, not just auth.role() = 'service_role'
-- alone: a bug in generate-bot-lineups literally cannot touch a real person's team
-- through this function, because the DB itself refuses it regardless of what the
-- edge function thinks it's doing -- not just "the client never has the service
-- role key" (true, but that's the only thing protecting every other service-role
-- bypass added this session, e.g. upsert_matchup, leave_league's rejoin path).
create or replace function public.can_manage_team(p_team_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from public.teams t
    left join public.league_memberships m on m.id = t.membership_id
    where t.id = p_team_id
      and (
        m.profile_id = auth.uid()
        or (t.is_simulated and public.is_league_commissioner(t.league_id, auth.uid()))
        or (t.is_simulated and auth.role() = 'service_role')
      )
  );
$function$;
