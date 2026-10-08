import type { ReactNode } from 'react';

// A still version of the skunked-week stink lines and flies around a team logo (see
// components/common/StinkAura.tsx for the live one): three wavy lines rising off the top and two
// flies, in the same muted theme colors, with plain inline styles and no animation so the exported
// picture matches the screen. The lines reach about half a logo above it, so leave that much room.
const LINE_PATH = 'M6 24C1 19 11 15 6 10S1 3 6 0';
const LINES = [
  { x: 18, s: 0.8, dx: 0 },
  { x: 42, s: 1, dx: 4 },
  { x: 66, s: 0.72, dx: 2 },
];
const FLY_BODY = 'rgb(var(--pl-skunk-fly, 46, 31, 20))';

function Fly({ style, rotate }: { style: React.CSSProperties; rotate: number }) {
  return (
    <svg viewBox="0 0 12 10" style={{ position: 'absolute', width: '25%', height: '21%', overflow: 'visible', transform: `rotate(${rotate}deg)`, ...style }}>
      <ellipse cx="3.4" cy="3.2" rx="3" ry="1.8" fill="rgba(var(--pl-skunk-fly-wing, 226, 230, 236), 0.6)" />
      <ellipse cx="8.6" cy="3.2" rx="3" ry="1.8" fill="rgba(var(--pl-skunk-fly-wing, 226, 230, 236), 0.6)" />
      <ellipse cx="6" cy="6.4" rx="1.9" ry="2.6" fill={FLY_BODY} stroke="rgba(var(--pl-skunk-fly-edge, 214, 198, 168), 0.75)" strokeWidth="0.7" />
    </svg>
  );
}

export function ShareStink({ active, size, children }: { active: boolean; size: number; children: ReactNode }) {
  if (!active) return <>{children}</>;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      {LINES.map((l, i) => (
        <svg
          key={i}
          viewBox="0 0 12 24"
          style={{
            position: 'absolute',
            left: `${l.x}%`,
            bottom: '80%',
            width: '21%',
            height: '66%',
            overflow: 'visible',
            transform: `translateX(${l.dx}%) scaleY(${l.s})`,
            transformOrigin: '50% 100%',
            color: 'rgba(var(--pl-skunk-line, 168, 170, 104), 0.8)',
          }}
        >
          <path d={LINE_PATH} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      ))}
      <div style={{ position: 'relative' }}>{children}</div>
      {/* After the logo so they can land on its edge, and big enough to read without any motion. */}
      <Fly style={{ right: '-8%', top: '2%' }} rotate={-24} />
      <Fly style={{ left: '-8%', bottom: '10%' }} rotate={38} />
    </div>
  );
}
