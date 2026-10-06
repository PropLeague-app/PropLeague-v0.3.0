-- Live Activities (lock screen + Dynamic Island), step 1: schema.
--
-- Two kinds of activity share one pipeline:
--   lineup : a countdown to the first kickoff of a day with picks and unspent credits, shown only
--            while the roster still needs work, gone at kickoff.
--   score  : your score against your opponent's, shown while you have picks live in a kickoff
--            window (Thursday night, Sunday early + late, Sunday night, Monday night).
--
-- 1. live_activity_start_tokens: one row per device. A "push to start" token (iOS 17.2+) lets the
--    server start an activity while the app is closed. Same ownership model as
--    device_push_tokens: the token is unique, signing a device into another account hands it over.
-- 2. live_activities: one row per activity the server is tracking. push_token is the per-activity
--    token the server updates it with; last_state lets the server skip a push when nothing changed.
-- 3. RPCs. register_live_activity_start_token and register_live_activity are for a signed-in app.
--    register_live_activity_by_start_token is for the background launch iOS does after a push to
--    start, when there is no signed-in session to use: the start token itself proves which device
--    (and so which profile) is asking, the same way a push token is only known to its own device.

create table if not exists public.live_activity_start_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists live_activity_start_tokens_profile_idx on public.live_activity_start_tokens (profile_id);
alter table public.live_activity_start_tokens enable row level security;
drop policy if exists "service role only" on public.live_activity_start_tokens;
create policy "service role only" on public.live_activity_start_tokens for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create table if not exists public.live_activities (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  league_id uuid not null,
  team_id uuid not null,
  week text not null,
  kind text not null check (kind in ('lineup', 'score')),
  window_key text not null,
  activity_id text,
  push_token text,
  last_state jsonb,   -- content state last pushed, so an unchanged state is not pushed again and an end can reuse it
  meta jsonb,         -- kickoff and title, so an end push can pick the right closing state
  started_at timestamptz not null default now(),
  last_pushed_at timestamptz,
  ended_at timestamptz,
  unique (profile_id, league_id, week, kind, window_key)
);
create index if not exists live_activities_open_idx on public.live_activities (profile_id) where ended_at is null;
alter table public.live_activities enable row level security;
drop policy if exists "service role only" on public.live_activities;
create policy "service role only" on public.live_activities for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create or replace function public.register_live_activity_start_token(p_token text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Must be signed in to register a live activity token';
  end if;
  insert into public.live_activity_start_tokens (profile_id, token, last_seen_at)
  values (auth.uid(), p_token, now())
  on conflict (token) do update set profile_id = excluded.profile_id, last_seen_at = now();
end;
$function$;

-- Called by a signed-in app once an activity (started by the server, or by the app itself on
-- iOS 16.2 to 17.1) has a push token. Creates the tracking row if the server did not make one.
create or replace function public.register_live_activity(
  p_activity_id text, p_push_token text, p_league_id uuid, p_team_id uuid,
  p_week text, p_kind text, p_window_key text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Must be signed in to register a live activity';
  end if;
  insert into public.live_activities (profile_id, league_id, team_id, week, kind, window_key, activity_id, push_token, ended_at)
  values (auth.uid(), p_league_id, p_team_id, p_week, p_kind, p_window_key, p_activity_id, p_push_token, null)
  on conflict (profile_id, league_id, week, kind, window_key) do update set
    activity_id = excluded.activity_id,
    push_token = excluded.push_token,
    ended_at = null;
end;
$function$;

-- The background path after a push to start: no session, so identify the profile by the device's
-- own start token. Granted to anon on purpose; useless without a valid start token.
create or replace function public.register_live_activity_by_start_token(
  p_start_token text, p_activity_id text, p_push_token text, p_league_id uuid, p_team_id uuid,
  p_week text, p_kind text, p_window_key text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_profile uuid;
begin
  select profile_id into v_profile from public.live_activity_start_tokens where token = p_start_token;
  if v_profile is null then
    return;
  end if;
  insert into public.live_activities (profile_id, league_id, team_id, week, kind, window_key, activity_id, push_token, ended_at)
  values (v_profile, p_league_id, p_team_id, p_week, p_kind, p_window_key, p_activity_id, p_push_token, null)
  on conflict (profile_id, league_id, week, kind, window_key) do update set
    activity_id = excluded.activity_id,
    push_token = excluded.push_token,
    ended_at = null;
end;
$function$;

grant execute on function public.register_live_activity_start_token(text) to authenticated;
grant execute on function public.register_live_activity(text, text, uuid, uuid, text, text, text) to authenticated;
grant execute on function public.register_live_activity_by_start_token(text, text, text, uuid, uuid, text, text, text) to anon, authenticated;
