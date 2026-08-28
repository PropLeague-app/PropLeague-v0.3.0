import type { League } from '../../types';
import { weekLabel } from '../../types';
import { LeagueLogo } from '../common/LeagueLogo';
import { buildEmptyRoster, rosterKey } from '../../engine/rosterSlots';
import { validateLineup } from '../../engine/validation';

/** Standard fantasy-app pattern: tap the league name/logo in the home header to swap
 * `currentLeagueId` (manual v0.2.0 §6 #13). Only lists leagues the user is still
 * actually a member of — a league they've left (manual §6 #12) keeps existing for its
 * remaining (now all-simulated) teams, but stops showing up here since `isUser` no
 * longer matches any team in it. Each row's attention badge reuses the same
 * validateLineup the Lineup screen itself runs, so "needs a lineup" always means the
 * same thing everywhere. */
export function LeagueSwitcherSheet({
  leagues,
  currentLeagueId,
  onSwitch,
  onClose,
}: {
  leagues: League[];
  currentLeagueId: string | null;
  onSwitch: (leagueId: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md bg-bg-raised border-t border-border rounded-t-2xl p-4 space-y-3 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold">Your Leagues</h2>
          <button onClick={onClose} className="text-text-muted text-sm">Close</button>
        </div>

        <div className="space-y-2">
          {leagues.map((league) => {
            const userTeam = league.teams.find((t) => t.isUser);
            const isCurrent = league.id === currentLeagueId;
            let needsLineup = false;
            if (userTeam && league.seasonPhase !== 'complete') {
              const roster =
                league.rostersByTeamWeek[rosterKey(userTeam.id, league.currentWeek)] ??
                buildEmptyRoster(userTeam.id, league.currentWeek, league.settings.lineupSlots);
              needsLineup = !validateLineup(roster, league.settings).valid;
            }
            return (
              <button
                key={league.id}
                onClick={() => onSwitch(league.id)}
                className={`w-full flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left ${
                  isCurrent ? 'border-primary bg-primary/10' : 'border-border bg-bg-card'
                }`}
              >
                <LeagueLogo league={league} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{league.name}</p>
                  <p className="text-[11px] text-text-muted">
                    {weekLabel(league.currentWeek)} · {league.teams.length} teams
                    {league.seasonPhase === 'complete' ? ' · Season complete' : ''}
                  </p>
                </div>
                {isCurrent && <span className="text-[10px] text-primary font-semibold shrink-0">CURRENT</span>}
                {!isCurrent && needsLineup && (
                  <span className="text-[10px] text-loss font-semibold shrink-0 bg-loss/10 border border-loss/40 rounded-full px-2 py-0.5">
                    Lineup needed
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
