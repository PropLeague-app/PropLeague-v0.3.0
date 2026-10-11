import { describe, it, expect } from 'vitest';
import { mergeBookmakersWithFallback, type RawBookmaker } from '../supabaseOdds';

/** Every book's lines are merged into one synthetic feed, so each outcome has to remember which
 * real book priced it. That stamp is what lets the bet slip name the book on its link. */
function feed(): RawBookmaker[] {
  return [
    {
      key: 'fanduel',
      title: 'FanDuel',
      markets: [
        { key: 'h2h', outcomes: [{ name: 'New York Giants', price: 150, link: 'https://fd.example/ml' }] },
        {
          key: 'player_reception_yds',
          outcomes: [
            { name: 'Over', description: 'Romeo Doubs', price: -110, point: 40.5, link: 'https://fd.example/doubs' },
            { name: 'Over', description: 'Only At FanDuel', price: -115, point: 20.5, link: 'https://fd.example/only' },
          ],
        },
      ],
    },
    {
      key: 'draftkings',
      title: 'DraftKings',
      markets: [
        { key: 'h2h', outcomes: [{ name: 'New York Giants', price: 145, link: 'https://dk.example/ml' }] },
        {
          key: 'player_reception_yds',
          outcomes: [{ name: 'Over', description: 'Romeo Doubs', price: -108, point: 39.5, link: 'https://dk.example/doubs' }],
        },
      ],
    },
  ];
}

const outcomesOf = (merged: RawBookmaker[], marketKey: string) =>
  merged[0].markets.find((m) => m.key === marketKey)?.outcomes ?? [];

describe('bookmaker deep links survive the merge', () => {
  it('keeps the preferred book on the lines it priced', () => {
    const merged = mergeBookmakersWithFallback(feed());
    const ml = outcomesOf(merged, 'h2h')[0];
    expect(ml.bookKey).toBe('draftkings');
    expect(ml.bookTitle).toBe('DraftKings');
    expect(ml.link).toBe('https://dk.example/ml');

    const doubs = outcomesOf(merged, 'player_reception_yds').find((o) => o.description === 'Romeo Doubs');
    expect(doubs?.bookKey).toBe('draftkings');
    expect(doubs?.point).toBe(39.5);
    expect(doubs?.link).toBe('https://dk.example/doubs');
  });

  it('stamps a filled-in line with the book that actually has it', () => {
    const merged = mergeBookmakersWithFallback(feed());
    const only = outcomesOf(merged, 'player_reception_yds').find((o) => o.description === 'Only At FanDuel');
    expect(only?.bookKey).toBe('fanduel');
    expect(only?.bookTitle).toBe('FanDuel');
    expect(only?.link).toBe('https://fd.example/only');
  });

  it('leaves an outcome with no link alone rather than inventing one', () => {
    const noLinks = feed().map((b) => ({
      ...b,
      markets: b.markets.map((m) => ({ ...m, outcomes: m.outcomes.map(({ link: _link, ...rest }) => rest) })),
    }));
    const ml = outcomesOf(mergeBookmakersWithFallback(noLinks), 'h2h')[0];
    expect(ml.link).toBeUndefined();
    expect(ml.bookKey).toBe('draftkings');
  });
});
