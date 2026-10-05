import { Flame } from 'lucide-react';
import type { LogoIdentity } from '../../types';
import { layoutRows } from '../fit';
import { C, SHARE_BODY_H, clamp, tint } from '../palette';
import { useTone } from '../useTone';
import { ShareFrame } from './ShareFrame';
import { ShareLogo } from './ShareLogo';

export interface LeaderRow {
  /** Null for lists that are not ranked (specialists). */
  rank: number | null;
  name: string;
  /** Small line under the name, like "5-2-0 · 7 picks". */
  sub?: string;
  /** Team or league logo; leave out for player rows. */
  logo?: { identity: LogoIdentity | null; initials: string };
  /** Position or market label shown as a chip where the logo would be. */
  tag?: { text: string; color: string; /** Fixed chip width so a column of chips lines up. */ width?: number };
  /** The signed-in person's team: highlighted like on screen. */
  isUser?: boolean;
  flame?: boolean;
  value: string;
  /** A P/L amount to color the value by (green, red, or scaled). */
  amount?: number;
  /** Reference loss for scaled coloring of `amount`. */
  ref?: number;
  /** Gold value text (perfect weeks). */
  gold?: boolean;
}

const ROW_GAP = 12;
const MIN_ROW_H = 88;
const MAX_ROWS = 30;

function RankChip({ rank, size }: { rank: number; size: number }) {
  // Gold, silver, bronze for the podium, same as on screen; plain number after that.
  const podium =
    rank === 1
      ? { background: 'rgba(var(--pl-gold, 244, 190, 70), 0.28)', color: C.goldText }
      : rank === 2
        ? { background: 'rgba(148, 163, 184, 0.28)', color: C.text }
        : rank === 3
          ? { background: 'rgba(205, 127, 50, 0.28)', color: 'var(--pl-loss-mid, #f5944a)' }
          : { background: 'transparent', color: C.muted };
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.46,
        fontWeight: 800,
        ...podium,
      }}
    >
      {rank}
    </div>
  );
}

/** One leaderboard as a picture: ranked rows with logos, the signed-in team highlighted, perfect-week
 * teams marked with a flame. A short board fills the 4:5 picture with roomy rows; a long one keeps
 * the rows readable and makes the picture taller. */
export function LeaderboardShareCard({
  leagueName,
  title,
  subtitle,
  rows,
  emptyText = 'Nothing to rank yet.',
}: {
  leagueName: string;
  title: string;
  subtitle?: string;
  rows: LeaderRow[];
  emptyText?: string;
}) {
  const tone = useTone();
  const fit = layoutRows(rows.length, {
    baseArea: SHARE_BODY_H,
    growH: MIN_ROW_H,
    min: MIN_ROW_H,
    max: 124,
    gap: ROW_GAP,
    moreH: 52,
    maxRows: MAX_ROWS,
  });
  const h = fit.rowH;
  const shown = rows.slice(0, fit.visible);
  const nameSize = clamp(h * 0.34, 28, 40);
  const subSize = clamp(h * 0.22, 20, 26);
  const valueSize = clamp(h * 0.38, 30, 46);
  const logo = clamp(h * 0.62, 56, 76);
  const rank = clamp(h * 0.56, 48, 64);

  return (
    <ShareFrame leagueName={leagueName} title={title} subtitle={subtitle} bodyHeight={fit.area}>
      <div style={{ height: fit.area, display: 'flex', flexDirection: 'column', gap: ROW_GAP, justifyContent: fit.area === SHARE_BODY_H && rows.length > 0 ? 'center' : 'flex-start' }}>
        {rows.length === 0 && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 30, color: C.muted }}>{emptyText}</div>
        )}
        {shown.map((r, i) => (
          <div
            key={`${r.name}-${i}`}
            style={{
              height: h,
              flexShrink: 0,
              boxSizing: 'border-box',
              display: 'flex',
              alignItems: 'center',
              gap: 18,
              padding: '0 28px 0 18px',
              borderRadius: 24,
              background: r.isUser ? tint(C.primary, 12) : C.card,
              border: `2px solid ${r.isUser ? tint(C.primary, 55) : C.border}`,
            }}
          >
            {r.rank != null && <RankChip rank={r.rank} size={rank} />}
            {r.tag && (
              <div
                style={{
                  minWidth: 74,
                  width: r.tag.width,
                  height: 44,
                  padding: '0 14px',
                  boxSizing: 'border-box',
                  borderRadius: 999,
                  border: `3px solid ${r.tag.color}`,
                  color: r.tag.color,
                  fontSize: 22,
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {r.tag.text}
              </div>
            )}
            {r.logo && <ShareLogo identity={r.logo.identity} initials={r.logo.initials} size={logo} />}
            <div style={{ flex: 1, minWidth: 0, marginLeft: r.logo ? -4 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span
                  style={{
                    fontSize: nameSize,
                    fontWeight: 800,
                    color: r.isUser ? C.primary : C.text,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {r.name}
                </span>
                {r.flame && <Flame size={nameSize * 0.8} color={C.warning} fill={C.warning} style={{ flexShrink: 0 }} />}
              </div>
              {r.sub && (
                <div style={{ fontSize: subSize, color: C.muted, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.sub}</div>
              )}
            </div>
            <div
              style={{
                flexShrink: 0,
                fontSize: valueSize,
                fontWeight: 800,
                whiteSpace: 'nowrap',
                color: r.gold ? C.goldText : r.amount != null ? tone(r.amount, r.ref) : C.text,
              }}
            >
              {r.value}
            </div>
          </div>
        ))}
        {fit.hidden > 0 && (
          <div style={{ height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, color: C.muted, fontWeight: 700 }}>
            +{fit.hidden} more
          </div>
        )}
      </div>
    </ShareFrame>
  );
}
