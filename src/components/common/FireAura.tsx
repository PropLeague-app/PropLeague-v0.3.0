import { useId, type ReactNode } from 'react';

// Flame tongues fanned across the top of a team logo, plus a soft glow ring all the way around.
// Used wherever a perfect week shows up (see engine/perfectWeek.ts). All CSS, no images, and the
// colors come from theme tokens so it reads on dark and light cards. When `active` is false it
// renders its children untouched, so callers can wrap unconditionally.
const TONGUES = [
  { a: '-74deg', s: 0.62, d: '0.5s' },
  { a: '-38deg', s: 0.86, d: '0.2s' },
  { a: '0deg', s: 1, d: '0.8s' },
  { a: '38deg', s: 0.82, d: '0.35s' },
  { a: '74deg', s: 0.6, d: '0.05s' },
];

const FLAME_PATH = 'M12 0C13 8 22 12 22 21c0 6-4.5 11-10 11S2 27 2 21c0-4 2-6.5 4-9 .5 3 2 4.5 3.5 5C9 11 10 5 12 0z';

export function FireAura({ active, children }: { active: boolean; children: ReactNode }) {
  const id = useId();
  if (!active) return <>{children}</>;
  return (
    <span className="pl-aura">
      <span className="pl-aura-glow" aria-hidden />
      {TONGUES.map((t, i) => (
        <svg
          key={i}
          viewBox="0 0 24 32"
          className="pl-flame"
          aria-hidden
          style={{ ['--pl-a' as string]: t.a, ['--pl-s' as string]: t.s, ['--pl-d' as string]: t.d }}
        >
          <defs>
            <linearGradient id={`${id}-${i}`} x1="0" y1="1" x2="0" y2="0">
              <stop offset="0" style={{ stopColor: 'var(--pl-flame-base)' }} />
              <stop offset="0.55" style={{ stopColor: 'var(--pl-flame-mid)' }} />
              <stop offset="1" style={{ stopColor: 'var(--pl-flame-top)' }} />
            </linearGradient>
          </defs>
          <path d={FLAME_PATH} fill={`url(#${id}-${i})`} />
        </svg>
      ))}
      {children}
    </span>
  );
}
