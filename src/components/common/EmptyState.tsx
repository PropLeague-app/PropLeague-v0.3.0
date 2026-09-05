import type { ReactNode } from 'react';
import { Trophy } from 'lucide-react';

export function EmptyState({
  icon = <Trophy size={36} strokeWidth={1.5} />,
  title,
  subtitle,
  action,
}: {
  icon?: ReactNode;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center gap-2 py-10 px-4 text-text-muted">
      <div className="mb-1">{icon}</div>
      <p className="font-semibold text-text">{title}</p>
      {subtitle && <p className="text-sm text-text-muted max-w-xs">{subtitle}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}