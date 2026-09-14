import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { TrendingUp } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { computeIndividualStats, collectTeamBets, collectLeagueBets, computeTeamStreak, LEAGUE_VIEW_ID, type RecordPL } from '../engine/stats';
import { resolveGame, gameHasStarted } from '../services/oddsService';
import { formatCents } from '../engine/oddsMath';
import { BackHeader } from '../components/layout/BackHeader';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { MemberSelector } from '../components/common/MemberSelector';

function pct(n: number): string {
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
}

// Fixed-width record/PL/ROI columns (rather than flex's justify-between, which
// sizes each column to its own row's content) so every StatRow lines up
// identically across every card on this screen -- see chat: "general alignment
// ... can be cleaner". whitespace-nowrap on every value also stops the browser's
// default line-breaking-after-a-hyphen behavior from splitting e.g. "-$47.25"
// onto its own line inside a narrow column (see chat: the P/L wrap bug).
function StatRow({ label, rec }: { label: string; rec: RecordPL }) {
  const roi = rec.wagered > 0 ? rec.pl / rec.wagered : 0;
  return (
    <div className="flex items-center gap-2 text-xs py-1.5 border-b border-border last:border-0">
      <span className="font-medium flex-1 min-w-0 truncate">{label}</span>
      <span className="text-text-muted w-11 text-right whitespace-nowrap">
        {rec.wins}-{rec.losses}-{rec.pushes}
      </span>
      <span className={`w-16 text-right whitespace-nowrap ${rec.pl >= 0 ? 'text-profit' : 'text-loss'}`}>{formatCents(rec.pl)}</span>
      <span className="text-text-muted w-14 text-right whitespace-nowrap">{rec.wagered > 0 ? pct(roi) : '—'}</span>
    </div>
  );
}

export function MyStats() {
  const location = useLocation();
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const userTeam = league?.teams.find((t) => t.isUser);
  const realGamesById = useAppStore((s) => s.realGamesById);
  const loadRealGame = useAppStore((s) => s.loadRealGame);

  // manual v0.3.0 §5: browse any league member's stats, defaulting to the signed-in
  // user's own team -- same member-selector pattern as Season Schedule. Landing here
  // from BetHistory's "View league stats ->" link (Sept 2026 chat) presets the
  // league-aggregate view via router state, same convention as Auth/ProfileSetup's
  // location.state 'next' handoff.
  const presetView = (location.state as { view?: 'league' } | null)?.view;
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(presetView === 'league' ? LEAGUE_VIEW_ID : null);
  const viewedTeamId = selectedTeamId ?? userTeam?.id;
  const isLeagueView = selectedTeamId === LEAGUE_VIEW_ID;

  // Same reasoning as BetHistory.tsx: stats span every past week this team has
  // ever bet on, so every real game across the team's whole history needs to be
  // loaded, or gameHasStarted silently falls back to "unknown" (see chat). In the
  // league-aggregate view that widens to every real game every team has ever bet on.
  useEffect(() => {
    if (!league || !viewedTeamId) return;
    const gameIds = new Set<string>();
    for (const roster of Object.values(league.rostersByTeamWeek)) {
      if (!isLeagueView && roster.teamId !== viewedTeamId) continue;
      for (const slot of roster.slots) if (slot.wager) gameIds.add(slot.wager.gameId);
    }
    for (const gameId of gameIds) if (!realGamesById[gameId]) loadRealGame(gameId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league, viewedTeamId, isLeagueView]);

  if (!league || !userTeam) return null;

  const viewedTeam = isLeagueView ? undefined : (league.teams.find((t) => t.id === selectedTeamId) ?? userTeam);
  const isOwnTeam = !isLeagueView && viewedTeam?.id === userTeam.id;
  const gameLookup = (gameId: string) => resolveGame(gameId, realGamesById, league.currentWeek, league.settings.lineMovementEnabled, league.manualGameOverrides);
  const isGameStarted = (gameId: string) => gameHasStarted(gameLookup(gameId));

  const bets = isLeagueView
    ? collectLeagueBets(league, userTeam.id, isGameStarted)
    : collectTeamBets(league, viewedTeam!.id, { isOwnTeam, isGameStarted });
  const stats = computeIndividualStats(bets, gameLookup);
  const matchupStreak = isLeagueView ? null : computeTeamStreak(league, viewedTeam!.id);
  const title = isLeagueView ? 'League Stats' : isOwnTeam ? 'My Stats' : `${viewedTeam!.teamName}'s Stats`;

  if (stats.settledBets === 0) {
    return (
      <div className="flex flex-col">
        <BackHeader title={title} fallback="/bet-history" />
        <div className="p-4 space-y-3">
          <MemberSelector teams={league.teams} selectedTeamId={viewedTeamId ?? userTeam.id} onSelect={setSelectedTeamId} showLeagueOption />
          <EmptyState
            icon={<TrendingUp size={36} strokeWidth={1.5} />}
            title="No settled bets yet"
            subtitle={
              isLeagueView
                ? "The league's advanced stats show up once picks start settling."
                : isOwnTeam
                  ? 'Advanced stats show up once your picks start settling.'
                  : "This team's advanced stats show up once their picks start settling."
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <BackHeader title={title} fallback="/bet-history" />
      <div className="p-4 space-y-4">
        <MemberSelector teams={league.teams} selectedTeamId={viewedTeamId ?? userTeam.id} onSelect={setSelectedTeamId} showLeagueOption />
        <div className="grid grid-cols-4 gap-2 text-center">
          <Card className="py-3 px-1.5">
            <p className={`text-sm font-bold whitespace-nowrap ${stats.roi >= 0 ? 'text-profit' : 'text-loss'}`}>{pct(stats.roi)}</p>
            <p className="text-[10px] text-text-muted">ROI</p>
          </Card>
          <Card className="py-3 px-1.5">
            <p className={`text-sm font-bold whitespace-nowrap ${stats.totalPL >= 0 ? 'text-profit' : 'text-loss'}`}>{formatCents(stats.totalPL)}</p>
            <p className="text-[10px] text-text-muted">Total P/L</p>
          </Card>
          <Card className="py-3 px-1.5">
            <p className="text-sm font-bold whitespace-nowrap">{formatCents(stats.avgStake)}</p>
            <p className="text-[10px] text-text-muted">Avg stake</p>
          </Card>
          <Card className="py-3 px-1.5">
            <p className="text-sm font-bold whitespace-nowrap">
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

        {!isLeagueView && matchupStreak && (
          <Card className="flex items-center justify-between">
            <div>
              <p className="text-xs text-text-muted">Current matchup streak</p>
              <p className="text-[10px] text-text-muted">Head-to-head, not individual bets</p>
            </div>
            <p className={`text-lg font-bold ${matchupStreak.type === 'W' ? 'text-profit' : matchupStreak.type === 'L' ? 'text-loss' : 'text-text-muted'}`}>
              {matchupStreak.type ? `${matchupStreak.type}${matchupStreak.count}` : '—'}
            </p>
          </Card>
        )}

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
            <p className="text-sm font-bold text-profit whitespace-nowrap">{formatCents(stats.biggestWin)}</p>
          </div>
          <div>
            <p className="text-[10px] text-text-muted">Biggest single loss</p>
            <p className="text-sm font-bold text-loss whitespace-nowrap">{formatCents(stats.biggestLoss)}</p>
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
