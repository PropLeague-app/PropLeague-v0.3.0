type Status = 'pending' | 'live' | 'won' | 'lost' | 'push' | 'voided' | 'upcoming' | 'final';

const STYLES: Record<Status, string> = {
  pending: 'bg-bg-raised text-text-muted',
  upcoming: 'bg-bg-raised text-text-muted',
  // Deliberately text-loss (red) + a leading dot, per Hunter's explicit ask --
  // reverses an earlier decision (see git blame) that avoided red here to
  // dodge an "in progress" pill reading as "something's wrong." The dot +
  // red + pulse combo together is what should now read as "broadcast live,"
  // not an error state.
  live: 'bg-bg-raised text-loss font-semibold animate-pulse',
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
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${STYLES[status]}`}>
      {status === 'live' && <span aria-hidden="true">•</span>}
      {LABELS[status]}
    </span>
  );
}
