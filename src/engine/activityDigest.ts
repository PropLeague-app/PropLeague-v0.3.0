import type { ActivityItem, ChatMessage } from '../types';

/** What the league has been up to, boiled down to a count and a few lines.
 *
 * The feed itself already knows how to show everything. What was missing was any way to know
 * something had happened without opening it: the only unread signal in the app lived on the Chat
 * pill, inside the feed, at the bottom of League Home, so you had to scroll to the thing it was
 * advertising before the advert was visible (see chat, Oct 2026).
 */

export type HighlightKind = 'announcement' | 'moment' | 'chat';

export interface Highlight {
  id: string;
  kind: HighlightKind;
  ts: string;
  text: string;
  /** The team that posted it, for a chat line or a commissioner's announcement. */
  teamId?: string;
  pinned: boolean;
  unread: boolean;
}

/** Settled-bet alerts and lineup reminders are about you and already arrived as a push, so they are
 *  not league news and never count toward a badge or a highlight. Counting them would mean a badge
 *  that is permanently lit by your own results, which trains people to ignore it. */
const isLeagueNews = (item: ActivityItem) => item.type === 'announcement' || item.type === 'moment';

const ms = (iso: string) => {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
};

/** How many things have happened in this league since the reader last looked.
 *
 * Your own chat messages never count: you know what you said. */
export function unreadActivityCount(
  items: ActivityItem[],
  chat: ChatMessage[],
  userTeamId: string | undefined,
  lastSeenMs: number,
): number {
  const news = items.filter((i) => isLeagueNews(i) && ms(i.ts) > lastSeenMs).length;
  const said = chat.filter((m) => m.teamId !== userTeamId && ms(m.ts) > lastSeenMs).length;
  return news + said;
}

/** The few lines worth showing without opening the feed.
 *
 * Pinned announcements come first because a commissioner pinned them on purpose, which is the only
 * explicit "this matters" signal in the data. After that it is unread before read, then newest.
 *
 * Then one more pass that matters more than the sort: at most one line per kind before any kind
 * repeats. Settle-week writes all of a week's Moments in the same second, so pure recency handed
 * every slot to that one batch and the preview showed three Moments and nothing else, every week,
 * for days (see chat, Oct 2026). Spreading across kinds first is what makes three lines describe
 * three different things. Leftovers fill any slot the spread could not.
 */
export function recentHighlights(
  items: ActivityItem[],
  chat: ChatMessage[],
  userTeamId: string | undefined,
  lastSeenMs: number,
  limit = 3,
): Highlight[] {
  const fromItems: Highlight[] = items.filter(isLeagueNews).map((i) => ({
    id: i.id,
    kind: i.type === 'moment' ? 'moment' : 'announcement',
    ts: i.ts,
    text: i.message,
    teamId: (i.type === 'moment' ? i.momentTeamId : i.postedByTeamId) ?? undefined,
    pinned: !!i.pinned,
    unread: ms(i.ts) > lastSeenMs,
  }));

  const fromChat: Highlight[] = chat.map((m) => ({
    id: m.id,
    kind: 'chat' as const,
    ts: m.ts,
    text: m.message,
    teamId: m.teamId,
    pinned: false,
    unread: m.teamId !== userTeamId && ms(m.ts) > lastSeenMs,
  }));

  const ranked = [...fromItems, ...fromChat].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.unread !== b.unread) return a.unread ? -1 : 1;
    return ms(b.ts) - ms(a.ts);
  });

  const picked: Highlight[] = [];
  const seenKinds = new Set<HighlightKind>();
  for (const h of ranked) {
    if (picked.length >= limit) break;
    if (seenKinds.has(h.kind)) continue;
    seenKinds.add(h.kind);
    picked.push(h);
  }
  for (const h of ranked) {
    if (picked.length >= limit) break;
    if (!picked.includes(h)) picked.push(h);
  }
  return picked;
}
