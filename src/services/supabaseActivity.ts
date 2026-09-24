import { supabase } from '../lib/supabaseClient';
import type { ActivityItem, MomentCategory, SlotPosition, WeekId } from '../types';

type ServiceResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function postAnnouncementRemote(leagueId: string, message: string): Promise<ServiceResult<{ itemId: string }>> {
  const { data, error } = await supabase.rpc('post_announcement', { p_league_id: leagueId, p_message: message });
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not post announcement.' };
  return { ok: true, itemId: data as string };
}

/** manual v0.3.0 §6: one reaction per person -- react_to_activity (replacing the
 * old uncapped increment_reaction) upserts the caller's own row in
 * activity_reactions, keyed on (item_id, team_id), and keeps activity_items.reactions
 * in sync server-side. Tapping the same emoji you already picked removes it;
 * tapping a different one switches. */
export async function reactToActivityRemote(itemId: string, emoji: string): Promise<ServiceResult> {
  const { error } = await supabase.rpc('react_to_activity', { p_item_id: itemId, p_emoji: emoji });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** manual v0.3.0 §6: "delete the announcements I send" -- the commissioner, or
 * whichever team actually posted it, can remove it. delete_announcement
 * re-validates both the type and the permission server-side; this is not a
 * trust-the-client operation. */
export async function deleteAnnouncementRemote(itemId: string): Promise<ServiceResult> {
  const { error } = await supabase.rpc('delete_announcement', { p_item_id: itemId });
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
  posted_by_team_id: string | null;
}

function parseWeekId(raw: string): WeekId {
  return raw === 'WC' || raw === 'DIV' || raw === 'CONF' ? raw : Number(raw);
}

/** `viewerTeamId` is optional only so this keeps working for a caller that
 * doesn't know it yet -- pass it whenever available (useAppStore always has
 * it) so each item comes back with the viewer's own reaction attached.
 * activity_reactions has no per-item breakdown otherwise: activity_items.reactions
 * is just the aggregate emoji->count map, with no way to tell which of those
 * counts is "me". */
export async function fetchLeagueActivity(leagueId: string, viewerTeamId?: string): Promise<ServiceResult<{ activity: ActivityItem[] }>> {
  const { data, error } = await supabase
    .from('activity_items')
    .select('id, ts, type, message, pinned, reactions, moment_category, moment_display_name, moment_week, moment_team_id, moment_extra, moment_position, posted_by_team_id')
    .eq('league_id', leagueId)
    .order('ts', { ascending: false })
    .limit(40);
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not load activity.' };

  let myReactionByItemId: Record<string, string> = {};
  if (viewerTeamId) {
    const { data: myReactions } = await supabase
      .from('activity_reactions')
      .select('item_id, emoji')
      .eq('league_id', leagueId)
      .eq('team_id', viewerTeamId);
    if (myReactions) {
      myReactionByItemId = Object.fromEntries((myReactions as { item_id: string; emoji: string }[]).map((r) => [r.item_id, r.emoji]));
    }
  }

  const activity: ActivityItem[] = (data as ActivityRow[]).map((row) => ({
    id: row.id,
    ts: row.ts,
    type: row.type as ActivityItem['type'],
    message: row.message,
    pinned: row.pinned || undefined,
    reactions: Object.keys(row.reactions).length > 0 ? row.reactions : undefined,
    myReaction: myReactionByItemId[row.id],
    postedByTeamId: row.posted_by_team_id ?? undefined,
    momentCategory: (row.moment_category as MomentCategory) ?? undefined,
    momentDisplayName: row.moment_display_name ?? undefined,
    momentWeek: row.moment_week != null ? parseWeekId(row.moment_week) : undefined,
    momentTeamId: row.moment_team_id ?? undefined,
    momentExtra: row.moment_extra ?? undefined,
    momentPosition: (row.moment_position as SlotPosition) ?? undefined,
  }));
  return { ok: true, activity };
}
