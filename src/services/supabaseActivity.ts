import { supabase } from '../lib/supabaseClient';
import type { ActivityItem, MomentCategory, SlotPosition, WeekId } from '../types';

type ServiceResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function postAnnouncementRemote(leagueId: string, message: string): Promise<ServiceResult<{ itemId: string }>> {
  const { data, error } = await supabase.rpc('post_announcement', { p_league_id: leagueId, p_message: message });
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not post announcement.' };
  return { ok: true, itemId: data as string };
}

export async function reactToActivityRemote(itemId: string, emoji: string): Promise<ServiceResult> {
  const { error } = await supabase.rpc('increment_reaction', { p_item_id: itemId, p_emoji: emoji });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** For system-generated items (settlement results, weekly moments/awards, welcome
 * messages) — commissioner-only, mirroring the trust model already established for
 * matchups/standings/bracket. `item.id` is ignored; Supabase assigns the real id. */
export async function postSystemActivityRemote(leagueId: string, item: ActivityItem): Promise<ServiceResult<{ itemId: string }>> {
  const { data, error } = await supabase.rpc('post_system_activity', {
    p_league_id: leagueId,
    p_type: item.type,
    p_message: item.message,
    p_pinned: item.pinned ?? false,
    p_moment_category: item.momentCategory ?? null,
    p_moment_display_name: item.momentDisplayName ?? null,
    p_moment_week: item.momentWeek != null ? String(item.momentWeek) : null,
    p_moment_team_id: item.momentTeamId ?? null,
    p_moment_extra: item.momentExtra ?? null,
    p_moment_position: item.momentPosition ?? null,
  });
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not post activity.' };
  return { ok: true, itemId: data as string };
}

interface ActivityRow {
  id: string;
  ts: string;
  type: string;
  message: string;
  pinned: boolean;
  reactions: Record<string, number>;
  moment_category: string | null;
  moment_display_name: string | null;
  moment_week: string | null;
  moment_team_id: string | null;
  moment_extra: string | null;
  moment_position: string | null;
}

function parseWeekId(raw: string): WeekId {
  return raw === 'WC' || raw === 'DIV' || raw === 'CONF' ? raw : Number(raw);
}

export async function fetchLeagueActivity(leagueId: string): Promise<ServiceResult<{ activity: ActivityItem[] }>> {
  const { data, error } = await supabase
    .from('activity_items')
    .select('id, ts, type, message, pinned, reactions, moment_category, moment_display_name, moment_week, moment_team_id, moment_extra, moment_position')
    .eq('league_id', leagueId)
    .order('ts', { ascending: false })
    .limit(40);
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not load activity.' };

  const activity: ActivityItem[] = (data as ActivityRow[]).map((row) => ({
    id: row.id,
    ts: row.ts,
    type: row.type as ActivityItem['type'],
    message: row.message,
    pinned: row.pinned || undefined,
    reactions: Object.keys(row.reactions).length > 0 ? row.reactions : undefined,
    momentCategory: (row.moment_category as MomentCategory) ?? undefined,
    momentDisplayName: row.moment_display_name ?? undefined,
    momentWeek: row.moment_week != null ? parseWeekId(row.moment_week) : undefined,
    momentTeamId: row.moment_team_id ?? undefined,
    momentExtra: row.moment_extra ?? undefined,
    momentPosition: (row.moment_position as SlotPosition) ?? undefined,
  }));
  return { ok: true, activity };
}
