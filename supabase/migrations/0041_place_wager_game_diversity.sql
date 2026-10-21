-- Game diversity becomes a rule that cannot be broken, instead of one that was only noticed later.
--
-- Until now the minimum-games rule was checked in exactly one place: validateLineup, which runs
-- when someone taps Mark Lineup Complete. Nothing checked it when picks were placed, and at
-- settlement checkRosterRules only runs when a commissioner has turned the invalid-roster penalty
-- on, which is off by default. So a lineup that broke the rule could be built freely, refused for
-- submission, and then settle normally with no consequence -- which is exactly what happened in
-- Week 6 of the Pooping Pigs Test League, where one team held eight picks on a single game.
--
-- The rule is a property of the finished lineup, so it can only be judged as the last open slot is
-- filled: until then another game could still arrive. That is what the "open slots left" term
-- below is for. The effect is that someone who tries ends up one pick short rather than with an
-- illegal lineup, and takes the empty-slot penalty instead.
--
-- Mirrors gameDiversityBlock in src/engine/validation.ts, which greys out the bet slip's button and
-- says why. This is the copy that enforces it.
--
-- Bots are exempt, the same way they are exempt from the kickoff lock and the stake rules above:
-- they call this as service_role and build their own legal lineups in one shot.

create or replace function public.wager_game_diversity_error(
  p_league_id uuid,
  p_team_id uuid,
  p_week text,
  p_slot_id text,
  p_game_id text
) returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_min int;
  v_total_slots int;
  v_games int;
  v_filled_other int;
  v_open_after int;
begin
  select coalesce((settings ->> 'minGamesPerRoster')::int, 1),
         (select coalesce(sum(value::int), 0) from jsonb_each_text(settings -> 'lineupSlots'))
    into v_min, v_total_slots
  from public.leagues where id = p_league_id;

  -- 1 means no constraint, which is the default.
  if v_min is null or v_min <= 1 then
    return null;
  end if;

  -- How many of the other slots are already filled, which is what decides how many stay open.
  select count(*) into v_filled_other
  from public.wagers w
  join public.weekly_rosters r on r.id = w.roster_id
  where r.team_id = p_team_id and r.week = p_week and w.slot_id <> p_slot_id;

  -- Games this lineup would be on afterwards: every other slot's game, plus this one. UNION rather
  -- than UNION ALL, so a pick on a game the lineup already uses adds nothing.
  select count(*) into v_games
  from (
    select w.game_id as g
    from public.wagers w
    join public.weekly_rosters r on r.id = w.roster_id
    where r.team_id = p_team_id and r.week = p_week and w.slot_id <> p_slot_id
    union
    select p_game_id
  ) s;

  -- Slots still open once this one is filled. Each could still bring a new game, so a shortfall
  -- only matters when even the best case falls short.
  v_open_after := greatest(v_total_slots - v_filled_other - 1, 0);

  if v_games + v_open_after >= v_min then
    return null;
  end if;

  return format(
    'Your lineup would be left on %s game(s). This league needs picks from at least %s different games.',
    v_games, v_min
  );
end;
$$;

revoke all on function public.wager_game_diversity_error(uuid, uuid, text, text, text) from public;
grant execute on function public.wager_game_diversity_error(uuid, uuid, text, text, text) to authenticated, service_role;

create or replace function public.place_wager(
  p_team_id uuid, p_week text, p_slot_id text, p_game_id text, p_market_key text,
  p_player_id text, p_player_name text, p_side text, p_point numeric, p_odds numeric, p_stake numeric
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_league_id uuid;
  v_cap int;
  v_roster_id uuid;
  v_wager_id uuid;
  v_claim_count int;
  v_game_status text;
  v_game_kickoff timestamptz;
  v_err text;
  v_replacing boolean;
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

  -- Market rules (Build 7): a blocked market is refused for everyone; a per-pick cap applies to people.
  v_err := public.wager_market_rule_error(v_league_id, p_market_key, p_side, p_stake, auth.role() <> 'service_role');
  if v_err is not null then
    raise exception '%', v_err;
  end if;

  -- Stake rules (Build 6): per-pick min / max / single-pick cap, the weekly credit total, and
  -- (new picks only) enough left over for every other empty slot's minimum bet. Bots call this
  -- as service_role and build their own legal lineups, so they are exempt like the kickoff lock.
  if auth.role() <> 'service_role' then
    select exists (
      select 1
      from public.wagers w
      join public.weekly_rosters r on r.id = w.roster_id
      where r.team_id = p_team_id and r.week = p_week and w.slot_id = p_slot_id
    ) into v_replacing;
    v_err := public.wager_stake_error(v_league_id, p_team_id, p_week, p_slot_id, p_stake, v_replacing);
    if v_err is not null then
      raise exception '%', v_err;
    end if;

    -- Game diversity: refuse the pick that would make the minimum unreachable.
    v_err := public.wager_game_diversity_error(v_league_id, p_team_id, p_week, p_slot_id, p_game_id);
    if v_err is not null then
      raise exception '%', v_err;
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
$function$;
