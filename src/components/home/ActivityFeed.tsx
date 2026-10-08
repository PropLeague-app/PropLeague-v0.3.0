import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Megaphone, Bell, DollarSign, Sparkles, Inbox, MessageCircle, Send, ChevronDown, Trash2, Pin, Plus } from 'lucide-react';
import type { ActivityItem, ChatMessage, League } from '../../types';
import { MOMENT_CATEGORY_LABELS, weekLabel, weekOrder } from '../../types';
import { Card } from '../common/Card';
import { EmptyState } from '../common/EmptyState';
import { TeamLogo } from '../common/TeamLogo';
import { LeagueLogo } from '../common/LeagueLogo';
import { PositionBadge } from '../common/PositionBadge';
import { OddsDisplay } from '../common/OddsDisplay';
import { ConfirmSheet } from '../common/ConfirmSheet';
import { FireAura } from '../common/FireAura';
import { StinkAura } from '../common/StinkAura';
import { parsePerfectWeek, type PerfectWeekPost } from '../../engine/perfectAnnouncement';
import { parseSkunkedWeek, type SkunkedWeekPost } from '../../engine/skunkedAnnouncement';
import { teamAccent } from '../../engine/teamColors';
import { MAX_PINNED_ANNOUNCEMENTS, parseRichText, pinnedAnnouncementCount } from '../../engine/richText';
import { useResolvedTheme } from '../../hooks/useResolvedTheme';
import { AnchoredPopover } from '../common/AnchoredPopover';
import { ReactionPicker } from './ReactionPicker';
import { CHIP_LOGOS, CHIP_ROW_GAP, QUICK_REACTIONS, fitChips, reactionGroups, type ReactionGroup } from '../../engine/reactions';

const ICONS: Record<ActivityItem['type'], ReactNode> = {
  announcement: <Megaphone size={16} />,
  reminder: <Bell size={16} />,
  settled: <DollarSign size={16} />,
  moment: <Sparkles size={16} />,
};

/** The league's teams, so a reaction chip can show who reacted. Provided by ActivityFeed. */
const ReactionTeamsContext = createContext<League['teams']>([]);

type ReactionPopup = { kind: 'picker' | 'all'; rect: DOMRect } | { kind: 'who'; rect: DOMRect; emoji: string };

/** One or two overlapping team logos (then "+n"), the "who" on a reaction chip. */
function ReactorLogos({ group, teamById }: { group: ReactionGroup; teamById: Map<string, League['teams'][number]> }) {
  if (group.teamIds.length === 0) return <span className="text-[10px] font-semibold text-text-muted tabular-nums">{group.count}</span>;
  const shown = group.teamIds.slice(0, CHIP_LOGOS).map((id) => teamById.get(id)).filter((t): t is League['teams'][number] => !!t);
  const extra = group.teamIds.length - CHIP_LOGOS;
  return (
    <span className="inline-flex items-center">
      {shown.map((team, i) => (
        <span key={team.id} className={`rounded-full ring-1 ring-bg-raised ${i > 0 ? '-ml-1.5' : ''}`}>
          <TeamLogo team={team} size="xs" />
        </span>
      ))}
      {extra > 0 && <span className="ml-0.5 text-[9px] font-semibold text-text-muted">+{extra}</span>}
    </span>
  );
}

/** A reaction with the teams that picked it, as a list (the "who reacted" bubble and the overview). */
function ReactorList({ group, teamById }: { group: ReactionGroup; teamById: Map<string, League['teams'][number]> }) {
  const teams = group.teamIds.map((id) => teamById.get(id)).filter((t): t is League['teams'][number] => !!t);
  if (teams.length === 0) return <p className="text-[11px] text-text-muted">{group.count} reaction{group.count === 1 ? '' : 's'}</p>;
  return (
    <ul className="space-y-1">
      {teams.map((team) => (
        <li key={team.id} className="flex items-center gap-1.5 min-w-0">
          <TeamLogo team={team} size="xs" />
          <span className="text-xs font-medium truncate">{team.teamName}</span>
        </li>
      ))}
    </ul>
  );
}

// manual v0.3.0 §6: one reaction per person, switchable -- item.myReaction (set
// by fetchLeagueActivity/reactToActivity, see chat) is the caller's own current
// pick, if any. Its chip and its quick-reaction button both get a ring so it's clear
// which one is "yours" and tapping any other emoji will move it rather than add a
// second one.
//
// Layout: the reactions people have left sit to the left of the quick buttons, each as
// the emoji plus the logos of the teams that chose it (tap for the full team list). When
// there are more kinds than fit in that space, the ones that don't fit collapse into one
// overlapping stack; tapping it opens an overview of every reaction. "+" opens a picker
// with more emojis than the quick four.
function Reactions({ item, onReact }: { item: ActivityItem; onReact?: (itemId: string, emoji: string) => void }) {
  const teams = useContext(ReactionTeamsContext);
  const teamById = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const groups = useMemo(() => reactionGroups(item.reactors, item.reactions), [item.reactors, item.reactions]);
  const areaRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(Infinity);
  const [popup, setPopup] = useState<ReactionPopup | null>(null);

  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    // Minus the 2px of padding each side, which is room for the rings (they would be clipped by overflow-hidden).
    const measure = () => setAvailable(el.clientWidth - 4);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [onReact]);

  if (!onReact) return null;
  const { shown, overflow } = fitChips(groups, available);
  const closePopup = () => setPopup(null);
  const whoGroup = popup?.kind === 'who' ? groups.find((g) => g.emoji === popup.emoji) : undefined;
  const ring = (emoji: string) => (emoji === item.myReaction ? 'ring-1 ring-primary' : '');

  return (
    <div className="flex items-center gap-1 flex-1 min-w-0 justify-end">
      <div ref={areaRef} className="flex flex-1 min-w-0 items-center justify-end overflow-hidden p-0.5 -my-0.5" style={{ gap: CHIP_ROW_GAP }}>
        {shown.map((group) => (
          <button
            key={group.emoji}
            type="button"
            onClick={(e) => setPopup({ kind: 'who', rect: e.currentTarget.getBoundingClientRect(), emoji: group.emoji })}
            aria-label={`${group.emoji} reactions`}
            className={`shrink-0 inline-flex items-center gap-[3px] bg-bg-raised rounded-full pl-1.5 pr-1 py-0.5 ${ring(group.emoji)}`}
          >
            <span className="text-[12px] leading-4">{group.emoji}</span>
            <ReactorLogos group={group} teamById={teamById} />
          </button>
        ))}
        {overflow.length > 0 && (
          <button
            type="button"
            onClick={(e) => setPopup({ kind: 'all', rect: e.currentTarget.getBoundingClientRect() })}
            aria-label="All reactions"
            className={`shrink-0 inline-flex items-center bg-bg-raised rounded-full pl-1.5 pr-1.5 py-0.5 ${overflow.some((g) => g.emoji === item.myReaction) ? 'ring-1 ring-primary' : ''}`}
          >
            {overflow.slice(0, 3).map((g, i) => (
              <span key={g.emoji} className={`text-[12px] leading-4 ${i > 0 ? '-ml-1' : ''}`}>
                {g.emoji}
              </span>
            ))}
            <span className="ml-1 text-[10px] font-semibold text-text-muted tabular-nums">+{overflow.length}</span>
          </button>
        )}
      </div>
      {QUICK_REACTIONS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => onReact(item.id, emoji)}
          className={`shrink-0 text-xs ${emoji === item.myReaction ? 'opacity-100' : 'opacity-50 hover:opacity-100'}`}
        >
          {emoji}
        </button>
      ))}
      <button
        type="button"
        onClick={(e) => setPopup({ kind: 'picker', rect: e.currentTarget.getBoundingClientRect() })}
        aria-label="More reactions"
        aria-haspopup="dialog"
        className="shrink-0 w-4 h-4 rounded-full border border-border text-text-muted flex items-center justify-center active:bg-bg-raised"
      >
        <Plus size={10} strokeWidth={2.5} />
      </button>

      {popup?.kind === 'picker' && (
        <AnchoredPopover anchor={popup.rect} onClose={closePopup} width={352} maxHeight={400}>
          <ReactionPicker
            current={item.myReaction}
            onPick={(emoji) => {
              onReact(item.id, emoji);
              closePopup();
            }}
          />
        </AnchoredPopover>
      )}
      {popup?.kind === 'who' && whoGroup && (
        <AnchoredPopover anchor={popup.rect} onClose={closePopup} width={200} align="start">
          <p className="text-sm font-semibold mb-1.5">
            {whoGroup.emoji} <span className="text-[11px] font-medium text-text-muted">{whoGroup.count}</span>
          </p>
          <ReactorList group={whoGroup} teamById={teamById} />
        </AnchoredPopover>
      )}
      {popup?.kind === 'all' && (
        <AnchoredPopover anchor={popup.rect} onClose={closePopup} width={236}>
          <div className="space-y-2.5">
            {groups.map((group) => (
              <div key={group.emoji}>
                <p className="text-sm font-semibold mb-1">
                  {group.emoji} <span className="text-[11px] font-medium text-text-muted">{group.count}</span>
                </p>
                <ReactorList group={group} teamById={teamById} />
              </div>
            ))}
          </div>
        </AnchoredPopover>
      )}
    </div>
  );
}

/** Renders announcement text with the tiny **highlight** / *italic* markup (see
 * engine/richText). Plain messages come through unchanged. */
function RichText({ text }: { text: string }) {
  const mode = useResolvedTheme();
  return (
    <>
      {parseRichText(text).map((seg, i) => {
        if (seg.style === 'highlight') {
          // A player's name carries his NFL team; wear that team's color (nudged to stay readable
          // on the card in either theme). Anything else uses the app's accent.
          const color = seg.team ? teamAccent(seg.team, mode) : null;
          return color ? (
            <span
              key={i}
              className="font-semibold rounded px-1 py-px"
              style={{ color, backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)` }}
            >
              {seg.text}
            </span>
          ) : (
            <span key={i} className="font-semibold text-accent bg-accent/15 rounded px-1 py-px">
              {seg.text}
            </span>
          );
        }
        if (seg.style === 'italic') {
          return (
            <em key={i} className="text-text-muted">
              {seg.text}
            </em>
          );
        }
        return <span key={i}>{seg.text}</span>;
      })}
    </>
  );
}

/** A perfect week gets its own card: week on top, then the team and "Perfect Week" in large type, then
 * the record and P/L underneath. Gold wash from both edges and flames around the logo, same look as the
 * rest of the app's perfect-week treatment. */
function PerfectWeekCard({
  league,
  item,
  post,
  onReact,
  onDelete,
  canDelete,
}: {
  league: League;
  item: ActivityItem;
  post: PerfectWeekPost;
  onReact?: (itemId: string, emoji: string) => void;
  onDelete?: (itemId: string) => void;
  canDelete?: boolean;
}) {
  const team = league.teams.find((t) => t.id === post.teamId);
  return (
    <Card dense className="pl-slip pl-slip-l pl-slip-r border-gold/30! space-y-1">
      <div className="flex flex-col items-center text-center">
        <p className="text-[9px] font-bold uppercase tracking-[0.2em] pl-gold-text">{post.weekLabel}</p>
        <div className="flex items-center justify-center gap-2 mt-1 max-w-full">
          {team && (
            <FireAura active>
              <TeamLogo team={team} size="sm" />
            </FireAura>
          )}
          <p className="text-base font-bold text-text truncate min-w-0">{team?.teamName ?? post.teamName}</p>
        </div>
        <p className="pl-fire-name text-xl font-extrabold uppercase tracking-wide leading-none mt-1">Perfect Week</p>
        <div className="flex items-center justify-center gap-1.5 mt-1.5">
          <span className="inline-flex items-baseline gap-1 rounded-full bg-black/30 px-2.5 py-0.5 text-sm font-bold text-text">
            {post.record}
            <span className="text-[8px] font-semibold uppercase tracking-wide text-text-muted">W-L-P</span>
          </span>
          <span className="rounded-full bg-profit/15 px-2.5 py-0.5 text-sm font-bold text-profit">{post.pl}</span>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <p className="shrink-0 text-[9px] text-text-muted">
          {new Date(item.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </p>
        <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
          <Reactions item={item} onReact={onReact} />
          {canDelete && onDelete && (
            <button onClick={() => onDelete(item.id)} className="text-text-muted hover:text-loss shrink-0" aria-label="Delete announcement">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

/** A few dry lines for under the headline. They poke fun at the week, never at the team. */
const SKUNK_QUIPS = [
  'Not one of them cashed.',
  'The week had other plans.',
  'Every pick found a new way out.',
  'A clean sweep, the wrong way.',
];

/** A skunked week gets the quiet mirror of the perfect-week card: muted olive wash instead of gold,
 * stink lines and flies instead of flames, and red only on the loss amount. Off unless the commissioner
 * turned announcements on (settle-week writes it; nothing here decides whether a week was skunked). */
function SkunkedWeekCard({
  league,
  item,
  post,
  onReact,
  onDelete,
  canDelete,
}: {
  league: League;
  item: ActivityItem;
  post: SkunkedWeekPost;
  onReact?: (itemId: string, emoji: string) => void;
  onDelete?: (itemId: string) => void;
  canDelete?: boolean;
}) {
  const team = league.teams.find((t) => t.id === post.teamId);
  const quip = SKUNK_QUIPS[[...post.teamId].reduce((n, c) => n + c.charCodeAt(0), 0) % SKUNK_QUIPS.length];
  const lost = post.pl.startsWith('-');
  return (
    <Card dense className="pl-slip pl-slip-l pl-slip-r pl-skunk space-y-1">
      <div className="flex flex-col items-center text-center">
        <p className="text-[9px] font-bold uppercase tracking-[0.2em] pl-skunk-name">{post.weekLabel}</p>
        <div className="flex items-center justify-center gap-2 mt-1 max-w-full">
          {team && (
            <StinkAura active>
              <TeamLogo team={team} size="sm" />
            </StinkAura>
          )}
          <p className="text-base font-bold text-text truncate min-w-0">{team?.teamName ?? post.teamName}</p>
        </div>
        <p className="pl-skunk-name text-xl font-extrabold uppercase tracking-wide leading-none mt-1">Skunked</p>
        <p className="text-[11px] italic text-text-muted mt-1">{quip}</p>
        <div className="flex items-center justify-center gap-1.5 mt-1.5">
          <span className="inline-flex items-baseline gap-1 rounded-full bg-black/30 px-2.5 py-0.5 text-sm font-bold text-text">
            {post.record}
            <span className="text-[8px] font-semibold uppercase tracking-wide text-text-muted">W-L</span>
          </span>
          <span className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${lost ? 'bg-loss/15 text-loss' : 'bg-black/30 text-text'}`}>{post.pl}</span>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <p className="shrink-0 text-[9px] text-text-muted">
          {new Date(item.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        </p>
        <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
          <Reactions item={item} onReact={onReact} />
          {canDelete && onDelete && (
            <button onClick={() => onDelete(item.id)} className="text-text-muted hover:text-loss shrink-0" aria-label="Delete announcement">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

function NewsCard({
  league,
  item,
  onReact,
  onDelete,
  canDelete,
  canPin,
  onTogglePin,
}: {
  league: League;
  item: ActivityItem;
  onReact?: (itemId: string, emoji: string) => void;
  /** manual v0.3.0 §6: "delete the announcements I send" -- only ever called for
   * type === 'announcement'; canDelete gates whether the button even renders
   * (the RPC re-checks permission regardless, this is just to not show a button
   * that would fail). */
  onDelete?: (itemId: string) => void;
  canDelete?: boolean;
  /** Commissioner only: shows the pin icon as a toggle. Everyone else just sees a
   * static (highlighted) pin on pinned announcements. */
  canPin?: boolean;
  onTogglePin?: (item: ActivityItem) => void;
}) {
  const isAnnouncement = item.type === 'announcement';
  const perfect = isAnnouncement ? parsePerfectWeek(item.message) : null;
  if (perfect) return <PerfectWeekCard league={league} item={item} post={perfect} onReact={onReact} onDelete={onDelete} canDelete={canDelete} />;
  const skunked = isAnnouncement ? parseSkunkedWeek(item.message) : null;
  if (skunked) return <SkunkedWeekCard league={league} item={item} post={skunked} onReact={onReact} onDelete={onDelete} canDelete={canDelete} />;
  // Announcements the commissioner posted (or flagged a void with) carry their team id;
  // system ones (season start, welcome) do not.
  const label = isAnnouncement ? (item.postedByTeamId ? 'Commissioner Announcement' : 'League Update') : null;
  const showPin = isAnnouncement && (canPin || item.pinned);
  return (
    <Card className={`flex items-start gap-2.5 ${item.pinned ? 'ring-1 ring-gold/40' : ''}`}>
      {isAnnouncement ? <LeagueLogo league={league} size="sm" /> : <span>{ICONS[item.type]}</span>}
      <div className="min-w-0 flex-1">
        {(label || showPin) && (
          <div className="flex items-center justify-between gap-2 min-h-[16px]">
            <span className="text-[10px] uppercase tracking-wide font-semibold text-text-muted">{label}</span>
            {showPin &&
              (canPin && onTogglePin ? (
                <button
                  onClick={() => onTogglePin(item)}
                  className={`shrink-0 p-0.5 -mr-0.5 -mt-0.5 ${item.pinned ? 'text-gold' : 'text-text-muted/50 hover:text-text-muted'}`}
                  aria-label={item.pinned ? 'Unpin announcement' : 'Pin announcement'}
                  aria-pressed={!!item.pinned}
                >
                  <Pin size={14} fill={item.pinned ? 'currentColor' : 'none'} />
                </button>
              ) : (
                <span className="shrink-0 text-gold" aria-label="Pinned">
                  <Pin size={14} fill="currentColor" />
                </span>
              ))}
          </div>
        )}
        <p className="text-sm">{isAnnouncement ? <RichText text={item.message} /> : item.message}</p>
        <div className="flex items-center justify-between mt-0.5">
          <p className="shrink-0 text-[11px] text-text-muted">
            {new Date(item.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </p>
          <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
            <Reactions item={item} onReact={onReact} />
            {isAnnouncement && canDelete && onDelete && (
              <button onClick={() => onDelete(item.id)} className="text-text-muted hover:text-loss shrink-0" aria-label="Delete announcement">
                <Trash2 size={13} />
              </button>
            )}
          </div>
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
        <p className="shrink-0 text-[9px] text-text-muted">
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
// manual v0.3.0 §6: "a person should be able to delete their own chats too" --
// team?.isUser is the same "is this mine" flag every other own-team check in
// the app already uses; onDelete only ever needs to be called for the viewer's
// own message since the button is gated on that same flag.
function ChatBubble({ league, item, onDelete }: { league: League; item: ChatMessage; onDelete?: (itemId: string) => void }) {
  const team = league.teams.find((t) => t.id === item.teamId);
  return (
    <div className="flex items-start gap-2 group">
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
      {team?.isUser && onDelete && (
        <button onClick={() => onDelete(item.id)} className="text-text-muted hover:text-loss shrink-0 mt-0.5" aria-label="Delete message">
          <Trash2 size={13} />
        </button>
      )}
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
  onDeleteAnnouncement,
  onTogglePin,
  onDeleteChat,
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
  /** manual v0.3.0 §6: commissioner (or whoever originally posted it) can
   * delete an announcement; any member can delete their own chat message.
   * Both omitted (Advanced dev-panel callers, say) simply hides every delete
   * button, same pattern onReact/onSendChat already use. */
  onDeleteAnnouncement?: (itemId: string) => Promise<{ ok: boolean; error?: string }>;
  /** Commissioner pin toggle; omitted hides the pin controls. */
  onTogglePin?: (itemId: string, pinned: boolean) => Promise<{ ok: boolean; error?: string }>;
  onDeleteChat?: (itemId: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [tab, setTab] = useState<FeedTab>('all');
  // Confirm-before-delete (see chat, Sept 2026: accidental taps on the trash
  // icon shouldn't silently delete someone's announcement or message) -- one
  // shared sheet for both kinds rather than per-row state, since only one can
  // ever be open at a time.
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'announcement' | 'chat'; id: string } | null>(null);
  // Commissioner can delete any announcement; anyone who posted one (or a
  // pre-this-feature announcement with no recorded poster, see chat) can only
  // delete their own -- canDeleteAnnouncement below folds both cases into one
  // per-item check the same way the server-side RPC does.
  const userTeam = league.teams.find((t) => t.isUser);
  const isCommissioner = !!userTeam && userTeam.id === league.commissionerTeamId;
  const canDeleteAnnouncement = (item: ActivityItem) => isCommissioner || (!!userTeam && item.postedByTeamId === userTeam.id);
  const [pinError, setPinError] = useState<string | null>(null);
  const togglePin = async (item: ActivityItem) => {
    if (!onTogglePin) return;
    if (!item.pinned && pinnedAnnouncementCount(items) >= MAX_PINNED_ANNOUNCEMENTS) {
      setPinError(`You can pin up to ${MAX_PINNED_ANNOUNCEMENTS} announcements. Unpin one first.`);
      return;
    }
    setPinError(null);
    const res = await onTogglePin(item.id, !item.pinned);
    if (!res.ok) setPinError(res.error ?? 'Could not update the pin.');
  };
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
    <ReactionTeamsContext.Provider value={league.teams}>
    <div className="space-y-3">
      {/* No overflow-hidden on the wrapper: the unread badge sits on the chat
          pill's top-right corner and would be clipped by it, so the first and
          last pills round their own outer corners instead. */}
      <div className="flex bg-bg-card rounded-lg w-fit">
        {(['all', 'moments', 'news', 'chat'] as FeedTab[]).map((t, i, all) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative px-3 py-1.5 text-xs font-semibold flex items-center gap-1 ${i === 0 ? 'rounded-l-lg' : ''} ${i === all.length - 1 ? 'rounded-r-lg' : ''} ${tab === t ? 'seg-active' : 'text-text-muted'}`}
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

      {pinError && (tab === 'all' || tab === 'news') && (
        <p className="text-xs text-loss" role="alert">
          {pinError}
        </p>
      )}

      {tab === 'all' && (
        <div className="space-y-2">
          {sorted.slice(0, 8).map((item) =>
            item.type === 'moment' ? (
              <MomentCard key={item.id} league={league} item={item} onReact={onReact} />
            ) : (
              <NewsCard key={item.id} league={league} item={item} onReact={onReact} onDelete={onDeleteAnnouncement ? () => setPendingDelete({ kind: 'announcement', id: item.id }) : undefined} canDelete={canDeleteAnnouncement(item)} canPin={isCommissioner && !!onTogglePin} onTogglePin={togglePin} />
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
            news.slice(0, 8).map((item) => (
              <NewsCard key={item.id} league={league} item={item} onReact={onReact} onDelete={onDeleteAnnouncement ? () => setPendingDelete({ kind: 'announcement', id: item.id }) : undefined} canDelete={canDeleteAnnouncement(item)} canPin={isCommissioner && !!onTogglePin} onTogglePin={togglePin} />
            ))
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
                className="btn-soft-primary text-sm font-semibold px-3 rounded-lg disabled:opacity-40"
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
                <ChatBubble
                  key={item.id}
                  league={league}
                  item={item}
                  onDelete={onDeleteChat ? () => setPendingDelete({ kind: 'chat', id: item.id }) : undefined}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {pendingDelete && (
        <ConfirmSheet
          title={pendingDelete.kind === 'announcement' ? 'Delete this announcement?' : 'Delete this message?'}
          description="This can't be undone."
          confirmLabel="Delete"
          confirmingLabel="Deleting…"
          onConfirm={async () => {
            const fn = pendingDelete.kind === 'announcement' ? onDeleteAnnouncement : onDeleteChat;
            if (!fn) return { ok: true };
            return fn(pendingDelete.id);
          }}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </div>
    </ReactionTeamsContext.Provider>
  );
}