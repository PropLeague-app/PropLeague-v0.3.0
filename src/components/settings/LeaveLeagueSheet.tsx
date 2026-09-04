import { useState } from 'react';
import type { League } from '../../types';
import { TeamLogo } from '../common/TeamLogo';

/** "Leave This League" confirm flow (manual v0.2.0 §6 #12, fixed in v0.2.1 §4 #3).
 * Spells out the consequences up front, and — only when the departing user is
 * commissioner — routes the successor pick through an explicit "Transfer commissioner
 * role to [team] and leave the league?" verification step before anything actually
 * happens. Picking a name here no longer transfers anything by itself (the v0.2.0 bug):
 * the transfer and the leave now execute together, atomically, only on Confirm; "Choose
 * someone else" backs out to the picker with nothing committed, and Close/the backdrop
 * at any point leaves the league completely untouched. */
export function LeaveLeagueSheet({
  league,
  userTeamId,
  onTransferCommissioner,
  onLeave,
  onClose,
}: {
  league: League;
  userTeamId: string;
  onTransferCommissioner: (newCommissionerTeamId: string) => void;
  onLeave: () => void;
  onClose: () => void;
}) {
  const isCommissioner = league.commissionerTeamId === userTeamId;
  const otherTeams = league.teams.filter((t) => t.id !== userTeamId);
  const [pendingSuccessorId, setPendingSuccessorId] = useState<string | null>(null);
  const pendingSuccessor = otherTeams.find((t) => t.id === pendingSuccessorId) ?? null;

  function confirmTransferAndLeave() {
    if (!pendingSuccessorId) return;
    onTransferCommissioner(pendingSuccessorId);
    onLeave();
  }

  // Non-commissioners skip the picker/confirm step entirely — there's no role to hand off.
  if (isCommissioner && pendingSuccessor) {
    return (
      <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60" onClick={onClose}>
        <div
          className="w-full max-w-md bg-bg-raised border-t border-border rounded-t-2xl p-4 space-y-4"
          style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex justify-between items-start">
            <h2 className="text-lg font-bold">Confirm handoff</h2>
            <button onClick={onClose} className="text-text-muted text-sm">Close</button>
          </div>
          <div className="flex items-center gap-2 bg-bg-card border border-border rounded-lg px-2.5 py-2">
            <TeamLogo team={pendingSuccessor} size="sm" />
            <span className="text-sm font-medium">{pendingSuccessor.teamName}</span>
          </div>
          <p className="text-sm">
            Transfer commissioner role to <strong>{pendingSuccessor.teamName}</strong> and leave {league.name}? This happens in one step — you can't reconsider once confirmed.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPendingSuccessorId(null)}
              className="flex-1 bg-bg-card border border-border font-semibold py-3 rounded-xl text-sm"
            >
              Choose someone else
            </button>
            <button
              onClick={confirmTransferAndLeave}
              className="flex-1 bg-loss/10 text-loss border border-loss/40 font-semibold py-3 rounded-xl text-sm"
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md bg-bg-raised border-t border-border rounded-t-2xl p-4 space-y-4"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start">
          <h2 className="text-lg font-bold">Leave {league.name}?</h2>
          <button onClick={onClose} className="text-text-muted text-sm">Close</button>
        </div>

        <ul className="text-xs text-text-muted list-disc list-inside space-y-1">
          <li>Your team becomes AI-controlled — its schedule, standings, and bet history stay exactly as they are.</li>
          <li>You'll lose access to this league's lineup, settings, and bets.</li>
          <li>This can't be undone from inside the app.</li>
        </ul>

        {isCommissioner ? (
          <div>
            <p className="text-xs font-semibold mb-1.5">
              You're the commissioner — pick who takes over before you can leave:
            </p>
            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {otherTeams.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setPendingSuccessorId(t.id)}
                  className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 border border-border bg-bg-card"
                >
                  <TeamLogo team={t} size="sm" />
                  <span className="text-sm truncate">{t.teamName}</span>
                </button>
              ))}
            </div>
            {otherTeams.length === 0 && (
              <p className="text-xs text-loss mt-1">No other teams to hand off to yet.</p>
            )}
          </div>
        ) : (
          <button
            onClick={onLeave}
            className="w-full bg-loss/10 text-loss border border-loss/40 font-semibold py-3 rounded-xl"
          >
            Leave This League
          </button>
        )}
      </div>
    </div>
  );
}
