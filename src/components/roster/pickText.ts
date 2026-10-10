import type { Wager } from '../../types';
import { MARKET_LABELS } from '../../data/propsGenerator';

/** "Matthew Stafford" -> "M. Stafford" (same rule as the Lineup cards). */
export function shortPlayerName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return name;
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`;
}

/**
 * The title of a held pick for the swap screens: "G. Smith Over 31.5", "Anytime TD" style for
 * a no-line prop, "Buccaneers -3.5" for a spread, "Eagles ML" for a moneyline.
 */
export function pickTitle(w: Pick<Wager, 'playerName' | 'side' | 'point' | 'marketKey'>): string {
  if (w.marketKey === 'h2h' || w.marketKey === 'spreads') {
    const team = w.side.trim().split(/\s+/).pop() ?? w.side;
    if (w.marketKey === 'h2h') return `${team} ML`;
    return w.point == null ? team : `${team} ${w.point > 0 ? '+' : ''}${w.point}`;
  }
  const who = w.playerName ? shortPlayerName(w.playerName) : '';
  const line = w.point != null ? `${w.side} ${w.point}` : w.side;
  return `${who} ${line}`.trim();
}

/** "Pass Attempts", "Spread", "Moneyline". */
export function pickMarket(w: Pick<Wager, 'marketKey'>): string {
  return MARKET_LABELS[w.marketKey] ?? '';
}
