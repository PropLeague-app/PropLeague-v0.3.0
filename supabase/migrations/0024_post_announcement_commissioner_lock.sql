-- Commissioner-gate post_announcement (see chat, Sept 2026): this RPC only ever
-- checked is_league_member, so any league member -- not just the commissioner --
-- could post a pinned, league-wide announcement. The client already only shows the
-- "+ Announcement" composer to the commissioner (see LeagueHome.tsx's own comment
-- flagging this exact gap), but that was always a UI-only gate; anyone could still
-- call this RPC directly and pin a message to every member's Activity feed.
--
-- This RPC predates the migrations/ folder (hand-created in the SQL editor, same
-- as add_simulated_team/place_wager/etc. were before their own lockdown
-- migrations), so its live body was pulled via pg_get_functiondef first rather
-- than guessed at -- same pattern used for every other pre-migrations RPC this
-- project has touched. Everything else here (the insert shape, returning the new
-- row's id, the v_team_id lookup for posted_by_team_id) is copied verbatim from
-- the live definition; only the permission check changes, from "any member" to
-- "the commissioner" -- matching delete_announcement's own is_league_commissioner
-- check (confirmed via the same pull: delete_announcement was already correct,
-- gating to "commissioner or original poster," and needed no change).
--
-- No service_role exemption: unlike post_system_activity (settle-week/moments
-- cron jobs), nothing but a real commissioner's own client call ever posts an
-- announcement, so there's no automated caller to carve out.
create or replace function public.post_announcement(p_league_id uuid, p_message text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
  v_team_id uuid;
begin
  if not public.is_league_commissioner(p_league_id) then
    raise exception 'Only the commissioner can post an announcement';
  end if;

  select t.id into v_team_id
  from public.teams t
  join public.league_memberships lm on lm.id = t.membership_id
  where lm.profile_id = auth.uid() and lm.league_id = p_league_id
  limit 1;

  insert into public.activity_items (league_id, type, message, pinned, posted_by_team_id)
  values (p_league_id, 'announcement', p_message, true, v_team_id)
  returning id into v_id;

  return v_id;
end;
$$;
