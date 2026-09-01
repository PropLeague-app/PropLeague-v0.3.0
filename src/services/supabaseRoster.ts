import { supabase } from '../lib/supabaseClient';
import type { MarketKey, RosterSlotState, SlotPosition, WagerStatus, WeekId, WeeklyRoster } from '../types';

type ServiceResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

interface PlaceWagerParams {
  teamId: string;
  week: WeekId;
  slotId: string;
  gameId: string;
  marketKey: MarketKey;
  playerId?: string;
  playerName?: string;
  side: string;
  point?: number;
  odds: number;
  stake: number;
}

export async function placeWagerRemote(params: PlaceWagerParams): Promise<ServiceResult<{ wagerId: string }>> {
  const { data, error } = await supabase.rpc('place_wager', {
    p_team_id: params.teamId,
    p_week: params.week,
    p_slot_id: params.slotId,
    p_game_id: params.gameId,
    p_market_key: params.marketKey,
    p_player_id: params.playerId ?? null,
    p_player_name: params.playerName ?? null,
    p_side: params.side,
    p_point: params.point ?? null,
    p_odds: params.odds,
    p_stake: params.stake,
  });
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not place wager.' };
  return { ok: true, wagerId: data as string };
}

export async function updateWagerStakeRemote(teamId: string, week: WeekId, slotId: string, stake: number): Promise<ServiceResult> {
  const { error } = await supabase.rpc('update_wager_stake', { p_team_id: teamId, p_week: week, p_slot_id: slotId, p_stake: stake });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function clearWagerRemote(teamId: string, week: WeekId, slotId: string): Promise<ServiceResult> {
  const { error } = await supabase.rpc('clear_wager', { p_team_id: teamId, p_week: week, p_slot_id: slotId });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function submitRosterRemote(teamId: string, week: WeekId): Promise<ServiceResult> {
  const { error } = await supabase.rpc('submit_roster', { p_team_id: teamId, p_week: week });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** slotId is always `${position}-${n}` (see engine/rosterSlots.ts), so position is
 * safely derivable rather than needing its own column. */
function positionFromSlotId(slotId: string): SlotPosition {
  return slotId.split('-')[0] as SlotPosition;
}

interface WagerRow {
  id: string;
  slot_id: string;
  game_id: string;
  market_key: string;
  player_id: string | null;
  player_name: string | null;
  side: string;
  point: number | null;
  odds_at_placement: number;
  stake: number;
  placed_at: string;
  status: string;
  settled_profit: number | null;
}
interface RosterRow {
  team_id: string;
  submitted: boolean;
  wagers: WagerRow[];
}

/** Loads every team's roster/wagers for one week of a league — used to populate
 * league.rostersByTeamWeek from the real source of truth (on entering the
 * Lineup/MarketBrowser screens, and after placing a wager). Teams with no wagers
 * yet simply won't appear in the result; the UI already falls back to
 * buildEmptyRoster() for those, so no special-casing needed here. */
export async function fetchLeagueRostersForWeek(leagueId: string, week: WeekId): Promise<ServiceResult<{ rosters: Record<string, WeeklyRoster> }>> {
  const { data, error } = await supabase
    .from('weekly_rosters')
    .select(
      'team_id, submitted, wagers(id, slot_id, game_id, market_key, player_id, player_name, side, point, odds_at_placement, stake, placed_at, status, settled_profit), teams!inner(league_id)',
    )
    .eq('teams.league_id', leagueId)
    .eq('week', week);
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not load rosters.' };

  const rosters: Record<string, WeeklyRoster> = {};
  for (const row of data as unknown as RosterRow[]) {
    const slots: RosterSlotState[] = row.wagers.map((w) => ({
      slotId: w.slot_id,
      position: positionFromSlotId(w.slot_id),
      wager: {
        id: w.id,
        slotId: w.slot_id,
        gameId: w.game_id,
        marketKey: w.market_key as MarketKey,
        playerId: w.player_id ?? undefined,
        playerName: w.player_name ?? undefined,
        side: w.side,
        point: w.point ?? undefined,
        oddsAtPlacement: w.odds_at_placement,
        stake: w.stake,
        placedAt: w.placed_at,
        status: w.status as WagerStatus,
        settledProfit: w.settled_profit,
      },
    }));
    rosters[`${row.team_id}:${week}`] = { week, teamId: row.team_id, slots, submitted: row.submitted };
  }
  return { ok: true, rosters };
}
