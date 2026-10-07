import { layoutRows } from '../fit';
import type { LogoIdentity } from '../../types';
import { C, POS_COLOR, SHARE_BODY_H, STATUS_COLOR, STATUS_LETTER, clamp, signedMoney, tint, type ShareStatus } from '../palette';
import { useTone } from '../useTone';
import { ShareFrame } from './ShareFrame';
import { ShareFlames } from './ShareFlames';
import { ShareLogo } from './ShareLogo';

export interface MatchupSide {
  name: string;
  initials: string;
  identity: LogoIdentity | null;
  score: number;
  /** An opponent's score is withheld while their picks are hidden. */
  scoreHidden?: boolean;
  /** e.g. "3-1 · 4 open". */
  progress: string;
  perfect: boolean;
}

export interface MatchupCell {
  kind: 'pick' | 'empty' | 'hidden';
  name?: string;
  line?: string;
  status?: ShareStatus;
  profit?: number | null;
}

export interface MatchupRow {
  position: string;
  a: MatchupCell;
  b: MatchupCell;
}

/** Room above the logos for a perfect week's flames. */
const FLAME_ROOM = 62;
const HEAD_H = 340;
const LOGO = 116;
const MIN_ROW_H = 60;
const MAX_ROWS = 30;
const ROW_GAP = 10;

function Cell({ cell, right, h }: { cell: MatchupCell; right: boolean; h: number }) {
  const box = {
    height: h,
    minWidth: 0,
    boxSizing: 'border-box' as const,
    borderRadius: 18,
    border: `2px solid ${C.border}`,
    background: C.card,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '0 16px',
    flexDirection: right ? ('row-reverse' as const) : ('row' as const),
    textAlign: right ? ('right' as const) : ('left' as const),
  };
  if (cell.kind !== 'pick') {
    return (
      <div style={{ ...box, justifyContent: 'center', color: C.muted, fontSize: clamp(h * 0.3, 20, 28), background: tint(C.card, 50) }}>
        {cell.kind === 'hidden' ? 'Hidden until kickoff' : 'Empty'}
      </div>
    );
  }
  const status = cell.status ?? 'pending';
  const color = STATUS_COLOR[status];
  const settled = status === 'won' || status === 'lost' || status === 'push' || status === 'voided';
  const result =
    settled && cell.profit != null && status !== 'voided' && status !== 'push' ? signedMoney(cell.profit) : STATUS_LETTER[status];
  return (
    <div style={box}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: clamp(h * 0.3, 22, 32), fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cell.name}</div>
        <div style={{ fontSize: clamp(h * 0.22, 17, 24), color: C.muted, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cell.line}</div>
      </div>
      <div style={{ fontSize: clamp(h * 0.27, 20, 28), fontWeight: 800, color, whiteSpace: 'nowrap', flexShrink: 0 }}>{result}</div>
    </div>
  );
}

function Team({
  side,
  winner,
  loser,
  plRef,
}: {
  side: MatchupSide;
  winner: boolean;
  loser: boolean;
  plRef?: number;
}) {
  const tone = useTone();
  const scoreColor = side.scoreHidden ? C.muted : side.perfect ? C.goldText : tone(side.score, plRef);
  // A soft gold glow that fades out on every side before the column's edge (no visible box).
  const wash = side.perfect
    ? 'radial-gradient(ellipse closest-side at 50% 52%, rgba(var(--pl-gold, 244, 190, 70), calc(var(--pl-wash-a, 0.2) * 1.5)) 0%, rgba(var(--pl-gold, 244, 190, 70), calc(var(--pl-wash-a, 0.2) * 0.6)) 55%, rgba(var(--pl-gold, 244, 190, 70), 0) 100%)'
    : undefined;
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        height: '100%',
        boxSizing: 'border-box',
        paddingTop: FLAME_ROOM,
        background: wash,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        opacity: loser ? 0.65 : 1,
      }}
    >
      <div style={{ position: 'relative' }}>
        <ShareFlames active={side.perfect} size={LOGO}>
          <ShareLogo identity={side.identity} initials={side.initials} size={LOGO} />
        </ShareFlames>
        {winner && (
          <div style={{ position: 'absolute', right: -14, bottom: -6, background: C.gold, color: '#1b1500', fontSize: 18, fontWeight: 800, borderRadius: 999, padding: '3px 10px' }}>
            WIN
          </div>
        )}
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, maxWidth: 360, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{side.name}</div>
      <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1, color: scoreColor, whiteSpace: 'nowrap' }}>{side.scoreHidden ? '$–' : signedMoney(side.score)}</div>
      <div style={{ fontSize: 20, color: side.perfect ? C.goldText : C.muted, whiteSpace: 'nowrap' }}>{side.perfect ? 'PERFECT WEEK' : side.progress}</div>
    </div>
  );
}

/** Head-to-head: both teams with their scores up top, then every slot side by side with its position
 * in the middle. Rows resize to fit however many slots the league uses. Picks a viewer cannot see
 * (hidden until kickoff) stay hidden here too. */
export function MatchupShareCard({
  leagueName,
  weekText,
  statusText,
  a,
  b,
  winner,
  rows,
  plRef,
}: {
  leagueName: string;
  weekText: string;
  statusText: string;
  a: MatchupSide;
  b: MatchupSide;
  winner: 'a' | 'b' | 'tie' | null;
  rows: MatchupRow[];
  /** Reference loss for scaled P/L coloring (same one the matchup screen uses). */
  plRef?: number;
}) {
  // Up to a normal league's slots fill the 4:5 picture; more slots make it taller.
  const fit = layoutRows(rows.length, {
    baseArea: SHARE_BODY_H - HEAD_H - 24,
    growH: MIN_ROW_H,
    min: MIN_ROW_H,
    max: 100,
    gap: ROW_GAP,
    moreH: 44,
    maxRows: MAX_ROWS,
  });
  const area = fit.area;
  const h = fit.rowH;
  return (
    <ShareFrame leagueName={leagueName} title="Matchup" subtitle={`${weekText} · ${statusText}`} bodyHeight={HEAD_H + 24 + area}>
      <div style={{ height: HEAD_H, display: 'flex', alignItems: 'stretch', gap: 12 }}>
        <Team side={a} winner={winner === 'a'} loser={winner === 'b'} plRef={plRef} />
        <div style={{ width: 90, alignSelf: 'center', textAlign: 'center', fontSize: 30, fontWeight: 800, color: C.muted }}>VS</div>
        <Team side={b} winner={winner === 'b'} loser={winner === 'a'} plRef={plRef} />
      </div>
      <div style={{ height: area, marginTop: 24, display: 'flex', flexDirection: 'column', gap: ROW_GAP }}>
        {rows.slice(0, fit.visible).map((r, i) => (
          <div key={i} style={{ height: h, flexShrink: 0, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 88px minmax(0,1fr)', gap: 10, alignItems: 'center' }}>
            <Cell cell={r.a} right={false} h={h} />
            <div
              style={{
                justifySelf: 'center',
                width: 74,
                height: 40,
                borderRadius: 999,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                fontWeight: 800,
                color: POS_COLOR[r.position] ?? C.primary,
                border: `3px solid ${POS_COLOR[r.position] ?? C.primary}`,
                boxSizing: 'border-box',
              }}
            >
              {r.position}
            </div>
            <Cell cell={r.b} right h={h} />
          </div>
        ))}
        {fit.hidden > 0 && (
          <div style={{ height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, color: C.muted, fontWeight: 700 }}>
            +{fit.hidden} more slot{fit.hidden === 1 ? '' : 's'}
          </div>
        )}
      </div>
    </ShareFrame>
  );
}
