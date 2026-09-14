import { Users } from 'lucide-react';
import type { LeagueTeam } from '../../types';
import { LEAGUE_VIEW_ID } from '../../engine/stats';
import { TeamLogo } from './TeamLogo';

/** Shared "browse any league member" chip row (manual v0.1.1 §6 #10, extended to My
 * Stats and Bet History in manual v0.3.0 §5) — one place for the pattern so every
 * screen that lets you view another team's data looks and behaves the same way.
 * `showLeagueOption` (Sept 2026 chat: "league aggregate stats") adds a leading
 * "League" chip that selects LEAGUE_VIEW_ID instead of a real team id — screens opt
 * in per-page since not every MemberSelector caller has a league-aggregate view. */
export function MemberSelector({
  teams,
  selectedTeamId,
  onSelect,
  showLeagueOption = false,
}: {
  teams: LeagueTeam[];
  selectedTeamId: string;
  onSelect: (teamId: string) => void;
  showLeagueOption?: boolean;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {showLeagueOption && (
        <button
          onClick={() => onSelect(LEAGUE_VIEW_ID)}
          className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-semibold border ${
            selectedTeamId === LEAGUE_VIEW_ID ? 'bg-primary text-white border-primary' : 'bg-bg-card border-border text-text-muted'
          }`}
        >
          <Users size={14} />
          League
        </button>
      )}
      {teams.map((t) => (
        <button
          key={t.id}
          onClick={() => onSelect(t.id)}
          className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-semibold border ${
            t.id === selectedTeamId ? 'bg-primary text-white border-primary' : 'bg-bg-card border-border text-text-muted'
          }`}
        >
          <TeamLogo team={t} size="sm" />
          {t.isUser ? 'You' : t.teamName}
        </button>
      ))}
    </div>
  );
}
