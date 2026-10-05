-- 0033: market rules limits + the "AI teams count toward the prize pool" option. Build 7.
--
-- Run after 0032. Safe to run more than once.
--
--  * Market rules can no longer target moneyline, spread or total (the ML slot has too few markets
--    to begin with), and a league can have at most 5 rules. Rules already saved on those markets are
--    ignored when picks are placed; the settings editor shows them as unsupported so they can be removed.
--  * New gameplay setting aiTeamsAffectPool (default on, which is how the pool has always worked: every
--    team's weekly score, AI teams included, moves it). Turning it off is deferred like other gameplay
--    rules, and settle-week then leaves AI teams out of the pool's movement, size and per-team share.
--    Must match DEFERRED_SETTING_KEYS in src/engine/settingsRules.ts.
--  * Everything else in the functions below is 0031's, unchanged.

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
    -- Moneyline, spread and total cannot be ruled on (the ML slot has too few markets to begin with).
    if (v_rule ->> 'market') = p_market_key
       and p_market_key not in ('h2h', 'spreads', 'totals')
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
    'emptySlotFloor', 'invalidRosterPenaltyEnabled', 'invalidRosterFee', 'aiTeamsAffectPool'
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

  if p_patch ? 'aiTeamsAffectPool' and jsonb_typeof(p_patch -> 'aiTeamsAffectPool') <> 'boolean' then
    raise exception 'The AI prize pool option must be on or off';
  end if;

  -- Market rules: a boolean switch and a short list of { market, side, maxStake } objects.
  if p_patch ? 'marketRulesEnabled' and jsonb_typeof(p_patch -> 'marketRulesEnabled') <> 'boolean' then
    raise exception 'Market rules must be on or off';
  end if;
  if p_patch ? 'marketRules' then
    if jsonb_typeof(p_patch -> 'marketRules') <> 'array' or jsonb_array_length(p_patch -> 'marketRules') > 5 then
      raise exception 'A league can have at most 5 market rules';
    end if;
    for v_elem in select value from jsonb_array_elements(p_patch -> 'marketRules') loop
      if jsonb_typeof(v_elem) <> 'object'
         or jsonb_typeof(v_elem -> 'market') is distinct from 'string'
         or public.market_rule_label(v_elem ->> 'market') = (v_elem ->> 'market')
         or (v_elem ->> 'market') in ('h2h', 'spreads', 'totals')
         or (v_elem ? 'side' and jsonb_typeof(v_elem -> 'side') not in ('null', 'string'))
         or (v_elem ? 'side' and jsonb_typeof(v_elem -> 'side') = 'string' and (v_elem ->> 'side') not in ('Over', 'Under'))
         or (v_elem ? 'maxStake' and jsonb_typeof(v_elem -> 'maxStake') not in ('null', 'number'))
         or (v_elem ? 'maxStake' and jsonb_typeof(v_elem -> 'maxStake') = 'number' and (v_elem ->> 'maxStake')::numeric < 0) then
        raise exception 'Each market rule needs a prop market (not moneyline, spread or total), an Over or Under side (or none), and a stake limit of $0 or more (or none to block it)';
      end if;
    end loop;
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

revoke all on function public.wager_market_rule_error(uuid, text, text, numeric, boolean) from public, anon, authenticated;
revoke all on function public.update_league_settings(uuid, jsonb) from public, anon;
grant execute on function public.update_league_settings(uuid, jsonb) to authenticated;
