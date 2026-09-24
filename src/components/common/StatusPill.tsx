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

// Matchup screen's Simple mode (see chat, Sept 2026): one letter/symbol per
// status instead of a full word, so a settled result can share a line with
// the abbreviated prop text without wrapping. Pending's "..." and Live's own
// "•" (already rendered separately below, so it's left out of this map)
// were Hunter's explicit picks over a plain "P" -- Push already owns that
// letter. upcoming/final aren't used by SlotMini today but are filled in for
// completeness, matching their full-word counterparts' behavior.
const COMPACT_LABELS: Record<Status, string> = {
  pending: '...',
  upcoming: '...',
  live: '',
  final: 'F',
  won: 'W',
  lost: 'L',
  push: 'P',
  voided: 'V',
};

export function StatusPill({ status, compact }: { status: Status; compact?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 font-semibold rounded-full ${STYLES[status]} ${
        compact ? 'text-[10px] px-1.5 py-0.5' : 'text-[11px] px-2 py-0.5'
      }`}
    >
      {status === 'live' && <span aria-hidden="true">•</span>}
      {compact ? COMPACT_LABELS[status] : LABELS[status]}
    </span>
  );
}
