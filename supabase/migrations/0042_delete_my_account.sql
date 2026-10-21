-- Account deletion, league side (see chat, Oct 2026).
--
-- Apple requires an app that creates accounts to delete them from inside the app
-- (App Review guideline 5.1.1(v)), so this is a submission blocker, not a nicety.
--
-- Deleting the auth user is the edge function's job (delete-account): only the
-- service role can touch auth.users. This function is everything that has to
-- happen in public first, and it has to happen first for a concrete reason.
-- profiles.id -> auth.users is ON DELETE CASCADE, so removing the auth user
-- cascades the profile row -- but teams.vacated_by_profile_id -> profiles is
-- NO ACTION (confirmed against the live schema), so that cascade RAISES and the
-- whole delete fails if any team still points at the leaving profile. Nulling
-- that column below is what makes the cascade possible at all.
--
-- The league outcome is the one Leave This League already produces (migration
-- 0012): the team becomes a bot and stays in the league. Schedule, standings,
-- settled matchups, chat and the prize pool are all untouched, because an
-- account leaving is not a reason to rewrite weeks other people already played.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_profile_id uuid := auth.uid();
  v_membership record;
  v_team_id uuid;
  v_successor uuid;
begin
  if v_profile_id is null then
    raise exception 'Not signed in';
  end if;

  for v_membership in
    select id, league_id from public.league_memberships where profile_id = v_profile_id
  loop
    select id into v_team_id from public.teams where membership_id = v_membership.id;

    -- A commissioner cannot be asked to hand the role over on the way out the
    -- door, the way Leave This League asks, because there is no "afterwards" to
    -- come back to. So the role is passed on here: to another real member first,
    -- oldest membership wins, and only to a bot team if nobody human is left. A
    -- league with no other team at all keeps its commissioner pointing at the
    -- now-bot team, which is what SET NULL on that FK would have produced anyway.
    if exists (
      select 1 from public.leagues
      where id = v_membership.league_id and commissioner_team_id = v_team_id
    ) then
      select t.id into v_successor
      from public.teams t
      left join public.league_memberships m on m.id = t.membership_id
      where t.league_id = v_membership.league_id
        and t.id is distinct from v_team_id
      order by (m.profile_id is null), m.joined_at nulls last, t.created_at
      limit 1;

      if v_successor is not null then
        update public.leagues
        set commissioner_team_id = v_successor
        where id = v_membership.league_id;
      end if;
    end if;

    if v_team_id is not null then
      -- is_simulated is what the bot lineup job picks up and what the reminder
      -- job's recipient filter excludes, so this one flag is what makes the team
      -- keep playing without the person who left (see 0012).
      update public.teams set is_simulated = true where id = v_team_id;
    end if;
  end loop;

  delete from public.league_memberships where profile_id = v_profile_id;

  -- Teams this profile vacated earlier, in leagues it already left. Nulling this
  -- is what lets the auth.users cascade through profiles succeed.
  update public.teams set vacated_by_profile_id = null where vacated_by_profile_id = v_profile_id;
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

comment on function public.delete_my_account() is
  'Prepares the signed-in profile for deletion: hands over any commissioner role, turns their teams into bot teams, drops their memberships and clears vacated_by_profile_id. The delete-account edge function calls this, then removes the auth user.';
