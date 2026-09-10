-- Automates the real-NFL settlement pipeline (see chat): fetch-nfl-scores,
-- fetch-nfl-player-stats, and settle-week all existed already, but nothing was
-- ever actually calling any of them on a schedule -- they only ran when someone
-- manually invoked them. That's why a game showing "Final" on the slate could sit
-- for days with its props still marked "Live": the game's real score had (maybe)
-- been pulled in by hand at some point, but nothing had told settle-week to grade
-- against it since.
--
-- Staggered five minutes apart, in dependency order: scores land first, then
-- player box scores, then settlement grades wagers and advances the week -- each
-- step gets a few minutes' head start on whatever depends on its data before the
-- next one runs. All three already auto-discover which real week(s) to process
-- except fetch-nfl-player-stats, which (unlike the other two) requires an
-- explicit week/season in its request body -- invoke_fetch_player_stats_for_active_weeks()
-- below covers that by mirroring settle-week's own auto-discovery query.
--
-- ONE-TIME MANUAL STEP -- do this yourself in the SQL editor BEFORE running this
-- migration, never commit a real key to git:
--   select vault.create_secret('<your service role key>', 'edge_function_auth');
-- Everything below only ever references that secret by name.
--
-- If extension creation below fails with a permission error, enable pg_cron and
-- pg_net from Database > Extensions in the Supabase dashboard instead, then
-- re-run this migration.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Looks up the Vault-stored service-role key and POSTs to one of this project's
-- own edge functions. Centralized here so all three schedules below share one
-- never-committed way to authenticate, rather than three copies of the same key
-- lookup.
create or replace function public.invoke_edge_function(function_name text, payload jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  auth_key text;
begin
  select decrypted_secret into auth_key from vault.decrypted_secrets where name = 'edge_function_auth';
  if auth_key is null then
    raise exception 'edge_function_auth secret not found in Vault -- run select vault.create_secret(...) first (see this migration''s header)';
  end if;

  perform net.http_post(
    url := 'https://ebinbsljpofxtutrcqhu.supabase.co/functions/v1/' || function_name,
    headers := jsonb_build_object('Authorization', 'Bearer ' || auth_key, 'Content-Type', 'application/json'),
    body := payload
  );
end;
$$;

-- fetch-nfl-player-stats has no auto-discovery of its own (400s without an
-- explicit week/season) -- this fires it once per distinct week any league is
-- currently sitting on, the same set settle-week auto-discovers for itself.
--
-- SEASON is hardcoded since leagues don't track a season column today --
-- bump this constant at the start of each new NFL season.
create or replace function public.invoke_fetch_player_stats_for_active_weeks()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec record;
  current_season constant int := 2026;
begin
  for rec in
    select distinct current_week from public.leagues where season_phase in ('regular', 'playoffs')
  loop
    perform public.invoke_edge_function(
      'fetch-nfl-player-stats',
      jsonb_build_object('week', rec.current_week, 'season', current_season)
    );
  end loop;
end;
$$;

-- cron.schedule upserts by job name, so re-running this migration is safe.
select cron.schedule('fetch-nfl-scores-hourly', '0 * * * *', $$select public.invoke_edge_function('fetch-nfl-scores');$$);
select cron.schedule('fetch-nfl-player-stats-hourly', '5 * * * *', $$select public.invoke_fetch_player_stats_for_active_weeks();$$);
select cron.schedule('settle-week-hourly', '10 * * * *', $$select public.invoke_edge_function('settle-week');$$);
