import { useNavigate } from 'react-router-dom';
import { ChevronRight, DollarSign, Lock } from 'lucide-react';
import type { PrizePool } from '../../types';
import { formatCents } from '../../engine/oddsMath';
import { usePlStyle } from '../common/usePlStyle';

/** One compact line on League Home: the pool now, how far it has moved, and a tap through to the full
 * screen. The amount stays plain unless the pool is actually above what the league bought in for. */
export function PrizePoolTicker({ pool }: { pool: PrizePool }) {
  const navigate = useNavigate();
  const plStyle = usePlStyle();
  const delta = pool.current - pool.initial;
  const up = pool.current > pool.initial;
  return (
    <button
      type="button"
      onClick={() => navigate('/prize-pool')}
      className="w-full flex items-center gap-2.5 rounded-xl border border-border bg-bg-card px-3 py-2 text-left active:opacity-80"
    >
      <span className="shrink-0 w-7 h-7 rounded-full bg-bg-raised flex items-center justify-center text-text-muted">
        <DollarSign size={15} />
      </span>
      <span className="text-xs text-text-muted shrink-0">Prize pool</span>
      <span className={`text-base font-bold tabular-nums ${up ? 'text-profit' : ''}`}>{formatCents(pool.current)}</span>
      <span
        className={`text-[11px] font-semibold tabular-nums ${delta >= 0 ? 'text-profit' : 'text-loss'}`}
        style={plStyle(delta, Math.max(1, pool.initial))}
      >
        {delta >= 0 ? '+' : ''}
        {formatCents(delta)}
      </span>
      <span className="flex-1" />
      {pool.locked && <Lock size={12} className="text-text-muted shrink-0" />}
      <ChevronRight size={16} className="text-text-muted shrink-0" />
    </button>
  );
}
