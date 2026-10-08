import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const EDGE = 8;
const GAP = 6;

/**
 * A small themed bubble pinned to an element (reaction picker, who-reacted lists). Portaled to <body>
 * and placed from the anchor's rect, so scrolling containers never clip it. Opens below the anchor, or
 * above it when there is more room there; `align` picks which side of the anchor it lines up with. Closes
 * on a tap outside, Escape, or a resize. Same look as the PillSelect menu.
 */
export function AnchoredPopover({
  anchor,
  onClose,
  width = 224,
  align = 'end',
  maxHeight = 320,
  children,
}: {
  anchor: DOMRect;
  onClose: () => void;
  width?: number;
  align?: 'start' | 'end';
  maxHeight?: number;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('resize', onClose);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', onClose);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(width, vw - EDGE * 2);
  const preferred = align === 'end' ? anchor.right - w : anchor.left;
  const left = Math.max(EDGE, Math.min(preferred, vw - w - EDGE));
  const below = vh - anchor.bottom - EDGE;
  const above = anchor.top - EDGE;
  const flip = below < 220 && above > below;
  const room = Math.max(120, (flip ? above : below) - GAP);
  const style = flip
    ? { left, width: w, maxHeight: Math.min(maxHeight, room), bottom: vh - anchor.top + GAP }
    : { left, width: w, maxHeight: Math.min(maxHeight, room), top: anchor.bottom + GAP };

  return createPortal(
    <>
      <div className="fixed inset-0 z-[100]" onClick={onClose} />
      <div
        role="dialog"
        style={style}
        className="fixed z-[101] overflow-y-auto overscroll-contain bg-bg-raised border border-border rounded-xl shadow-2xl p-2"
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
