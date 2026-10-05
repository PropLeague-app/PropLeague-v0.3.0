import { formatCents } from '../../engine/oddsMath';
import { layoutRows } from '../fit';
import { C, POS_COLOR, SHARE_BODY_H, STATUS_COLOR, STATUS_LABEL, clamp, signedMoney, tint, type ShareStatus } from '../palette';
import { ShareFrame } from './ShareFrame';

export interface SlipRow {
  id: string;
  position: string;
  name: string;
  line: string;
  /** Whose pick it is, shown only when the slip mixes teams (league view). */
  who?: string | null;
  status: ShareStatus;
  stake: number;
  oddsText: string;
  profit: number | null;
}

export interface SlipTotals {
  record: string;
  /** Voided picks on the slip. They are not in the record (no win, loss or push), so they get their own mention. */
  voids?: number;
  wagered: number;
  /** Null until at least one pick on the slip has settled. */
  net: number | null;
}

const TOTALS_H = 170;
const ROW_GAP = 14;
/** Rows never get shorter than this: past what fits the 4:5 picture, the picture grows taller
 * instead (like a long parlay slip), up to this many picks, then "+N more". */
const MIN_ROW_H = 104;
export const MAX_SLIP_ROWS = 20;
/** A slip this short is drawn at its natural size instead of stretched to 4:5, so a single bet is a compact card. */
const COMPACT_MAX = 5;

/** A bet slip: one pick or a whole filtered list. A few picks fill a 4:5 picture with big rows; as
 * picks are added the rows settle at a readable height and the picture gets taller. */
export function SlipShareCard({
  leagueName,
  title,
  subtitle,
  rows,
  totals,
}: {
  leagueName: string;
  title: string;
  subtitle?: string;
  rows: SlipRow[];
  totals: SlipTotals;
}) {
  const compact = rows.length > 0 && rows.length <= COMPACT_MAX;
  const compactH = rows.length === 1 ? 180 : rows.length <= 3 ? 150 : 130;
  const fit = compact
    ? { rowH: compactH, visible: rows.length, hidden: 0, area: rows.length * compactH + (rows.length - 1) * ROW_GAP }
    : layoutRows(rows.length, {
        baseArea: SHARE_BODY_H - TOTALS_H - 24,
        growH: MIN_ROW_H,
        min: MIN_ROW_H,
        max: 190,
        gap: ROW_GAP,
        moreH: 52,
        maxRows: MAX_SLIP_ROWS,
      });
  const area = fit.area;
  const single = rows.length === 1 ? rows[0] : null;
  const shown = rows.slice(0, fit.visible);
  const h = fit.rowH;
  const nameSize = clamp(h * 0.27, 26, 44);
  const lineSize = clamp(h * 0.19, 20, 30);
  const resultSize = clamp(h * 0.3, 28, 50);
  const smallSize = clamp(h * 0.17, 19, 26);
  const badge = clamp(h * 0.5, 50, 84);

  return (
    <ShareFrame leagueName={leagueName} title={title} subtitle={subtitle} bodyHeight={area + 24 + TOTALS_H} minBodyHeight={compact ? 0 : SHARE_BODY_H}>
      <div style={{ height: area, display: 'flex', flexDirection: 'column', gap: ROW_GAP }}>
        {shown.map((r) => {
          const color = STATUS_COLOR[r.status];
          return (
            <div
              key={r.id}
              style={{
                height: h,
                boxSizing: 'border-box',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                gap: 22,
                padding: '0 26px 0 0',
                background: C.card,
                border: `2px solid ${C.border}`,
                borderRadius: 24,
                overflow: 'hidden',
              }}
            >
              <div style={{ width: 10, alignSelf: 'stretch', background: color, flexShrink: 0 }} />
              <div
                style={{
                  width: badge,
                  height: badge,
                  borderRadius: '50%',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: badge * 0.36,
                  fontWeight: 800,
                  color: POS_COLOR[r.position] ?? C.primary,
                  background: tint(C.text, 6),
                  border: `3px solid ${POS_COLOR[r.position] ?? C.primary}`,
                  boxSizing: 'border-box',
                }}
              >
                {r.position}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: nameSize, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</div>
                <div style={{ fontSize: lineSize, color: C.muted, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {r.who ? `${r.who} · ${r.line}` : r.line}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: resultSize, fontWeight: 800, color: r.profit == null || r.status === 'voided' ? color : r.profit >= 0 ? C.profit : C.loss, whiteSpace: 'nowrap' }}>
                  {r.profit == null || r.status === 'pending' || r.status === 'live' ? STATUS_LABEL[r.status] : r.status === 'voided' ? STATUS_LABEL.voided : signedMoney(r.profit)}
                </div>
                <div style={{ fontSize: smallSize, color: C.muted, marginTop: 4, whiteSpace: 'nowrap' }}>
                  ${r.stake.toFixed(2)} @ {r.oddsText}
                </div>
              </div>
            </div>
          );
        })}
        {fit.hidden > 0 && (
          <div style={{ height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, color: C.muted, fontWeight: 700 }}>
            +{fit.hidden} more pick{fit.hidden === 1 ? '' : 's'}
          </div>
        )}
      </div>

      <div style={{ height: TOTALS_H, marginTop: 24, display: 'flex', gap: 16 }}>
        {(single
          ? [
              { label: 'RESULT', value: STATUS_LABEL[single.status], color: STATUS_COLOR[single.status] },
              { label: 'STAKE', value: formatCents(single.stake), color: C.text },
              {
                label: 'P/L',
                value: single.profit == null || single.status === 'pending' || single.status === 'live' ? 'Pending' : signedMoney(single.profit),
                color: single.profit == null || single.status === 'pending' || single.status === 'live' ? C.muted : single.profit >= 0 ? C.profit : C.loss,
              },
            ]
          : [
              { label: totals.voids ? `RECORD · ${totals.voids} VOID` : 'RECORD', value: totals.record, color: C.text },
              { label: 'WAGERED', value: formatCents(totals.wagered), color: C.text },
              {
                label: 'NET P/L',
                value: totals.net == null ? 'Pending' : signedMoney(totals.net),
                color: totals.net == null ? C.muted : totals.net >= 0 ? C.profit : C.loss,
              },
            ]
        ).map((t) => (
          <div
            key={t.label}
            style={{
              flex: 1,
              boxSizing: 'border-box',
              background: C.raised,
              border: `2px solid ${C.border}`,
              borderRadius: 24,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <div style={{ fontSize: 22, letterSpacing: 3, color: C.muted, fontWeight: 700 }}>{t.label}</div>
            <div style={{ fontSize: 52, fontWeight: 800, color: t.color, whiteSpace: 'nowrap' }}>{t.value}</div>
          </div>
        ))}
      </div>
    </ShareFrame>
  );
}
