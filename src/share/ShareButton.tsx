import { useState, type ReactNode } from 'react';
import { Share as ShareIcon } from 'lucide-react';
import { ShareSheet } from './ShareSheet';

/** A small round share icon. The card is only built once the sheet opens (renderCard is a function
 * for that reason), so screens pay nothing for it until someone taps. */
export function ShareButton({
  title,
  renderCard,
  disabled = false,
  size = 'md',
  label = 'Share',
}: {
  title: string;
  renderCard: () => ReactNode;
  disabled?: boolean;
  size?: 'sm' | 'md';
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const dim = size === 'sm' ? 'w-6 h-6' : 'w-8 h-8';
  return (
    <>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen(true)}
        className={`shrink-0 ${dim} rounded-full border border-border bg-bg-card text-text-muted flex items-center justify-center active:opacity-70 disabled:opacity-40`}
      >
        <ShareIcon size={size === 'sm' ? 12 : 15} />
      </button>
      {open && (
        <ShareSheet title={title} onClose={() => setOpen(false)}>
          {renderCard()}
        </ShareSheet>
      )}
    </>
  );
}
