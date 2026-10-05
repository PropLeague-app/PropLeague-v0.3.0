-- 0029: team color for the player in game-exit notices and the Game Exits card.
--
-- Run AFTER 0028. Safe to run more than once.
--
--  * league_void_candidates also returns each pick's player_id (its first part is the NFL team,
--    e.g. KC-rashee-rice), so the card can tint the avatar.
--  * set_wager_void_flag writes the team into the notice as **Name|KC**; the app turns that into
--    a team-tinted highlight. Notices written before this keep their plain highlight.

drop function if exists public.league_void_candidates(uuid, text);
create function public.league_void_candidates(p_league_id uuid, p_week text)
returns table (
  player_name text,
  game_id text,
  flag_id uuid,
  flag_reason text,
  flag_note text,
  team_id uuid,
  team_name text,
  wager_id uuid,
  market_key text,
  side text,
  point numeric,
  stake numeric,
  status text,
  player_id text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select w.player_name, w.game_id, f.id, f.reason, f.note, t.id, t.team_name, w.id, w.market_key, w.side, w.point, w.stake, w.status, w.player_id
  from public.wagers w
  join public.weekly_rosters r on r.id = w.roster_id
  join public.teams t on t.id = r.team_id
  left join public.real_games g on g.id = w.game_id
  left join public.wager_void_flags f
    on f.league_id = p_league_id and f.week = p_week and f.player_name = w.player_name
  where public.is_league_commissioner(p_league_id)
    and t.league_id = p_league_id
    and r.week = p_week
    and w.player_name is not null
    and w.market_key not in ('h2h', 'spreads', 'totals')
    and (w.market_key = 'player_anytime_td' or lower(w.side) = 'over')
    and (f.id is not null or (g.id is not null and (g.status <> 'upcoming' or g.kickoff <= now())))
  order by w.player_name, t.team_name;
$$;

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
  v_nfl text;
  v_tag text := '';
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

  insert into public.activity_items (league_id, type, message, pinned, posted_by_team_id)
  values (
    p_league_id, 'announcement',
    'All **' || replace(replace(p_player_name, '*', ''), '|', '') || v_tag || '** picks for ' || v_week_label
      || ' have been **voided** due to ' || v_reason
      || '. *Only applies to Over and Anytime TD picks.*',
    false, v_team_id
  );

  return v_id;
end;
$$;

revoke all on function public.league_void_candidates(uuid, text) from public, anon;
revoke all on function public.set_wager_void_flag(uuid, text, text, text, text) from public, anon;
grant execute on function public.league_void_candidates(uuid, text) to authenticated;
grant execute on function public.set_wager_void_flag(uuid, text, text, text, text) to authenticated;
