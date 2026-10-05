import type { ReactNode } from 'react';

// The app forces every input to 16px (index.css) so iOS never zooms the page on focus, which makes
// a plain input look oversized next to the rest of the UI. This draws the same 16px input at 75%
// so it reads as 12px text, and the browser still sees a 16px field, so there is no focus zoom.
const SCALE = 0.75;
const INNER_HEIGHT = 40;

export function CompactInput({
  value,
  onChange,
  placeholder,
  icon,
  maxLength,
  tone = 'card',
  className = '',
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  icon?: ReactNode;
  maxLength?: number;
  /** Fill color: the page card, or the slightly raised panel color used inside settings cards. */
  tone?: 'card' | 'raised';
  className?: string;
}) {
  return (
    <div style={{ height: INNER_HEIGHT * SCALE }} className={className}>
      <div className="relative" style={{ width: `${100 / SCALE}%`, height: INNER_HEIGHT, transform: `scale(${SCALE})`, transformOrigin: 'top left' }}>
        {icon && <span className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none flex">{icon}</span>}
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          className={`w-full h-full border border-border rounded-full pr-4 ${icon ? 'pl-11' : 'pl-4'} ${tone === 'raised' ? 'bg-bg-raised' : 'bg-bg-card'}`}
        />
      </div>
    </div>
  );
}
