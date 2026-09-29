-- RPC1 of the RPC-lockdown pass (see chat, Sept 28 2026) -- the one flagged as
-- highest real-world severity: place_wager, update_wager_stake, and clear_wager had
-- NO server-side check that a game had already started. The client hides an
-- already-live/final game from the slate (Lineup.tsx: `locked = game.status !==
-- 'upcoming'`), but that's UI-only -- calling these RPCs directly bypasses it
-- entirely. Concretely, before this migration a user could: place a wager on a game
-- that's already final once they know the real outcome; raise a stake on a pick
-- after watching it go well; or -- worst of the three -- call clear_wager to quietly
-- delete a losing pick before settle-week's next run ever grades it, at zero cost.
--
-- Fix: all three now look up the relevant game's status/kickoff from real_games and
-- reject once it's not 'upcoming' OR its kickoff has passed -- checking both, not
-- just status, closes the race window where kickoff has technically passed but the
-- next fetch-nfl-scores run hasn't flipped the status column yet.
--
-- place_wager gets a service_role exemption: generate-bot-lineups (this session's
-- earlier build) calls place_wager itself, as service_role, to seed bot rosters.
-- update_wager_stake/clear_wager get no such exemption -- neither is called from any
-- edge function, only ever from the real client (confirmed by grepping supabase/
-- functions for both names -- zero hits), so there's no legitimate caller to exempt.

create or replace function public.place_wager(p_team_id uuid, p_week text, p_slot_id text, p_game_id text, p_market_key text, p_player_id text, p_player_name text, p_side text, p_point numeric, p_odds numeric, p_stake numeric)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_league_id uuid;
  v_cap int;
  v_roster_id uuid;
  v_wager_id uuid;
  v_claim_count int;
  v_game_status text;
  v_game_kickoff timestamptz;
begin
  if not public.can_manage_team(p_team_id) then
    raise exception 'You do not have permission to manage this team';
  end if;

  if auth.role() <> 'service_role' then
    select status, kickoff into v_game_status, v_game_kickoff
    from public.real_games where id = p_game_id;

    if v_game_status is null then
      raise exception 'Game not found';
    end if;
    if v_game_status <> 'upcoming' or v_game_kickoff <= now() then
      raise exception 'This game has already started -- picks lock at kickoff';
    end if;
  end if;

  select league_id into v_league_id from public.teams where id = p_team_id;
  select (settings ->> 'maxDuplicatePicks')::int into v_cap from public.leagues where id = v_league_id;

  if v_cap is not null then
    select count(distinct r.team_id) into v_claim_count
    from public.wagers w
    join public.weekly_rosters r on r.id = w.roster_id
    join public.teams t on t.id = r.team_id
    where t.league_id = v_league_id
      and r.week = p_week
      and r.team_id <> p_team_id
      and w.game_id = p_game_id
      and w.market_key = p_market_key
      and w.player_id is not distinct from p_player_id
      and w.side = p_side
      and w.point is not distinct from p_point;

    if v_claim_count >= v_cap then
      raise exception 'This pick has already been claimed by the maximum number of teams (%)', v_cap;
    end if;
  end if;

  insert into public.weekly_rosters (team_id, week)
  values (p_team_id, p_week)
  on conflict (team_id, week) do update set submitted = false, updated_at = now()
  returning id into v_roster_id;

  insert into public.wagers (roster_id, slot_id, game_id, market_key, player_id, player_name, side, point, odds_at_placement, stake)
  values (v_roster_id, p_slot_id, p_game_id, p_market_key, p_player_id, p_player_name, p_side, p_point, p_odds, p_stake)
  on conflict (roster_id, slot_id) do update set
    game_id = excluded.game_id,
    market_key = excluded.market_key,
    player_id = excluded.player_id,
    player_name = excluded.player_name,
    side = excluded.side,
    point = excluded.point,
    odds_at_placement = excluded.odds_at_placement,
    stake = excluded.stake,
    placed_at = now(),
    status = 'pending',
    settled_profit = null
  returning id into v_wager_id;

  return v_wager_id;
end;
$$;

create or replace function public.update_wager_stake(p_team_id uuid, p_week text, p_slot_id text, p_stake numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_roster_id uuid;
  v_game_id text;
  v_game_status text;
  v_game_kickoff timestamptz;
begin
  if not public.can_manage_team(p_team_id) then
    raise exception 'You do not have permission to manage this team';
  end if;

  select id into v_roster_id from public.weekly_rosters where team_id = p_team_id and week = p_week;
  if v_roster_id is null then
    raise exception 'No roster found for this team/week';
  end if;

  select game_id into v_game_id from public.wagers where roster_id = v_roster_id and slot_id = p_slot_id;
  if v_game_id is not null then
    select status, kickoff into v_game_status, v_game_kickoff from public.real_games where id = v_game_id;
    if v_game_status is not null and (v_game_status <> 'upcoming' or v_game_kickoff <= now()) then
      raise exception 'This game has already started -- picks lock at kickoff';
    end if;
  end if;

  update public.wagers set stake = p_stake where roster_id = v_roster_id and slot_id = p_slot_id;
  update public.weekly_rosters set submitted = false, updated_at = now() where id = v_roster_id;
end;
$$;

create or replace function public.clear_wager(p_team_id uuid, p_week text, p_slot_id text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_roster_id uuid;
  v_game_id text;
  v_game_status text;
  v_game_kickoff timestamptz;
begin
  if not public.can_manage_team(p_team_id) then
    raise exception 'You do not have permission to manage this team';
  end if;

  select id into v_roster_id from public.weekly_rosters where team_id = p_team_id and week = p_week;
  if v_roster_id is null then return; end if;

  select game_id into v_game_id from public.wagers where roster_id = v_roster_id and slot_id = p_slot_id;
  if v_game_id is not null then
    select status, kickoff into v_game_status, v_game_kickoff from public.real_games where id = v_game_id;
    if v_game_status is not null and (v_game_status <> 'upcoming' or v_game_kickoff <= now()) then
      raise exception 'This game has already started -- picks lock at kickoff';
    end if;
  end if;

  delete from public.wagers where roster_id = v_roster_id and slot_id = p_slot_id;
  update public.weekly_rosters set submitted = false, updated_at = now() where id = v_roster_id;
end;
$$;
