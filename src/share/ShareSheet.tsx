import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Share as ShareIcon, X } from 'lucide-react';
import { SHARE_H, SHARE_W } from './palette';
import { renderCardPng, shareFileName, shareImageFile } from './shareImage';

/** Full-screen preview of a share card with a Share button. It is rendered through a portal on
 * document.body: the share icon lives inside a page header whose blur effect would otherwise become
 * the containing block for this fixed overlay and squash it into the header's strip. The card is always laid out at its real
 * real size (1080 wide, 1350 tall or more); the preview only scales a wrapper around it, so what you
 * see is exactly the picture that gets shared. A tall card (a long slip) is scaled to the screen's
 * width and the preview scrolls. */
export function ShareSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);
  const [cardH, setCardH] = useState(SHARE_H);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The card decides its own height (long slips grow), so measure it.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const measure = () => setCardH(Math.max(200, el.offsetHeight));
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    function fit() {
      // Leave room for the header row and the button. Fit the whole picture on screen when it is
      // roughly the standard shape; a much taller one takes the full width and scrolls.
      const byWidth = (window.innerWidth - 32) / SHARE_W;
      const byHeight = (window.innerHeight - 230) / cardH;
      setScale(Math.max(0.1, byHeight >= byWidth * 0.6 ? Math.min(byWidth, byHeight) : byWidth));
    }
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [cardH]);

  async function handleShare() {
    if (!cardRef.current || busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const png = await renderCardPng(cardRef.current);
      const outcome = await shareImageFile(png, shareFileName(title), title);
      if (outcome === 'downloaded') setMessage('Image downloaded.');
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Could not create the image. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex flex-col items-center bg-black/80"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="w-full max-w-md flex items-center justify-between px-4 py-3">
        <h2 className="text-base font-bold text-white">Share</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full bg-white/10 text-white flex items-center justify-center">
          <X size={16} />
        </button>
      </div>

      <div className="flex-1 min-h-0 w-full overflow-y-auto flex flex-col">
        <div className="m-auto py-1">
          <div style={{ width: SHARE_W * scale, height: cardH * scale, borderRadius: 12 * scale * 3, overflow: 'hidden', boxShadow: '0 8px 30px rgba(0,0,0,0.5)' }}>
            <div style={{ width: SHARE_W, height: cardH, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
              <div ref={cardRef} style={{ width: SHARE_W }}>
                {children}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="w-full max-w-md px-4 pt-3 pb-4 space-y-2">
        {error && <p className="text-xs text-loss text-center">{error}</p>}
        {message && <p className="text-xs text-profit text-center">{message}</p>}
        <button
          type="button"
          onClick={() => void handleShare()}
          disabled={busy}
          className="w-full flex items-center justify-center gap-2 bg-primary text-white font-semibold py-3 rounded-xl disabled:opacity-60"
        >
          <ShareIcon size={18} />
          {busy ? 'Creating image…' : 'Share image'}
        </button>
      </div>
    </div>,
    document.body,
  );
}
