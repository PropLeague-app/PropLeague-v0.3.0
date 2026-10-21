import { useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, Gauge, Medal, Settings as SettingsIcon, Swords, Ticket, TrendingUp, UserRound, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { useAppStore } from '../store/useAppStore';
import { BackHeader } from '../components/layout/BackHeader';
import { TeamLogo } from '../components/common/TeamLogo';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { collectTeamBets, computeIndividualStats, computeTeamStreak } from '../engine/stats';
import { resolveGame, gameHasStarted } from '../services/oddsService';
import { formatCents } from '../engine/oddsMath';
import { usePlStyle } from '../components/common/usePlStyle';
import { useEnsureSettledWeekRosters } from '../components/common/useEnsureWeekRosters';

/** One league member: who they are, how their season is going, and the way through to everything
 * that belongs to them.
 *
 * A hub rather than a screen that holds other screens. It used to render My Stats and Bet History
 * inline behind a two-way switch, which read as a settings page and, because those two carry their
 * own headers, quietly cost them their share buttons (see chat, Oct 2026). They are full screens
 * again, reached from here with the team in the route, so each keeps its header, its share card and
 * its own member selector.
 *
 * Everything here is scoped to one person. League-wide views live on the league side. */
export function Profile() {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const realGamesById = useAppStore((s) => s.realGamesById);
  const plStyle = usePlStyle();
  // Perfect weeks and settled records are read from past weeks' rosters, same as My Stats.
  useEnsureSettledWeekRosters(league);

  const userTeam = league?.teams.find((t) => t.isUser);
  // No team in the route means "me". An unknown one falls back the same way rather than erroring:
  // a stale link to a team that has since left the league should land somewhere sensible.
  const viewed = (teamId ? league?.teams.find((t) => t.id === teamId) : undefined) ?? userTeam;

  if (!league || !viewed || !userTeam) {
    return (
      <div className="flex flex-col">
        <BackHeader title="Profile" fallback="/home" />
        <div className="p-4">
          <EmptyState icon={<UserRound size={36} strokeWidth={1.5} />} title="No team to show" subtitle="This profile is not part of the league you are viewing." />
        </div>
      </div>
    );
  }

  const isOwn = viewed.id === userTeam.id;
  const standing = league.standings.find((s) => s.teamId === viewed.id);
  const streak = computeTeamStreak(league, viewed.id);
  const record = standing ? `${standing.wins}-${standing.losses}${standing.ties ? `-${standing.ties}` : ''}` : '—';
  const streakText = streak.type && streak.count > 0 ? `${streak.type.toUpperCase()}${streak.count}` : '—';

  // The betting summary, computed the same way My Stats computes it, so the headline numbers here
  // and the screen behind them can never disagree.
  const gameLookup = (gameId: string) => resolveGame(gameId, realGamesById, league.currentWeek, league.settings.lineMovementEnabled);
  const bets = collectTeamBets(league, viewed.id, {
    isOwnTeam: isOwn,
    isGameStarted: (gameId: string) => gameHasStarted(gameLookup(gameId)),
  });
  const stats = computeIndividualStats(bets, gameLookup);
  const pl = stats.totalPL;
  const hasSettled = stats.settledBets > 0;

  const suffix = isOwn ? '' : `/${viewed.id}`;

  return (
    <div className="flex flex-col">
      {/* Your own profile is a tab root, so it gets a plain header like Lineup and NFL Slate rather
          than a back arrow to nowhere, and the gear that is now the only way into Settings. Someone
          else's was pushed onto the stack and keeps its Back. Neither repeats the team name, since
          the identity block directly below says it. */}
      {isOwn ? (
        <div className="flex items-center justify-between px-4 pt-2 pb-3 sticky top-0 bg-bg-raised z-10">
          <h1 className="text-xl font-bold">My Profile</h1>
          <button
            onClick={() => navigate('/settings')}
            aria-label="Settings"
            className="w-9 h-9 rounded-full flex items-center justify-center text-text-muted shrink-0 active:scale-95 tap-44"
          >
            <SettingsIcon size={20} />
          </button>
        </div>
      ) : (
        <BackHeader title="Profile" fallback="/members" />
      )}

      <div className="p-4 space-y-4">
        <div className="flex items-center gap-3">
          <TeamLogo team={viewed} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold truncate">{viewed.teamName}</p>
            <p className="text-xs text-text-muted truncate">
              {viewed.ownerName}
              {viewed.id === league.commissionerTeamId ? ' · Commissioner' : ''}
            </p>
          </div>
        </div>

        {/* The season at a glance. These repeat on the screens below by design: a hub that makes you
            open a screen to learn how someone is doing is a menu, not a hub. */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <Summary value={record} label="Matchups" />
          <Summary
            value={hasSettled ? formatCents(pl) : '—'}
            label="Season P/L"
            className={!hasSettled ? '' : pl >= 0 ? 'text-profit' : 'text-loss'}
            style={hasSettled ? plStyle(pl, Math.max(1, Math.abs(pl))) : undefined}
          />
          <Summary value={streakText} label="Streak" />
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Summary value={hasSettled ? `${stats.wins}-${stats.losses}` : '—'} label="Bets" />
          <Summary value={hasSettled ? `${Math.round(stats.winRate * 100)}%` : '—'} label="Win rate" />
          <Summary
            value={hasSettled ? `${stats.roi >= 0 ? '+' : ''}${(stats.roi * 100).toFixed(1)}%` : '—'}
            label="ROI"
            className={!hasSettled ? '' : stats.roi >= 0 ? 'text-profit' : 'text-loss'}
          />
        </div>

        <div className="space-y-1.5">
          <Entry icon={<TrendingUp size={17} />} label={isOwn ? 'My Stats' : 'Stats'} onClick={() => navigate(`/my-stats${suffix}`)} />
          <Entry icon={<Ticket size={17} />} label={isOwn ? 'My Bets' : 'Bets'} onClick={() => navigate(`/bet-history${suffix}`)} />
          <Entry icon={<Gauge size={17} />} label="Power Rankings" onClick={() => navigate(`/power-rankings/${viewed.id}`)} />
          <Entry icon={<Swords size={17} />} label="Season Schedule" onClick={() => navigate(`/schedule${suffix}`)} />
          {/* The way across to everyone else, which is what makes this a hub rather than a dead end. */}
          <Entry icon={<Users size={17} />} label="League Members" onClick={() => navigate('/members')} />
          {isOwn && <Entry icon={<Medal size={17} />} label="Leaderboards" onClick={() => navigate('/leaderboards')} />}
        </div>
      </div>
    </div>
  );
}

function Summary({ value, label, className = '', style }: { value: string; label: string; className?: string; style?: React.CSSProperties }) {
  return (
    <Card className="py-3 px-1.5">
      <p className={`text-sm font-bold tabular-nums whitespace-nowrap ${className}`} style={style}>
        {value}
      </p>
      <p className="text-[10px] text-text-muted">{label}</p>
    </Card>
  );
}

function Entry({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 bg-bg-card border border-border rounded-xl px-3 py-3 text-left active:opacity-80"
    >
      <span className="text-text-muted shrink-0">{icon}</span>
      <span className="flex-1 min-w-0 truncate text-sm font-semibold">{label}</span>
      <ChevronRight size={16} className="text-text-muted shrink-0" />
    </button>
  );
}
