-- League Chat (manual backlog item, added per chat): a free-text channel any
-- league member can post to, kept deliberately separate from activity_items --
-- that table is the sparse, curated feed (system settlements, weekly Moments,
-- commissioner-only League News), while chat is high-volume and purely social
-- (no reactions, no pinning, no moment fields). Fetched on load like the rest
-- of shared league state -- no realtime subscription (none exist anywhere in
-- this app yet, see chat).
--
-- Security model mirrors activity_items exactly (confirmed live via
-- pg_policies + pg_get_functiondef before writing this, see chat): a single
-- member-only SELECT policy, no INSERT policy at all, so every write goes
-- through a SECURITY DEFINER RPC that resolves the caller's own team
-- server-side (via league_memberships/teams, joined off auth.uid()) rather
-- than trusting a client-supplied team_id.
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  message text not null,
  ts timestamptz not null default now(),
  constraint chat_messages_message_len check (char_length(message) > 0 and char_length(message) <= 500)
);

create index if not exists chat_messages_league_ts_idx on public.chat_messages (league_id, ts desc);

alter table public.chat_messages enable row level security;

drop policy if exists "league members can see all chat in their league" on public.chat_messages;
create policy "league members can see all chat in their league"
  on public.chat_messages for select
  using (is_league_member(league_id));

create or replace function public.post_chat_message(p_league_id uuid, p_message text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_team_id uuid;
  v_message text := trim(p_message);
  v_id uuid;
begin
  if not public.is_league_member(p_league_id) then
    raise exception 'Not a member of this league';
  end if;

  if v_message = '' or char_length(v_message) > 500 then
    raise exception 'Message must be between 1 and 500 characters';
  end if;

  select t.id into v_team_id
  from public.teams t
  join public.league_memberships lm on lm.id = t.membership_id
  where lm.profile_id = auth.uid() and lm.league_id = p_league_id
  limit 1;

  if v_team_id is null then
    raise exception 'Could not resolve your team in this league';
  end if;

  insert into public.chat_messages (league_id, team_id, message)
  values (p_league_id, v_team_id, v_message)
  returning id into v_id;

  return v_id;
end;
$$;
