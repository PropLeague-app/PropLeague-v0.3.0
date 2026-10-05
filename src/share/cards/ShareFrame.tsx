import type { ReactNode } from 'react';
// ?inline embeds the PNG as a data URL so the image export never has to fetch it.
import logoMark from '../../assets/logo-mono-muted.png?inline';
import { C, FONT, SHARE_BODY_H, SHARE_CHROME_H, SHARE_HEADER_H, SHARE_W, tint } from '../palette';

/** The shared shell: PropLeague mark and league name on top, a title panel (title plus the subtitle as
 * chips), the card's own content in a body, a small footer. The card is 1080 wide and 1350 tall at minimum; a card with a lot to show passes a
 * larger `bodyHeight` and the whole picture grows to match (header and footer stay the same). Every
 * share card renders inside this so they look like a set. */
const CHIP_FS = 24;
const CHIP_H = 44;
const CHIP_GAP = 10;
/** Room for chips: card width minus the bar's side padding. */
const CHIP_ROOM = SHARE_W - 112;

/** Rough rendered width of a chip (Verdana is wide), so chips can be split into rows ahead of time
 * and the frame height can include any extra row. */
const chipWidth = (text: string) => Math.ceil(text.length * CHIP_FS * 0.66) + 40;

function chipRows(chips: string[]): string[][] {
  const rows: string[][] = [[]];
  let used = 0;
  for (const c of chips) {
    const w = chipWidth(c);
    const row = rows[rows.length - 1];
    if (row.length > 0 && used + CHIP_GAP + w > CHIP_ROOM) {
      rows.push([c]);
      used = w;
    } else {
      row.push(c);
      used += (row.length > 1 ? CHIP_GAP : 0) + w;
    }
  }
  return rows;
}

/** "A · B · C" reads as chips; a plain sentence stays a line of text. */
const splitSubtitle = (subtitle?: string): { chips: string[]; text?: string } => {
  if (!subtitle) return { chips: [] };
  const parts = subtitle.split(' · ').filter(Boolean);
  return parts.length > 1 ? { chips: parts } : { chips: [], text: subtitle };
};

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
  const { chips, text } = splitSubtitle(subtitle);
  const rows = chipRows(chips);
  // Every chip row past the first adds to the header, and so to the whole picture.
  const extraH = chips.length > 0 ? (rows.length - 1) * (CHIP_H + CHIP_GAP) : 0;
  return (
    <div
      style={{
        width: SHARE_W,
        height: body + SHARE_CHROME_H + extraH,
        boxSizing: 'border-box',
        padding: '0 56px 56px',
        display: 'flex',
        flexDirection: 'column',
        gap: 24,
        fontFamily: FONT,
        color: C.text,
        background: `radial-gradient(900px 600px at 100% 0%, ${tint(C.primary, 22)}, transparent 70%), linear-gradient(160deg, ${C.bg2}, ${C.bg})`,
        overflow: 'hidden',
      }}
    >
      {/* Header bar in the app's own header style: a flat raised band across the full width with a
          hairline under it. Brand and league on one line, then the title with its chips. The bar
          takes the card's top padding too, so its height is the old padding plus the old header. */}
      <div
        style={{
          margin: '0 -56px',
          height: 56 + SHARE_HEADER_H + extraH,
          boxSizing: 'border-box',
          padding: '40px 56px 26px',
          background: C.raised,
          borderBottom: `2px solid ${C.border}`,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, height: 44 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img src={logoMark} alt="" style={{ width: 60, height: 60, objectFit: 'contain', margin: '-8px 0 -8px -8px' }} />
            <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: 0.5, color: C.text }}>PropLeague</span>
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 58, fontWeight: 800, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {title}
          </div>
          {text && (
            <div style={{ height: CHIP_H, display: 'flex', alignItems: 'center', fontSize: 26, color: C.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {text}
            </div>
          )}
          {rows.map((row, ri) =>
            row.length === 0 ? null : (
              <div key={ri} style={{ display: 'flex', gap: CHIP_GAP, height: CHIP_H, overflow: 'hidden' }}>
                {row.map((c, ci) => {
                  const lead = ri === 0 && ci === 0;
                  return (
                    <span
                      key={ci}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '0 20px',
                        borderRadius: 999,
                        fontSize: CHIP_FS,
                        fontWeight: lead ? 800 : 600,
                        whiteSpace: 'nowrap',
                        color: lead ? C.primary : C.muted,
                        background: lead ? tint(C.primary, 16) : tint(C.muted, 10),
                        border: `2px solid ${lead ? tint(C.primary, 45) : C.border}`,
                      }}
                    >
                      {c}
                    </span>
                  );
                })}
              </div>
            ),
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
