-- Settings lock + pending changes + server-side stake rules, Build 6 (Batch 2). See chat, Oct 2026.
--
-- 1) SETTINGS LOCK. Once ANY pick (human or bot) exists in a league's current week, gameplay settings
--    (slots, credits, bet limits, duplicate/correlation/min-games/hide-picks rules, buy-in amount,
--    multipliers) must not change under those picks. Edits made during the lock are saved as
--    PENDING (leagues.pending_settings) and settle-week merges them into `settings` in the same
--    update that advances the week. Cosmetic / non-gameplay settings (league name, moments, alt
--    lines, line movement, playoff format, payout splits, conference names, display options)
--    always apply immediately. The deferred key list below MUST match DEFERRED_SETTING_KEYS in
--    src/engine/settingsRules.ts.
-- 2) FEASIBILITY. A full, legal roster must always be reachable: settings_infeasibility() mirrors
--    settingsInfeasibility() in src/engine/settingsRules.ts and rejects limits that cannot be met
--    (min bet x slots > credits, max bets that cannot absorb the credits, ...).
-- 3) DIRECT-WRITE GUARD. RLS lets a commissioner UPDATE the whole leagues row, which would skip
--    the lock. A trigger now rejects API changes to settings / pending_settings unless they come
--    through update_league_settings. service_role (edge functions) and the SQL editor are exempt.
-- 4) STAKE RULES. place_wager and update_wager_stake now enforce, server-side, what the bet slip
--    already did client-side: minimum bet, per-slot max (moneyline slot vs prop slots), the
--    single-pick % cap, the weekly credit total, and for a NEW pick into an empty slot, enough left
--    for every other empty slot's minimum. Edits to existing picks skip the reserve rule so moving
--    dollars between picks is never blocked by order of operations. Bots (service_role) are exempt
--    from the stake rules in place_wager, same as the kickoff lock.
--
-- place_wager / update_wager_stake bodies below are 0022's, verbatim, plus the stake check.

alter table public.leagues add column if not exists pending_settings jsonb;

create or replace function public.settings_infeasibility(p_settings jsonb)
returns text
language plpgsql
immutable
as $$
declare
  v_credits numeric := coalesce((p_settings ->> 'weeklyCredits')::numeric, 100);
  v_min numeric := coalesce((p_settings ->> 'minBetPerSlot')::numeric, 1);
  v_ml numeric := coalesce((p_settings -> 'mlBetOverride' ->> 'max')::numeric, (p_settings ->> 'maxMLBet')::numeric, 15);
  v_prop numeric := coalesce((p_settings -> 'propBetOverride' ->> 'max')::numeric, (p_settings ->> 'maxPropBet')::numeric);
  v_pct numeric := coalesce((p_settings ->> 'singleBetCapPct')::numeric, 0.8);
  v_slots jsonb := coalesce(p_settings -> 'lineupSlots', '{"QB":1,"RB":2,"WR":2,"TE":1,"K":1,"ML":1}'::jsonb);
  v_total int;
  v_mlslots int;
  v_propslots int;
  v_cap numeric;
  v_mlmax numeric;
  v_propmax numeric;
  v_capacity numeric;
begin
  select coalesce(sum(value::numeric), 0)::int into v_total from jsonb_each_text(v_slots);
  v_mlslots := coalesce((v_slots ->> 'ML')::int, 0);
  v_propslots := v_total - v_mlslots;

  if v_credits <= 0 then return 'Weekly credits must be more than $0.'; end if;
  if v_total <= 0 then return 'The lineup needs at least one slot.'; end if;
  if v_pct <= 0 or v_pct > 1 then return 'Max % of credits on one pick must be between 1% and 100%.'; end if;

  if v_min * v_total > v_credits + 0.005 then
    return 'Minimum bet $' || to_char(v_min, 'FM999990.00') || ' across ' || v_total || ' slots is $'
      || to_char(v_min * v_total, 'FM999990.00') || ', more than the $' || to_char(v_credits, 'FM999990.00')
      || ' weekly credits. Use $' || to_char(floor(v_credits / v_total * 100) / 100, 'FM999990.00') || ' or less.';
  end if;

  v_cap := v_credits * v_pct;
  v_mlmax := least(v_ml, v_cap);
  v_propmax := least(coalesce(v_prop, v_cap), v_cap);

  if v_mlslots > 0 and v_min > v_mlmax + 0.005 then
    return 'Minimum bet $' || to_char(v_min, 'FM999990.00') || ' is above the highest allowed moneyline/spread bet ($'
      || to_char(v_mlmax, 'FM999990.00') || ').';
  end if;
  if v_propslots > 0 and v_min > v_propmax + 0.005 then
    return 'Minimum bet $' || to_char(v_min, 'FM999990.00') || ' is above the highest allowed prop bet ($'
      || to_char(v_propmax, 'FM999990.00') || ').';
  end if;

  v_capacity := v_mlslots * v_mlmax + v_propslots * v_propmax;
  if v_capacity < v_credits - 0.005 then
    return 'The max bets only allow $' || to_char(v_capacity, 'FM999990.00') || ' of the $' || to_char(v_credits, 'FM999990.00')
      || ' weekly credits to be used across ' || v_total || ' slots. Raise a max bet or the max % on one pick.';
  end if;

  return null;
end;
$$;

-- True once any pick exists in the league's current week (bots count).
create or replace function public.league_settings_locked(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.is_league_member(p_league_id)
    and exists (
      select 1
      from public.leagues l
      join public.teams t on t.league_id = l.id
      join public.weekly_rosters r on r.team_id = t.id and r.week = l.current_week::text
      join public.wagers w on w.roster_id = r.id
      where l.id = p_league_id
    );
$$;

-- p_patch holds ONLY the keys the commissioner changed (never the whole object), so defaults the
-- app fills in for a key a league never stored can never show up as a fake "change".
--   unlocked: patch applies now, and any stale scheduled changes apply with it
--   locked:   deferred keys go to pending_settings (a key set back to its live value is dropped from
--             pending); every other key applies now
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
    'correlationRules', 'minGamesPerRoster', 'buyInEnabled', 'buyInAmount', 'poolMultipliers',
    'propBetOverride', 'mlBetOverride'
  ];
  v_current jsonb;
  v_pend jsonb;
  v_week text;
  v_locked boolean;
  v_err text;
  v_new jsonb;
  v_pending_new jsonb;
  k text;
begin
  if not public.is_league_commissioner(p_league_id) then
    raise exception 'Only the commissioner can change league settings';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'Settings changes must be an object';
  end if;

  select coalesce(settings, '{}'::jsonb), coalesce(pending_settings, '{}'::jsonb), current_week::text
  into v_current, v_pend, v_week
  from public.leagues where id = p_league_id for update;

  -- Judge what the league BECOMES (live + scheduled + this change), never an in-between state.
  v_err := public.settings_infeasibility(v_current || v_pend || p_patch);
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

-- "Discard pending changes": drops everything scheduled for the next week.
create or replace function public.discard_pending_settings(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_settings jsonb;
  v_week text;
begin
  if not public.is_league_commissioner(p_league_id) then
    raise exception 'Only the commissioner can change league settings';
  end if;
  perform set_config('app.settings_rpc', 'on', true);
  update public.leagues set pending_settings = null where id = p_league_id
  returning coalesce(settings, '{}'::jsonb), current_week::text into v_settings, v_week;
  return jsonb_build_object('locked', public.league_settings_locked(p_league_id), 'week', v_week, 'settings', v_settings, 'pending_settings', null);
end;
$$;

create or replace function public.leagues_settings_write_guard()
returns trigger
language plpgsql
as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     and coalesce(current_setting('app.settings_rpc', true), '') <> 'on'
     and (new.settings is distinct from old.settings or new.pending_settings is distinct from old.pending_settings) then
    raise exception 'League settings must be changed through update_league_settings';
  end if;
  return new;
end;
$$;

drop trigger if exists leagues_settings_write_guard on public.leagues;
create trigger leagues_settings_write_guard
  before update on public.leagues
  for each row execute function public.leagues_settings_write_guard();

-- First problem with a stake at placement, or null. Shared by place_wager and update_wager_stake.
-- p_replacing: the slot already holds a pick (a swap or a stake edit), so the reserve rule is skipped.
-- Mirrors stakeError() in src/engine/stakeRules.ts.
create or replace function public.wager_stake_error(
  p_league_id uuid, p_team_id uuid, p_week text, p_slot_id text, p_stake numeric, p_replacing boolean
)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_s jsonb;
  v_credits numeric;
  v_min numeric;
  v_pct numeric;
  v_cap numeric;
  v_max numeric;
  v_roster_id uuid;
  v_other numeric := 0;
  v_filled_others int := 0;
  v_total_slots int;
  v_empty_others int;
  v_remaining numeric;
  v_leave numeric;
begin
  select coalesce(settings, '{}'::jsonb) into v_s from public.leagues where id = p_league_id;
  v_credits := coalesce((v_s ->> 'weeklyCredits')::numeric, 100);
  v_min := coalesce((v_s ->> 'minBetPerSlot')::numeric, 1);
  v_pct := coalesce((v_s ->> 'singleBetCapPct')::numeric, 0.8);
  v_cap := v_credits * v_pct;

  if p_slot_id like 'ML-%' then
    v_max := coalesce((v_s -> 'mlBetOverride' ->> 'max')::numeric, (v_s ->> 'maxMLBet')::numeric, 15);
  else
    v_max := coalesce((v_s -> 'propBetOverride' ->> 'max')::numeric, (v_s ->> 'maxPropBet')::numeric);
  end if;

  if p_stake is null or p_stake <= 0 then
    return 'Stake must be more than $0.';
  end if;
  if p_stake < v_min - 0.005 then
    return 'Minimum bet is $' || to_char(v_min, 'FM999990.00') || '.';
  end if;
  if v_max is not null and p_stake > v_max + 0.005 then
    return 'Maximum bet is $' || to_char(v_max, 'FM999990.00') || '.';
  end if;
  if p_stake > v_cap + 0.005 then
    return 'Exceeds the ' || round(v_pct * 100) || '% single-pick cap ($' || to_char(v_cap, 'FM999990.00') || ').';
  end if;

  select id into v_roster_id from public.weekly_rosters where team_id = p_team_id and week = p_week;
  if v_roster_id is not null then
    select coalesce(sum(stake), 0), count(*) into v_other, v_filled_others
    from public.wagers where roster_id = v_roster_id and slot_id <> p_slot_id;
  end if;

  v_remaining := v_credits - v_other;
  if p_stake > v_remaining + 0.005 then
    return 'Only $' || to_char(greatest(0, v_remaining), 'FM999990.00') || ' left this week.';
  end if;

  if not p_replacing then
    select coalesce(sum(value::numeric), 0)::int into v_total_slots
    from jsonb_each_text(coalesce(v_s -> 'lineupSlots', '{"QB":1,"RB":2,"WR":2,"TE":1,"K":1,"ML":1}'::jsonb));
    v_empty_others := greatest(0, v_total_slots - v_filled_others - 1);
    v_leave := v_min * v_empty_others;
    if v_empty_others > 0 and v_remaining - p_stake < v_leave - 0.005 then
      return 'Leave $' || to_char(v_leave, 'FM999990.00') || ' for your ' || v_empty_others || ' empty slot'
        || case when v_empty_others > 1 then 's' else '' end
        || ' (max $' || to_char(greatest(0, least(v_cap, coalesce(v_max, v_cap), v_remaining - v_leave)), 'FM999990.00') || ').';
    end if;
  end if;

  return null;
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
  v_game_status text;
  v_game_kickoff timestamptz;
  v_err text;
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

  v_err := public.wager_stake_error((select league_id from public.teams where id = p_team_id), p_team_id, p_week, p_slot_id, p_stake, true);
  if v_err is not null then
    raise exception '%', v_err;
  end if;

  update public.wagers set stake = p_stake where roster_id = v_roster_id and slot_id = p_slot_id;
  update public.weekly_rosters set submitted = false, updated_at = now() where id = v_roster_id;
end;
$$;


revoke all on function public.settings_infeasibility(jsonb) from public, anon;
revoke all on function public.league_settings_locked(uuid) from public, anon;
revoke all on function public.update_league_settings(uuid, jsonb) from public, anon;
revoke all on function public.discard_pending_settings(uuid) from public, anon;
revoke all on function public.wager_stake_error(uuid, uuid, text, text, numeric, boolean) from public, anon, authenticated;
grant execute on function public.settings_infeasibility(jsonb) to authenticated, service_role;
grant execute on function public.league_settings_locked(uuid) to authenticated;
grant execute on function public.update_league_settings(uuid, jsonb) to authenticated;
grant execute on function public.discard_pending_settings(uuid) to authenticated;
