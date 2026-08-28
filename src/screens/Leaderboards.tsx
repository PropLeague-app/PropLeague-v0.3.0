import { useAppStore } from '../store/useAppStore';
import { computeLeagueLeaderboards } from '../engine/stats';
import { getGame } from '../services/oddsService';
import { formatCents } from '../engine/oddsMath';
import { BackHeader } from '../components/layout/BackHeader';
import { Card } from '../components/common/Card';
import { TeamLogo } from '../components/common/TeamLogo';
import { MARKET_LABELS, MARKET_SHORT_LABELS } from '../data/propsGenerator';
import type { LeagueTeam } from '../types';

function TeamName({ team }: { team: LeagueTeam | undefined }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${team?.isUser ? 'text-primary font-semibold' : ''}`}>
      {team && <TeamLogo team={team} size="sm" />}
      {team?.teamName ?? 'Unknown'}
    </span>
  );
}

export function Leaderboards() {
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));

  const userTeam = league?.teams.find((t) => t.isUser);
  if (!league) return null;

  const boards = computeLeagueLeaderboards(
    league,
    (gameId) => getGame(gameId, league.currentWeek, league.settings.lineMovementEnabled, league.manualGameOverrides),
    userTeam?.id,
  );
  const teamById = (id: string) => league.teams.find((t) => t.id === id);

  return (
    <div className="flex flex-col">
      <BackHeader title="Leaderboards" fallback="/home" />
      <div className="p-4 space-y-4">
        <Card>
          <p className="text-xs text-text-muted mb-2">Best ROI</p>
          {boards.bestROI.slice(0, 5).map((e, i) => (
            <div key={e.teamId} className="flex justify-between text-xs py-1">
              <span>
                {i + 1}. <TeamName team={teamById(e.teamId)} />
              </span>
              <span className={e.value >= 0 ? 'text-profit' : 'text-loss'}>{(e.value * 100).toFixed(1)}%</span>
            </div>
          ))}
        </Card>

        <Card>
          <p className="text-xs text-text-muted mb-2">Most total profit</p>
          {boards.mostProfit.slice(0, 5).map((e, i) => (
            <div key={e.teamId} className="flex justify-between text-xs py-1">
              <span>
                {i + 1}. <TeamName team={teamById(e.teamId)} />
              </span>
              <span className={e.value >= 0 ? 'text-profit' : 'text-loss'}>{formatCents(e.value)}</span>
            </div>
          ))}
        </Card>

        <Card>
          <p className="text-xs text-text-muted mb-2">Best single week</p>
          {boards.bestSingleWeek.slice(0, 5).map((e, i) => (
            <div key={e.teamId} className="flex justify-between text-xs py-1">
              <span>
                {i + 1}. <TeamName team={teamById(e.teamId)} />
              </span>
              <span className="text-profit">{formatCents(e.value)}</span>
            </div>
          ))}
        </Card>

        <Card>
          <p className="text-xs text-text-muted mb-2">Most bets won</p>
          {boards.mostBetsWon.slice(0, 5).map((e, i) => (
            <div key={e.teamId} className="flex justify-between text-xs py-1">
              <span>
                {i + 1}. <TeamName team={teamById(e.teamId)} />
              </span>
              <span>{e.value}</span>
            </div>
          ))}
        </Card>

        <Card>
          <p className="text-xs text-text-muted mb-2">Position specialists</p>
          {boards.positionSpecialists.map((s) => (
            <div key={s.position} className="flex justify-between text-xs py-1">
              <span>
                Best {s.position} bettor: <TeamName team={teamById(s.teamId)} />
              </span>
              <span className={s.roi >= 0 ? 'text-profit' : 'text-loss'}>{(s.roi * 100).toFixed(1)}%</span>
            </div>
          ))}
        </Card>

        {boards.mostPickedPropsThisWeek.length > 0 && (
          <Card>
            <p className="text-xs text-text-muted mb-2">Most-picked props this week</p>
            {boards.mostPickedPropsThisWeek.map((p) => (
              <div key={`${p.playerName}-${p.marketKey}`} className="flex justify-between text-xs py-1">
                <span>
                  {p.playerName} · {MARKET_SHORT_LABELS[p.marketKey] ?? MARKET_LABELS[p.marketKey]}
                </span>
                <span className="text-text-muted">{p.count} {p.count === 1 ? 'team' : 'teams'}</span>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}
