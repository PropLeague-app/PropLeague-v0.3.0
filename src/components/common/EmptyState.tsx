import type { ReactNode } from 'react';

export function EmptyState({
  icon = '🏈',
  title,
  subtitle,
  action,
}: {
  icon?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-2 py-10 px-4">
      <span className="text-4xl">{icon}</span>
      <p className="font-semibold text-text">{title}</p>
      {subtitle && <p className="text-sm text-text-muted max-w-xs">{subtitle}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
