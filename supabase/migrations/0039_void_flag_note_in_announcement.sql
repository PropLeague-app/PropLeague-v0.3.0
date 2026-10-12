-- 0039_void_flag_note_in_announcement.sql (1.2.11)
--
-- The void announcement used to end with a fixed line, "Only applies to Over and Anytime TD picks."
-- That rule is already explained in How It Works, and repeating it on every post pushed the real
-- content down and read as boilerplate (see chat, Oct 2026). The commissioner's own note goes there
-- instead, and when there is no note the post simply ends after the reason.
--
-- A note is already required for reason 'other', where it is the reason itself, so it is never
-- repeated: the italic tail only appears for injury and ejection.
--
-- Everything else about set_wager_void_flag is unchanged from 0032.

create or replace function public.set_wager_void_flag(
  p_league_id uuid,
  p_week text,
  p_player_name text,
  p_reason text,
  p_note text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_current text;
  v_id uuid;
  v_team_id uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_reason text;
  v_nfl text;
  v_tag text := '';
  v_week_label text;
  v_tail text := '';
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

  -- The player's NFL team is the first part of his pick id ('KC-rashee-rice'); the app uses it to
  -- tint his name in the notice. Left off when it does not look like a team code.
  select upper(split_part(w.player_id, '-', 1)) into v_nfl
  from public.wagers w
  join public.weekly_rosters r on r.id = w.roster_id
  join public.teams t on t.id = r.team_id
  where t.league_id = p_league_id and r.week = p_week and w.player_name = p_player_name and w.player_id is not null
  limit 1;
  if v_nfl ~ '^[A-Z]{2,3}$' then
    v_tag := '|' || v_nfl;
  end if;

  v_reason := case p_reason
    when 'injury' then 'an early exit (injury)'
    when 'ejection' then 'an early exit (ejection)'
    else coalesce(replace(v_note, '*', ''), 'an early exit')
  end;
  v_week_label := case when p_week ~ '^[0-9]+$' then 'Week ' || p_week else p_week end;

  -- The commissioner's own words, in italics, where the boilerplate used to be. Asterisks are
  -- stripped so a note can never break the **highlight** / *italic* markup the app parses.
  if p_reason <> 'other' and v_note is not null then
    v_tail := ' *' || replace(replace(v_note, '*', ''), '|', '') || '*';
  end if;

  insert into public.activity_items (league_id, type, message, pinned, posted_by_team_id)
  values (
    p_league_id, 'announcement',
    'All **' || replace(replace(p_player_name, '*', ''), '|', '') || v_tag || '** picks for ' || v_week_label
      || ' have been **voided** due to ' || v_reason || '.' || v_tail,
    false, v_team_id
  );

  return v_id;
end;
$function$;
