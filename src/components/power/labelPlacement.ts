/** Place N labels as near as possible to where they want to be, without overlapping, inside bounds.
 *
 * The naive version walks down the list pushing each label below the previous one. That fails two
 * ways at once, both visible on an eight-team season (see chat, Oct 2026): it can only ever push
 * downward, so a crowd near the top is shunted to the bottom while the space above it stays empty,
 * and when it reaches the floor it has nowhere left to go and labels pile up on each other.
 *
 * This solves the real problem instead. Labels that would collide are merged into a block, and the
 * block is placed at the position that minimises how far its members move, which lets a crowd
 * spread in both directions around where it actually belongs. Blocks are clamped to the bounds and
 * re-merged until nothing overlaps, so the floor pushes back up rather than swallowing labels.
 *
 * For one block of n labels ending up at `start, start + gap, ..., start + (n-1) * gap`, the total
 * squared displacement is smallest at `start = mean(desired[k] - k * gap)`, which is what `sum`
 * tracks.
 *
 * Returns the placed position for each input, in the input's own order.
 */
export function placeLabels(desired: number[], gap: number, min: number, max: number): number[] {
  const n = desired.length;
  if (n === 0) return [];

  // If they cannot all fit at the asked-for spacing, tighten it rather than overlap.
  const fit = n > 1 ? Math.min(gap, (max - min) / (n - 1)) : gap;

  const order = desired.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);

  interface Block {
    /** Running total of (desired - localIndex * gap), so start = sum / count. */
    sum: number;
    count: number;
    items: number[];
  }

  const place = (b: Block) => {
    const ideal = b.sum / b.count;
    const highest = max - (b.count - 1) * fit;
    return Math.max(min, Math.min(ideal, highest));
  };

  const blocks: Block[] = [];
  for (const { y, i } of order) {
    let block: Block = { sum: y, count: 1, items: [i] };
    // Merge backwards while this block would start before the previous one ends.
    while (blocks.length > 0) {
      const prev = blocks[blocks.length - 1];
      const prevEnd = place(prev) + (prev.count - 1) * fit;
      if (place(block) >= prevEnd + fit - 1e-9) break;
      blocks.pop();
      block = {
        // Shifting this block's members down by prev.count positions costs that many gaps each.
        sum: prev.sum + block.sum - prev.count * fit * block.count,
        count: prev.count + block.count,
        items: [...prev.items, ...block.items],
      };
    }
    blocks.push(block);
  }

  const out: number[] = Array.from({ length: n }, () => 0);
  for (const block of blocks) {
    const start = place(block);
    block.items.forEach((item, k) => {
      out[item] = start + k * fit;
    });
  }
  return out;
}
