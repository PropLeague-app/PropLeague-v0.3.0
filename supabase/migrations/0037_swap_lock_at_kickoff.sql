-- Swapping a pick (1.2.10): the app's new swap button (⇄ on a filled slot) replaces a pick through
-- place_wager, which overwrites the wager already in that slot in one step. place_wager checks that
-- the NEW pick's game has not started, but never checked the OLD one's, so a direct call could swap
-- out a pick whose game was already live. clear_wager and update_wager_stake already refuse that.
--
-- Rather than restate place_wager (its live body may differ from the migrations, since several RPCs
-- were edited in the SQL editor), this adds a guard on the wagers table itself: when a signed-in
-- person changes WHAT a pick is (game, market, player, side, line or odds), the pick it is replacing
-- must still be before kickoff. Settlement, bots and void flags run as service_role and are not
-- affected, nor is anything run from the SQL editor. Stake-only edits are untouched.

create or replace function public.guard_wager_swap_after_kickoff()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
  v_kickoff timestamptz;
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.game_id is not distinct from old.game_id
     and new.market_key is not distinct from old.market_key
     and new.player_id is not distinct from old.player_id
     and new.side is not distinct from old.side
     and new.point is not distinct from old.point
     and new.odds_at_placement is not distinct from old.odds_at_placement then
    return new;
  end if;
  select status, kickoff into v_status, v_kickoff from public.real_games where id = old.game_id;
  if v_status is not null and (v_status <> 'upcoming' or v_kickoff <= now()) then
    raise exception 'This pick''s game has already started -- it is locked in and cannot be swapped';
  end if;
  return new;
end;
$function$;

drop trigger if exists guard_wager_swap_after_kickoff on public.wagers;
create trigger guard_wager_swap_after_kickoff
  before update on public.wagers
  for each row execute function public.guard_wager_swap_after_kickoff();
