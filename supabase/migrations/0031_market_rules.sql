-- 0031: commissioner market rules (block a market, or cap the stake on one pick), Build 7.
--
-- Run after 0030. Safe to run more than once.
--
--  * Two new gameplay settings, marketRulesEnabled and marketRules. They are deferred like every other
--    rule that changes how a week is played: while a pick exists this week an edit is saved as PENDING and
--    applies at rollover. Must match DEFERRED_SETTING_KEYS in src/engine/settingsRules.ts.
--  * marketRules is a list of { id, market, side, maxStake }. side is "Over", "Under" or null (both).
--    maxStake null blocks the market outright; a number caps what one pick on it can stake.
--  * place_wager refuses a blocked market for every caller (bots included, they filter first) and a stake
--    over the cap for people (bots are exempt from stake rules, same as the other limits).
--    update_wager_stake enforces the cap on stake edits.
--  * update_league_settings validates the new keys and refuses a rule set that would leave the ML slot with
--    nothing to pick (moneyline, spread and total all blocked).
--  * Everything else in the functions below is 0027 / 0030's, unchanged.
--
-- No edge function needs redeploying for this, except generate-bot-lineups (it skips blocked markets).

-- Readable market name for error messages. Mirrors MARKET_LABELS in src/data/propsGenerator.ts.
create or replace function public.market_rule_label(p_market text)
returns text
language sql
immutable
as $$
  select case p_market
    when 'h2h' then 'Moneyline'
    when 'spreads' then 'Spread'
    when 'totals' then 'Total Points'
    when 'player_pass_yds' then 'Passing Yards'
    when 'player_pass_tds' then 'Passing TDs'
    when 'player_pass_interceptions' then 'Interceptions'
    when 'player_rush_yds' then 'Rushing Yards'
    when 'player_rush_attempts' then 'Rush Attempts'
    when 'player_pass_rush_yds' then 'Pass + Rush Yards'
    when 'player_anytime_td' then 'Anytime TD'
    when 'player_reception_yds' then 'Receiving Yards'
    when 'player_receptions' then 'Receptions'
    when 'player_rush_reception_yds' then 'Rush + Rec Yards'
    when 'player_kicking_points' then 'Kicking Points'
    when 'player_field_goals' then 'Field Goals Made'
    when 'player_pass_attempts' then 'Pass Attempts'
    when 'player_pass_completions' then 'Pass Completions'
    when 'player_rush_longest' then 'Longest Rush'
    when 'player_reception_longest' then 'Longest Reception'
    when 'player_pats' then 'Extra Points Made'
    else p_market
  end
$$;

-- First market-rule problem with a pick, or null. p_check_max is false for bots (service_role).
-- Mirrors marketBlockReason / marketMaxStake in src/engine/marketRules.ts.
create or replace function public.wager_market_rule_error(
  p_league_id uuid, p_market_key text, p_side text, p_stake numeric, p_check_max boolean
)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_s jsonb;
  v_rule jsonb;
  v_label text;
  v_cap numeric;
  v_cap_label text;
  v_rule_cap numeric;
begin
  select coalesce(settings, '{}'::jsonb) into v_s from public.leagues where id = p_league_id;
  if coalesce(v_s ->> 'marketRulesEnabled', 'false') <> 'true' or jsonb_typeof(v_s -> 'marketRules') <> 'array' then
    return null;
  end if;

  for v_rule in select value from jsonb_array_elements(v_s -> 'marketRules') loop
    if (v_rule ->> 'market') = p_market_key
       and ((v_rule ->> 'side') is null or lower(v_rule ->> 'side') = lower(coalesce(p_side, ''))) then
      v_label := public.market_rule_label(p_market_key) || coalesce(' ' || (v_rule ->> 'side'), '');
      if (v_rule ->> 'maxStake') is null then
        return v_label || ' picks are blocked in this league.';
      end if;
      v_rule_cap := (v_rule ->> 'maxStake')::numeric;
      if v_cap is null or v_rule_cap < v_cap then
        v_cap := v_rule_cap;
        v_cap_label := v_label;
      end if;
    end if;
  end loop;

  if p_check_max and v_cap is not null and p_stake > v_cap + 0.005 then
    return 'Max stake on ' || v_cap_label || ' is $' || to_char(v_cap, 'FM999990.00') || '.';
  end if;
  return null;
end;
$$;

-- A rule set that shuts the ML slot out completely (moneyline, spread and total all blocked).
create or replace function public.market_rules_infeasibility(p_settings jsonb)
returns text
language plpgsql
immutable
as $$
declare
  v_slots jsonb := coalesce(p_settings -> 'lineupSlots', '{"ML":1}'::jsonb);
  v_blocked int;
begin
  if coalesce(p_settings ->> 'marketRulesEnabled', 'false') <> 'true' or jsonb_typeof(p_settings -> 'marketRules') <> 'array' then
    return null;
  end if;
  if coalesce((v_slots ->> 'ML')::int, 0) <= 0 then
    return null;
  end if;
  select count(distinct r ->> 'market') into v_blocked
  from jsonb_array_elements(p_settings -> 'marketRules') r
  where (r ->> 'market') in ('h2h', 'spreads', 'totals')
    and (r ->> 'side') is null
    and (r ->> 'maxStake') is null;
  if v_blocked >= 3 then
    return 'Moneyline, spread and total are all blocked, so the ML slot could never be filled.';
  end if;
  return null;
end;
$$;

create or replace function public.update_league_settings(p_league_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_deferred constant text[] := array[
    'lineupSlots', 'weeklyCredits', 'minBetPerSlot', 'maxMLBet', 'maxPropBet', 'minOdds', 'singleBetCapPct',
    'wagerPrecision', 'hidePicks', 'maxDuplicatePicks', 'waiverMode', 'correlationBlockEnabled',
    'correlationRules', 'marketRulesEnabled', 'marketRules', 'minGamesPerRoster', 'buyInEnabled', 'buyInAmount',
    'poolMultipliers', 'propBetOverride', 'mlBetOverride',
    'emptySlotFloor', 'invalidRosterPenaltyEnabled', 'invalidRosterFee'
  ];
  v_current jsonb;
  v_pend jsonb;
  v_week text;
  v_locked boolean;
  v_err text;
  v_new jsonb;
  v_pending_new jsonb;
  v_elem jsonb;
  k text;
begin
  if not public.is_league_commissioner(p_league_id) then
    raise exception 'Only the commissioner can change league settings';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Settings changes must be an object';
  end if;

  -- Penalty settings: a floor or fee can never be negative, and the toggles are plain booleans.
  if p_patch ? 'emptySlotFloor' and jsonb_typeof(p_patch -> 'emptySlotFloor') <> 'null'
     and (jsonb_typeof(p_patch -> 'emptySlotFloor') <> 'number' or (p_patch ->> 'emptySlotFloor')::numeric < 0) then
    raise exception 'The empty slot penalty must be a dollar amount of $0 or more';
  end if;
  if p_patch ? 'invalidRosterFee'
     and (jsonb_typeof(p_patch -> 'invalidRosterFee') <> 'number' or (p_patch ->> 'invalidRosterFee')::numeric < 0) then
    raise exception 'The invalid roster fee must be a dollar amount of $0 or more';
  end if;
  if p_patch ? 'invalidRosterPenaltyEnabled' and jsonb_typeof(p_patch -> 'invalidRosterPenaltyEnabled') <> 'boolean' then
    raise exception 'The invalid roster penalty must be on or off';
  end if;
  if p_patch ? 'perfectWeekAnnouncements' and jsonb_typeof(p_patch -> 'perfectWeekAnnouncements') <> 'boolean' then
    raise exception 'Perfect week announcements must be on or off';
  end if;

  -- Market rules: a boolean switch and a short list of { market, side, maxStake } objects.
  if p_patch ? 'marketRulesEnabled' and jsonb_typeof(p_patch -> 'marketRulesEnabled') <> 'boolean' then
    raise exception 'Market rules must be on or off';
  end if;
  if p_patch ? 'marketRules' then
    if jsonb_typeof(p_patch -> 'marketRules') <> 'array' or jsonb_array_length(p_patch -> 'marketRules') > 60 then
      raise exception 'Market rules must be a list of at most 60 rules';
    end if;
    for v_elem in select value from jsonb_array_elements(p_patch -> 'marketRules') loop
      if jsonb_typeof(v_elem) <> 'object'
         or jsonb_typeof(v_elem -> 'market') is distinct from 'string'
         or public.market_rule_label(v_elem ->> 'market') = (v_elem ->> 'market')
         or (v_elem ? 'side' and jsonb_typeof(v_elem -> 'side') not in ('null', 'string'))
         or (v_elem ? 'side' and jsonb_typeof(v_elem -> 'side') = 'string' and (v_elem ->> 'side') not in ('Over', 'Under'))
         or (v_elem ? 'maxStake' and jsonb_typeof(v_elem -> 'maxStake') not in ('null', 'number'))
         or (v_elem ? 'maxStake' and jsonb_typeof(v_elem -> 'maxStake') = 'number' and (v_elem ->> 'maxStake')::numeric < 0) then
        raise exception 'Each market rule needs a known market, an Over or Under side (or none), and a stake limit of $0 or more (or none to block it)';
      end if;
    end loop;
  end if;

  select coalesce(settings, '{}'::jsonb), coalesce(pending_settings, '{}'::jsonb), current_week::text
  into v_current, v_pend, v_week
  from public.leagues where id = p_league_id for update;

  -- Judge what the league BECOMES (live + scheduled + this change), never an in-between state.
  v_err := public.settings_infeasibility(v_current || v_pend || p_patch);
  if v_err is null then
    v_err := public.market_rules_infeasibility(v_current || v_pend || p_patch);
  end if;
  if v_err is not null then
    raise exception '%', v_err;
  end if;

  v_locked := public.league_settings_locked(p_league_id);

  if not v_locked then
    v_new := v_current || v_pend || p_patch;
    v_pending_new := null;
  else
    v_new := v_current;
    v_pending_new := v_pend;
    for k in select jsonb_object_keys(p_patch) loop
      if k = any(v_deferred) then
        if v_current ? k and (p_patch -> k) = (v_current -> k) then
          v_pending_new := v_pending_new - k;
        else
          v_pending_new := v_pending_new || jsonb_build_object(k, p_patch -> k);
        end if;
      else
        v_new := v_new || jsonb_build_object(k, p_patch -> k);
        v_pending_new := v_pending_new - k;
      end if;
    end loop;
    if v_pending_new = '{}'::jsonb then
      v_pending_new := null;
    end if;
  end if;

  perform set_config('app.settings_rpc', 'on', true);
  update public.leagues set settings = v_new, pending_settings = v_pending_new where id = p_league_id;

  -- The league's name and visibility also live in their own columns (that is what every other
  -- device and the invite screens read), and nothing ever wrote them after creation, so a
  -- rename only ever stuck on the commissioner's phone. Keep them in step here.
  if p_patch ? 'leagueName' and nullif(btrim(p_patch ->> 'leagueName'), '') is not null then
    update public.leagues set name = left(btrim(p_patch ->> 'leagueName'), 60) where id = p_league_id;
  end if;
  if p_patch ? 'isPublic' and jsonb_typeof(p_patch -> 'isPublic') = 'boolean' then
    update public.leagues set is_public = (p_patch ->> 'isPublic')::boolean where id = p_league_id;
  end if;

  return jsonb_build_object('locked', v_locked, 'week', v_week, 'settings', v_new, 'pending_settings', v_pending_new);
end;
$$;

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
  v_market text;
  v_side text;
  v_game_status text;
  v_game_kickoff timestamptz;
  v_league_id uuid;
  v_err text;
begin
  if not public.can_manage_team(p_team_id) then
    raise exception 'You do not have permission to manage this team';
  end if;

  select id into v_roster_id from public.weekly_rosters where team_id = p_team_id and week = p_week;
  if v_roster_id is null then
    raise exception 'No roster found for this team/week';
  end if;

  select game_id, market_key, side into v_game_id, v_market, v_side
  from public.wagers where roster_id = v_roster_id and slot_id = p_slot_id;
  if v_game_id is not null then
    select status, kickoff into v_game_status, v_game_kickoff from public.real_games where id = v_game_id;
    if v_game_status is not null and (v_game_status <> 'upcoming' or v_game_kickoff <= now()) then
      raise exception 'This game has already started -- picks lock at kickoff';
    end if;
  end if;

  select league_id into v_league_id from public.teams where id = p_team_id;

  -- Only the per-pick cap matters on an edit: a market that became blocked while this pick sat in the slot
  -- does not stop its stake being lowered or the pick cleared.
  v_err := public.wager_market_rule_error(v_league_id, v_market, v_side, p_stake, true);
  if v_err is not null and v_err like 'Max stake%' then
    raise exception '%', v_err;
  end if;

  v_err := public.wager_stake_error(v_league_id, p_team_id, p_week, p_slot_id, p_stake, true);
  if v_err is not null then
    raise exception '%', v_err;
  end if;

  update public.wagers set stake = p_stake where roster_id = v_roster_id and slot_id = p_slot_id;
  update public.weekly_rosters set submitted = false, updated_at = now() where id = v_roster_id;
end;
$$;

revoke all on function public.market_rule_label(text) from public, anon;
revoke all on function public.wager_market_rule_error(uuid, text, text, numeric, boolean) from public, anon, authenticated;
revoke all on function public.market_rules_infeasibility(jsonb) from public, anon;
revoke all on function public.update_league_settings(uuid, jsonb) from public, anon;
revoke all on function public.place_wager(uuid, text, text, text, text, text, text, text, numeric, numeric, numeric) from public, anon;
revoke all on function public.update_wager_stake(uuid, text, text, numeric) from public, anon;
grant execute on function public.market_rule_label(text) to authenticated, service_role;
grant execute on function public.market_rules_infeasibility(jsonb) to authenticated, service_role;
grant execute on function public.update_league_settings(uuid, jsonb) to authenticated;
grant execute on function public.place_wager(uuid, text, text, text, text, text, text, text, numeric, numeric, numeric) to authenticated, service_role;
grant execute on function public.update_wager_stake(uuid, text, text, numeric) to authenticated;
