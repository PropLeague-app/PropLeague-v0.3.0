import { supabase } from '../lib/supabaseClient';
import type { ChatMessage } from '../types';

type ServiceResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Posts a free-text Chat message as the caller's own team in this league.
 * Goes through the post_chat_message RPC rather than a direct table insert --
 * mirroring post_announcement/post_system_activity's pattern (see chat:
 * activity_items only has a SELECT RLS policy, no INSERT policy at all, so
 * every write there goes through a SECURITY DEFINER function that resolves
 * the caller's own team server-side rather than trusting a client-supplied
 * team_id). chat_messages follows the same shape. */
export async function postChatMessageRemote(leagueId: string, message: string): Promise<ServiceResult<{ itemId: string }>> {
  const { data, error } = await supabase.rpc('post_chat_message', { p_league_id: leagueId, p_message: message });
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not send message.' };
  return { ok: true, itemId: data as string };
}

interface ChatRow {
  id: string;
  ts: string;
  team_id: string;
  message: string;
}

/** manual v0.3.0 §6: "a person should be able to delete their own chats too" --
 * delete_chat_message re-validates ownership server-side (caller's own resolved
 * team in this league must match the message's team_id), same trust model as
 * every other write here. */
export async function deleteChatMessageRemote(itemId: string): Promise<ServiceResult> {
  const { error } = await supabase.rpc('delete_chat_message', { p_item_id: itemId });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function fetchLeagueChat(leagueId: string): Promise<ServiceResult<{ chat: ChatMessage[] }>> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, ts, team_id, message')
    .eq('league_id', leagueId)
    .order('ts', { ascending: false })
    .limit(100);
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not load chat.' };

  const chat: ChatMessage[] = (data as ChatRow[]).map((row) => ({
    id: row.id,
    ts: row.ts,
    teamId: row.team_id,
    message: row.message,
  }));
  return { ok: true, chat };
}
