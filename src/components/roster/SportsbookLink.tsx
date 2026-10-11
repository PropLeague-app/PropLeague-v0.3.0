import { ArrowUpRight } from 'lucide-react';
import type { OddsOutcome } from '../../types';

/**
 * Sending a pick made here to the real sportsbook that priced it.
 *
 * The link is the one The Odds API already returns beside the line (includeLinks, stored on the
 * outcome, see services/supabaseOdds.ts), so it points at that book's own selection at that book's
 * own number. It is deliberately the book that priced the line rather than a favorite book: it is
 * the only one guaranteed to be offering this exact pick at this exact line, so there is never a
 * near-miss on the number.
 *
 * PropLeague takes nothing for the tap. There is no affiliate code on the link, nothing is reported
 * back, and none of this renders unless the person turned Open picks at a sportsbook on in Profile
 * and Settings. Books are drawn as their initials in their own color rather than their logo art.
 */

interface Book {
  abbrev: string;
  name: string;
  /** The brand color, deepened where needed so white initials stay readable on it. */
  color: string;
}

/**
 * Only books that are licensed and regulated in US states get a button. The feed also carries
 * offshore books (Bovada, BetOnline, BetUS, LowVig, MyBookie), and sending someone to one of those
 * is not something this app should do: they are not legal operators, and it is the kind of thing
 * that would sink an App Store review. A pick priced only by one of those simply gets no button.
 *
 * Keys are The Odds API's own, taken from what the feed actually returns: Caesars arrives as
 * williamhill_us. Initials in a colored circle, never their logo art.
 */
const BOOKS: Record<string, Book> = {
  draftkings: { abbrev: 'DK', name: 'DraftKings', color: '#45B82C' },
  fanduel: { abbrev: 'FD', name: 'FanDuel', color: '#1493FF' },
  betmgm: { abbrev: 'MGM', name: 'BetMGM', color: '#8C6D1F' },
  williamhill_us: { abbrev: 'CZR', name: 'Caesars', color: '#8A6D3B' },
  betrivers: { abbrev: 'BR', name: 'BetRivers', color: '#1D5FA8' },
  fanatics: { abbrev: 'FAN', name: 'Fanatics', color: '#C8102E' },
  // Rebranded from ESPN BET; the old key is kept so a feed still sending it works.
  thescorebet: { abbrev: 'SCR', name: 'theScore Bet', color: '#1B3A6B' },
  espnbet: { abbrev: 'SCR', name: 'theScore Bet', color: '#1B3A6B' },
  bet365: { abbrev: '365', name: 'bet365', color: '#126E51' },
  hardrockbet: { abbrev: 'HR', name: 'Hard Rock Bet', color: '#A5192E' },
  ballybet: { abbrev: 'BB', name: 'Bally Bet', color: '#C8352F' },
};

function bookOf(outcome: OddsOutcome): Book | null {
  if (!outcome.link || !outcome.bookKey) return null;
  return BOOKS[outcome.bookKey] ?? null;
}

/** The initials fill most of the circle, so they stay readable at this size: bigger for a two
 * letter book than for a four letter one. */
function initialsPx(abbrev: string, diameter: number): number {
  const ratio = abbrev.length <= 2 ? 0.46 : abbrev.length === 3 ? 0.34 : 0.27;
  return Math.round(diameter * ratio);
}

const BUBBLE_PX = 26;

/**
 * The transport button beside Add to Roster: the book's badge in its own color with an arrow
 * leaving it, built like a team logo (filled circle, white initials, hairline ring) so it belongs
 * to the app rather than looking pasted in. Deliberately small and slightly dimmed, since it is a
 * side door and must not pull focus from Add to Roster; it comes to full strength while pressed.
 * Renders nothing when the setting is off, the book published no link, or the book is not one of
 * the regulated ones above.
 */
export function SportsbookChip({ outcome, enabled, onPress }: { outcome: OddsOutcome; enabled: boolean; onPress: () => void }) {
  const book = enabled ? bookOf(outcome) : null;
  if (!book) return null;

  return (
    <button
      type="button"
      onClick={onPress}
      aria-label={`Open this pick at ${book.name}`}
      className="relative self-center w-9 h-9 shrink-0 flex items-center justify-center opacity-80 active:opacity-100"
    >
      <span
        className="rounded-full border border-border flex items-center justify-center font-extrabold text-white leading-none tracking-tight"
        style={{
          width: BUBBLE_PX,
          height: BUBBLE_PX,
          background: book.color,
          fontSize: initialsPx(book.abbrev, BUBBLE_PX),
        }}
      >
        {book.abbrev}
      </span>
      {/* Just outside the circle, in the theme's own text color: the pick leaving for that book. */}
      <ArrowUpRight size={12} strokeWidth={3.2} className="absolute top-0.5 right-0.5 text-text" />
    </button>
  );
}

/** What replaces the keypad once the chip is tapped: one clear button out, and the honest line about
 * whose odds apply, where someone will actually read it. Back returns to the keypad. */
export function SportsbookPrompt({ outcome, onBack }: { outcome: OddsOutcome; onBack: () => void }) {
  const book = bookOf(outcome);
  if (!book || !outcome.link) return null;

  return (
    <div className="space-y-2">
      <a
        href={outcome.link}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onBack}
        className="w-full h-[54px] flex items-center justify-center gap-2 rounded-xl border-2 text-base font-bold active:opacity-80"
        style={{ color: book.color, borderColor: book.color }}
      >
        <ArrowUpRight size={18} strokeWidth={2.5} />
        Open at {book.name}
      </a>
      <p className="text-[11px] text-text-muted text-center">
        {book.name} sets their own odds. Adding to your lineup is separate.
      </p>
      <button type="button" onClick={onBack} className="w-full h-9 text-xs font-semibold text-text-muted active:text-text">
        Back
      </button>
    </div>
  );
}
