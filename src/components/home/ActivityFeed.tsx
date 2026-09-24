import { useEffect, useState, type ReactNode } from 'react';
import { Megaphone, Bell, DollarSign, Sparkles, Inbox, MessageCircle, Send, ChevronDown } from 'lucide-react';
import type { ActivityItem, ChatMessage, League } from '../../types';
import { MOMENT_CATEGORY_LABELS, weekLabel, weekOrder } from '../../types';
import { Card } from '../common/Card';
import { EmptyState } from '../common/EmptyState';
import { TeamLogo } from '../common/TeamLogo';
import { LeagueLogo } from '../common/LeagueLogo';
import { PositionBadge } from '../common/PositionBadge';
import { OddsDisplay } from '../common/OddsDisplay';

const ICONS: Record<ActivityItem['type'], ReactNode> = {
  announcement: <Megaphone size={16} />,
  reminder: <Bell size={16} />,
  settled: <DollarSign size={16} />,
  moment: <Sparkles size={16} />,
};

const QUICK_REACTIONS = ['🔥', '😂', '💀', '👏'];

function Reactions({ item, onReact }: { item: ActivityItem; onReact?: (itemId: string, emoji: string) => void }) {
  if (!onReact) return null;
  return (
    <div className="flex items-center gap-1">
      {item.reactions &&
        Object.entries(item.reactions)
          .filter(([, count]) => count > 0)
          .map(([emoji, count]) => (
            <span key={emoji} className="text-[11px] bg-bg-raised rounded-full px-1.5 py-0.5">
              {emoji} {count}
            </span>
          ))}
      {QUICK_REACTIONS.map((emoji) => (
        <button key={emoji} onClick={() => onReact(item.id, emoji)} className="text-xs opacity-50 hover:opacity-100">
          {emoji}
        </button>
      ))}
    </div>
  );
}

function NewsCard({ league, item, onReact }: { league: League; item: ActivityItem; onReact?: (itemId: string, emoji: string) => void }) {
  return (
    <Card className="flex items-start gap-2.5">
      {item.type === 'announcement' ? <LeagueLogo league={league} size="sm" /> : <span>{ICONS[item.type]}</span>}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {item.pinned && <span className="text-[10px] text-accent font-semibold">PINNED</span>}
        </div>
        <p className="text-sm">{item.message}</p>
        <div className="flex items-center justify-between mt-0.5">
          <p className="text-[11px] text-text-muted">
            {new Date(item.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </p>
          <Reactions item={item} onReact={onReact} />
        </div>
      </div>
    </Card>
  );
}

/** Splits a moment's extra text on embedded signed dollar amounts ("+$45.00",
 * "-$12.50" — exactly what engine/moments.ts's formatSigned produces) and colors each
 * one profit-green or loss-red, so a card reading "... missed by 1.5" next to
 * "+$23.00" doesn't bury the number that actually matters (manual v0.1.1 §4 #8). */
function HighlightedExtra({ text }: { text: string }) {
  const parts = text.split(/([+-]\$[\d,]+\.\d{2})/g);
  return (
    <>
      {parts.map((part, i) =>
        /^[+-]\$[\d,]+\.\d{2}$/.test(part) ? (
          <span key={i} className={`font-bold ${part.startsWith('-') ? 'text-loss' : 'text-profit'}`}>
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/** Small colored capsule for any already-signed dollar string ("+$27.00",
 * "-$13.00") -- the same rounded-pill visual language as the Matchup screen's
 * WagerProfitPill (see chat, Sept 2026 matchup-screen cleanup), reused here so a
 * moment's win/loss number is never just plain colored text sitting inline in a
 * sentence. Takes the already-formatted text rather than a raw number since most
 * callers already have a formatSigned()'d string straight from momentExtra --
 * color is inferred from its leading sign. */
function AmountPill({ text, negative, size = 'md' }: { text: string; negative?: boolean; size?: 'sm' | 'md' }) {
  // Defaults to sniffing a leading +/- sign, which works for every dollar-amount
  // caller (formatSigned always produces one) -- callers with no sign of their own
  // to sniff (the W/L streak pill) pass `negative` explicitly instead.
  const isNegative = negative ?? text.trim().startsWith('-');
  const sizeClass = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5';
  return (
    <span className={`inline-flex items-center font-bold rounded-full whitespace-nowrap ${isNegative ? 'bg-loss/20 text-loss' : 'bg-profit/20 text-profit'} ${sizeClass}`}>
      {text}
    </span>
  );
}

/** Splits settle-week's ticket-style moment extra -- "<bet> @ <odds>, $<stake>
 * stake, <signedProfit>[ — missed by <margin>]", exactly what ticketLabelReal
 * produces in supabase/functions/_shared/momentsReal.ts (and its identical
 * local-sim twin, engine/moments.ts's ticketLabel) -- into the pieces worstBeat/
 * boldestBet/bestBet need for a proper bet-description-line + stake/profit-row
 * layout, instead of one long wrapped sentence with the number buried mid-string
 * (see chat, Sept 2026: Heartbreaker/Cash Cow/Against All Odds "have poor visual
 * display as to the win/loss"). Returns null on anything that doesn't match --
 * defensive only, since every extra reaching this parser was built by one of
 * those two always-this-shape functions for an already-graded wager. */
function parseTicketExtra(extra: string): { description: string; oddsText: string; stakeText: string; profitText: string; note: string | null } | null {
  let rest = extra;
  let note: string | null = null;
  const missedMarker = ' — missed by ';
  const missedIdx = rest.indexOf(missedMarker);
  if (missedIdx !== -1) {
    note = rest.slice(missedIdx + missedMarker.length);
    rest = rest.slice(0, missedIdx);
  }
  const atIdx = rest.indexOf(' @ ');
  if (atIdx === -1) return null;
  const description = rest.slice(0, atIdx);
  const [oddsText, stakePart, profitText] = rest.slice(atIdx + 3).split(', ');
  const stakeMatch = stakePart?.match(/^\$([\d,.]+) stake$/);
  if (!oddsText || !stakeMatch || !profitText) return null;
  return { description, oddsText, stakeText: `$${stakeMatch[1]}`, profitText, note };
}

/** Award-style card for a single weekly moment (manual v0.03 §4.4), rebuilt compact
 * (see chat, Sept 2026: "these cells are huge... decrease the size... while keeping
 * visual clarity as to what the category is, the team winner, the stake, win/loss
 * margin and the bet"). Hierarchy is still explicit top-to-bottom, just tighter and
 * smaller throughout -- the category label now sits right under the award name
 * (both are header context) instead of its own row at the bottom, the team row
 * gets a smaller logo, and the result itself is always a colored AmountPill/streak
 * pill rather than plain text. The three single-wager categories (worstBeat/
 * boldestBet/bestBet) get their own bet-description line plus a stake/profit
 * result row (parseTicketExtra) mirroring the Matchup screen's own settled-pick
 * layout -- stake on the outer side, odds folded in with it, profit pill (plus
 * worstBeat's "missed by" note) grouped on the inner side -- instead of the one
 * run-on sentence that made those three specifically hard to read at a glance.
 * Falls back to the old highlighted-prose rendering for anything that doesn't
 * match one of the known shapes, so no moment ever renders as literally nothing. */
function MomentCard({ league, item, onReact }: { league: League; item: ActivityItem; onReact?: (itemId: string, emoji: string) => void }) {
  const team = item.momentTeamId ? league.teams.find((t) => t.id === item.momentTeamId) : undefined;
  const category = item.momentCategory;
  const extra = item.momentExtra;
  const ticket = extra && (category === 'worstBeat' || category === 'boldestBet' || category === 'bestBet') ? parseTicketExtra(extra) : null;
  const isStreak = !!extra && (category === 'hottestBettor' || category === 'coldestBettor') && /^[WL]\d+$/.test(extra);
  const swingParts = category === 'biggestSwing' && extra?.includes(' → ') ? extra.split(' → ') : null;
  const isPlainAmount = !!extra && /^[+-]\$[\d,]+\.\d{2}$/.test(extra);

  return (
    <div className="bg-bg-card border border-border rounded-xl p-2 space-y-1">
      <div>
        <p className="text-xs font-bold truncate">{item.momentDisplayName ?? item.message}</p>
        {category && <p className="text-[9px] text-text-muted truncate">{MOMENT_CATEGORY_LABELS[category]}</p>}
      </div>

      <div className="flex items-center gap-1.5">
        {team ? <TeamLogo team={team} size="sm" /> : <Sparkles size={16} />}
        {team && <p className="text-xs font-semibold truncate flex-1 min-w-0">{team.teamName}</p>}
        {item.momentPosition && <PositionBadge position={item.momentPosition} />}
      </div>

      {ticket ? (
        <div>
          <p className="text-[10px] truncate">
            <span className="text-text font-medium">{ticket.description}</span>
            <span className="text-text-muted">
              : {ticket.stakeText} @ <OddsDisplay odds={Number(ticket.oddsText)} />
            </span>
          </p>
          {/* Always flush right, note included -- previously this used justify-between
              whenever a note existed, which threw the note all the way to the row's far
              left edge, away from the pill it was actually describing, and (per Hunter,
              Sept 2026) made the two categories with no note at all look like they were
              reserving dead space for one that would never show up. Clustering note+pill
              together removes that reserved-looking gap entirely, in both cases. */}
          <div className="flex items-center justify-end gap-1.5 mt-0.5">
            {ticket.note && <span className="text-[10px] text-text-muted font-medium whitespace-nowrap">missed by {ticket.note}</span>}
            <AmountPill text={ticket.profitText} size="sm" />
          </div>
        </div>
      ) : isStreak ? (
        <AmountPill text={extra!} negative={extra!.startsWith('L')} size="sm" />
      ) : swingParts ? (
        <div className="flex items-center gap-1.5">
          <AmountPill text={swingParts[0]} size="sm" />
          <span className="text-[10px] text-text-muted">→</span>
          <AmountPill text={swingParts[1]} size="sm" />
        </div>
      ) : isPlainAmount ? (
        <AmountPill text={extra!} />
      ) : (
        extra && (
          <p className="text-xs font-medium">
            <HighlightedExtra text={extra} />
          </p>
        )
      )}

      <div className="flex items-center justify-between pt-0.5">
        <p className="text-[9px] text-text-muted">
          {new Date(item.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </p>
        <Reactions item={item} onReact={onReact} />
      </div>
    </div>
  );
}

type FeedTab = 'all' | 'moments' | 'news' | 'chat';

const FEED_TAB_LABELS: Record<FeedTab, string> = { all: 'All', moments: 'Moments', news: 'League News', chat: 'Chat' };

/** One message row in the Chat tab (see chat: deliberately separate from the
 * News/Moments cards above -- no Card wrapper, no reactions, just sender + text,
 * since this is meant to read like a normal group chat, not another award/news
 * card style). */
function ChatBubble({ league, item }: { league: League; item: ChatMessage }) {
  const team = league.teams.find((t) => t.id === item.teamId);
  return (
    <div className="flex items-start gap-2">
      {team ? <TeamLogo team={team} size="sm" /> : <span className="w-6 h-6 shrink-0" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <p className="text-xs font-semibold truncate">{team?.teamName ?? 'Former member'}</p>
          <p className="text-[10px] text-text-muted shrink-0">
            {new Date(item.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </p>
        </div>
        <p className="text-sm break-words">{item.message}</p>
      </div>
    </div>
  );
}

function groupMomentsByWeek(items: ActivityItem[]): { key: string; label: string; order: number; items: ActivityItem[] }[] {
  const groups = new Map<string, ActivityItem[]>();
  for (const item of items) {
    const key = item.momentWeek != null ? String(item.momentWeek) : 'earlier';
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .map(([key, groupItems]) => {
      const week = groupItems[0].momentWeek;
      return {
        key,
        label: week != null ? `${weekLabel(week)} Moments` : 'Earlier',
        order: week != null ? weekOrder(week) : -1,
        items: groupItems,
      };
    })
    .sort((a, b) => b.order - a.order); // most recent week first
}

export function ActivityFeed({
  league,
  items,
  chat,
  chatUnreadCount = 0,
  onReact,
  onSendChat,
  onSeenChat,
}: {
  league: League;
  items: ActivityItem[];
  chat?: ChatMessage[];
  /** Count of chat messages the user hasn't seen yet (computed by the caller,
      which is the one that knows the user's own team id and the per-league
      "last seen" cursor -- see useAppStore's lastSeenChatByLeague). Shown as a
      small badge on the Chat tab pill itself. */
  chatUnreadCount?: number;
  onReact?: (itemId: string, emoji: string) => void;
  onSendChat?: (message: string) => void;
  /** Called whenever the Chat tab is the active tab and there are messages to
      have seen -- both right when the user switches to it, and again if a new
      message arrives while they're still looking at it. */
  onSeenChat?: () => void;
}) {
  const [tab, setTab] = useState<FeedTab>('all');
  const [chatText, setChatText] = useState('');
  // Which week groups are collapsed on the Moments tab (see chat, Sept 2026: "the
  // weeks should be collapsible"). Keyed by groupMomentsByWeek's own group.key, not
  // week number, so the synthetic "earlier" bucket collapses independently too.
  // Nothing starts collapsed -- this only ever hides a week once the person actually
  // taps it shut, so a league with just one or two weeks of history looks exactly
  // like it did before this existed.
  const [collapsedMomentWeeks, setCollapsedMomentWeeks] = useState<Set<string>>(new Set());
  const chatItems = chat ?? [];

  useEffect(() => {
    if (tab === 'chat' && chatItems.length > 0) onSeenChat?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, chatItems.length]);

  if (items.length === 0 && chatItems.length === 0) {
    return <EmptyState icon={<Inbox size={36} strokeWidth={1.5} />} title="No activity yet" subtitle="League announcements and bet alerts will show up here." />;
  }

  const sorted = [...items].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  const moments = sorted.filter((i) => i.type === 'moment');
  const news = sorted.filter((i) => i.type !== 'moment');

  return (
    <div className="space-y-3">
      {/* No overflow-hidden on the wrapper: the unread badge sits on the chat
          pill's top-right corner and would be clipped by it, so the first and
          last pills round their own outer corners instead. */}
      <div className="flex bg-bg-card rounded-lg w-fit">
        {(['all', 'moments', 'news', 'chat'] as FeedTab[]).map((t, i, all) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative px-3 py-1.5 text-xs font-semibold flex items-center gap-1 ${i === 0 ? 'rounded-l-lg' : ''} ${i === all.length - 1 ? 'rounded-r-lg' : ''} ${tab === t ? 'bg-primary text-white' : 'text-text-muted'}`}
          >
            {FEED_TAB_LABELS[t]}
            {/* Top-right corner of the pill, same red (bg-loss) and placement as the
                lineup-needed "!" on the footer tabs, to keep the app's notification
                colors to one scheme (see chat, Sept 2026; supersedes the earlier
                inline orange/purple badge). */}
            {t === 'chat' && chatUnreadCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 inline-flex items-center justify-center min-w-[15px] h-[15px] px-1 rounded-full bg-loss text-white text-[9px] font-bold leading-none">
                {chatUnreadCount > 9 ? '9+' : chatUnreadCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'all' && (
        <div className="space-y-2">
          {sorted.slice(0, 8).map((item) =>
            item.type === 'moment' ? (
              <MomentCard key={item.id} league={league} item={item} onReact={onReact} />
            ) : (
              <NewsCard key={item.id} league={league} item={item} onReact={onReact} />
            ),
          )}
        </div>
      )}

      {tab === 'moments' &&
        (moments.length === 0 ? (
          <EmptyState icon={<Sparkles size={36} strokeWidth={1.5} />} title="No moments yet" subtitle="Weekly awards show up here once a week fully settles." />
        ) : (
          <div className="space-y-3">
            {groupMomentsByWeek(moments).map((group) => {
              const collapsed = collapsedMomentWeeks.has(group.key);
              return (
                <div key={group.key}>
                  <button
                    onClick={() =>
                      setCollapsedMomentWeeks((prev) => {
                        const next = new Set(prev);
                        if (next.has(group.key)) next.delete(group.key);
                        else next.add(group.key);
                        return next;
                      })
                    }
                    className="flex items-center gap-1 w-full text-left mb-1.5"
                  >
                    <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">{group.label}</p>
                    <ChevronDown size={14} className={`text-text-muted transition-transform ${collapsed ? '-rotate-90' : ''}`} />
                  </button>
                  {!collapsed && (
                    <div className="space-y-1.5">
                      {group.items.map((item) => (
                        <MomentCard key={item.id} league={league} item={item} onReact={onReact} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}

      {tab === 'news' && (
        <div className="space-y-2">
          {news.length === 0 ? (
            <EmptyState icon={<Inbox size={36} strokeWidth={1.5} />} title="No news yet" subtitle="Commissioner announcements and system updates show up here." />
          ) : (
            news.slice(0, 8).map((item) => <NewsCard key={item.id} league={league} item={item} onReact={onReact} />)
          )}
        </div>
      )}

      {tab === 'chat' && (
        <div className="space-y-3">
          {onSendChat && (
            <div className="flex gap-2">
              <input
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' || !chatText.trim()) return;
                  onSendChat(chatText.trim());
                  setChatText('');
                }}
                placeholder="Message the league…"
                maxLength={500}
                className="flex-1 bg-bg-card border border-border rounded-lg px-3 py-2 text-sm"
              />
              <button
                disabled={!chatText.trim()}
                onClick={() => {
                  onSendChat(chatText.trim());
                  setChatText('');
                }}
                className="bg-primary text-white text-sm font-semibold px-3 rounded-lg disabled:opacity-40"
              >
                <Send size={16} />
              </button>
            </div>
          )}
          {chatItems.length === 0 ? (
            <EmptyState icon={<MessageCircle size={36} strokeWidth={1.5} />} title="No messages yet" subtitle="Say something to the rest of the league." />
          ) : (
            <div className="space-y-3">
              {[...chatItems].reverse().map((item) => (
                <ChatBubble key={item.id} league={league} item={item} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}