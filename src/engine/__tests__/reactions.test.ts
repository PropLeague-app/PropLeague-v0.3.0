import { describe, expect, it } from 'vitest';
import { STACK_WIDTH, chipWidth, fitChips, gridEmojis, moveReactor, reactionGroups } from '../reactions';

describe('reactionGroups', () => {
  it('orders by how many teams used it, keeping first-come order on ties', () => {
    const g = reactionGroups({ '😂': ['a'], '🔥': ['b', 'c'], '💀': ['d'] });
    expect(g.map((x) => x.emoji)).toEqual(['🔥', '😂', '💀']);
    expect(g[0].count).toBe(2);
  });
  it('trusts the named reactors over a stale aggregate count', () => {
    const g = reactionGroups({ '😂': ['a'] }, { '🔥': 1, '😂': 1 });
    expect(g).toEqual([{ emoji: '😂', teamIds: ['a'], count: 1 }]);
    expect(reactionGroups({}, { '🔥': 3 })).toEqual([]);
  });
  it('uses the bare counts only when the reactors are not known at all', () => {
    expect(reactionGroups(undefined, { '🔥': 3, '😂': 0 })).toEqual([{ emoji: '🔥', teamIds: [], count: 3 }]);
  });
  it('is empty with nothing', () => {
    expect(reactionGroups()).toEqual([]);
  });
});

describe('fitChips', () => {
  const groups = reactionGroups({ '🔥': ['a', 'b', 'c'], '😂': ['d'], '💀': ['e'], '👏': ['f'], '🐐': ['g'] });
  it('shows everything when it all fits', () => {
    expect(fitChips(groups, 1000)).toEqual({ shown: groups, overflow: [] });
  });
  it('collapses the tail into a stack, leaving room for it', () => {
    const w = chipWidth(groups[0]) + 4 + chipWidth(groups[1]) + 4 + STACK_WIDTH;
    const { shown, overflow } = fitChips(groups, w);
    expect(shown.map((g) => g.emoji)).toEqual(['🔥', '😂']);
    expect(overflow.map((g) => g.emoji)).toEqual(['💀', '👏', '🐐']);
  });
  it('puts everything in the stack when not even one chip fits', () => {
    expect(fitChips(groups, STACK_WIDTH).shown).toEqual([]);
  });
});

describe('moveReactor', () => {
  it('adds a first reaction', () => {
    expect(moveReactor(undefined, 't1', '🔥')).toEqual({ '🔥': ['t1'] });
  });
  it('switches to a different emoji and drops an emptied one', () => {
    expect(moveReactor({ '🔥': ['t1'], '😂': ['t2'] }, 't1', '😂')).toEqual({ '😂': ['t2', 't1'] });
  });
  it('tapping the same emoji removes it', () => {
    expect(moveReactor({ '🔥': ['t1', 't2'] }, 't1', '🔥')).toEqual({ '🔥': ['t2'] });
  });
});

describe('gridEmojis', () => {
  const list = (n: number) => Array.from({ length: n }, (_, i) => i);
  it('leaves a list alone when the last row is not a lone emoji', () => {
    expect(gridEmojis(list(36))).toHaveLength(36);
    expect(gridEmojis(list(40))).toHaveLength(40);
    expect(gridEmojis(list(3))).toHaveLength(3);
  });
  it('drops a single trailing orphan', () => {
    expect(gridEmojis(list(37))).toHaveLength(36);
    expect(gridEmojis(list(73))).toHaveLength(72);
  });
  it('never ends on a row with just one emoji', () => {
    for (let n = 10; n < 400; n++) expect(gridEmojis(list(n)).length % 9).not.toBe(1);
  });
});
