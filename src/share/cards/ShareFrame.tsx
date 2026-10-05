import type { ReactNode } from 'react';
// ?inline embeds the PNG as a data URL so the image export never has to fetch it.
import logoMark from '../../assets/logo-mono-muted.png?inline';
import { C, FONT, SHARE_BODY_H, SHARE_CHROME_H, SHARE_W, tint } from '../palette';

/** The shared shell: PropLeague mark and league name on top, the card's own content in a body, a
 * small footer. The card is 1080 wide and 1350 tall at minimum; a card with a lot to show passes a
 * larger `bodyHeight` and the whole picture grows to match (header and footer stay the same). Every
 * share card renders inside this so they look like a set. */
export function ShareFrame({
  leagueName,
  title,
  subtitle,
  bodyHeight = SHARE_BODY_H,
  minBodyHeight = SHARE_BODY_H,
  children,
}: {
  leagueName: string;
  title: string;
  subtitle?: string;
  bodyHeight?: number;
  /** Smallest body. The default keeps the standard 4:5 picture; a card with little to show can pass a
   * smaller number and shrink to fit instead of leaving empty space. */
  minBodyHeight?: number;
  children: ReactNode;
}) {
  const body = Math.max(minBodyHeight, bodyHeight);
  return (
    <div
      style={{
        width: SHARE_W,
        height: body + SHARE_CHROME_H,
        boxSizing: 'border-box',
        padding: 56,
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        fontFamily: FONT,
        color: C.text,
        background: `radial-gradient(900px 600px at 100% 0%, ${tint(C.primary, 22)}, transparent 70%), linear-gradient(160deg, ${C.bg2}, ${C.bg})`,
        overflow: 'hidden',
      }}
    >
      <div style={{ height: 170, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={logoMark} alt="" style={{ width: 72, height: 72, objectFit: 'contain', margin: '-10px 0 -10px -8px' }} />
            <span style={{ fontSize: 34, fontWeight: 700, letterSpacing: 0.5, color: C.text }}>PropLeague</span>
          </div>
          <span
            style={{
              fontSize: 26,
              color: C.muted,
              maxWidth: 520,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {leagueName}
          </span>
        </div>
        <div>
          <div style={{ fontSize: 58, fontWeight: 800, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {title}
          </div>
          {subtitle && (
            <div style={{ fontSize: 28, color: C.muted, marginTop: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {subtitle}
            </div>
          )}
        </div>
      </div>

      <div style={{ height: body, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>{children}</div>

      <div
        style={{
          marginTop: 'auto',
          borderTop: `2px solid ${C.border}`,
          paddingTop: 16,
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 22,
          color: C.muted,
        }}
      >
        <span>Pick your props. Beat your league.</span>
        <span>{new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
      </div>
    </div>
  );
}
