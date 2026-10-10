import { useEffect, useRef } from 'react';
import { Delete } from 'lucide-react';
import type { KeypadKey } from '../../engine/stakeInput';

const ROWS: KeypadKey[][] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', 'back'],
];

/**
 * Our own number pad, so entering an amount never summons the OS keyboard (which shoves the layout
 * around and can't be themed). Compact on purpose: it sits under the pick details and has to fit
 * small phones. Every key, backspace included, is a single tap that fires on release: holding does
 * not repeat. Callers keep anything that can appear or disappear (errors, notes) ABOVE the pad so a
 * tap never shifts the keys under the finger. A physical keyboard (Bluetooth, or a Mac running the app)
 * works too: digits and the numpad type, "." or "," is the decimal point, Backspace/Delete deletes,
 * Enter calls `onEnter`, Escape calls `onEscape`.
 */
export function NumericKeypad({
  onKey,
  onEnter,
  onEscape,
  allowDecimal = true,
}: {
  onKey: (key: KeypadKey) => void;
  onEnter?: () => void;
  onEscape?: () => void;
  allowDecimal?: boolean;
}) {
  // Latest handlers, so the window listener below is attached once and never goes stale.
  const handlers = useRef({ onKey, onEnter, onEscape, allowDecimal });
  handlers.current = { onKey, onEnter, onEscape, allowDecimal };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      // Held hardware keys auto-repeat; ignore those so every key is one press, same as the on-screen pad.
      if (e.repeat) {
        if (/^[0-9.,]$/.test(e.key) || e.key === 'Backspace' || e.key === 'Delete') e.preventDefault();
        return;
      }
      const h = handlers.current;
      if (/^[0-9]$/.test(e.key)) h.onKey(e.key as KeypadKey);
      else if ((e.key === '.' || e.key === ',') && h.allowDecimal) h.onKey('.');
      else if (e.key === 'Backspace' || e.key === 'Delete') h.onKey('back');
      else if (e.key === 'Enter' && h.onEnter) h.onEnter();
      else if (e.key === 'Escape' && h.onEscape) h.onEscape();
      else return;
      // Handled: stop a focused button from also "clicking" on Enter, and Backspace from navigating.
      e.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="grid grid-cols-3 gap-px rounded-xl overflow-hidden bg-border border border-border select-none" role="group" aria-label="Number pad">
      {ROWS.flat().map((k) => {
        const isBack = k === 'back';
        const disabled = k === '.' && !allowDecimal;
        return (
          <button
            key={k}
            type="button"
            disabled={disabled}
            aria-label={isBack ? 'Delete' : k === '.' ? 'Decimal point' : k}
            onClick={() => onKey(k)}
            onMouseDown={(e) => e.preventDefault()}
            onContextMenu={(e) => e.preventDefault()}
            className="h-11 flex items-center justify-center bg-bg-card text-xl font-medium text-text active:bg-bg-raised disabled:opacity-30 touch-manipulation"
          >
            {isBack ? <Delete size={22} /> : k}
          </button>
        );
      })}
    </div>
  );
}
