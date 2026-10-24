import type { ReactNode, Ref } from 'react';
import { ChevronDown, Megaphone, Pin } from 'lucide-react';
import type { League } from '../../types';
import { Card } from '../common/Card';
import { TeamLogo } from '../common/TeamLogo';
import { LeagueLogo } from '../common/LeagueLogo';
import { recentHighlights, type Highlight } from '../../engine/activityDigest';
import { parseRichText } from '../../engine/richText';

/** The league's last few lines, with the whole feed one tap below.
 *
 * The feed is the only thing on League Home that is genuinely different since the last visit, and
 * it was the last thing on the page. This is the part worth seeing without scrolling: pinned
 * announcements, then whatever is unread, then whatever is newest. Everything else, every tab and
 * every reaction, is still in the feed underneath when it is open (see chat, Oct 2026).
 *
 * Laid out like the Standings card beside it: header and rows on the same 12px inset. The card used
 * to pass p-0 to Card, which Card's own p-3 overrides, so everything sat twice as far in as intended
 * (backlog B5.1).
 */
export function ActivityMini({
  anchorRef,
  league,
  unread,
  lastSeenMs,
  open,
  onToggle,
  headerAction,
  children,
}: {
  /** So a caller can scroll the card into view after opening it from elsewhere on the page. */
  anchorRef?: Ref<HTMLDivElement>;
  league: League;
  unread: number;
  /** When this device last opened the feed, so a line can be shown as unread. */
  lastSeenMs: number;
  open: boolean;
  onToggle: () => void;
  /** A control for the header's right side while open (the commissioner's new-announcement button). */
  headerAction?: ReactNode;
  /** The full ActivityFeed, rendered only while open. */
  children: ReactNode;
}) {
  const userTeamId = league.teams.find((t) => t.isUser)?.id;
  // Chat has its own screen (backlog C6), so the preview is the feed's own news and Moments only.
  const highlights = recentHighlights(league.activity, [], userTeamId, lastSeenMs, 3);

  return (
    // Lands below League Home's sticky header when scrolled to, instead of under it.
    <div ref={anchorRef} className="scroll-mt-[72px]">
      <Card className="p-0! overflow-hidden">
        <div className={`flex items-center gap-1.5 px-3 pt-3 ${open ? 'pb-2' : highlights.length > 0 ? 'pb-1.5' : 'pb-3'}`}>
          <button onClick={onToggle} aria-expanded={open} className="flex-1 min-w-0 flex items-center gap-1.5 text-left">
            <span className="text-text-muted shrink-0 flex items-center">
              <Megaphone size={13} />
            </span>
            <span className="font-semibold text-xs min-w-0 truncate">Activity</span>
            {unread > 0 && (
              <span className="shrink-0 min-w-4 h-4 px-1 rounded-full bg-loss text-white text-[9px] leading-4 font-bold text-center">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>
          {open && headerAction}
          <button onClick={onToggle} aria-label={open ? 'Collapse activity' : 'Expand activity'} className="shrink-0 -mr-1 p-1 text-text-muted">
            <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>

        {!open && highlights.length > 0 && (
          <button onClick={onToggle} className="w-full px-3 pb-3 space-y-1.5 text-left">
            {highlights.map((h) => (
              <HighlightLine key={h.id} highlight={h} league={league} />
            ))}
          </button>
        )}

        {open && <div className="px-1.5 pb-1.5 pt-2 border-t border-border">{children}</div>}
      </Card>
    </div>
  );
}

const valueTone = (value: string) => (value.startsWith('-') || value.startsWith('L') ? 'text-loss' : 'text-profit');

/** One line, shaped for one line rather than a sentence cut short.
 *
 * - A Moment leads with its award name and team, with its number at the right.
 * - An announcement carries the league logo (the same mark as in the feed) and its words, with a pin
 *   icon when pinned.
 * - A chat line is the team's name, then what it said.
 * Server text can carry emoji and long dashes; none of that reaches this line (backlog B5.3, B5.4). */
function HighlightLine({ highlight, league }: { highlight: Highlight; league: League }) {
  const team = highlight.teamId ? league.teams.find((t) => t.id === highlight.teamId) : undefined;
  const tone = highlight.unread || highlight.pinned ? 'text-text' : 'text-text-muted';

  if (highlight.kind === 'moment') {
    return (
      <span className="flex items-center gap-1.5 min-w-0">
        {team ? <TeamLogo team={team} size="xs" /> : <span className="w-4 h-4 shrink-0" />}
        <span className={`flex-1 min-w-0 truncate text-[11px] ${tone}`}>
          <span className="font-semibold">{highlight.title}</span>
          {team && <span className="text-text-muted"> · {team.teamName}</span>}
        </span>
        {highlight.value && <span className={`shrink-0 text-[11px] font-semibold tabular-nums ${valueTone(highlight.value)}`}>{highlight.value}</span>}
      </span>
    );
  }

  if (highlight.kind === 'chat') {
    return (
      <span className="flex items-center gap-1.5 min-w-0">
        {team ? <TeamLogo team={team} size="xs" /> : <span className="w-4 h-4 shrink-0" />}
        <span className={`flex-1 min-w-0 truncate text-[11px] ${tone}`}>
          <span className="font-semibold">{team?.teamName ?? 'Former member'}</span> {highlight.text}
        </span>
      </span>
    );
  }

  // Announcements are rich text; the feed renders them properly, a one-line preview wants the words.
  const text = parseRichText(highlight.text)
    .map((seg) => seg.text)
    .join('');
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      <LeagueLogo league={league} size="xs" />
      {highlight.pinned && <Pin size={11} fill="currentColor" className="shrink-0 text-pin" aria-label="Pinned" />}
      <span className={`flex-1 min-w-0 truncate text-[11px] ${tone}`}>{text}</span>
    </span>
  );
}
