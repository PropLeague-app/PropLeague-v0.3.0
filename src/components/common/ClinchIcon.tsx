import { CircleCheck, CircleX, Crown, Star } from 'lucide-react';
import type { ClinchStatus } from '../../engine/clinch';

const META: Record<ClinchStatus, { label: string; Icon: typeof Star; className: string }> = {
  top: { label: 'Clinched the #1 seed', Icon: Crown, className: 'text-star' },
  bye: { label: 'Clinched a first-round bye', Icon: Star, className: 'text-star fill-current' },
  playoffs: { label: 'Clinched a playoff spot', Icon: CircleCheck, className: 'text-profit' },
  out: { label: 'Eliminated', Icon: CircleX, className: 'text-text-muted' },
};

/** The small marker after a team name (1.2.11): crown #1 seed, star bye, check playoff spot, x out. */
export function ClinchIcon({ status, size = 12 }: { status: ClinchStatus | undefined; size?: number }) {
  if (!status) return null;
  const { label, Icon, className } = META[status];
  return (
    <span className="shrink-0 inline-flex" title={label} aria-label={label}>
      <Icon size={size} strokeWidth={2.5} className={className} />
    </span>
  );
}

/** One-line key, shown under a standings list when any marker is on it. */
export function ClinchLegend({ statuses }: { statuses: Iterable<ClinchStatus> }) {
  const present = new Set(statuses);
  const order: ClinchStatus[] = ['top', 'bye', 'playoffs', 'out'];
  const short: Record<ClinchStatus, string> = { top: '#1 seed', bye: 'Bye', playoffs: 'Clinched', out: 'Out' };
  const shown = order.filter((s) => present.has(s));
  if (shown.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-text-muted">
      {shown.map((s) => (
        <span key={s} className="inline-flex items-center gap-1">
          <ClinchIcon status={s} size={10} /> {short[s]}
        </span>
      ))}
    </p>
  );
}
