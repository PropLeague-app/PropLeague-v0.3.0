import type { ReactNode } from 'react';

export function Card({
  children,
  className = '',
  onClick,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`bg-bg-card border border-border rounded-xl p-3 ${onClick ? 'cursor-pointer active:opacity-80' : ''} ${className}`}
    >
      {children}
    </div>
  );
}
