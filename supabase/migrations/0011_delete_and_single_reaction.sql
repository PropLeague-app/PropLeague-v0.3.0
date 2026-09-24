-- manual v0.3.0 §6: delete-able announcements, delete-able chat messages, and
-- one reaction per person (switchable) on activity_items -- which covers both
-- League News and Weekly Moments, since both render through the same
-- Reactions component/reaction system (see chat).
--
-- activity_items and its RPCs (post_announcement, post_system_activity,
-- increment_reaction) predate migration tracking -- this is the first migration
-- file to touch them, confirmed against the live schema/policies/function
-- bodies before writing anything below (see chat).

-- 1. Who posted an announcement, so delete_announcement can tell "the person
--    who sent it" from "everyone else". Nullable: existing announcements (and
--    any future one where team resolution somehow fails) have no recorded
--    poster, so they fall back to commissioner-only delete.
alter table public.activity_items
  add column if not exists posted_by_team_id uuid references public.teams(id) on delete set null;

-- 2. Per-person reaction tracking. activity_items.reactions stays as the
--    aggregate emoji->count cache the client already reads; this table is the
--    new source of truth for "who reacted with what", enforced one-per-person
--    via the primary key.
create table if not exists public.activity_reactions (
  item_id uuid not null references public.activity_items(id) on delete cascade,
  league_id uuid not null references public.leagues(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  emoji text not null,
  ts timestamptz not null default now(),
  primary key (item_id, team_id)
);
create index if not exists activity_reactions_item_idx on public.activity_reactions (item_id);

alter table public.activity_reactions enable row level security;
drop policy if exists "league members can see reactions in their league" on public.activity_reactions;
create policy "league members can see reactions in their league"
  on public.activity_reactions for select
  using (is_league_member(league_id));

-- 3. post_announcement now records the poster's own team.
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
  if not public.is_league_member(p_league_id) then
    raise exception 'Only league members can post';
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

-- 4. react_to_activity replaces increment_reaction: upserts the caller's own
--    row in activity_reactions (one per (item, team) by primary key), and
--    keeps activity_items.reactions in sync. Tapping the emoji you already
--    picked removes it; tapping a different one switches.
create or replace function public.react_to_activity(p_item_id uuid, p_emoji text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_league_id uuid;
  v_team_id uuid;
  v_prev_emoji text;
begin
  select league_id into v_league_id from public.activity_items where id = p_item_id;
  if v_league_id is null or not public.is_league_member(v_league_id) then
    raise exception 'Cannot react to this item';
  end if;

  select t.id into v_team_id
  from public.teams t
  join public.league_memberships lm on lm.id = t.membership_id
  where lm.profile_id = auth.uid() and lm.league_id = v_league_id
  limit 1;

  if v_team_id is null then
    raise exception 'Could not resolve your team in this league';
  end if;

  select emoji into v_prev_emoji from public.activity_reactions where item_id = p_item_id and team_id = v_team_id;

  if v_prev_emoji is not null then
    -- decrement (dropping the key entirely at zero) whatever this team was
    -- previously reacting with, whether they're switching or un-reacting
    update public.activity_items
    set reactions = case
      when coalesce((reactions ->> v_prev_emoji)::int, 0) - 1 > 0
        then jsonb_set(reactions, array[v_prev_emoji], to_jsonb((reactions ->> v_prev_emoji)::int - 1))
      else reactions - v_prev_emoji
    end
    where id = p_item_id;
  end if;

  if v_prev_emoji = p_emoji then
    -- tapping your current reaction again just removes it
    delete from public.activity_reactions where item_id = p_item_id and team_id = v_team_id;
    return;
  end if;

  insert into public.activity_reactions (item_id, league_id, team_id, emoji)
  values (p_item_id, v_league_id, v_team_id, p_emoji)
  on conflict (item_id, team_id) do update set emoji = excluded.emoji, ts = now();

  update public.activity_items
  set reactions = jsonb_set(reactions, array[p_emoji], to_jsonb(coalesce((reactions ->> p_emoji)::int, 0) + 1))
  where id = p_item_id;
end;
$$;

-- Close the old uncapped path -- SECURITY DEFINER functions are callable via
-- PostgREST by name regardless of whether the client still references them,
-- so leaving increment_reaction in place would leave the 1-per-person limit
-- bypassable by anyone calling it directly.
drop function if exists public.increment_reaction(uuid, text);

-- 5. delete_announcement: the commissioner, or whichever team originally
--    posted it, can remove it. Scoped to type = 'announcement' only --
--    system-generated items (settlements, Moments, reminders) aren't
--    deletable through this path.
create or replace function public.delete_announcement(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_league_id uuid;
  v_type text;
  v_posted_by uuid;
  v_caller_team_id uuid;
begin
  select league_id, type, posted_by_team_id into v_league_id, v_type, v_posted_by
  from public.activity_items where id = p_item_id;

  if v_league_id is null then
    raise exception 'Announcement not found';
  end if;
  if v_type <> 'announcement' then
    raise exception 'Only announcements can be deleted this way';
  end if;

  select t.id into v_caller_team_id
  from public.teams t
  join public.league_memberships lm on lm.id = t.membership_id
  where lm.profile_id = auth.uid() and lm.league_id = v_league_id
  limit 1;

  if not (
    public.is_league_commissioner(v_league_id)
    or (v_posted_by is not null and v_posted_by = v_caller_team_id)
  ) then
    raise exception 'Only the commissioner or the original poster can delete this announcement';
  end if;

  delete from public.activity_items where id = p_item_id;
end;
$$;

-- 6. delete_chat_message: caller's own resolved team must match the
--    message's team_id -- self-delete only, no commissioner moderation
--    override (not asked for; easy to add later if wanted).
create or replace function public.delete_chat_message(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_league_id uuid;
  v_team_id uuid;
  v_caller_team_id uuid;
begin
  select league_id, team_id into v_league_id, v_team_id
  from public.chat_messages where id = p_item_id;

  if v_league_id is null then
    raise exception 'Message not found';
  end if;

  select t.id into v_caller_team_id
  from public.teams t
  join public.league_memberships lm on lm.id = t.membership_id
  where lm.profile_id = auth.uid() and lm.league_id = v_league_id
  limit 1;

  if v_caller_team_id is null or v_caller_team_id <> v_team_id then
    raise exception 'You can only delete your own messages';
  end if;

  delete from public.chat_messages where id = p_item_id;
end;
$$;
