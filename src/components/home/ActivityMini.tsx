import { ChevronDown, Megaphone, MessageSquare, Sparkles } from 'lucide-react';
import type { League } from '../../types';
import { Card } from '../common/Card';
import { TeamLogo } from '../common/TeamLogo';
import { recentHighlights, type Highlight } from '../../engine/activityDigest';
import { parseRichText } from '../../engine/richText';

/** The league's last few lines, with the whole feed one tap below.
 *
 * The feed is the only thing on League Home that is genuinely different since the last visit, and
 * it was the last thing on the page. This is the part worth seeing without scrolling: pinned
 * announcements, then whatever is unread, then whatever is newest. Everything else, every tab and
 * every reaction, is still in the feed underneath when it is open (see chat, Oct 2026).
 */
export function ActivityMini({
  anchorRef,
  league,
  unread,
  lastSeenMs,
  open,
  onToggle,
  children,
}: {
  /** So a caller can scroll the card into view after opening it from elsewhere on the page. */
  anchorRef?: React.Ref<HTMLDivElement>;
  league: League;
  unread: number;
  /** When this device last opened the feed, so a line can be shown as unread. */
  lastSeenMs: number;
  open: boolean;
  onToggle: () => void;
  /** The full ActivityFeed, rendered only while open. */
  children: React.ReactNode;
}) {
  const userTeamId = league.teams.find((t) => t.isUser)?.id;
  const highlights = recentHighlights(league.activity, league.chat, userTeamId, lastSeenMs, 3);

  return (
    <div ref={anchorRef}>
    <Card className="p-0 overflow-hidden">
      <button onClick={onToggle} aria-expanded={open} className="w-full flex items-center gap-1.5 px-3 py-2 text-left active:bg-bg-raised">
        <span className="text-text-muted shrink-0 flex items-center">
          <Megaphone size={13} />
        </span>
        <p className="font-semibold text-xs flex-1 min-w-0">Activity</p>
        {unread > 0 && (
          <span className="shrink-0 min-w-4 h-4 px-1 rounded-full bg-loss text-white text-[9px] leading-4 font-bold text-center">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
        <ChevronDown size={14} className={`text-text-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {!open && highlights.length > 0 && (
        <div className="px-3 pb-2 space-y-1">
          {highlights.map((h) => (
            <HighlightLine key={h.id} highlight={h} league={league} />
          ))}
        </div>
      )}

      {open && <div className="px-1.5 pb-1.5 pt-2 border-t border-border">{children}</div>}
    </Card>
    </div>
  );
}

const KIND_ICON = {
  announcement: Megaphone,
  moment: Sparkles,
  chat: MessageSquare,
} as const;

/** One line. A logo when a team is behind it, the category's icon when the league itself is. */
function HighlightLine({ highlight, league }: { highlight: Highlight; league: League }) {
  const team = highlight.teamId ? league.teams.find((t) => t.id === highlight.teamId) : undefined;
  const Icon = KIND_ICON[highlight.kind];
  // Announcements are rich text; the feed renders them properly, but a one-line preview wants the
  // words without the markup.
  const text =
    highlight.kind === 'announcement'
      ? parseRichText(highlight.text)
          .map((seg) => seg.text)
          .join('')
      : highlight.text;
  return (
    <div className="flex items-center gap-1.5">
      {team ? (
        <TeamLogo team={team} size="xs" />
      ) : (
        <span className="w-4 h-4 shrink-0 flex items-center justify-center text-text-muted">
          <Icon size={11} />
        </span>
      )}
      <span className={`flex-1 min-w-0 truncate text-[11px] ${highlight.unread || highlight.pinned ? '' : 'text-text-muted'}`}>
        {highlight.pinned && <span className="text-pin">📌 </span>}
        {text}
      </span>
    </div>
  );
}
