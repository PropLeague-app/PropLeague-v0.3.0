import type { LeagueTeam } from '../../types';
import { Card } from '../common/Card';
import { TeamLogo } from '../common/TeamLogo';

export interface UpcomingSide {
  team?: LeagueTeam;
  /** Shown instead of a team that is not known yet ("Winner of Semifinal 1"). */
  placeholder?: string;
  /** Small line under the name: the season record, or a playoff seed. */
  sub?: string;
}

/** A game that has not started: both sides with their record or seed, and nothing else (no $0.00 or
 * win chance). Your own team's name is in the primary color. */
export function UpcomingMatchupCard({
  a,
  b,
  userTeamId,
  dashed,
  onClick,
}: {
  a: UpcomingSide;
  b: UpcomingSide;
  userTeamId?: string;
  /** A projected pairing (the bracket as if the season ended today). */
  dashed?: boolean;
  onClick?: () => void;
}) {
  return (
    <Card onClick={onClick} className={`flex items-center gap-2 ${dashed ? 'border-dashed' : ''} ${a.team?.id === userTeamId || b.team?.id === userTeamId ? 'ring-1 ring-primary/40' : ''}`}>
      <Side side={a} userTeamId={userTeamId} />
      <span className="shrink-0 text-[11px] font-bold text-text-muted">VS</span>
      <Side side={b} userTeamId={userTeamId} reverse />
    </Card>
  );
}

function Side({ side, userTeamId, reverse }: { side: UpcomingSide; userTeamId?: string; reverse?: boolean }) {
  return (
    <div className={`flex items-center gap-2 min-w-0 flex-1 ${reverse ? 'flex-row-reverse text-right' : ''}`}>
      {side.team ? (
        <TeamLogo team={side.team} size="sm" />
      ) : (
        <span className="w-6 h-6 shrink-0 rounded-full border border-dashed border-border" />
      )}
      <div className="min-w-0">
        <p className={`text-xs font-medium truncate ${side.team ? (side.team.id === userTeamId ? 'text-primary' : '') : 'italic text-text-muted'}`}>
          {side.team?.teamName ?? side.placeholder ?? 'TBD'}
        </p>
        {side.sub && <p className="text-[10px] text-text-muted tabular-nums">{side.sub}</p>}
      </div>
    </div>
  );
}
