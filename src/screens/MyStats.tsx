import { useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { computeIndividualStats, collectTeamBets, computeTeamStreak, type RecordPL } from '../engine/stats';
import { getGame } from '../services/oddsService';
import { formatCents } from '../engine/oddsMath';
import { BackHeader } from '../components/layout/BackHeader';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { MemberSelector } from '../components/common/MemberSelector';

function pct(n: number): string {
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
}

function StatRow({ label, rec }: { label: string; rec: RecordPL }) {
  const roi = rec.wagered > 0 ? rec.pl / rec.wagered : 0;
  return (
    <div className="flex items-center justify-between text-xs py-1.5 border-b border-border last:border-0">
      <span className="font-medium">{label}</span>
      <span className="text-text-muted">
        {rec.wins}-{rec.losses}-{rec.pushes}
      </span>
      <span className={rec.pl >= 0 ? 'text-profit' : 'text-loss'}>{formatCents(rec.pl)}</span>
      <span className="text-text-muted w-14 text-right">{rec.wagered > 0 ? pct(roi) : '—'}</span>
    </div>
  );
}

export function MyStats() {
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const userTeam = league?.teams.find((t) => t.isUser);

  // manual v0.3.0 §5: browse any league member's stats, defaulting to the signed-in
  // user's own team — same member-selector pattern as Season Schedule.
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  if (!league || !userTeam) return null;

  const viewedTeam = league.teams.find((t) => t.id === selectedTeamId) ?? userTeam;
  const isOwnTeam = viewedTeam.id === userTeam.id;
  const isGameStarted = (gameId: string) =>
    getGame(gameId, league.currentWeek, league.settings.lineMovementEnabled, league.manualGameOverrides)?.status !== 'upcoming';

  const bets = collectTeamBets(league, viewedTeam.id, { isOwnTeam, isGameStarted });
  const stats = computeIndividualStats(bets, (gameId) => getGame(gameId, league.currentWeek, league.settings.lineMovementEnabled, league.manualGameOverrides));
  const matchupStreak = computeTeamStreak(league, viewedTeam.id);
  const title = isOwnTeam ? 'My Stats' : `${viewedTeam.teamName}'s Stats`;

  if (stats.settledBets === 0) {
    return (
      <div className="flex flex-col">
        <BackHeader title={title} fallback="/bet-history" />
        <div className="p-4 space-y-3">
          <MemberSelector teams={league.teams} selectedTeamId={viewedTeam.id} onSelect={setSelectedTeamId} />
          <EmptyState icon={<TrendingUp size={36} strokeWidth={1.5} />} title="No settled bets yet" subtitle={isOwnTeam ? 'Advanced stats show up once your picks start settling.' : "This team's advanced stats show up once their picks start settling."} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <BackHeader title={title} fallback="/bet-history" />
      <div className="p-4 space-y-4">
        <MemberSelector teams={league.teams} selectedTeamId={viewedTeam.id} onSelect={setSelectedTeamId} />
        <div className="grid grid-cols-4 gap-2 text-center">
          <Card className="py-3">
            <p className={`text-sm font-bold ${stats.roi >= 0 ? 'text-profit' : 'text-loss'}`}>{pct(stats.roi)}</p>
            <p className="text-[10px] text-text-muted">ROI</p>
          </Card>
          <Card className="py-3">
            <p className={`text-sm font-bold ${stats.totalPL >= 0 ? 'text-profit' : 'text-loss'}`}>{formatCents(stats.totalPL)}</p>
            <p className="text-[10px] text-text-muted">Total P/L</p>
          </Card>
          <Card className="py-3">
            <p className="text-sm font-bold">{formatCents(stats.avgStake)}</p>
            <p className="text-[10px] text-text-muted">Avg stake</p>
          </Card>
          <Card className="py-3">
            <p className="text-sm font-bold">
              {stats.wins}-{stats.losses}-{stats.pushes}
            </p>
            <p className="text-[10px] text-text-muted">Record</p>
          </Card>
        </div>

        <Card>
          <p className="text-xs text-text-muted mb-1">By position slot</p>
          {(['QB', 'RB', 'WR', 'TE', 'K', 'ML'] as const).map(
            (pos) => stats.byPosition[pos] && <StatRow key={pos} label={pos} rec={stats.byPosition[pos]!} />,
          )}
        </Card>

        <Card>
          <p className="text-xs text-text-muted mb-1">Favorite vs. underdog</p>
          <StatRow label="Favorite (−odds)" rec={stats.byOddsRange.favorite} />
          <StatRow label="Underdog (+odds)" rec={stats.byOddsRange.underdog} />
        </Card>

        <Card>
          <p className="text-xs text-text-muted mb-1">Over vs. under</p>
          <StatRow label="Over" rec={stats.byOverUnder.over} />
          <StatRow label="Under" rec={stats.byOverUnder.under} />
        </Card>

        <Card>
          <p className="text-xs text-text-muted mb-1">By stake size</p>
          <StatRow label="Small (< $10)" rec={stats.byStakeSize.small} />
          <StatRow label="Medium ($10–25)" rec={stats.byStakeSize.medium} />
          <StatRow label="Large (> $25)" rec={stats.byStakeSize.large} />
        </Card>

        <Card>
          <p className="text-xs text-text-muted mb-1">By day slot</p>
          {(['TNF', 'SUN_EARLY', 'SUN_LATE', 'SNF', 'MNF'] as const).map(
            (slot) => stats.byDaySlot[slot] && <StatRow key={slot} label={slot.replace('_', ' ')} rec={stats.byDaySlot[slot]!} />,
          )}
        </Card>

        <Card className="flex items-center justify-between">
          <div>
            <p className="text-xs text-text-muted">Current matchup streak</p>
            <p className="text-[10px] text-text-muted">Head-to-head, not individual bets</p>
          </div>
          <p className={`text-lg font-bold ${matchupStreak.type === 'W' ? 'text-profit' : matchupStreak.type === 'L' ? 'text-loss' : 'text-text-muted'}`}>
            {matchupStreak.type ? `${matchupStreak.type}${matchupStreak.count}` : '—'}
          </p>
        </Card>

        <Card className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] text-text-muted">Longest win streak (bets)</p>
            <p className="text-sm font-bold text-profit">{stats.longestWinStreak}</p>
          </div>
          <div>
            <p className="text-[10px] text-text-muted">Longest loss streak (bets)</p>
            <p className="text-sm font-bold text-loss">{stats.longestLossStreak}</p>
          </div>
          <div>
            <p className="text-[10px] text-text-muted">Biggest single win</p>
            <p className="text-sm font-bold text-profit">{formatCents(stats.biggestWin)}</p>
          </div>
          <div>
            <p className="text-[10px] text-text-muted">Biggest single loss</p>
            <p className="text-sm font-bold text-loss">{formatCents(stats.biggestLoss)}</p>
          </div>
          <div>
            <p className="text-[10px] text-text-muted">Pushes</p>
            <p className="text-sm font-bold">{stats.pushes}</p>
          </div>
          <div>
            <p className="text-[10px] text-text-muted">Voids</p>
            <p className="text-sm font-bold">{stats.voids}</p>
          </div>
        </Card>
      </div>
    </div>
  );
}