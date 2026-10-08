-- 0035: market rules can also cap how many lineup slots use a market (build 12).
--
-- Run after 0034. Safe to run more than once.
--
--  * A market rule is now { id, market, side, maxStake, maxSlots }. maxStake caps what one pick can stake
--    (null = no stake cap), maxSlots caps how many of a roster's slots may hold a pick on that market and
--    side (absent or null = no slot cap). A rule with neither is a block, as before; a rule with either or
--    both is a limit.
--  * wager_market_rule_error (0033's) now treats a rule as a block only when BOTH caps are empty, so a
--    slot-only limit is not mistaken for a block.
--  * New trigger enforce_market_slot_cap on public.wagers (before insert): when a pick is placed or swapped
--    into a slot, the other wagers on the same roster are counted against every matching slot cap. Edits to
--    a stake never trip it. Bots (service_role) are exempt like the other placement limits; the bot
--    generator skips picks that would break a cap itself.
--  * Mirrors marketSlotCapReason in src/engine/marketRules.ts.

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
  v_has_slot_cap boolean;
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
      v_has_slot_cap := jsonb_typeof(v_rule -> 'maxSlots') = 'number';
      if jsonb_typeof(v_rule -> 'maxStake') is distinct from 'number' then
        if not v_has_slot_cap then
          return v_label || ' picks are blocked in this league.';
        end if;
        continue; -- a slot-only limit: no stake cap to apply
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

revoke all on function public.wager_market_rule_error(uuid, text, text, numeric, boolean) from public, anon, authenticated;

create or replace function public.enforce_market_slot_cap()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_league_id uuid;
  v_s jsonb;
  v_rule jsonb;
  v_cap int;
  v_used int;
  v_label text;
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  if new.market_key in ('h2h', 'spreads', 'totals') then
    return new;
  end if;

  select t.league_id into v_league_id
  from public.weekly_rosters r join public.teams t on t.id = r.team_id
  where r.id = new.roster_id;
  if v_league_id is null then
    return new;
  end if;

  select coalesce(settings, '{}'::jsonb) into v_s from public.leagues where id = v_league_id;
  if coalesce(v_s ->> 'marketRulesEnabled', 'false') <> 'true' or jsonb_typeof(v_s -> 'marketRules') <> 'array' then
    return new;
  end if;

  for v_rule in select value from jsonb_array_elements(v_s -> 'marketRules') loop
    if (v_rule ->> 'market') = new.market_key
       and jsonb_typeof(v_rule -> 'maxSlots') = 'number'
       and ((v_rule ->> 'side') is null or lower(v_rule ->> 'side') = lower(coalesce(new.side, ''))) then
      v_cap := (v_rule ->> 'maxSlots')::numeric::int;
      select count(*) into v_used
      from public.wagers w
      where w.roster_id = new.roster_id
        and w.slot_id <> new.slot_id
        and w.market_key = new.market_key
        and ((v_rule ->> 'side') is null or lower(v_rule ->> 'side') = lower(coalesce(w.side, '')));
      if v_used >= v_cap then
        v_label := public.market_rule_label(new.market_key) || coalesce(' ' || (v_rule ->> 'side'), '');
        raise exception 'Only % of your slots can use %, and % taken.', v_cap, v_label, case when v_cap = 1 then 'it is' else 'they are' end;
      end if;
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function public.enforce_market_slot_cap() from public, anon, authenticated;

drop trigger if exists enforce_market_slot_cap on public.wagers;
create trigger enforce_market_slot_cap
  before insert on public.wagers
  for each row execute function public.enforce_market_slot_cap();
