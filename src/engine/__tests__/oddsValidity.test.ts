import { describe, it, expect } from 'vitest';
import { normalizeAmericanOdds } from '../oddsMath';
import { NFL_GAMES } from '../../data/seed';
import { getSlate } from '../../services/oddsService';

function isValidAmericanOdds(price: number): boolean {
  return price >= 100 || price <= -100;
}

function collectPrices(game: (typeof NFL_GAMES)[number]): number[] {
  const prices: number[] = [];
  for (const bookmaker of game.bookmakers) {
    for (const market of bookmaker.markets) {
      for (const outcome of market.outcomes) prices.push(outcome.price);
      if (market.altLines) {
        for (const alt of market.altLines) {
          for (const outcome of alt.outcomes) prices.push(outcome.price);
        }
      }
    }
  }
  return prices;
}

describe('normalizeAmericanOdds', () => {
  it('leaves already-valid odds untouched', () => {
    expect(normalizeAmericanOdds(-110)).toBe(-110);
    expect(normalizeAmericanOdds(150)).toBe(150);
    expect(normalizeAmericanOdds(100)).toBe(100);
    expect(normalizeAmericanOdds(-100)).toBe(-100);
  });

  it('maps a negative price inside the invalid gap to a positive equivalent (manual §5 #12 example)', () => {
    const result = normalizeAmericanOdds(-84);
    expect(result).toBeGreaterThanOrEqual(100);
  });

  it('maps a positive price inside the invalid gap to a negative equivalent', () => {
    const result = normalizeAmericanOdds(85);
    expect(result).toBeLessThanOrEqual(-100);
  });

  it('never emits a value strictly between -100 and 100', () => {
    for (let p = -300; p <= 300; p += 1) {
      const result = normalizeAmericanOdds(p);
      expect(isValidAmericanOdds(result)).toBe(true);
    }
  });
});

describe('odds sanity sweep (manual §5 #13)', () => {
  it('every generated main-line and alt-line price across the full mock slate is valid American odds', () => {
    let checked = 0;
    for (const game of NFL_GAMES) {
      for (const price of collectPrices(game)) {
        expect(isValidAmericanOdds(price)).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('every price stays valid after session line-movement drift is applied', () => {
    let checked = 0;
    for (const week of [1, 2, 3]) {
      const slate = getSlate(week, 1, true);
      for (const game of slate) {
        for (const price of collectPrices(game)) {
          expect(isValidAmericanOdds(price)).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});
