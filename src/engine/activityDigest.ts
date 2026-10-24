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
  /** A Moment's award name, so its line can lead with that instead of the server's full sentence. */
  title?: string;
  /** A Moment's one number worth showing on a single line ("+$20.00", "W5"). */
  value?: string;
}

const SIGNED_AMOUNT = /[+-]\$[\d,]+\.\d{2}/;

function parseSigned(text: string): number {
  const m = text.trim().match(/^([+-])\$([\d,]+(?:\.\d+)?)$/);
  if (!m) return Number.NaN;
  const n = Number(m[2].replace(/,/g, ''));
  return m[1] === '-' ? -n : n;
}

function formatSigned(n: number): string {
  return `${n < 0 ? '-' : '+'}$${Math.abs(n).toFixed(2)}`;
}

/** The single figure that sums up a Moment, from its extra text: a streak as is, a week-over-week swing
 * as its size, otherwise the first signed dollar amount (a ticket's profit, a week's score). */
export function momentPreviewValue(extra: string | undefined): string | undefined {
  if (!extra) return undefined;
  const text = extra.trim();
  if (/^[WL]\d+$/.test(text)) return text;
  if (text.includes(' → ')) {
    const [from, to] = text.split(' → ').map(parseSigned);
    if (!Number.isNaN(from) && !Number.isNaN(to)) return formatSigned(to - from);
  }
  return text.match(SIGNED_AMOUNT)?.[0];
}

/** A Moment's award name. Older rows only carry the full sentence ("🎢 The Roller Coaster: ..."), so
 * the name is whatever comes before the colon, minus any leading symbol. */
export function momentPreviewTitle(displayName: string | undefined, message: string): string {
  if (displayName?.trim()) return displayName.trim();
  const head = message.split(':')[0];
  return head.replace(/^[^\p{L}\p{N}]+/u, '').trim() || message;
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
 * Chat has its own screen and its own cursor (backlog C6): opening the feed clears the news, opening
 * the chat clears the messages. `lastSeenChatMs` is that second cursor; left out, both use one.
 * Your own chat messages never count: you know what you said. */
export function unreadActivityCount(
  items: ActivityItem[],
  chat: ChatMessage[],
  userTeamId: string | undefined,
  lastSeenMs: number,
  lastSeenChatMs: number = lastSeenMs,
): number {
  const news = items.filter((i) => isLeagueNews(i) && ms(i.ts) > lastSeenMs).length;
  const said = chat.filter((m) => m.teamId !== userTeamId && ms(m.ts) > lastSeenChatMs).length;
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
    ...(i.type === 'moment' ? { title: momentPreviewTitle(i.momentDisplayName, i.message), value: momentPreviewValue(i.momentExtra) } : {}),
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
