-- Fixes a real bug hit live (see chat, Sept 2026): leave_league (0012) failed
-- with "violates check constraint team_ownership_matches_kind" every single
-- time, meaning nobody could ever actually leave a league through it.
--
-- Confirmed the constraint's actual definition before touching this (see
-- chat): teams.team_ownership_matches_kind requires
--   (is_simulated = true  AND membership_id IS NULL)
--   OR (is_simulated = false AND membership_id IS NOT NULL)
-- 0012's leave_league set is_simulated = true on the departing team while
-- membership_id was still pointing at the (not-yet-deleted) membership row --
-- exactly the disallowed in-between state, since the FK's ON DELETE SET NULL
-- only nulls membership_id once the membership row is actually deleted, a
-- step later. This version nulls membership_id in the SAME update instead of
-- waiting on that cascade, so the row is never in an invalid state at any
-- point -- the later delete of the membership row itself is unaffected (it
-- deletes the row; membership_id being null already just means the FK has
-- nothing left to cascade).
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
    update public.teams set is_simulated = true, membership_id = null where id = v_team_id;
  end if;

  delete from public.league_memberships where id = v_membership_id;
end;
$$;
