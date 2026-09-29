-- AI-team-indicator build (see chat, Sept 28 2026): "make sure the AI teams
-- customize their team name/logo/abbreviation/colors/etc." Tracing that through,
-- generateSimulatedTeamIdentities (leagueService.ts) already picks a varied
-- teamName/abbrev/logoColor AND a random logoMode ('emoji' vs 'initials') + logoEmoji
-- per simulated team -- but addSimulatedTeamRemote only ever forwards teamName/
-- abbrev/logoColor to add_simulated_team; logoMode/logoEmoji were silently dropped on
-- the way to the DB, so every simulated team landed as plain 'initials' regardless of
-- what the client actually picked.
--
-- Deliberately NOT touching add_simulated_team itself to fix this: that function
-- predates the migrations/ folder (created directly via the SQL editor, same as
-- join_league_by_code was before 0017/0018 needed pg_get_functiondef pasted in from
-- the live DB to even see its body) -- redefining it here blind, without its real
-- current body in hand, risks silently dropping whatever capacity/permission checks
-- it already has. Instead this adds one narrow, separate RPC that only ever patches
-- logo_mode/logo_emoji, and only on a team that (a) is actually simulated and (b) sits
-- in a league the caller commissions -- same shape/guard style as every other
-- commissioner-gated RPC in this file's siblings (0012/0013/0017/0018).
create or replace function public.set_simulated_team_logo(
  p_team_id uuid,
  p_logo_mode text,
  p_logo_emoji text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_league_id uuid;
  v_is_simulated boolean;
begin
  select league_id, is_simulated into v_league_id, v_is_simulated
  from public.teams
  where id = p_team_id;

  if v_league_id is null then
    raise exception 'Team not found';
  end if;

  if not v_is_simulated then
    raise exception 'Only a simulated team''s logo can be set this way';
  end if;

  if not public.is_league_commissioner(v_league_id) then
    raise exception 'Only the commissioner can do that';
  end if;

  if p_logo_mode not in ('emoji', 'initials', 'image') then
    raise exception 'Invalid logo mode';
  end if;

  update public.teams
  set logo_mode = p_logo_mode,
      logo_emoji = p_logo_emoji
  where id = p_team_id;
end;
$$;
