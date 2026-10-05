import type { LogoIdentity } from '../../types';
import { C, SHARE_BODY_H } from '../palette';
import { useTone } from '../useTone';
import { ShareFrame } from './ShareFrame';
import { ShareLogo } from './ShareLogo';
import { toneColor, type StatTile } from './StatsShareCard';

// The Markets, Trends and Matchups versions of the stats picture. Each tab is a stack of blocks
// (tiles, tables, a weekly bar chart); every block has a known height, so the picture is exactly as
// tall as its content, never shorter than the standard 4:5.

export interface ShareCell {
  text: string;
  /** A P/L amount: colors the text green, or red (or scaled) for a loss. */
  amount?: number;
  /** Reference loss for scaled coloring of `amount`. */
  ref?: number;
  muted?: boolean;
}

export interface TableRow {
  label: string;
  logo?: { identity: LogoIdentity | null; initials: string };
  cells: ShareCell[];
}

export type TabBlock =
  | { kind: 'tiles'; tiles: StatTile[]; cols: 2 | 3 }
  | { kind: 'highlights'; items: Highlight[] }
  | { kind: 'table'; title: string; heads: string[]; rows: TableRow[] }
  | { kind: 'bars'; title: string; weeks: { label: string; pl: number }[] };

/** One headline fact: a small caption, the name of the thing, and its P/L. */
export interface Highlight {
  label: string;
  name: string;
  value: string;
  /** P/L amount to color the value by. */
  amount?: number;
  ref?: number;
  /** Small note next to the value, like a record. */
  sub?: string;
}

export interface StatsTabCardData {
  leagueName: string;
  title: string;
  subtitle?: string;
  blocks: TabBlock[];
}

const BLOCK_GAP = 20;
const TILE_H = 120;
const TILE_GAP = 14;
const TABLE_PAD = 18;
const TABLE_TITLE_H = 46;
const TABLE_HEAD_H = 36;
const TABLE_ROW_H = 56;
const HL_H = 150;
const HL_GAP = 14;
const BARS_PAD = 22;
const BARS_TITLE_H = 44;
/** Height of the bar area (above plus below the baseline), shared out by how big each side's tallest bar is. */
const BARS_CHART_H = 220;
const BARS_VALUE_H = 32;
const BARS_LABEL_H = 34;
/** Past this many weeks the bars get too narrow for amounts above them. */
const BARS_MAX_LABELED = 8;
const COL_W = [170, 190, 130];

function barsDims(weeks: { pl: number }[]) {
  const posMax = Math.max(0, ...weeks.map((w) => w.pl));
  const negMax = Math.max(0, ...weeks.map((w) => -w.pl));
  const total = posMax + negMax;
  if (total <= 0) return { posMax, negMax, posH: BARS_CHART_H / 2, negH: BARS_CHART_H / 2 };
  // Each side gets room in proportion to its biggest bar, but never so little a bar disappears.
  const posH = negMax === 0 ? BARS_CHART_H : posMax === 0 ? 0 : Math.max(40, Math.min(BARS_CHART_H - 40, Math.round((BARS_CHART_H * posMax) / total)));
  return { posMax, negMax, posH, negH: BARS_CHART_H - posH };
}

export function blockHeight(b: TabBlock): number {
  if (b.kind === 'tiles') {
    const rows = Math.ceil(b.tiles.length / b.cols);
    return rows * TILE_H + (rows - 1) * TILE_GAP;
  }
  if (b.kind === 'highlights') {
    const rows = Math.ceil(b.items.length / 2);
    return rows * HL_H + (rows - 1) * HL_GAP;
  }
  if (b.kind === 'table') return TABLE_PAD * 2 + TABLE_TITLE_H + TABLE_HEAD_H + b.rows.length * TABLE_ROW_H;
  const d = barsDims(b.weeks);
  return BARS_PAD * 2 + BARS_TITLE_H + d.posH + BARS_VALUE_H + 2 + d.negH + BARS_VALUE_H + BARS_LABEL_H;
}

/** Height the card's body needs for these blocks. */
export function tabBodyHeight(blocks: TabBlock[]): number {
  return blocks.reduce((sum, b) => sum + blockHeight(b), 0) + BLOCK_GAP * Math.max(0, blocks.length - 1);
}

const panel = {
  background: C.card,
  border: `2px solid ${C.border}`,
  borderRadius: 22,
  boxSizing: 'border-box' as const,
};

function Tiles({ block }: { block: Extract<TabBlock, { kind: 'tiles' }> }) {
  const tone = useTone();
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${block.cols}, 1fr)`, gridAutoRows: TILE_H, gap: TILE_GAP }}>
      {block.tiles.map((t) => (
        <div key={t.label} style={{ ...panel, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '0 8px' }}>
          <div style={{ fontSize: 40, fontWeight: 800, color: t.amount != null ? tone(t.amount, t.ref) : toneColor(t.tone), whiteSpace: 'nowrap' }}>{t.value}</div>
          <div style={{ fontSize: 21, color: C.muted, letterSpacing: 1, whiteSpace: 'nowrap' }}>{t.label}</div>
        </div>
      ))}
    </div>
  );
}

function Highlights({ block }: { block: Extract<TabBlock, { kind: 'highlights' }> }) {
  const tone = useTone();
  const odd = block.items.length % 2 === 1;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gridAutoRows: HL_H, gap: HL_GAP }}>
      {block.items.map((h, i) => (
        <div
          key={h.label}
          style={{
            ...panel,
            gridColumn: odd && i === block.items.length - 1 ? '1 / -1' : undefined,
            padding: '0 26px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            gap: 6,
            minWidth: 0,
          }}
        >
          <div style={{ fontSize: 20, letterSpacing: 2, color: C.muted, whiteSpace: 'nowrap' }}>{h.label}</div>
          <div style={{ fontSize: 32, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.name}</div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span style={{ fontSize: 40, fontWeight: 800, whiteSpace: 'nowrap', color: h.amount != null ? tone(h.amount, h.ref) : C.text }}>{h.value}</span>
            {h.sub && <span style={{ fontSize: 22, color: C.muted, whiteSpace: 'nowrap' }}>{h.sub}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function Table({ block }: { block: Extract<TabBlock, { kind: 'table' }> }) {
  const tone = useTone();
  const cols = COL_W.slice(COL_W.length - block.heads.length);
  return (
    <div style={{ ...panel, height: blockHeight(block), padding: `${TABLE_PAD}px 28px`, display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: TABLE_TITLE_H, fontSize: 28, fontWeight: 800, display: 'flex', alignItems: 'center' }}>{block.title}</div>
      <div style={{ height: TABLE_HEAD_H, display: 'flex', alignItems: 'center', gap: 14, fontSize: 20, letterSpacing: 1, color: C.muted, borderBottom: `2px solid ${C.border}` }}>
        <span style={{ flex: 1 }} />
        {block.heads.map((h, i) => (
          <span key={h} style={{ width: cols[i], textAlign: 'right' }}>
            {h}
          </span>
        ))}
      </div>
      {block.rows.map((r, ri) => (
        <div
          key={`${r.label}-${ri}`}
          style={{
            height: TABLE_ROW_H,
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            borderBottom: ri === block.rows.length - 1 ? 'none' : `1px solid ${C.border}`,
          }}
        >
          {r.logo && <ShareLogo identity={r.logo.identity} initials={r.logo.initials} size={40} />}
          <span style={{ flex: 1, minWidth: 0, fontSize: 28, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.label}</span>
          {r.cells.map((c, ci) => (
            <span
              key={ci}
              style={{
                width: cols[ci],
                textAlign: 'right',
                fontSize: 26,
                fontWeight: c.amount != null ? 800 : 500,
                whiteSpace: 'nowrap',
                color: c.amount != null ? tone(c.amount, c.ref) : c.muted ? C.muted : C.text,
              }}
            >
              {c.text}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

function Bars({ block }: { block: Extract<TabBlock, { kind: 'bars' }> }) {
  const tone = useTone();
  const d = barsDims(block.weeks);
  const n = Math.max(1, block.weeks.length);
  const barW = Math.max(18, Math.min(84, Math.floor(912 / n) - 18));
  const labeled = n <= BARS_MAX_LABELED;
  const short = (v: number) => `${v < 0 ? '-' : '+'}$${Math.round(Math.abs(v))}`;
  const colStyle = { width: barW + 18, display: 'flex', flexDirection: 'column' as const, alignItems: 'center' };
  return (
    <div style={{ ...panel, height: blockHeight(block), padding: `${BARS_PAD}px 28px`, display: 'flex', flexDirection: 'column' }}>
      <div style={{ height: BARS_TITLE_H, fontSize: 28, fontWeight: 800, display: 'flex', alignItems: 'center' }}>{block.title}</div>
      <div style={{ display: 'flex', justifyContent: 'space-around' }}>
        {block.weeks.map((w, i) => {
          const scale = w.pl >= 0 ? (d.posMax > 0 ? d.posH / d.posMax : 0) : d.negMax > 0 ? d.negH / d.negMax : 0;
          const h = Math.max(6, Math.round(Math.abs(w.pl) * scale));
          const color = w.pl >= 0 ? C.profit : tone(w.pl);
          return (
            <div key={i} style={colStyle}>
              <div style={{ height: d.posH + BARS_VALUE_H, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'center' }}>
                {w.pl >= 0 && labeled && <div style={{ height: BARS_VALUE_H, fontSize: 22, fontWeight: 800, color, display: 'flex', alignItems: 'center' }}>{short(w.pl)}</div>}
                {w.pl >= 0 && <div style={{ width: barW, height: Math.min(h, d.posH), borderRadius: '8px 8px 0 0', background: C.profit }} />}
              </div>
              <div style={{ width: '100%', height: 2, background: C.border }} />
              <div style={{ height: d.negH + BARS_VALUE_H, display: 'flex', flexDirection: 'column', justifyContent: 'flex-start', alignItems: 'center' }}>
                {w.pl < 0 && <div style={{ width: barW, height: Math.min(h, d.negH), borderRadius: '0 0 8px 8px', background: C.loss }} />}
                {w.pl < 0 && labeled && <div style={{ height: BARS_VALUE_H, fontSize: 22, fontWeight: 800, color: C.loss, display: 'flex', alignItems: 'center' }}>{short(w.pl)}</div>}
              </div>
              <div style={{ height: BARS_LABEL_H, fontSize: 20, color: C.muted, display: 'flex', alignItems: 'center' }}>{w.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One stats tab as a picture (Markets, Trends or Matchups). */
export function StatsTabShareCard({ leagueName, title, subtitle, blocks }: StatsTabCardData) {
  const body = tabBodyHeight(blocks);
  return (
    <ShareFrame leagueName={leagueName} title={title} subtitle={subtitle} bodyHeight={body}>
      <div
        style={{
          height: Math.max(SHARE_BODY_H, body),
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-start',
          gap: BLOCK_GAP,
        }}
      >
        {blocks.map((b, i) => {
          if (b.kind === 'tiles') return <Tiles key={i} block={b} />;
          if (b.kind === 'highlights') return <Highlights key={i} block={b} />;
          if (b.kind === 'table') return <Table key={i} block={b} />;
          return <Bars key={i} block={b} />;
        })}
      </div>
    </ShareFrame>
  );
}
