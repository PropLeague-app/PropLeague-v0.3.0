-- RPC lockdown, phase 1 of the "RPCs are a major gap" pass (see chat, Sept 28 2026).
-- Full audit was done by pulling pg_get_functiondef for every SECURITY DEFINER
-- function in public and reading each one -- this migration ships the three
-- highest-confidence findings from that audit (RPCs2-4 in that conversation's
-- numbering). RPCs1 (kickoff-lock missing on place_wager/update_wager_stake/
-- clear_wager) and RPCs5 (post_system_activity letting a commissioner fabricate a
-- fake 'moment'/'settled' item) are deliberately NOT in this migration -- both need
-- more design/care and are follow-ups, not because they're less real.

-- RPC2: settle_wager's `auth.role() <> 'service_role' and not is_league_commissioner(...)`
-- carve-out let any league's commissioner call this directly (browser console,
-- supabase.rpc) and force ANY wager in their league to won/lost/push/voided with any
-- settled_profit number. Traced its only client caller (settleWagerRemote, inside
-- useAppStore's advanceWeek) and advanceWeek is dead code -- nothing in the UI calls
-- it anymore (no DevPanel, no Advance Week button exist in this codebase today; real
-- settlement is 100% settle-week's cron, which already calls this as service_role).
-- Safe to drop the commissioner branch entirely with zero regression.
create or replace function public.settle_wager(p_wager_id uuid, p_status text, p_settled_profit numeric)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_league_id uuid;
begin
  if p_status not in ('won', 'lost', 'push', 'voided') then
    raise exception 'Invalid settlement status: %', p_status;
  end if;

  if auth.role() <> 'service_role' then
    raise exception 'Only the automated settlement system can settle wagers';
  end if;

  select t.league_id into v_league_id
  from public.wagers w
  join public.weekly_rosters r on r.id = w.roster_id
  join public.teams t on t.id = r.team_id
  where w.id = p_wager_id;

  if v_league_id is null then
    raise exception 'Wager not found';
  end if;

  update public.wagers set status = p_status, settled_profit = p_settled_profit where id = p_wager_id;
end;
$$;

-- RPC3: upsert_matchup / upsert_standing have the exact same dual-branch shape as
-- settle_wager above, but CANNOT just drop the commissioner branch -- unlike
-- settle_wager, these have a genuinely live client caller: pushSeasonStart (runs
-- every time a real commissioner starts a season) calls both directly, as an
-- authenticated client, to write the initial all-zero/all-null schedule and
-- standings rows before any week has been played. Removing commissioner access
-- outright would break "Start Season" for every real league.
--
-- Fix: keep the commissioner branch, but only let it through when every value being
-- written is the "nothing has happened yet" bootstrap state -- a real score, winner,
-- W/L record, or P/L requires service_role. This closes the actual hole (a
-- commissioner fabricating a result or a standing at any point mid-season) while
-- leaving pushSeasonStart's bootstrap write, which only ever sends that exact
-- all-null/all-zero shape, working exactly as before.
create or replace function public.upsert_matchup(
  p_league_id uuid, p_week text, p_team_a_id uuid, p_team_b_id uuid,
  p_team_a_score numeric, p_team_b_score numeric, p_winner_id uuid, p_is_tie boolean
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_matchup_id uuid;
  v_is_bootstrap boolean;
begin
  v_is_bootstrap := p_team_a_score is null and p_team_b_score is null and p_winner_id is null and p_is_tie is not true;

  if auth.role() <> 'service_role' then
    if not public.is_league_commissioner(p_league_id) then
      raise exception 'Only the commissioner can report matchup results';
    end if;
    if not v_is_bootstrap then
      raise exception 'Only the automated settlement system can report a real matchup result';
    end if;
  end if;

  insert into public.matchups (league_id, week, team_a_id, team_b_id, team_a_score, team_b_score, winner_id, is_tie)
  values (p_league_id, p_week, p_team_a_id, p_team_b_id, p_team_a_score, p_team_b_score, p_winner_id, p_is_tie)
  on conflict (league_id, week, team_a_id, team_b_id) do update set
    team_a_score = excluded.team_a_score,
    team_b_score = excluded.team_b_score,
    winner_id = case
      when excluded.winner_id is null and excluded.is_tie is false
           and (matchups.winner_id is not null or matchups.is_tie) then matchups.winner_id
      else excluded.winner_id
    end,
    is_tie = case
      when excluded.winner_id is null and excluded.is_tie is false
           and (matchups.winner_id is not null or matchups.is_tie) then matchups.is_tie
      else excluded.is_tie
    end
  returning id into v_matchup_id;

  return v_matchup_id;
end;
$$;

create or replace function public.upsert_standing(
  p_team_id uuid, p_wins integer, p_losses integer, p_ties integer, p_total_pl numeric,
  p_bets_won integer, p_bets_lost integer, p_bets_pushed integer, p_best_week_pl numeric,
  p_weekly_scores jsonb, p_total_wagered numeric default 0
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_league_id uuid;
  v_is_bootstrap boolean;
begin
  select league_id into v_league_id from public.teams where id = p_team_id;
  if v_league_id is null then
    raise exception 'Team not found';
  end if;

  -- emptyStanding() (src/engine/standings.ts) seeds bestWeekPL as -Infinity, which
  -- JSON.stringify turns into null on the wire -- so null is part of the bootstrap
  -- shape here, not just 0.
  v_is_bootstrap := p_wins = 0 and p_losses = 0 and p_ties = 0 and p_total_pl = 0
    and p_bets_won = 0 and p_bets_lost = 0 and p_bets_pushed = 0
    and (p_best_week_pl is null or p_best_week_pl = 0)
    and p_total_wagered = 0
    and (p_weekly_scores is null or p_weekly_scores = '{}'::jsonb);

  if auth.role() <> 'service_role' then
    if not public.is_league_commissioner(v_league_id) then
      raise exception 'Only the commissioner can report standings';
    end if;
    if not v_is_bootstrap then
      raise exception 'Only the automated settlement system can report real standings';
    end if;
  end if;

  insert into public.standings (team_id, league_id, wins, losses, ties, total_pl, bets_won, bets_lost, bets_pushed, best_week_pl, weekly_scores, total_wagered, updated_at)
  values (p_team_id, v_league_id, p_wins, p_losses, p_ties, p_total_pl, p_bets_won, p_bets_lost, p_bets_pushed, p_best_week_pl, p_weekly_scores, p_total_wagered, now())
  on conflict (team_id) do update set
    wins = excluded.wins,
    losses = excluded.losses,
    ties = excluded.ties,
    total_pl = excluded.total_pl,
    bets_won = excluded.bets_won,
    bets_lost = excluded.bets_lost,
    bets_pushed = excluded.bets_pushed,
    best_week_pl = excluded.best_week_pl,
    weekly_scores = excluded.weekly_scores,
    total_wagered = excluded.total_wagered,
    updated_at = now();
end;
$$;

-- RPC4: found while reading the live audit output, unrelated to what we went looking
-- for -- a STALE second overload of upsert_standing (10 params, pre-total_wagered)
-- has been sitting in the live DB since before migration 0007 added the 11-param
-- version. `create or replace function` only replaces a function with the exact same
-- argument signature; a different arg list creates a second, separate overload
-- instead of retiring the old one, so this one was silently never dropped. It has no
-- service_role carve-out at all (just `not is_league_commissioner`), so it's both
-- dead weight and a stale inconsistent copy of the function just patched above. Drop
-- it outright -- settle-week and the client both only ever call the 11-param version.
drop function if exists public.upsert_standing(uuid, integer, integer, integer, numeric, integer, integer, integer, numeric, jsonb);
