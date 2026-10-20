import type { CSSProperties, ReactNode } from 'react';

export function Card({
  children,
  className = '',
  onClick,
  dense,
  style,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  /** Tighter padding (p-2 instead of p-3) for a smaller variant of the same card
   * surface -- added for MatchupCard's `compact` mode (see chat, Sept 2026: the
   * Home screen's "Other Matchups" rows needed a shrunk-down version of the real
   * card, not a separately hand-rolled one). Every existing call site omits this
   * and keeps the original p-3. */
  dense?: boolean;
  style?: CSSProperties;
}) {
  // A clickable card is a control, so it has to be reachable and operable without a
  // tap: role/tabIndex/Enter+Space are the ARIA fallback for a non-<button> control.
  // It stays a <div> deliberately -- swapping in a real <button> would inherit the UA
  // button reset (shrink-to-fit width, centered text, its own font) across every card
  // on five screens, and the point of this change is accessibility, not a relayout.
  const interactive = !!onClick;
  return (
    <div
      onClick={onClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              // Space scrolls the page by default; a control has to swallow it.
              e.preventDefault();
              onClick?.();
            }
          : undefined
      }
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      style={style}
      className={`bg-bg-card border border-border rounded-xl ${dense ? 'p-2' : 'p-3'} ${interactive ? 'cursor-pointer active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary' : ''} ${className}`}
    >
      {children}
    </div>
  );
}
