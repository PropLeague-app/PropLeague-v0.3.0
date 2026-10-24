import { describe, it, expect } from 'vitest';
import { bookmakersForRun, hasKickedOff, mergeBookmakers, type BookmakerRow } from '../../../../supabase/functions/_shared/gameOdds';

const NOW = Date.parse('2026-10-19T00:30:00Z');

const book = (key: string, markets: BookmakerRow['markets']): BookmakerRow => ({ key, title: key, markets });
const h2h = (home: number, away: number) => ({
  key: 'h2h',
  outcomes: [
    { name: 'Chicago Bears', price: home },
    { name: 'New England Patriots', price: away },
  ],
});
const prop = { key: 'player_pass_yds', outcomes: [{ name: 'Over', price: -110, point: 245.5 }] };

describe('hasKickedOff', () => {
  it('is false before kickoff while upcoming', () => {
    expect(hasKickedOff('2026-10-19T00:31:00Z', 'upcoming', NOW)).toBe(false);
  });
  it('is true at and after kickoff', () => {
    expect(hasKickedOff('2026-10-19T00:30:00Z', 'upcoming', NOW)).toBe(true);
    expect(hasKickedOff('2026-10-18T17:00:00Z', 'upcoming', NOW)).toBe(true);
  });
  it('is true when another feed already marked the game live or final', () => {
    expect(hasKickedOff('2026-10-19T03:00:00Z', 'live', NOW)).toBe(true);
    expect(hasKickedOff('2026-10-19T03:00:00Z', 'final', NOW)).toBe(true);
  });
  it('falls back to status when the kickoff string is unreadable', () => {
    expect(hasKickedOff('not a date', 'upcoming', NOW)).toBe(false);
    expect(hasKickedOff('not a date', undefined, NOW)).toBe(false);
  });
});

describe('bookmakersForRun', () => {
  const pregame = [book('draftkings', [h2h(-180, 150), prop])];
  const inPlay = [book('draftkings', [h2h(-427, 320)])];

  it('merges fresh prices before kickoff, keeping stored props', () => {
    const out = bookmakersForRun(pregame, [book('draftkings', [h2h(-200, 165)])], false);
    expect(out[0].markets).toEqual([h2h(-200, 165), prop]);
  });

  it('keeps the stored pre-kickoff line once the game has started', () => {
    expect(bookmakersForRun(pregame, inPlay, true)).toBe(pregame);
  });

  it('stores nothing for a game first seen after kickoff', () => {
    expect(bookmakersForRun(undefined, inPlay, true)).toEqual([]);
  });

  it('creates a new pre-kickoff game from the fresh feed', () => {
    expect(bookmakersForRun(undefined, inPlay, false)).toEqual(inPlay);
  });
});

describe('mergeBookmakers', () => {
  it('keeps a book that dropped out of the fresh feed, with its props', () => {
    const out = mergeBookmakers([book('fanduel', [h2h(-150, 130), prop])], [book('draftkings', [h2h(-160, 140)])]);
    expect(out.map((b) => b.key).sort()).toEqual(['draftkings', 'fanduel']);
    expect(out.find((b) => b.key === 'fanduel')!.markets).toEqual([prop]);
  });
});
