import { useEffect, useRef, useState } from 'react';
import { formatCents } from '../../engine/oddsMath';

export function AnimatedNumber({ value, className = '' }: { value: number; className?: string }) {
  const [displayed, setDisplayed] = useState(value);
  const [flash, setFlash] = useState<'profit' | 'loss' | null>(null);
  const prevValue = useRef(value);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const from = prevValue.current;
    const to = value;
    if (from === to) return;

    setFlash(to > from ? 'profit' : 'loss');
    const duration = 600;
    const start = performance.now();

    function tick(now: number) {
      const progress = Math.min(1, (now - start) / duration);
      setDisplayed(from + (to - from) * progress);
      if (progress < 1) {
        frame.current = requestAnimationFrame(tick);
      } else {
        prevValue.current = to;
      }
    }
    frame.current = requestAnimationFrame(tick);

    const flashTimeout = setTimeout(() => setFlash(null), 900);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      clearTimeout(flashTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const colorClass = displayed > 0 ? 'text-profit' : displayed < 0 ? 'text-loss' : 'text-text';
  const flashClass = flash === 'profit' ? 'flash-profit' : flash === 'loss' ? 'flash-loss' : '';

  return (
    <span className={`${colorClass} ${flashClass} rounded px-0.5 ${className}`}>
      {formatCents(displayed)}
    </span>
  );
}
