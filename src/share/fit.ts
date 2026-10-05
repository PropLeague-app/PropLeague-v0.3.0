// Fits a list of rows into a fixed-height area. Rows grow up to `max` when there are few of them and
// shrink toward `min` as the list gets longer; past what fits at `min`, the rest collapse into a
// single "+N more" line. This is what lets one card design hold 1 pick or 40 and still fill the image.
export interface FitOptions {
  min: number;
  max: number;
  gap: number;
  /** Height reserved for the "+N more" line when rows have to be dropped. */
  moreH: number;
}

export interface FitResult {
  rowH: number;
  visible: number;
  hidden: number;
}

function heightFor(count: number, available: number, gap: number): number {
  if (count <= 0) return 0;
  return Math.floor((available - gap * (count - 1)) / count);
}

export function fitRows(count: number, available: number, opts: FitOptions): FitResult {
  if (count <= 0) return { rowH: opts.max, visible: 0, hidden: 0 };
  // Everything fits at or above the minimum height.
  if (heightFor(count, available, opts.gap) >= opts.min) {
    return { rowH: Math.min(opts.max, heightFor(count, available, opts.gap)), visible: count, hidden: 0 };
  }
  // Otherwise keep as many rows as fit at the minimum, leaving room for the "+N more" line.
  const room = available - opts.moreH - opts.gap;
  let visible = count;
  while (visible > 1 && heightFor(visible, room, opts.gap) < opts.min) visible -= 1;
  return {
    rowH: Math.min(opts.max, Math.max(opts.min, heightFor(visible, room, opts.gap))),
    visible,
    hidden: count - visible,
  };
}

export interface GrowOptions extends FitOptions {
  /** Height of the rows area at the card's minimum size. */
  baseArea: number;
  /** Row height once the list is too long to fit the base area. */
  growH: number;
  /** Most rows ever drawn; past this the rest become "+N more". */
  maxRows: number;
}

export interface GrowResult extends FitResult {
  /** Height the rows area needs. Equals baseArea unless the card had to grow. */
  area: number;
}

/** Like fitRows, but a long list makes the card taller instead of squeezing the rows: rows stay at
 * `growH` and the area grows to hold up to `maxRows` of them, then "+N more". A short list behaves
 * exactly like fitRows (rows stretch to fill the base area). */
export function layoutRows(count: number, o: GrowOptions): GrowResult {
  const n = Math.min(count, o.maxRows);
  const extra = count - n;
  if (n <= 0) return { rowH: o.max, visible: 0, hidden: 0, area: o.baseArea };
  if (extra === 0 && heightFor(n, o.baseArea, o.gap) >= o.growH) {
    const r = fitRows(n, o.baseArea, { min: o.growH, max: o.max, gap: o.gap, moreH: o.moreH });
    return { ...r, area: o.baseArea };
  }
  const more = extra > 0 ? o.moreH + o.gap : 0;
  const area = n * o.growH + (n - 1) * o.gap + more;
  return { rowH: o.growH, visible: n, hidden: extra, area: Math.max(area, o.baseArea) };
}
