import { useId, type ReactNode } from 'react';

// A still version of the perfect-week flames behind a team logo (see components/common/FireAura.tsx
// for the live one): five flame tongues fanned across the top plus a glow ring. Same shapes and the
// same theme colors, but plain inline styles and no animation, so it draws the same in the exported
// picture as on screen in a frozen frame. Flames sit behind the logo and reach above it, so leave
// roughly a third of the logo's size free over the top.
const TONGUES = [
  { a: -74, s: 0.62 },
  { a: -38, s: 0.86 },
  { a: 0, s: 1 },
  { a: 38, s: 0.82 },
  { a: 74, s: 0.6 },
];

const FLAME_PATH = 'M12 0C13 8 22 12 22 21c0 6-4.5 11-10 11S2 27 2 21c0-4 2-6.5 4-9 .5 3 2 4.5 3.5 5C9 11 10 5 12 0z';

export function ShareFlames({ active, size, children }: { active: boolean; size: number; children: ReactNode }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  if (!active) return <>{children}</>;
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <div
        style={{
          position: 'absolute',
          left: -size * 0.28,
          top: -size * 0.28,
          right: -size * 0.28,
          bottom: -size * 0.28,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(var(--pl-ember, 255, 120, 30), 0.42) 0%, rgba(var(--pl-ember, 255, 120, 30), 0.16) 50%, transparent 72%)',
        }}
      />
      {TONGUES.map((t, i) => (
        <svg
          key={i}
          viewBox="0 0 24 32"
          style={{
            position: 'absolute',
            left: '22%',
            width: '56%',
            top: '-50%',
            height: '100%',
            overflow: 'visible',
            transformOrigin: '50% 100%',
            transform: `rotate(${t.a}deg) scaleY(${t.s})`,
          }}
        >
          <defs>
            <linearGradient id={`${id}f${i}`} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" style={{ stopColor: 'var(--pl-flame-base, #ffd45a)' }} />
              <stop offset="0.55" style={{ stopColor: 'var(--pl-flame-mid, #ff9a24)' }} />
              <stop offset="1" style={{ stopColor: 'var(--pl-flame-top, #ff4a1a)' }} />
            </linearGradient>
          </defs>
          <path d={FLAME_PATH} fill={`url(#${id}f${i})`} />
        </svg>
      ))}
      <div style={{ position: 'relative' }}>{children}</div>
    </div>
  );
}
