import type { ReactNode } from 'react';

export function Card({
  children,
  className = '',
  onClick,
  dense,
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
}) {
  return (
    <div
      onClick={onClick}
      className={`bg-bg-card border border-border rounded-xl ${dense ? 'p-2' : 'p-3'} ${onClick ? 'cursor-pointer active:opacity-80' : ''} ${className}`}
    >
      {children}
    </div>
  );
}
