import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { shellNavState, type ShellNavState } from './shellNav';

/** Goes back through real router history when there is any (so the back stack feels
 * native), falling back to a sensible parent route when a screen was entered directly
 * (e.g. a refresh) and there's nothing to pop. */
function goBack(navigate: ReturnType<typeof useNavigate>, fallback: string) {
  const history = window.history.state as { idx?: number; usr?: unknown } | null;
  // A screen the tab bar reopened (shellNav.ts) goes up to its parent, not back to the other tab.
  if (shellNavState(history?.usr).fromTab) {
    navigate(fallback, { state: { restoreScroll: true } satisfies ShellNavState });
    return;
  }
  if ((history?.idx ?? 0) > 0) navigate(-1);
  else navigate(fallback);
}

/** Matches BackHeader's actual rendered height (`py-3` padding + its content line) —
 * exported so a screen that needs its own sticky row just below it (e.g. Full
 * Standings' column headers, manual v0.3.0 §6) can offset against a single source of
 * truth instead of a guessed pixel value that silently drifts if this component's
 * padding ever changes. */
export const BACK_HEADER_HEIGHT = 44;

export function BackHeader({
  title,
  fallback = '/home',
  right,
  onBack,
  below,
}: {
  title: string;
  fallback?: string;
  /** Optional right-aligned slot (see chat, Sept 2026 -- the Matchup screen's
   * Simple/Advanced toggle) -- undefined for every other screen today, so this
   * is purely additive and changes nothing for an existing caller. */
  right?: ReactNode;
  /** Replaces the default back behavior, e.g. to ask before discarding unsaved edits. */
  onBack?: () => void;
  /** Hangs just under the header and scrolls with it (it stays in view), e.g. a TopToast. */
  below?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <div className="sticky top-0 z-10 bg-bg-raised/95 backdrop-blur border-b border-border px-4 py-2 flex items-center gap-2">
      <button
        onClick={() => (onBack ? onBack() : goBack(navigate, fallback))}
        className="flex items-center gap-0.5 text-text-muted -ml-1 pl-1 pr-2 py-1 shrink-0"
      >
        <span className="text-xl leading-none">‹</span>
        <span className="text-sm">Back</span>
      </button>
      <h1 className="text-base font-bold truncate flex-1">{title}</h1>
      {right}
      {below}
    </div>
  );
}

export { goBack };
