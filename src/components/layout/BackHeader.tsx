import { useNavigate } from 'react-router-dom';

/** Goes back through real router history when there is any (so the back stack feels
 * native), falling back to a sensible parent route when a screen was entered directly
 * (e.g. a refresh) and there's nothing to pop. */
function goBack(navigate: ReturnType<typeof useNavigate>, fallback: string) {
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  if (idx > 0) navigate(-1);
  else navigate(fallback);
}

/** Matches BackHeader's actual rendered height (`py-3` padding + its content line) —
 * exported so a screen that needs its own sticky row just below it (e.g. Full
 * Standings' column headers, manual v0.3.0 §6) can offset against a single source of
 * truth instead of a guessed pixel value that silently drifts if this component's
 * padding ever changes. */
export const BACK_HEADER_HEIGHT = 52;

export function BackHeader({ title, fallback = '/home' }: { title: string; fallback?: string }) {
  const navigate = useNavigate();
  return (
    <div className="sticky top-0 z-10 bg-bg-raised/95 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-2">
      <button
        onClick={() => goBack(navigate, fallback)}
        className="flex items-center gap-0.5 text-text-muted -ml-1 pl-1 pr-2 py-1 shrink-0"
      >
        <span className="text-xl leading-none">‹</span>
        <span className="text-sm">Back</span>
      </button>
      <h1 className="text-base font-bold truncate">{title}</h1>
    </div>
  );
}

export { goBack };
