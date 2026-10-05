import type { LogoIdentity } from '../../types';
import { C, SHARE_BODY_H, signedMoney, tint } from '../palette';
import { useTone } from '../useTone';
import { ShareFrame } from './ShareFrame';
import { ShareLogo } from './ShareLogo';

export interface StatTile {
  label: string;
  value: string;
  tone?: 'profit' | 'loss' | 'plain';
  /** A P/L amount to color the value by (wins green, losses red or scaled). Beats `tone`. */
  amount?: number;
  /** Reference loss for scaled coloring of `amount`. */
  ref?: number;
}

export interface StatsCardData {
  leagueName: string;
  title: string;
  subtitle?: string;
  identity: LogoIdentity | null;
  initials: string;
  name: string;
  totalPL: number;
  /** Reference loss for scaled P/L coloring of the headline number (same one the screen uses). */
  plRef?: number;
  roiText: string;
  roiPositive: boolean;
  /** Six tiles, laid out three across. */
  tiles: StatTile[];
  /** Actual hit rate and what the odds implied, as 0 to 1 fractions. */
  winRate: number;
  impliedWinRate: number;
  /** Best markets by profit, at most three. */
  markets: { label: string; record: string; pl: number }[];
}

export const toneColor = (t?: StatTile['tone']) => (t === 'profit' ? C.profit : t === 'loss' ? C.loss : C.text);

/** Season (or league) stats on one picture: the headline P/L, six tiles, hit rate against the odds,
 * and the best markets. Everything is fixed size, so unlike the slip nothing needs to be fitted. */
export function StatsShareCard(d: StatsCardData) {
  const tone = useTone();
  const plColor = tone(d.totalPL, d.plRef);
  const edge = (d.winRate - d.impliedWinRate) * 100;
  return (
    <ShareFrame leagueName={d.leagueName} title={d.title} subtitle={d.subtitle}>
      <div style={{ height: SHARE_BODY_H, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <ShareLogo identity={d.identity} initials={d.initials} size={90} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 38, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 800 }}>{d.name}</div>
            <div style={{ fontSize: 22, color: C.muted, letterSpacing: 3, marginTop: 4 }}>TOTAL P/L</div>
          </div>
        </div>

        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 124, fontWeight: 800, lineHeight: 1, color: plColor, whiteSpace: 'nowrap' }}>{signedMoney(d.totalPL)}</div>
          <div
            style={{
              display: 'inline-block',
              marginTop: 12,
              padding: '6px 24px',
              borderRadius: 999,
              fontSize: 28,
              fontWeight: 800,
              color: d.roiPositive ? C.profit : C.loss,
              background: tint(d.roiPositive ? C.profit : C.loss, 14),
            }}
          >
            {d.roiText} ROI
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
          {d.tiles.slice(0, 6).map((t) => (
            <div
              key={t.label}
              style={{
                height: 112,
                background: C.card,
                border: `2px solid ${C.border}`,
                borderRadius: 22,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '0 8px',
              }}
            >
              <div style={{ fontSize: 36, fontWeight: 800, color: t.amount != null ? tone(t.amount, t.ref) : toneColor(t.tone), whiteSpace: 'nowrap' }}>{t.value}</div>
              <div style={{ fontSize: 20, color: C.muted, letterSpacing: 1, whiteSpace: 'nowrap' }}>{t.label}</div>
            </div>
          ))}
        </div>

        <div style={{ background: C.raised, border: `2px solid ${C.border}`, borderRadius: 22, padding: '16px 28px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 24, color: C.muted, marginBottom: 8 }}>
            <span>Hit rate vs the odds</span>
            <span style={{ color: edge >= 0 ? C.profit : C.loss, fontWeight: 800 }}>
              {edge >= 0 ? '+' : ''}
              {edge.toFixed(1)} pts
            </span>
          </div>
          {[
            { label: 'Actual', value: d.winRate, color: C.primary },
            { label: 'Odds implied', value: d.impliedWinRate, color: tint(C.muted, 55) },
          ].map((b) => (
            <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 8 }}>
              <span style={{ width: 170, fontSize: 22 }}>{b.label}</span>
              <div style={{ flex: 1, height: 18, borderRadius: 9, background: C.bg, overflow: 'hidden' }}>
                <div style={{ width: `${Math.min(100, b.value * 100)}%`, height: '100%', borderRadius: 9, background: b.color }} />
              </div>
              <span style={{ width: 90, textAlign: 'right', fontSize: 24, fontWeight: 800 }}>{(b.value * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>

        {d.markets.length > 0 && (
          <div style={{ background: C.raised, border: `2px solid ${C.border}`, borderRadius: 22, padding: '14px 28px' }}>
            <div style={{ fontSize: 22, color: C.muted, letterSpacing: 3, marginBottom: 4 }}>BEST MARKETS</div>
            {d.markets.slice(0, 3).map((m) => (
              <div key={m.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 44, fontSize: 26 }}>
                <span style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 520 }}>{m.label}</span>
                <span style={{ color: C.muted }}>{m.record}</span>
                <span style={{ fontWeight: 800, color: m.pl >= 0 ? C.profit : C.loss, width: 170, textAlign: 'right' }}>{signedMoney(m.pl)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </ShareFrame>
  );
}
