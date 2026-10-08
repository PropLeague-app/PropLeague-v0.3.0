import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

export interface PillOption<T extends string> {
  value: T;
  label: string;
}

const MENU_MIN_WIDTH = 176;
const MENU_MAX_HEIGHT = 320;
const EDGE = 8;

/**
 * A compact filter/sort chip that opens an in-app themed menu (not the OS picker). The menu is
 * portaled to <body> and positioned from the chip's rect, so it is never clipped by the
 * horizontally scrolling chip rows it lives in. It flips above the chip when there is more room
 * there, scrolls when the list is long, and closes on backdrop tap, Escape, or resize.
 *
 * `active` highlights the chip when it is holding a non-default choice (a filter in effect).
 */
export function PillSelect<T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
  label,
  active = false,
  fill = false,
}: {
  value: T;
  onChange: (value: T) => void;
  options: PillOption<T>[];
  ariaLabel: string;
  /** Overrides the text shown on the chip (for "Sort: ..." style prefixes). Defaults to the selected option. */
  label?: string;
  active?: boolean;
  /** Stretch to the width of its container (a compact form row) instead of hugging its text. */
  fill?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selectedRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((o) => o.value === value);

  const openMenu = () => {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const width = Math.min(Math.max(rect.width, MENU_MIN_WIDTH), vw - EDGE * 2);
    // Line up with the chip's left edge, shifting left if that would run off the screen.
    const left = Math.max(EDGE, Math.min(rect.left, vw - width - EDGE));
    const below = vh - rect.bottom - EDGE;
    const above = rect.top - EDGE;
    const flip = below < 200 && above > below;
    const maxHeight = Math.min(MENU_MAX_HEIGHT, (flip ? above : below) - 6);
    setMenuStyle(
      flip
        ? { left, width, maxHeight, bottom: vh - rect.top + 6 }
        : { left, width, maxHeight, top: rect.bottom + 6 },
    );
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    // Bring the current choice into view in long lists.
    selectedRef.current?.scrollIntoView({ block: 'nearest' });
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className={`items-center gap-1 border text-[11px] font-semibold ${
          fill ? 'flex min-w-0 flex-1 justify-between rounded-lg px-2.5 py-1 text-left' : 'inline-flex shrink-0 rounded-full pl-3 pr-2 py-1'
        } ${active ? 'sel-pill' : 'border-border bg-bg-card text-text-muted'}`}
      >
        <span className={fill ? 'truncate' : 'whitespace-nowrap'}>{label ?? selected?.label ?? ''}</span>
        <ChevronDown size={12} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open &&
        menuStyle &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[100]" onClick={() => setOpen(false)} />
            <div
              role="listbox"
              aria-label={ariaLabel}
              style={menuStyle}
              className="fixed z-[101] overflow-y-auto overscroll-contain bg-bg-raised border border-border rounded-xl shadow-2xl p-1"
            >
              {options.map((o) => {
                const isSelected = o.value === value;
                return (
                  <button
                    key={o.value}
                    ref={isSelected ? selectedRef : undefined}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-xs font-semibold ${
                      isSelected ? 'seg-active' : 'text-text'
                    }`}
                  >
                    <span className="flex-1">{o.label}</span>
                    {isSelected && <Check size={14} className="shrink-0" />}
                  </button>
                );
              })}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
