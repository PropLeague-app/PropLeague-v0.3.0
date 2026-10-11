-- 0038_settings_timing.sql (1.2.11)
--
-- 1) Prize pool settings apply immediately. The pool is now rebuilt from stored results whenever a week
--    closes (and by the rebuild-pool function right after a change), so buy-in on/off, buy-in amount,
--    multipliers and "AI teams count toward the pool" no longer wait for next week. They come off the
--    deferred list in update_league_settings (src/engine/settingsRules.ts DEFERRED_SETTING_KEYS matches),
--    and any of them already scheduled are applied now.
-- 2) apply_pending_settings_now: the commissioner can apply scheduled changes that only affect new picks
--    (stake limits, min odds, precision, duplicate picks, waiver order, market rules, hide picks) right
--    away. Existing picks are not changed. Settings that judge whole rosters at the end of the week
--    (lineup slots, weekly credits, correlation, minimum games, penalties) always wait for next week.

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
    'correlationRules', 'marketRulesEnabled', 'marketRules', 'minGamesPerRoster',
    'propBetOverride', 'mlBetOverride',
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

-- Pool keys already scheduled: apply them now.
do $$
begin
  perform set_config('app.settings_rpc', 'on', true);
  update public.leagues l
  set settings = coalesce(l.settings, '{}'::jsonb) || (
        select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
        from jsonb_each(l.pending_settings) e
        where e.key in ('buyInEnabled', 'buyInAmount', 'poolMultipliers', 'aiTeamsAffectPool')
      ),
      pending_settings = nullif(
        l.pending_settings - array['buyInEnabled', 'buyInAmount', 'poolMultipliers', 'aiTeamsAffectPool'],
        '{}'::jsonb
      )
  where l.pending_settings ?| array['buyInEnabled', 'buyInAmount', 'poolMultipliers', 'aiTeamsAffectPool'];
end $$;

create or replace function public.apply_pending_settings_now(p_league_id uuid, p_keys text[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_allowed constant text[] := array[
    'minBetPerSlot', 'maxMLBet', 'maxPropBet', 'minOdds', 'singleBetCapPct', 'wagerPrecision', 'hidePicks',
    'maxDuplicatePicks', 'waiverMode', 'marketRulesEnabled', 'marketRules', 'propBetOverride', 'mlBetOverride'
  ];
  v_current jsonb;
  v_pend jsonb;
  v_week text;
  v_err text;
  k text;
begin
  if not public.is_league_commissioner(p_league_id) then
    raise exception 'Only the commissioner can change league settings';
  end if;

  select coalesce(settings, '{}'::jsonb), coalesce(pending_settings, '{}'::jsonb), current_week::text
  into v_current, v_pend, v_week
  from public.leagues where id = p_league_id for update;

  foreach k in array coalesce(p_keys, array[]::text[]) loop
    if k = any(v_allowed) and v_pend ? k then
      v_current := v_current || jsonb_build_object(k, v_pend -> k);
      v_pend := v_pend - k;
    end if;
  end loop;

  -- The league must still be able to field a full, legal roster (now and after the rest goes live).
  v_err := public.settings_infeasibility(v_current || v_pend);
  if v_err is not null then
    raise exception '%', v_err;
  end if;

  if v_pend = '{}'::jsonb then
    v_pend := null;
  end if;

  perform set_config('app.settings_rpc', 'on', true);
  update public.leagues set settings = v_current, pending_settings = v_pend where id = p_league_id;

  return jsonb_build_object('locked', public.league_settings_locked(p_league_id), 'week', v_week, 'settings', v_current, 'pending_settings', v_pend);
end;
$$;

revoke all on function public.apply_pending_settings_now(uuid, text[]) from public, anon;
grant execute on function public.apply_pending_settings_now(uuid, text[]) to authenticated;
