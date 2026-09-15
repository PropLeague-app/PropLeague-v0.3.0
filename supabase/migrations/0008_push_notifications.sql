-- Push notifications, step 1: schema. Three new pieces, all additive/nullable
-- so nothing existing breaks if a client hasn't updated yet.
--
-- 1. device_push_tokens -- one row per (device, current signed-in user). A
-- plain user-owns-own-row RLS policy is enough here (unlike chat_messages'
-- SECURITY DEFINER RPC, which had to resolve team_id server-side to stop
-- spoofing another team) -- a push token is inherently tied to whoever is
-- signed in on that device right now, nothing to spoof. `token` is globally
-- unique on purpose: if a device gets signed into a different account (e.g.
-- Hunter's phone, then a friend's), re-registering that same token should
-- hand it to the new profile_id, not leave two profiles both receiving pushes
-- for one physical device.
create table if not exists public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  token text not null unique,
  platform text not null default 'ios',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists device_push_tokens_profile_idx on public.device_push_tokens (profile_id);

alter table public.device_push_tokens enable row level security;

drop policy if exists "users manage their own push tokens" on public.device_push_tokens;
create policy "users manage their own push tokens"
  on public.device_push_tokens for all
  using (auth.uid() = profile_id)
  with check (auth.uid() = profile_id);

-- register_push_token: the actual write path the client uses (see
-- src/services/pushNotifications.ts), NOT a direct table upsert. The RLS
-- policy above only lets a user touch rows THEY already own -- fine for
-- viewing/deleting your own devices, but it can't reassign a token that
-- currently belongs to a different profile_id (its USING clause fails
-- against the pre-existing row), which is exactly the case that matters here:
-- the same physical device signing into a different PropLeague account (see
-- 0008's device_push_tokens comment above -- Hunter's phone, then a friend's
-- test account, sharing one device during testing). SECURITY DEFINER sidesteps
-- that by always writing auth.uid() as the new owner, matching the RPC
-- pattern this repo already uses for chat_messages/settle_wager.
create or replace function public.register_push_token(p_token text, p_platform text default 'ios')
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'Must be signed in to register a push token';
  end if;
  insert into public.device_push_tokens (profile_id, token, platform, last_seen_at)
  values (auth.uid(), p_token, p_platform, now())
  on conflict (token) do update set
    profile_id = excluded.profile_id,
    platform = excluded.platform,
    last_seen_at = now();
end;
$function$;

-- 2. profiles.notification_prefs -- same jsonb-blob-with-client-side-defaults
-- pattern as leagues.settings (see 0002_settings_and_prizepool.sql): null
-- until the user visits Settings and changes something, client treats null
-- as {lineupReminders: true, wagerSettled: true, weekResults: true}.
alter table public.profiles add column if not exists notification_prefs jsonb;

-- 3. notification_dedup -- generic idempotency guard so a cron-driven or
-- rerun-safe edge function can "claim" a specific notification exactly once:
-- `insert into notification_dedup (key) values (...) on conflict do nothing
-- returning key` -- a row coming back means this is the first claim, safe to
-- send; nothing coming back means it already went out, skip. Key shapes used
-- so far (informal, not enforced): 'wager-settled:<wagerId>',
-- 'week-results:<leagueId>:<week>:<teamId>',
-- 'roster-lock:<leagueId>:<week>:<daySlot>:<teamId>'. service_role only --
-- this table is written exclusively by edge functions, never the client.
create table if not exists public.notification_dedup (
  key text primary key,
  sent_at timestamptz not null default now()
);

alter table public.notification_dedup enable row level security;

drop policy if exists "service role only" on public.notification_dedup;
create policy "service role only"
  on public.notification_dedup for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
