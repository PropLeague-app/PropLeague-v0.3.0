import { useState, type ReactNode } from 'react';
import { Megaphone, Bell, DollarSign, Sparkles, Inbox } from 'lucide-react';
import type { ActivityItem, League } from '../../types';
import { MOMENT_CATEGORY_LABELS, weekLabel, weekOrder } from '../../types';
import { Card } from '../common/Card';
import { EmptyState } from '../common/EmptyState';
import { TeamLogo } from '../common/TeamLogo';
import { LeagueLogo } from '../common/LeagueLogo';
import { PositionBadge } from '../common/PositionBadge';

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

/** Award-style card for a single weekly moment (manual v0.03 §4.4). Hierarchy is
 * explicit top-to-bottom (manual v0.2.0 §5 #11): the display name (the award itself)
 * on its own line, then a team header row — logo + bold, larger team name,
 * structurally separated so it's never confused with the bet description that
 * follows — then the bet/$ details (semantic coloring from v0.1.1 §4 #8), then the
 * plain category label last, muted. */
function MomentCard({ league, item, onReact }: { league: League; item: ActivityItem; onReact?: (itemId: string, emoji: string) => void }) {
  const team = item.momentTeamId ? league.teams.find((t) => t.id === item.momentTeamId) : undefined;
  return (
    <Card className="space-y-1.5">
      <p className="text-sm font-bold truncate">{item.momentDisplayName ?? item.message}</p>

      <div className="flex items-center gap-2">
        {team ? <TeamLogo team={team} size="md" /> : <Sparkles size={20} />}
        {team && <p className="text-base font-bold truncate">{team.teamName}</p>}
        {item.momentPosition && <PositionBadge position={item.momentPosition} />}
      </div>

      {item.momentExtra && (
        <p className="text-sm font-medium">
          <HighlightedExtra text={item.momentExtra} />
        </p>
      )}

      {item.momentCategory && <p className="text-[10px] text-text-muted">{MOMENT_CATEGORY_LABELS[item.momentCategory]}</p>}

      <div className="flex items-center justify-between pt-0.5">
        <p className="text-[11px] text-text-muted">
          {new Date(item.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </p>
        <Reactions item={item} onReact={onReact} />
      </div>
    </Card>
  );
}

type FeedTab = 'all' | 'moments' | 'news';

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

export function ActivityFeed({ league, items, onReact }: { league: League; items: ActivityItem[]; onReact?: (itemId: string, emoji: string) => void }) {
  const [tab, setTab] = useState<FeedTab>('all');

  if (items.length === 0) {
    return <EmptyState icon={<Inbox size={36} strokeWidth={1.5} />} title="No activity yet" subtitle="League announcements and bet alerts will show up here." />;
  }

  const sorted = [...items].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  const moments = sorted.filter((i) => i.type === 'moment');
  const news = sorted.filter((i) => i.type !== 'moment');

  return (
    <div className="space-y-3">
      <div className="flex bg-bg-card rounded-lg overflow-hidden w-fit">
        {(['all', 'moments', 'news'] as FeedTab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 text-xs font-semibold ${tab === t ? 'bg-primary text-white' : 'text-text-muted'}`}
          >
            {t === 'all' ? 'All' : t === 'moments' ? 'Moments' : 'League News'}
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
          <div className="space-y-4">
            {groupMomentsByWeek(moments).map((group) => (
              <div key={group.key}>
                <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">{group.label}</p>
                <div className="space-y-2">
                  {group.items.map((item) => (
                    <MomentCard key={item.id} league={league} item={item} onReact={onReact} />
                  ))}
                </div>
              </div>
            ))}
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
    </div>
  );
}