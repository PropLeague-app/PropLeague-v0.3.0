import type { LeagueTeam } from '../../types';
import { TeamLogo } from './TeamLogo';

/** Shared "browse any league member" chip row (manual v0.1.1 §6 #10, extended to My
 * Stats and Bet History in manual v0.3.0 §5) — one place for the pattern so every
 * screen that lets you view another team's data looks and behaves the same way. */
export function MemberSelector({
  teams,
  selectedTeamId,
  onSelect,
}: {
  teams: LeagueTeam[];
  selectedTeamId: string;
  onSelect: (teamId: string) => void;
}) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
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
