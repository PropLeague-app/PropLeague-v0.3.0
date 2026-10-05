-- 0030: roster penalties and the Perfect Week announcement toggle.
--
-- Run after 0029. Safe to run more than once.
--
--  * update_league_settings now treats emptySlotFloor, invalidRosterPenaltyEnabled and
--    invalidRosterFee as gameplay settings: while a pick exists this week they are saved as
--    PENDING and apply at rollover (like every other rule that changes how a week is played).
--    Must match DEFERRED_SETTING_KEYS in src/engine/settingsRules.ts.
--  * perfectWeekAnnouncements is a display choice, so it applies immediately (not deferred).
--  * Everything else in the function is 0027's, unchanged.
--
-- Also redeploy the settle-week edge function: it applies the penalties and posts the Perfect Week
-- announcement when a week is final.

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

revoke all on function public.update_league_settings(uuid, jsonb) from public, anon;
grant execute on function public.update_league_settings(uuid, jsonb) to authenticated;
