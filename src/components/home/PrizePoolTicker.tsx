import { useNavigate } from 'react-router-dom';
import type { PrizePool } from '../../types';
import { AnimatedNumber } from '../common/AnimatedNumber';
import { Card } from '../common/Card';

export function PrizePoolTicker({ pool }: { pool: PrizePool }) {
  const navigate = useNavigate();
  return (
    <Card onClick={() => navigate('/prize-pool')} className="flex items-center justify-between">
      <div>
        <p className="text-xs text-text-muted">{pool.locked ? 'Prize pool (locked)' : 'Prize pool'}</p>
        <AnimatedNumber value={pool.current} className="text-xl font-bold" />
      </div>
      <span className="text-2xl">💰</span>
    </Card>
  );
}
