import { createContext, Suspense, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Megaphone, Bell, DollarSign, Sparkles, Inbox, ChevronDown, Trash2, Pin, SmilePlus, SlidersHorizontal } from 'lucide-react';
import type { ActivityItem, League } from '../../types';
import { MOMENT_CATEGORY_LABELS, weekLabel, weekOrder } from '../../types';
import { ClinchIcon } from '../common/ClinchIcon';
import type { ClinchStatus } from '../../engine/clinch';
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
import { lazyNamed } from '../../lazyLoad';

// The full emoji picker carries every emoji category, so it loads on first use (lazyLoad.ts).
const ReactionPicker = lazyNamed(() => import('./ReactionPicker'), 'ReactionPicker');
import { haptic } from '../../services/haptics';
import { usePlStyle } from '../common/usePlStyle';
import { weekScaleRef } from '../../engine/plColor';
import type { CSSProperties } from 'react';
import { CHIP_LOGOS, CHIP_ROW_GAP, fitChips, reactionGroups, type ReactionGroup } from '../../engine/reactions';
import { momentPreviewValue } from '../../engine/activityDigest';

const ICONS: Record<ActivityItem['type'], ReactNode> = {
  announcement: <Megaphone size={16} />,
  reminder: <Bell size={16} />,
  settled: <DollarSign size={16} />,
  moment: <Sparkles size={16} />,
};

/** The icon for a system post, read from its wording: a gear for a settings update, and the standings
 * marker for a clinch. Everything else keeps the league logo. */
function systemPostIcon(message: string): ReactNode {
  if (message.startsWith('Commissioner update:')) {
    return (
      <span className="shrink-0 w-6 h-6 rounded-full bg-bg-raised flex items-center justify-center text-text-muted">
        <SlidersHorizontal size={13} />
      </span>
    );
  }
  const clinch = /clinched (a playoff spot|a first-round bye|the #1 seed)/.exec(message);
  if (clinch) {
    const status: ClinchStatus = clinch[1] === 'the #1 seed' ? 'top' : clinch[1] === 'a first-round bye' ? 'bye' : 'playoffs';
    return (
      <span className="shrink-0 w-6 h-6 rounded-full bg-bg-raised flex items-center justify-center">
        <ClinchIcon status={status} size={14} />
      </span>
    );
  }
  return null;
}

/** The league's teams, so a reaction chip can show who reacted. Provided by ActivityFeed. */
const ReactionTeamsContext = createContext<League['teams']>([]);

type ReactionPopup = { kind: 'picker'; rect: DOMRect } | { kind: 'who'; rect: DOMRect; emoji: string | null };

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

/**
 * Who reacted, as one list: a row per team (logo, name, and its emoji at the right), grouped by emoji,
 * most-used first. A row of filter chips on top ("All 4", then each emoji with its count) narrows it to
 * one emoji; tapping a reaction chip opens it already on that emoji, the stack opens it on All.
 */
function ReactionsSheet({
  groups,
  teamById,
  initial,
  mine,
}: {
  groups: ReactionGroup[];
  teamById: Map<string, League['teams'][number]>;
  /** Tapping one emoji's chip lists just that emoji; the overflow stack lists all of them. */
  initial: string | null;
  mine?: string;
}) {
  const visible = initial ? groups.filter((g) => g.emoji === initial) : groups;
  const rows = visible.flatMap((g) =>
    g.teamIds.map((id) => ({ emoji: g.emoji, team: teamById.get(id) })).filter((r): r is { emoji: string; team: League['teams'][number] } => !!r.team),
  );
  if (rows.length === 0) {
    return <p className="text-[11px] text-text-muted">{visible.map((g) => `${g.emoji} ${g.count}`).join('  ')}</p>;
  }
  return (
    <ul className="space-y-1">
      {rows.map(({ emoji, team }) => (
        <li key={`${emoji}-${team.id}`} className="flex items-center gap-2 min-w-0">
          <TeamLogo team={team} size="sm" />
          <span className="text-xs font-medium truncate flex-1 min-w-0">{team.teamName}</span>
          {/* Fixed square so your own reaction's ring is a true circle centered on the emoji. */}
          <span
            className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[15px] leading-none ${
              team.isUser && emoji === mine ? 'ring-1 ring-primary' : ''
            }`}
          >
            {emoji}
          </span>
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
// Layout: only the reactions people have actually left, each as the emoji plus the logos of the
// teams that chose it (tap for the full team list), then one add-reaction button. The quick four
// used to sit on every card whether anyone had reacted or not, which doubled each card's weight and
// squeezed the chips until they were clipped (backlog B5.8, B5.9). They are still one tap away: they
// lead the picker's first tab. When there are more kinds than fit, the rest collapse into one
// overlapping stack; tapping it opens an overview of every reaction.
function Reactions({
  item,
  onReact,
  addOnly = false,
}: {
  item: ActivityItem;
  onReact?: (itemId: string, emoji: string) => void;
  /** Just the add-reaction button, for a card with no reactions yet that has room beside its value. */
  addOnly?: boolean;
}) {
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
  const ring = (emoji: string) => (emoji === item.myReaction ? 'ring-1 ring-primary' : '');

  return (
    <div className={`flex items-center gap-1 justify-end ${addOnly ? 'shrink-0' : 'flex-1 min-w-0'}`}>
      {!addOnly && (
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
            onClick={(e) => setPopup({ kind: 'who', rect: e.currentTarget.getBoundingClientRect(), emoji: null })}
            aria-label={`${overflow.reduce((n, g) => n + g.count, 0)} more reactions`}
            className={`shrink-0 inline-flex items-center gap-1 bg-bg-raised rounded-full pl-1 pr-1.5 py-0.5 ${overflow.some((g) => g.emoji === item.myReaction) ? 'ring-1 ring-primary' : ''}`}
          >
            {/* Up to three emojis, each in its own small disc so the overlap reads as a stack, then how
                many reactions are inside (people, not kinds). */}
            <span className="inline-flex items-center">
              {overflow.slice(0, 3).map((g, i) => (
                <span
                  key={g.emoji}
                  className={`w-4 h-4 rounded-full bg-bg-card ring-1 ring-bg-raised flex items-center justify-center text-[10px] leading-none ${i > 0 ? '-ml-[5px]' : ''}`}
                >
                  {g.emoji}
                </span>
              ))}
            </span>
            <span className="text-[10px] font-semibold text-text-muted tabular-nums">{overflow.reduce((n, g) => n + g.count, 0)}</span>
          </button>
        )}
      </div>
      )}
      <button
        type="button"
        onClick={(e) => setPopup({ kind: 'picker', rect: e.currentTarget.getBoundingClientRect() })}
        aria-label="Add a reaction"
        aria-haspopup="dialog"
        className="shrink-0 -m-1 p-1 text-text-muted/50 active:text-text"
      >
        <SmilePlus size={13} />
      </button>

      {popup?.kind === 'picker' && (
        <AnchoredPopover anchor={popup.rect} onClose={closePopup} width={352} maxHeight={400}>
          <Suspense fallback={null}>
            <ReactionPicker
              current={item.myReaction}
              onPick={(emoji) => {
                haptic.tap();
                onReact(item.id, emoji);
                closePopup();
              }}
            />
          </Suspense>
        </AnchoredPopover>
      )}
      {popup?.kind === 'who' && (
        <AnchoredPopover anchor={popup.rect} onClose={closePopup} width={224} maxHeight={300}>
          <ReactionsSheet groups={groups} teamById={teamById} initial={popup.emoji} mine={item.myReaction} />
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
              className="font-semibold rounded-[3px] px-[3px]"
              style={{ color, backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)` }}
            >
              {seg.text}
            </span>
          ) : (
            <span key={i} className="font-semibold text-accent bg-accent/15 rounded-[3px] px-[3px]">
              {seg.text}
            </span>
          );
        }
        if (seg.style === 'italic') {
          return (
            <em key={i} className="text-[11px] text-text-muted">
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
        <p className="shrink-0 text-[9px] text-text-muted">{shortTime(item.ts)}</p>
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
  // The week's loss follows the P/L colors setting, scaled against that week's worst score.
  const plStyle = usePlStyle();
  const skunkWeek = Number(post.weekLabel.match(/(\d+)/)?.[1]);
  const skunkAmount = signedAmount(post.pl);
  const skunkScaled =
    lost && Number.isInteger(skunkWeek) && !Number.isNaN(skunkAmount) ? plStyle(skunkAmount, weekScaleRef(league, skunkWeek)) : undefined;
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
          <span className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${lost ? 'bg-loss/15 text-loss' : 'bg-black/30 text-text'}`} style={scaledPillStyle(skunkScaled)}>
            {post.pl}
          </span>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <p className="shrink-0 text-[9px] text-text-muted">{shortTime(item.ts)}</p>
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
  // A system post gets an icon that matches what it says, instead of an emoji in the text.
  const systemIcon = isAnnouncement && !item.postedByTeamId ? systemPostIcon(item.message) : null;
  const showPin = isAnnouncement && (canPin || item.pinned);
  const showDelete = isAnnouncement && canDelete && !!onDelete;
  // No "Commissioner Announcement" caps label any more: the league logo already says who posted it,
  // and in the League News tab it repeated on every card (backlog B5.11). Pin and delete sit together
  // at the top right rather than one at the top and one in the reaction row (B5.10).
  return (
    <Card className={`flex items-start gap-2.5 ${item.pinned ? 'ring-1 ring-pin/40' : ''}`}>
      {systemIcon ?? (isAnnouncement ? <LeagueLogo league={league} size="sm" /> : <span>{ICONS[item.type]}</span>)}
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          {/* Sized against MomentCard (12px title, 9px label) so a feed of announcements and moments
              reads as one list instead of two (see chat, Oct 2026). */}
          <p className="flex-1 min-w-0 text-xs leading-relaxed">{isAnnouncement ? <RichText text={item.message} /> : item.message}</p>
          {(showPin || showDelete) && (
            <div className="shrink-0 flex items-center gap-2 -mr-0.5 pt-0.5">
              {showPin &&
                (canPin && onTogglePin ? (
                  <button
                    onClick={() => onTogglePin(item)}
                    className={`p-0.5 -m-0.5 ${item.pinned ? 'text-pin' : 'text-text-muted/50 hover:text-text-muted'}`}
                    aria-label={item.pinned ? 'Unpin announcement' : 'Pin announcement'}
                    aria-pressed={!!item.pinned}
                  >
                    <Pin size={13} fill={item.pinned ? 'currentColor' : 'none'} />
                  </button>
                ) : (
                  <span className="text-pin" aria-label="Pinned">
                    <Pin size={13} fill="currentColor" />
                  </span>
                ))}
              {showDelete && (
                <button onClick={() => onDelete!(item.id)} className="p-0.5 -m-0.5 text-text-muted/50 hover:text-loss" aria-label="Delete announcement">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <p className="shrink-0 text-[11px] text-text-muted">{shortTime(item.ts)}</p>
          <Reactions item={item} onReact={onReact} />
        </div>
      </div>
    </Card>
  );
}

/** "Oct 20 at 10:02 AM", the one timestamp format the feed uses. */
function shortTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
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
function AmountPill({ text, negative, size = 'md', scaled }: { text: string; negative?: boolean; size?: 'sm' | 'md'; scaled?: CSSProperties }) {
  // Defaults to sniffing a leading +/- sign, which works for every dollar-amount
  // caller (formatSigned always produces one) -- callers with no sign of their own
  // to sniff (the W/L streak pill) pass `negative` explicitly instead.
  const isNegative = negative ?? text.trim().startsWith('-');
  const sizeClass = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5';
  return (
    <span
      className={`inline-flex items-center font-bold rounded-full whitespace-nowrap ${isNegative ? 'bg-loss/20 text-loss' : 'bg-profit/20 text-profit'} ${sizeClass}`}
      style={scaledPillStyle(scaled)}
    >
      {text}
    </span>
  );
}

/** A scaled loss color (P/L colors: Scaled) as a pill: that color for the text and a 20% wash of it
 * for the fill, matching the classic red pill's recipe. Undefined keeps the classic look. */
function scaledPillStyle(scaled: CSSProperties | undefined): CSSProperties | undefined {
  const color = scaled?.color;
  if (!color) return undefined;
  return { color, backgroundColor: `color-mix(in oklab, ${color} 20%, transparent)` };
}

/** "-$13.78" -> -13.78 (NaN for anything that isn't a signed dollar amount). */
function signedAmount(text: string): number {
  const m = text.trim().match(/^([+-])\$([\d,]+(?:\.\d+)?)$/);
  if (!m) return Number.NaN;
  const n = Number(m[2].replace(/,/g, ''));
  return m[1] === '-' ? -n : n;
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
  const swingSize = swingParts ? momentPreviewValue(extra) : undefined;
  const hasReactions = reactionGroups(item.reactors, item.reactions).length > 0;
  const addInline = !hasReactions && !!onReact;
  // Week-total amounts (a team's whole-week score) follow the P/L colors setting, scaled against that
  // week's worst score like the matchup screens. Single-bet results (the ticket categories) keep the
  // classic red, the same as a bet everywhere else.
  const plStyle = usePlStyle();
  const weekNum = Number(item.momentWeek);
  const refFor = (week: number) => (Number.isInteger(week) && week > 0 ? weekScaleRef(league, week) : 0);
  const scaledFor = (text: string, week: number) => {
    const amount = signedAmount(text);
    return Number.isNaN(amount) ? undefined : plStyle(amount, refFor(week));
  };

  // One shape for every category. Each used to build its own middle, so the award name sat above a
  // logo row above a value whose position moved with the category, and no two cards in a column
  // lined up with each other (see chat, Oct 2026). Now: logo, two lines of identity, value pinned to
  // the right of the same row, an optional detail line, then the footer. Same skeleton every time.
  // "missed by" used to sit beside the pill and squeeze the title to an ellipsis; it lives on the bet's
  // own line now (backlog B5.7).
  const value = ticket ? (
    <AmountPill text={ticket.profitText} size="sm" />
  ) : isStreak ? (
    <AmountPill text={extra!} negative={extra!.startsWith('L')} size="sm" />
  ) : swingParts && swingSize ? (
    // The size of the swing up top; the two weeks it ran between go on the detail line, where the pair
    // no longer squeezes the title (backlog B5.6).
    <AmountPill text={swingSize} size="sm" />
  ) : isPlainAmount ? (
    <AmountPill text={extra!} size="sm" scaled={scaledFor(extra!, weekNum)} />
  ) : null;

  // The line under the title: the bet for a ticket, the two weeks for a swing, otherwise any plain text.
  const detail = ticket ? (
    <p className="text-[10px] truncate">
      <span className="text-text font-medium">{ticket.description}</span>
      <span className="text-text-muted">
        : {ticket.stakeText} @ <OddsDisplay odds={Number(ticket.oddsText)} />
        {ticket.note && ` · missed by ${ticket.note}`}
      </span>
    </p>
  ) : swingParts ? (
    <div className="flex items-center gap-1">
      {/* Last week's score to this week's, each scaled against its own week. */}
      <AmountPill text={swingParts[0]} size="sm" scaled={scaledFor(swingParts[0], weekNum - 1)} />
      <span className="text-[9px] text-text-muted">→</span>
      <AmountPill text={swingParts[1]} size="sm" scaled={scaledFor(swingParts[1], weekNum)} />
    </div>
  ) : !value && extra ? (
    <p className="text-[10px] font-medium truncate">
      <HighlightedExtra text={extra} />
    </p>
  ) : null;

  return (
    <div className="bg-bg-card border border-border rounded-xl p-2 space-y-1">
      <div className="flex items-center gap-2">
        {team ? <TeamLogo team={team} size="sm" /> : <Sparkles size={16} className="shrink-0" />}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold truncate">{item.momentDisplayName ?? item.message}</p>
          <p className="text-[9px] text-text-muted truncate">
            {team?.teamName}
            {team && category ? ' · ' : ''}
            {category ? MOMENT_CATEGORY_LABELS[category] : ''}
          </p>
        </div>
        {item.momentPosition && <PositionBadge position={item.momentPosition} />}
        {/* With no reactions yet the add button takes no row of its own: it sits in the card's bottom
            right corner, on the bet's line when there is one, otherwise under the value, so most cards
            are two lines (backlog B5.8). */}
        {(value || (addInline && !detail)) && (
          <div className="shrink-0 flex flex-col items-end gap-1">
            {value}
            {addInline && !detail && <Reactions item={item} onReact={onReact} addOnly />}
          </div>
        )}
      </div>

      {detail && (
        <div className="flex items-end gap-2">
          <div className="flex-1 min-w-0">{detail}</div>
          {addInline && <Reactions item={item} onReact={onReact} addOnly />}
        </div>
      )}

      {/* No per-card time: a week's Moments are all written in the same second, so seven cards read
          the same timestamp. The week label above each run says when instead (backlog B5.12). */}
      {hasReactions && (
        <div className="flex items-center">
          <Reactions item={item} onReact={onReact} />
        </div>
      )}
    </div>
  );
}

/** The All tab's items, with a week label in front of each run of Moments (the same label the Moments
 * tab groups by), since Moment cards carry no time of their own. */
function withMomentLabels(items: ActivityItem[]): ({ kind: 'label'; key: string; text: string } | { kind: 'item'; item: ActivityItem })[] {
  const out: ({ kind: 'label'; key: string; text: string } | { kind: 'item'; item: ActivityItem })[] = [];
  let lastWeek: string | null = null;
  for (const item of items) {
    if (item.type === 'moment') {
      const week = item.momentWeek != null ? String(item.momentWeek) : 'earlier';
      if (week !== lastWeek) {
        out.push({ kind: 'label', key: `label-${item.id}`, text: item.momentWeek != null ? `${weekLabel(item.momentWeek)} Moments` : 'Moments' });
        lastWeek = week;
      }
    } else {
      lastWeek = null;
    }
    out.push({ kind: 'item', item });
  }
  return out;
}

const RUN_LABEL = 'text-[10px] font-semibold text-text-muted uppercase tracking-wide px-1 pt-1';

// Chat is its own screen now (ChatScreen.tsx, backlog C6), so it lives in exactly one place.
type FeedTab = 'all' | 'moments' | 'news';

const FEED_TAB_LABELS: Record<FeedTab, string> = { all: 'All', moments: 'Moments', news: 'League News' };

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
  onReact,
  onDeleteAnnouncement,
  onTogglePin,
}: {
  league: League;
  items: ActivityItem[];
  onReact?: (itemId: string, emoji: string) => void;
  /** manual v0.3.0 §6: commissioner (or whoever originally posted it) can
   * delete an announcement. Omitted (Advanced dev-panel callers, say) hides every
   * delete button, same pattern onReact already uses. */
  onDeleteAnnouncement?: (itemId: string) => Promise<{ ok: boolean; error?: string }>;
  /** Commissioner pin toggle; omitted hides the pin controls. */
  onTogglePin?: (itemId: string, pinned: boolean) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [tab, setTab] = useState<FeedTab>('all');
  // Confirm-before-delete (see chat, Sept 2026: accidental taps on the trash
  // icon shouldn't silently delete someone's announcement or message) -- one
  // shared sheet for both kinds rather than per-row state, since only one can
  // ever be open at a time.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
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
  // Which week groups are collapsed on the Moments tab (see chat, Sept 2026: "the
  // weeks should be collapsible"). Keyed by groupMomentsByWeek's own group.key, not
  // week number, so the synthetic "earlier" bucket collapses independently too.
  // Nothing starts collapsed -- this only ever hides a week once the person actually
  // taps it shut, so a league with just one or two weeks of history looks exactly
  // like it did before this existed.
  const [collapsedMomentWeeks, setCollapsedMomentWeeks] = useState<Set<string>>(new Set());
  if (items.length === 0) {
    return <EmptyState icon={<Inbox size={36} strokeWidth={1.5} />} title="No activity yet" subtitle="League announcements and bet alerts will show up here." />;
  }

  const sorted = [...items].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  const moments = sorted.filter((i) => i.type === 'moment');
  const news = sorted.filter((i) => i.type !== 'moment');

  return (
    <ReactionTeamsContext.Provider value={league.teams}>
    <div className="space-y-3">
      <div className="flex bg-bg-card rounded-lg w-fit">
        {(['all', 'moments', 'news'] as FeedTab[]).map((t, i, all) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`relative px-3 py-1.5 text-xs font-semibold flex items-center gap-1 ${i === 0 ? 'rounded-l-lg' : ''} ${i === all.length - 1 ? 'rounded-r-lg' : ''} ${tab === t ? 'seg-active' : 'text-text-muted'}`}
          >
            {FEED_TAB_LABELS[t]}
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
          {withMomentLabels(sorted.slice(0, 8)).map((row) =>
            row.kind === 'label' ? (
              <p key={row.key} className={RUN_LABEL}>
                {row.text}
              </p>
            ) : row.item.type === 'moment' ? (
              <MomentCard key={row.item.id} league={league} item={row.item} onReact={onReact} />
            ) : (
              <NewsCard key={row.item.id} league={league} item={row.item} onReact={onReact} onDelete={onDeleteAnnouncement ? () => setPendingDelete(row.item.id) : undefined} canDelete={canDeleteAnnouncement(row.item)} canPin={isCommissioner && !!onTogglePin} onTogglePin={togglePin} />
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
              <NewsCard key={item.id} league={league} item={item} onReact={onReact} onDelete={onDeleteAnnouncement ? () => setPendingDelete(item.id) : undefined} canDelete={canDeleteAnnouncement(item)} canPin={isCommissioner && !!onTogglePin} onTogglePin={togglePin} />
            ))
          )}
        </div>
      )}

      {pendingDelete && (
        <ConfirmSheet
          title="Delete this announcement?"
          description="This can't be undone."
          confirmLabel="Delete"
          confirmingLabel="Deleting…"
          onConfirm={async () => (onDeleteAnnouncement ? onDeleteAnnouncement(pendingDelete) : { ok: true })}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </div>
    </ReactionTeamsContext.Provider>
  );
}