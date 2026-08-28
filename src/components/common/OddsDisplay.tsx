import { useAppStore } from '../../store/useAppStore';
import { formatOdds } from '../../engine/oddsMath';

export function OddsDisplay({ odds, className = '' }: { odds: number; className?: string }) {
  const format = useAppStore((s) => s.profile?.oddsFormat ?? 'american');
  return <span className={className}>{formatOdds(odds, format)}</span>;
}
