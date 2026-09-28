import { useState } from 'react';

/** Generic "are you sure" bottom sheet for a destructive action (see chat, Sept
 * 2026: confirm-before-delete for chat/announcements, confirm-before-remove for
 * an already-placed lineup pick). Pulled out of LeaveLeagueSheet's shell (same
 * backdrop/sheet classes, same busy/error/disabled-while-in-flight behavior) so
 * every "are you sure" moment in the app looks and behaves the same way instead
 * of each feature growing its own one-off copy. */
export function ConfirmSheet({
  title,
  description,
  confirmLabel,
  confirmingLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  description?: string;
  confirmLabel: string;
  /** Shown on the button while onConfirm's promise is pending. Defaults to
   * "<confirmLabel>…" if not given. */
  confirmingLabel?: string;
  /** Return { ok: false, error } to keep the sheet open and show why (matches
   * every other async action in the app -- leaveLeague, deleteAnnouncement,
   * etc.); return { ok: true } (or nothing) to close automatically. */
  onConfirm: () => Promise<{ ok: boolean; error?: string } | void>;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await onConfirm();
    if (result && result.ok === false) {
      setBusy(false);
      setError(result.error ?? 'Something went wrong. Try again.');
      return;
    }
    setBusy(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md bg-bg-raised border-t border-border rounded-t-2xl p-4 space-y-4"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start">
          <h2 className="text-lg font-bold">{title}</h2>
          <button onClick={onClose} className="text-text-muted text-sm">Close</button>
        </div>
        {description && <p className="text-sm text-text-muted">{description}</p>}
        {error && <p className="text-xs text-loss">{error}</p>}
        <button
          onClick={handleConfirm}
          disabled={busy}
          className="w-full bg-loss/10 text-loss border border-loss/40 font-semibold py-3 rounded-xl disabled:opacity-50"
        >
          {busy ? (confirmingLabel ?? `${confirmLabel}…`) : confirmLabel}
        </button>
      </div>
    </div>
  );
}
