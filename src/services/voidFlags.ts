// Void requests (void flags): any member can ask for a player who left a game early to be voided
// (a reason and a note are required); the commissioner approves or denies. Approving, or the
// commissioner flagging directly, creates a flag and settle-week voids that player's Over /
// Anytime TD picks that did not hit. See supabase/migrations/0025, 0026 and 0032.
import { supabase } from '../lib/supabaseClient';

export type VoidReason = 'injury' | 'ejection' | 'other';

export const VOID_REASON_LABELS: Record<VoidReason, string> = {
  injury: 'Early exit: injury',
  ejection: 'Early exit: ejection',
  other: 'Other',
};

export function voidReasonLabel(reason: string | null): string {
  return reason && reason in VOID_REASON_LABELS ? VOID_REASON_LABELS[reason as VoidReason] : 'Early exit';
}

export interface VoidCandidateRow {
  player_name: string;
  game_id: string | null;
  flag_id: string | null;
  flag_reason: string | null;
  flag_note: string | null;
  team_id: string;
  team_name: string | null;
  wager_id: string;
  market_key: string;
  side: string;
  point: number | null;
  stake: number;
  status: string;
  /** First part is the pick's NFL team (KC-rashee-rice). Missing until migration 0029 is run. */
  player_id?: string | null;
}

export type VoidResult = { ok: true } | { ok: false; error: string };

export async function fetchVoidCandidates(
  leagueId: string,
  week: string,
): Promise<{ ok: true; rows: VoidCandidateRow[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('league_void_candidates', { p_league_id: leagueId, p_week: week });
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: (data ?? []) as VoidCandidateRow[] };
}

export async function setVoidFlag(
  leagueId: string,
  week: string,
  playerName: string,
  reason: VoidReason,
  note: string,
): Promise<VoidResult> {
  const { error } = await supabase.rpc('set_wager_void_flag', {
    p_league_id: leagueId,
    p_week: week,
    p_player_name: playerName,
    p_reason: reason,
    p_note: note.trim() === '' ? null : note.trim(),
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function clearVoidFlag(flagId: string): Promise<VoidResult> {
  const { error } = await supabase.rpc('clear_wager_void_flag', { p_flag_id: flagId });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export interface VoidPlayerGroup {
  playerName: string;
  flagId: string | null;
  flagReason: string | null;
  flagNote: string | null;
  picks: VoidCandidateRow[];
}

/** One group per player, A to Z. */
export function groupVoidCandidates(rows: VoidCandidateRow[]): VoidPlayerGroup[] {
  const byPlayer = new Map<string, VoidPlayerGroup>();
  for (const row of rows) {
    const g = byPlayer.get(row.player_name) ?? { playerName: row.player_name, flagId: null, flagReason: null, flagNote: null, picks: [] };
    if (row.flag_id) {
      g.flagId = row.flag_id;
      g.flagReason = row.flag_reason;
      g.flagNote = row.flag_note;
    }
    g.picks.push(row);
    byPlayer.set(row.player_name, g);
  }
  return [...byPlayer.values()].sort((a, b) => a.playerName.localeCompare(b.playerName));
}

/** Unflagged players whose name matches the query (case/punctuation-insensitive), best 8. */
export function searchVoidPlayers(groups: VoidPlayerGroup[], query: string): VoidPlayerGroup[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const q = norm(query);
  if (q === '') return [];
  return groups.filter((g) => !g.flagId && norm(g.playerName).includes(q)).slice(0, 8);
}

// ---- Member requests (migration 0032) ----

export type VoidRequestStatus = 'pending' | 'approved' | 'denied';

export interface VoidRequestRow {
  id: string;
  player_name: string;
  player_id: string | null;
  reason: VoidReason;
  note: string;
  status: VoidRequestStatus;
  team_name: string | null;
  mine: boolean;
  created_at: string;
  resolved_at: string | null;
  pick_count: number;
  team_count: number;
}

/** A player a member can ask about this week. Counts only, never whose picks they are. */
export interface VoidSearchRow {
  player_name: string;
  player_id: string | null;
  pick_count: number;
  team_count: number;
  flag_id: string | null;
  pending_request_id: string | null;
  denied: boolean;
}

export async function fetchVoidRequests(
  leagueId: string,
  week: string,
): Promise<{ ok: true; rows: VoidRequestRow[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('league_void_requests', { p_league_id: leagueId, p_week: week });
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: ((data ?? []) as VoidRequestRow[]).map((r) => ({ ...r, pick_count: Number(r.pick_count), team_count: Number(r.team_count) })) };
}

export async function fetchVoidSearch(
  leagueId: string,
  week: string,
): Promise<{ ok: true; rows: VoidSearchRow[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('league_void_search', { p_league_id: leagueId, p_week: week });
  if (error) return { ok: false, error: error.message };
  return { ok: true, rows: ((data ?? []) as VoidSearchRow[]).map((r) => ({ ...r, pick_count: Number(r.pick_count), team_count: Number(r.team_count) })) };
}

/** Best-effort push (commissioner on a new request, requester on an answer). A failure here never
 * blocks the action: the in-app badge and list are the source of truth. */
async function notifyVoidRequest(requestId: string, event: 'new' | 'resolved'): Promise<void> {
  try {
    await supabase.functions.invoke('notify-void-request', { method: 'POST', body: { requestId, event } });
  } catch {
    // push is a courtesy
  }
}

export type RequestVoidResult = { ok: true; status: 'pending' | 'approved' } | { ok: false; error: string };

/** A member's request is queued; the commissioner's goes straight through as a flag. */
export async function requestVoid(
  leagueId: string,
  week: string,
  playerName: string,
  reason: VoidReason,
  note: string,
): Promise<RequestVoidResult> {
  const { data, error } = await supabase.rpc('request_void', {
    p_league_id: leagueId,
    p_week: week,
    p_player_name: playerName,
    p_reason: reason,
    p_note: note.trim(),
  });
  if (error) return { ok: false, error: error.message };
  const res = (data ?? {}) as { status?: 'pending' | 'approved'; request_id?: string | null };
  if (res.status === 'pending' && res.request_id) void notifyVoidRequest(res.request_id, 'new');
  return { ok: true, status: res.status ?? 'pending' };
}

export async function resolveVoidRequest(requestId: string, approve: boolean): Promise<VoidResult> {
  const { error } = await supabase.rpc('resolve_void_request', { p_request_id: requestId, p_approve: approve });
  if (error) return { ok: false, error: error.message };
  void notifyVoidRequest(requestId, 'resolved');
  return { ok: true };
}
