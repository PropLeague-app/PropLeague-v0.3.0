import { describe, expect, it } from 'vitest';
import { fitRows, layoutRows } from '../fit';

const OPTS = { min: 90, max: 190, gap: 14, moreH: 48 };

describe('fitRows', () => {
  it('lets a single row grow to the maximum height', () => {
    expect(fitRows(1, 736, OPTS)).toEqual({ rowH: 190, visible: 1, hidden: 0 });
  });

  it('shrinks rows as the list grows but keeps them all', () => {
    const r = fitRows(6, 736, OPTS);
    expect(r.visible).toBe(6);
    expect(r.hidden).toBe(0);
    expect(r.rowH).toBeGreaterThanOrEqual(90);
    expect(r.rowH * 6 + 14 * 5).toBeLessThanOrEqual(736);
  });

  it('collapses the overflow into a "+N more" line and still fits the area', () => {
    const r = fitRows(30, 736, OPTS);
    expect(r.hidden).toBeGreaterThan(0);
    expect(r.visible + r.hidden).toBe(30);
    expect(r.rowH).toBeGreaterThanOrEqual(90);
    expect(r.rowH * r.visible + 14 * (r.visible - 1) + 14 + 48).toBeLessThanOrEqual(736);
  });

  it('handles an empty list', () => {
    expect(fitRows(0, 736, OPTS).visible).toBe(0);
  });
});

const GROW = { min: 104, max: 190, gap: 14, moreH: 52, baseArea: 756, growH: 104, maxRows: 30 };

describe('layoutRows', () => {
  it('acts like fitRows while the list fits the base area', () => {
    const r = layoutRows(3, GROW);
    expect(r.area).toBe(756);
    expect(r.visible).toBe(3);
    expect(r.hidden).toBe(0);
    expect(r.rowH).toBeGreaterThanOrEqual(104);
    expect(r.rowH * 3 + 14 * 2).toBeLessThanOrEqual(756);
  });

  it('grows the area instead of squeezing rows once the base area is full', () => {
    const r = layoutRows(12, GROW);
    expect(r.rowH).toBe(104);
    expect(r.visible).toBe(12);
    expect(r.hidden).toBe(0);
    expect(r.area).toBe(12 * 104 + 11 * 14);
    expect(r.area).toBeGreaterThan(756);
  });

  it('caps at maxRows and adds room for the "+N more" line', () => {
    const r = layoutRows(45, GROW);
    expect(r.visible).toBe(30);
    expect(r.hidden).toBe(15);
    expect(r.area).toBe(30 * 104 + 29 * 14 + 52 + 14);
  });

  it('handles an empty list', () => {
    expect(layoutRows(0, GROW)).toMatchObject({ visible: 0, hidden: 0, area: 756 });
  });
});
