-- 0044: move every cron job off the inline legacy service_role JWT and onto the vault's
-- `edge_admin_key` (an sb_secret_ key), the way live-activities already authenticates.
--
-- Why: the legacy service_role JWT leaked in a screenshot (Sept 2026) and can only be
-- invalidated by disabling JWT-based API keys. Seven jobs still carried it pasted inline,
-- so disabling it would have broken them. After this runs and one cycle returns 200s,
-- JWT-based keys can be turned off in the dashboard.
--
-- cron.alter_job only replaces the command. Schedule and active/inactive state are kept,
-- so the two retired jobs (fetch-nfl-scores, fetch-nflverse-player-stats) stay off.

do $$
declare
  j record;
  base constant text := 'https://ebinbsljpofxtutrcqhu.supabase.co/functions/v1/';
begin
  if not exists (select 1 from vault.decrypted_secrets where name = 'edge_admin_key') then
    raise exception 'vault secret edge_admin_key is missing; create it before running 0044';
  end if;

  for j in
    select * from (values
      ('fetch-balldontlie-player-stats', 'fetch-balldontlie-player-stats', 30000),
      ('fetch-nfl-odds-daily',           'fetch-nfl-odds',                 30000),
      ('fetch-nfl-rosters',              'fetch-nfl-rosters',              30000),
      ('fetch-nfl-scores',               'fetch-nfl-scores',               5000),
      ('fetch-nflverse-player-stats',    'fetch-nflverse-player-stats',    5000),
      ('generate-bot-lineups',           'generate-bot-lineups',           30000),
      ('send-roster-reminders',          'send-roster-reminders',          30000),
      ('settle-week',                    'settle-week',                    30000)
    ) as t(jobname, slug, timeout_ms)
  loop
    perform cron.alter_job(
      job_id  := (select jobid from cron.job where jobname = j.jobname),
      command := format($cmd$
  select net.http_post(
    url := %L,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_admin_key')
    ),
    timeout_milliseconds := %s
  ) as request_id;
$cmd$, base || j.slug, j.timeout_ms)
    );
  end loop;
end $$;
