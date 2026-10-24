import { X } from 'lucide-react';
import { VoidRequestsCard } from '../settings/VoidRequestsCard';
import type { WeekId } from '../../types';

/** Void Requests opened from League Home: the same card Settings shows, in a sheet. */
export function VoidRequestsSheet({
  leagueId,
  week,
  isCommissioner,
  onClose,
}: {
  leagueId: string;
  week: WeekId;
  isCommissioner: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md bg-bg-raised border-t border-border rounded-t-2xl p-4 space-y-3 max-h-[85vh] overflow-y-auto overscroll-contain"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center gap-3">
          <h2 className="text-base font-bold leading-tight">Void Requests</h2>
          <button onClick={onClose} aria-label="Close" className="text-text-muted -mr-1 p-1 shrink-0 tap-44">
            <X size={20} />
          </button>
        </div>
        <VoidRequestsCard leagueId={leagueId} week={week} isCommissioner={isCommissioner} embedded />
      </div>
    </div>
  );
}
