import type { CSSProperties } from 'react';

// A small solid swirl, drawn like the lucide Flame the perfect-week rows use (one flat fill that takes
// the surrounding text color), for marking a skunked week in dense rows such as the season schedule.
export function SkunkIcon({ size = 12, className, style }: { size?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      style={style}
      role="img"
      aria-label="Skunked week"
    >
      <path d="M5 21.5c-1.7 0-3-1.2-3-2.9 0-1.6 1.3-2.8 3-2.8h14c1.7 0 3 1.2 3 2.8 0 1.7-1.3 2.9-3 2.9H5z" />
      <path d="M7 14.6c-1.5 0-2.6-1-2.6-2.5 0-1.4 1.1-2.5 2.6-2.5h10c1.5 0 2.6 1.1 2.6 2.5 0 1.5-1.1 2.5-2.6 2.5H7z" />
      <path d="M9.4 8.4C8.5 8 8 7.3 8 6.5c0-1.4 1.1-2.2 2-3C10.8 2.8 11.3 2 11.4.7c1.8.4 3.9 1.4 3.9 3.5 0 .7-.2 1.2-.5 1.6 1 .4 1.7 1.2 1.7 2.2 0 .2 0 .3-.1.4H9.4z" />
    </svg>
  );
}
