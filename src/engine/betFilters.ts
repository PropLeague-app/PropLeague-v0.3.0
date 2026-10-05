// Shared vocabulary for the Bets screen and the Stats screen: odds ranges, sort choices, and the
// preset a stat row hands to Bets when you tap it ("show me the bets behind this number").
import type { MarketKey, SlotPosition, WagerStatus, WeekId } from '../types';
import { weekOrder } from '../types';

export type OddsBucket = 'heavyFav' | 'favorite' | 'pickem' | 'underdog' | 'longshot';

export const ODDS_BUCKETS: OddsBucket[] = ['heavyFav', 'favorite', 'pickem', 'underdog', 'longshot'];

export const ODDS_BUCKET_LABELS: Record<OddsBucket, string> = {
  heavyFav: 'Heavy fav (−200 or shorter)',
  favorite: 'Favorite (−199 to −120)',
  pickem: 'Pick-em (−119 to +119)',
  underdog: 'Underdog (+120 to +249)',
  longshot: 'Longshot (+250 or longer)',
};

/** Which odds range an American price falls in. */
export function oddsBucket(odds: number): OddsBucket {
  if (odds <= -200) return 'heavyFav';
  if (odds <= -120) return 'favorite';
  if (odds < 120) return 'pickem';
  if (odds < 250) return 'underdog';
  return 'longshot';
}

export type StakeSize = 'small' | 'medium' | 'large';

export type BetSort = 'newest' | 'oldest' | 'biggestWin' | 'biggestLoss' | 'highestStake' | 'longestOdds' | 'week';

export const BET_SORT_OPTIONS: { value: BetSort; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'week', label: 'By week' },
  { value: 'biggestWin', label: 'Biggest win' },
  { value: 'biggestLoss', label: 'Biggest loss' },
  { value: 'highestStake', label: 'Highest stake' },
  { value: 'longestOdds', label: 'Longest odds' },
];

/** What a stat row passes along when tapped. Every field is optional; whatever is set becomes a
 * filter on the Bets screen (and a removable chip there). `team` is a team id or LEAGUE_VIEW_ID. */
export interface BetPreset {
  team?: string;
  market?: MarketKey;
  position?: SlotPosition;
  result?: WagerStatus;
  week?: string;
  oddsBucket?: OddsBucket;
  side?: 'over' | 'under';
  stake?: StakeSize;
  player?: string;
  /** Only bets that have settled, matching what a stat row counts. */
  settledOnly?: boolean;
}

/** The fields a sort needs from one bet. */
export interface SortableBet {
  placedAt: string;
  stake: number;
  odds: number;
  profit: number | null;
  week: WeekId;
}

/** Pending bets (no profit yet) always sink to the bottom of a profit sort. */
export function sortBets<T>(items: T[], sort: BetSort, get: (item: T) => SortableBet): T[] {
  const copy = [...items];
  const byPlaced = (a: SortableBet, b: SortableBet) => (a.placedAt < b.placedAt ? -1 : a.placedAt > b.placedAt ? 1 : 0);
  copy.sort((ia, ib) => {
    const a = get(ia);
    const b = get(ib);
    switch (sort) {
      case 'oldest':
        return byPlaced(a, b);
      case 'week':
        return weekOrder(b.week) - weekOrder(a.week) || byPlaced(b, a);
      case 'biggestWin':
      case 'biggestLoss': {
        if (a.profit == null && b.profit == null) return byPlaced(b, a);
        if (a.profit == null) return 1;
        if (b.profit == null) return -1;
        return (sort === 'biggestWin' ? b.profit - a.profit : a.profit - b.profit) || byPlaced(b, a);
      }
      case 'highestStake':
        return b.stake - a.stake || byPlaced(b, a);
      case 'longestOdds':
        return b.odds - a.odds || byPlaced(b, a);
      case 'newest':
      default:
        return byPlaced(b, a);
    }
  });
  return copy;
}

/** Human label for the chips that show an active preset on the Bets screen. */
export function stakeSizeLabel(size: StakeSize): string {
  return size === 'small' ? 'Small stake (< $10)' : size === 'medium' ? 'Medium stake ($10 to $25)' : 'Large stake (> $25)';
}
