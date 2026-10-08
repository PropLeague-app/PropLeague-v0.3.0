import type { ReactNode } from 'react';

// The skunked-week counterpart of FireAura: three wavy stink lines drifting up off a team logo and
// two tiny flies circling it. All CSS and one small SVG each, colors from the --pl-skunk-* tokens so
// it stays muted on every theme (see engine/skunkedWeek.ts). When `active` is false it renders its
// children untouched, so callers can wrap unconditionally.
const LINES = [
  { x: '14%', d: '0s', s: 0.85 },
  { x: '45%', d: '1.4s', s: 1 },
  { x: '76%', d: '2.6s', s: 0.8 },
];

const FLIES = [
  { cls: 'pl-fly-a', style: { right: '-30%', top: '-12%' } },
  { cls: 'pl-fly-b', style: { left: '-34%', bottom: '2%' } },
];

const LINE_PATH = 'M6 24C1 19 11 15 6 10S1 3 6 0';

export function StinkAura({ active, children }: { active: boolean; children: ReactNode }) {
  if (!active) return <>{children}</>;
  return (
    <span className="pl-stink">
      {LINES.map((l, i) => (
        <svg
          key={i}
          viewBox="0 0 12 24"
          className="pl-stink-line"
          aria-hidden
          style={{ left: l.x, ['--pl-sd' as string]: l.d, ['--pl-ss' as string]: l.s }}
        >
          <path d={LINE_PATH} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ))}
      {FLIES.map((f, i) => (
        <svg key={i} viewBox="0 0 12 10" className={`pl-fly ${f.cls}`} style={f.style} aria-hidden>
          <ellipse className="pl-fly-wing" cx="3.4" cy="3.2" rx="3" ry="1.8" />
          <ellipse className="pl-fly-wing" cx="8.6" cy="3.2" rx="3" ry="1.8" />
          <ellipse className="pl-fly-body" cx="6" cy="6.4" rx="1.9" ry="2.6" />
        </svg>
      ))}
      {children}
    </span>
  );
}
