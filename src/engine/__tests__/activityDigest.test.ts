import { describe, it, expect } from 'vitest';
import { recentHighlights, unreadActivityCount } from '../activityDigest';
import type { ActivityItem, ChatMessage } from '../../types';

const t = (minutesAgo: number) => new Date(Date.UTC(2026, 9, 23, 12, 0) - minutesAgo * 60_000).toISOString();
const SEEN = new Date(Date.UTC(2026, 9, 23, 11, 30)).getTime(); // 30 minutes ago

const item = (o: Partial<ActivityItem> & { id: string; ts: string; type: ActivityItem['type'] }): ActivityItem => ({
  message: `msg ${o.id}`,
  ...o,
});
const msg = (id: string, teamId: string, ts: string): ChatMessage => ({ id, teamId, ts, message: `chat ${id}` });

describe('unreadActivityCount', () => {
  it('counts announcements and moments newer than the last look', () => {
    const items = [
      item({ id: 'a', ts: t(10), type: 'announcement' }),
      item({ id: 'b', ts: t(5), type: 'moment' }),
      item({ id: 'c', ts: t(120), type: 'announcement' }),
    ];
    expect(unreadActivityCount(items, [], 'me', SEEN)).toBe(2);
  });

  // These arrive as a push about your own picks. Counting them would keep the badge permanently
  // lit by your own results, which is how people learn to ignore a badge.
  it('ignores settled alerts and lineup reminders entirely', () => {
    const items = [
      item({ id: 'a', ts: t(1), type: 'settled' }),
      item({ id: 'b', ts: t(1), type: 'reminder' }),
    ];
    expect(unreadActivityCount(items, [], 'me', SEEN)).toBe(0);
  });

  it('counts other people talking but never your own messages', () => {
    const chat = [msg('1', 'them', t(10)), msg('2', 'me', t(9)), msg('3', 'them', t(8))];
    expect(unreadActivityCount([], chat, 'me', SEEN)).toBe(2);
  });

  it('is zero when everything predates the last look', () => {
    const items = [item({ id: 'a', ts: t(600), type: 'announcement' })];
    expect(unreadActivityCount(items, [msg('1', 'them', t(600))], 'me', SEEN)).toBe(0);
  });
});

describe('recentHighlights', () => {
  it('puts a pinned announcement first even when it is old and read', () => {
    const items = [
      item({ id: 'pin', ts: t(900), type: 'announcement', pinned: true }),
      item({ id: 'new', ts: t(2), type: 'moment' }),
    ];
    expect(recentHighlights(items, [], 'me', SEEN).map((h) => h.id)).toEqual(['pin', 'new']);
  });

  it('puts unread before read, and newest first inside each', () => {
    const items = [
      item({ id: 'old1', ts: t(400), type: 'announcement' }),
      item({ id: 'new1', ts: t(20), type: 'announcement' }),
      item({ id: 'old2', ts: t(300), type: 'moment' }),
      item({ id: 'new2', ts: t(5), type: 'moment' }),
    ];
    expect(recentHighlights(items, [], 'me', SEEN, 4).map((h) => h.id)).toEqual(['new2', 'new1', 'old2', 'old1']);
  });

  it('mixes chat in with league news on the same timeline', () => {
    const items = [item({ id: 'ann', ts: t(10), type: 'announcement' })];
    const chat = [msg('c1', 'them', t(3))];
    expect(recentHighlights(items, chat, 'me', SEEN).map((h) => h.id)).toEqual(['c1', 'ann']);
  });

  it('leaves settled alerts out of the highlights too', () => {
    const items = [
      item({ id: 'settled', ts: t(1), type: 'settled' }),
      item({ id: 'ann', ts: t(50), type: 'announcement' }),
    ];
    expect(recentHighlights(items, [], 'me', SEEN).map((h) => h.id)).toEqual(['ann']);
  });

  it('honours the limit', () => {
    const items = Array.from({ length: 10 }, (_, i) => item({ id: `i${i}`, ts: t(i), type: 'announcement' }));
    expect(recentHighlights(items, [], 'me', SEEN)).toHaveLength(3);
    expect(recentHighlights(items, [], 'me', SEEN, 5)).toHaveLength(5);
  });

  // Your own message is still shown, it just does not count as something you have not seen.
  it('shows your own chat but never marks it unread', () => {
    const mine = recentHighlights([], [msg('c1', 'me', t(1))], 'me', SEEN);
    expect(mine).toHaveLength(1);
    expect(mine[0].unread).toBe(false);
  });

  it('is empty when there is nothing to show', () => {
    expect(recentHighlights([], [], 'me', SEEN)).toEqual([]);
  });
});

describe('recentHighlights spreads across kinds', () => {
  // settle-week writes a whole week of Moments in the same second. On pure recency they took every
  // slot and the preview said the same three things for days.
  it('does not let one batch of Moments take every slot', () => {
    const items = [
      item({ id: 'm1', ts: t(1), type: 'moment' }),
      item({ id: 'm2', ts: t(1), type: 'moment' }),
      item({ id: 'm3', ts: t(1), type: 'moment' }),
      item({ id: 'ann', ts: t(200), type: 'announcement' }),
    ];
    const chat = [msg('c1', 'them', t(300))];
    const kinds = recentHighlights(items, chat, 'me', SEEN).map((h) => h.kind);
    expect(new Set(kinds).size).toBe(3);
    expect(kinds[0]).toBe('moment'); // still the newest first within the spread
  });

  it('falls back to repeating a kind when that is all there is', () => {
    const items = [
      item({ id: 'm1', ts: t(1), type: 'moment' }),
      item({ id: 'm2', ts: t(2), type: 'moment' }),
      item({ id: 'm3', ts: t(3), type: 'moment' }),
    ];
    expect(recentHighlights(items, [], 'me', SEEN).map((h) => h.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('keeps a pinned announcement first even while spreading', () => {
    const items = [
      item({ id: 'pin', ts: t(900), type: 'announcement', pinned: true }),
      item({ id: 'm1', ts: t(1), type: 'moment' }),
      item({ id: 'm2', ts: t(2), type: 'moment' }),
    ];
    const chat = [msg('c1', 'them', t(5))];
    expect(recentHighlights(items, chat, 'me', SEEN).map((h) => h.id)).toEqual(['pin', 'm1', 'c1']);
  });
});
