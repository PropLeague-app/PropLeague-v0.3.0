-- Fixes real, confirmed breakage found in chat: settle-week's automated grading
-- was failing on every single wager with "Only the commissioner can settle
-- wagers" -- the exact error a real signed-in commissioner is supposed to trip
-- if they try to settle someone else's league. settle_wager's is_league_commissioner
-- check reads auth.uid(), which is empty when the caller is settle-week's own
-- Supabase client (authenticated with the project's service role key, not a real
-- user session), so the check failed every time regardless of who "should" be
-- allowed. This was masked until now: the edge function never checked the RPC's
-- result, so it silently reported wagersGraded > 0 while nothing was actually
-- written (see chat -- that's separately fixed in the settle-week source now).
--
-- Fix: the service role -- which only ever lives server-side, never shipped to
-- a client -- is trusted to settle any wager outright. A real signed-in user
-- (any role other than service_role) still goes through the existing
-- is_league_commissioner check exactly as before; this changes nothing about
-- who can settle from inside the app itself.
--
-- Definition below is the exact one pulled from the live database (via
-- pg_get_functiondef) with only that one auth check changed, not a guess at
-- what it might contain -- this table's functions predate migrations in this
-- repo, so this is also the first time settle_wager exists in git at all.
create or replace function public.settle_wager(p_wager_id uuid, p_status text, p_settled_profit numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_league_id uuid;
begin
  if p_status not in ('won', 'lost', 'push', 'voided') then
    raise exception 'Invalid settlement status: %', p_status;
  end if;

  select t.league_id into v_league_id
  from public.wagers w
  join public.weekly_rosters r on r.id = w.roster_id
  join public.teams t on t.id = r.team_id
  where w.id = p_wager_id;

  if v_league_id is null or (auth.role() <> 'service_role' and not public.is_league_commissioner(v_league_id)) then
    raise exception 'Only the commissioner can settle wagers';
  end if;

  update public.wagers set status = p_status, settled_profit = p_settled_profit where id = p_wager_id;
end;
$function$;
