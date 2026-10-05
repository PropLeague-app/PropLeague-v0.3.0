// Game exits (void flags): the commissioner searches for a player who left a game early
// (no snaps in the 2nd half), picks a reason, and settle-week voids that player's Over /
// Anytime TD picks that did not hit. See supabase/migrations/0025 and 0026 for the rules
// and the RPCs.
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
