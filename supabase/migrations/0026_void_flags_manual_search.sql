-- Game exits, take 2 (follow-up to 0025). See chat, Oct 2026.
--
-- 0025 listed every player with a lost Over / Anytime TD pick and asked the commissioner
-- to confirm each had 0 snaps in the 2nd half. That was wrong: most of those players
-- played the full game, and nothing in our stats feed can tell us who left early. The
-- commissioner now searches for the specific player, picks a reason, and (for "other")
-- writes a short note. Every flag is announced in the league feed with that reason.
--
-- Changes:
--   * wager_void_flags.note (free text) next to the existing reason column.
--   * league_void_candidates now returns every Over / Anytime TD pick in the league this
--     week whose game has started (any status, so the commissioner can see what will be
--     voided and what stays), plus the flag's reason/note. It is the searchable pool.
--   * set_wager_void_flag takes a reason ('injury' | 'ejection' | 'other') and a note.
--     The old 3-argument version is dropped.
-- clear_wager_void_flag is unchanged.

alter table public.wager_void_flags add column if not exists note text;

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
  status text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select w.player_name, w.game_id, f.id, f.reason, f.note, t.id, t.team_name, w.id, w.market_key, w.side, w.point, w.stake, w.status
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

drop function if exists public.set_wager_void_flag(uuid, text, text);
create function public.set_wager_void_flag(
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
  v_label text;
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

  v_label := case p_reason
    when 'injury' then 'Early exit: injury'
    when 'ejection' then 'Early exit: ejection'
    else 'Early exit'
  end;

  insert into public.activity_items (league_id, type, message, pinned, posted_by_team_id)
  values (
    p_league_id, 'announcement',
    p_player_name || ' (' || v_label || ', no snaps in the 2nd half). His Over and Anytime TD picks that had not hit are voided.'
      || coalesce(' Note: ' || v_note || '.', '')
      || ' Updates within about 15 minutes.',
    false, v_team_id
  );

  return v_id;
end;
$$;

revoke all on function public.league_void_candidates(uuid, text) from public, anon;
revoke all on function public.set_wager_void_flag(uuid, text, text, text, text) from public, anon;
grant execute on function public.league_void_candidates(uuid, text) to authenticated;
grant execute on function public.set_wager_void_flag(uuid, text, text, text, text) to authenticated;
