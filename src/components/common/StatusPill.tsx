type Status = 'pending' | 'live' | 'won' | 'lost' | 'push' | 'voided' | 'upcoming' | 'final';

const STYLES: Record<Status, string> = {
  pending: 'bg-bg-raised text-text-muted',
  upcoming: 'bg-bg-raised text-text-muted',
  live: 'bg-loss/20 text-loss animate-pulse',
  final: 'bg-bg-raised text-text-muted',
  won: 'bg-profit/20 text-profit',
  lost: 'bg-loss/20 text-loss',
  push: 'bg-primary/20 text-primary',
  voided: 'bg-accent/20 text-accent',
};

const LABELS: Record<Status, string> = {
  pending: 'Pending',
  upcoming: 'Upcoming',
  live: 'Live',
  final: 'Final',
  won: 'Won',
  lost: 'Lost',
  push: 'Push',
  voided: 'Voided',
};

export function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full ${STYLES[status]}`}>
      {LABELS[status]}
    </span>
  );
}
