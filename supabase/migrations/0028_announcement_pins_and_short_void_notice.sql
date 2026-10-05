-- 0028: shorter game-exit notices, and manual pinning for announcements.
--
-- Run AFTER 0027. Safe to run more than once.
--
-- 1) Announcement text now carries a tiny bit of markup the app understands:
--    **bold** is highlighted, *italic* is italic. Plain text still renders as before.
-- 2) post_announcement no longer auto-pins. The commissioner chooses per post
--    (p_pinned), and set_announcement_pinned toggles it later. At most 3 pinned
--    announcements per league at a time.
-- 3) One-time cleanup: every announcement used to be auto-pinned, so each league
--    keeps only its 3 newest pinned announcements; older ones fall back into the
--    feed by date.

create or replace function public.set_wager_void_flag(
  p_league_id uuid,
  p_week text,
  p_player_name text,
  p_reason text,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_current text;
  v_id uuid;
  v_team_id uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_reason text;
  v_week_label text;
begin
  if not public.is_league_commissioner(p_league_id) then
    raise exception 'Only the commissioner can flag a game exit';
  end if;

  if p_reason not in ('injury', 'ejection', 'other') then
    raise exception 'Pick a reason for the early exit';
  end if;
  if p_reason = 'other' and (v_note is null or char_length(v_note) < 3) then
    raise exception 'Add a short note explaining the early exit';
  end if;
  if v_note is not null and char_length(v_note) > 200 then
    raise exception 'Keep the note under 200 characters';
  end if;

  select current_week::text into v_current from public.leagues where id = p_league_id;
  if v_current is distinct from p_week then
    raise exception 'Game exits can only be flagged for the current week';
  end if;

  if not exists (
    select 1
    from public.wagers w
    join public.weekly_rosters r on r.id = w.roster_id
    join public.teams t on t.id = r.team_id
    join public.real_games g on g.id = w.game_id
    where t.league_id = p_league_id and r.week = p_week and w.player_name = p_player_name
      and w.market_key not in ('h2h', 'spreads', 'totals')
      and (w.market_key = 'player_anytime_td' or lower(w.side) = 'over')
      and (g.status <> 'upcoming' or g.kickoff <= now())
  ) then
    raise exception 'No Over or Anytime TD picks on that player in a game that has started';
  end if;

  insert into public.wager_void_flags (league_id, week, player_name, reason, note)
  values (p_league_id, p_week, p_player_name, p_reason, v_note)
  on conflict (league_id, week, player_name) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.wager_void_flags
    where league_id = p_league_id and week = p_week and player_name = p_player_name;
    return v_id; -- already flagged, nothing new to announce
  end if;

  select t.id into v_team_id
  from public.teams t
  join public.league_memberships lm on lm.id = t.membership_id
  where lm.profile_id = auth.uid() and lm.league_id = p_league_id
  limit 1;

  v_reason := case p_reason
    when 'injury' then 'an early exit (injury)'
    when 'ejection' then 'an early exit (ejection)'
    else coalesce(replace(v_note, '*', ''), 'an early exit')
  end;
  v_week_label := case when p_week ~ '^[0-9]+$' then 'Week ' || p_week else p_week end;

  insert into public.activity_items (league_id, type, message, pinned, posted_by_team_id)
  values (
    p_league_id, 'announcement',
    'All **' || replace(p_player_name, '*', '') || '** picks for ' || v_week_label
      || ' have been **voided** due to ' || v_reason
      || '. *Only applies to Over and Anytime TD picks.*',
    false, v_team_id
  );

  return v_id;
end;
$$;

create or replace function public.clear_wager_void_flag(p_flag_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_league_id uuid;
  v_week text;
  v_player text;
  v_current text;
  v_team_id uuid;
begin
  select league_id, week, player_name into v_league_id, v_week, v_player
  from public.wager_void_flags where id = p_flag_id;
  if v_league_id is null then
    raise exception 'Flag not found';
  end if;

  if not public.is_league_commissioner(v_league_id) then
    raise exception 'Only the commissioner can clear a game exit';
  end if;

  select current_week::text into v_current from public.leagues where id = v_league_id;
  if v_current is distinct from v_week then
    raise exception 'That week has already moved on';
  end if;

  -- Back to pending: settle-week re-grades them from the real stats on its next run.
  update public.wagers
  set status = 'pending', settled_profit = null, void_flag_id = null
  where void_flag_id = p_flag_id;

  delete from public.wager_void_flags where id = p_flag_id;

  select t.id into v_team_id
  from public.teams t
  join public.league_memberships lm on lm.id = t.membership_id
  where lm.profile_id = auth.uid() and lm.league_id = v_league_id
  limit 1;

  insert into public.activity_items (league_id, type, message, pinned, posted_by_team_id)
  values (
    v_league_id, 'announcement',
    '**' || replace(v_player, '*', '') || '** picks for ' || case when v_week ~ '^[0-9]+$' then 'Week ' || v_week else v_week end
      || ' are no longer voided. *They will be re-graded from the real stats.*',
    false, v_team_id
  );
end;
$$;

drop function if exists public.post_announcement(uuid, text);
create or replace function public.post_announcement(p_league_id uuid, p_message text, p_pinned boolean default false)
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

  if coalesce(p_pinned, false) and (
    select count(*) from public.activity_items
    where league_id = p_league_id and type = 'announcement' and pinned
  ) >= 3 then
    raise exception 'You can pin up to 3 announcements. Unpin one first.';
  end if;

  select t.id into v_team_id
  from public.teams t
  join public.league_memberships lm on lm.id = t.membership_id
  where lm.profile_id = auth.uid() and lm.league_id = p_league_id
  limit 1;

  insert into public.activity_items (league_id, type, message, pinned, posted_by_team_id)
  values (p_league_id, 'announcement', p_message, coalesce(p_pinned, false), v_team_id)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.set_announcement_pinned(p_item_id uuid, p_pinned boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_league_id uuid;
  v_type text;
  v_was boolean;
begin
  select league_id, type, pinned into v_league_id, v_type, v_was
  from public.activity_items where id = p_item_id;
  if v_league_id is null then
    raise exception 'Announcement not found';
  end if;
  if v_type <> 'announcement' then
    raise exception 'Only announcements can be pinned';
  end if;
  if not public.is_league_commissioner(v_league_id) then
    raise exception 'Only the commissioner can pin an announcement';
  end if;

  if p_pinned and not v_was and (
    select count(*) from public.activity_items
    where league_id = v_league_id and type = 'announcement' and pinned
  ) >= 3 then
    raise exception 'You can pin up to 3 announcements. Unpin one first.';
  end if;

  update public.activity_items set pinned = p_pinned where id = p_item_id;
end;
$$;

-- One-time: keep the 3 newest pinned announcements per league.
update public.activity_items a
set pinned = false
from (
  select id, row_number() over (partition by league_id order by ts desc) as rn
  from public.activity_items
  where type = 'announcement' and pinned
) r
where a.id = r.id and r.rn > 3;

revoke all on function public.set_wager_void_flag(uuid, text, text, text, text) from public, anon;
revoke all on function public.clear_wager_void_flag(uuid) from public, anon;
revoke all on function public.post_announcement(uuid, text, boolean) from public, anon;
revoke all on function public.set_announcement_pinned(uuid, boolean) from public, anon;
grant execute on function public.set_wager_void_flag(uuid, text, text, text, text) to authenticated;
grant execute on function public.clear_wager_void_flag(uuid) to authenticated;
grant execute on function public.post_announcement(uuid, text, boolean) to authenticated;
grant execute on function public.set_announcement_pinned(uuid, boolean) to authenticated;
