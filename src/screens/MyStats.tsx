import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight, Flame, TrendingUp } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { computeIndividualStats, collectTeamBets, collectLeagueBets, computeTeamStreak, LEAGUE_VIEW_ID, type RecordPL } from '../engine/stats';
import { resolveGame, gameHasStarted } from '../services/oddsService';
import { formatCents } from '../engine/oddsMath';
import { BackHeader } from '../components/layout/BackHeader';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { MemberSelector } from '../components/common/MemberSelector';
import { usePlStyle } from '../components/common/usePlStyle';
import { useEnsureSettledWeekRosters } from '../components/common/useEnsureWeekRosters';
import { leagueSeasonAtRisk, REFERENCE_FLOOR_SHARE, seasonScaleRef } from '../engine/plColor';
import { perfectWeeksForTeam } from '../engine/perfectWeek';
import { weekLabel, type WeekId } from '../types';
import { ODDS_BUCKETS, ODDS_BUCKET_LABELS, type BetPreset } from '../engine/betFilters';
import { bestAndWorstWeek, matchupStats, playerHighlights, playerRecords, unspentCredits, weeklyPL, type PlayerRecord } from '../engine/statsExtra';
import { MARKET_LABELS } from '../data/propsGenerator';
import { TeamLogo } from '../components/common/TeamLogo';
import { ShareButton } from '../share/ShareButton';
import { StatsShareCard, type StatsCardData } from '../share/cards/StatsShareCard';
import { StatsTabShareCard, type Highlight, type ShareCell, type TabBlock, type TableRow } from '../share/cards/StatsTabShareCard';

function pct(n: number): string {
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
}

// Fixed-width record/PL/ROI columns (rather than flex's justify-between, which
// sizes each column to its own row's content) so every StatRow lines up
// identically across every card on this screen -- see chat: "general alignment
// ... can be cleaner". whitespace-nowrap on every value also stops the browser's
// default line-breaking-after-a-hyphen behavior from splitting e.g. "-$47.25"
// onto its own line inside a narrow column (see chat: the P/L wrap bug).
function StatRow({ label, rec, onClick }: { label: string; rec: RecordPL; onClick?: () => void }) {
  const roi = rec.wagered > 0 ? rec.pl / rec.wagered : 0;
  const body = (
    <>
      <span className="font-medium flex-1 min-w-0 truncate text-left">{label}</span>
      <span className="text-text-muted w-11 text-right whitespace-nowrap">
        {rec.wins}-{rec.losses}-{rec.pushes}
      </span>
      <span className={`w-16 text-right whitespace-nowrap ${rec.pl >= 0 ? 'text-profit' : 'text-loss'}`}>{formatCents(rec.pl)}</span>
      <span className="text-text-muted w-14 text-right whitespace-nowrap">{rec.wagered > 0 ? pct(roi) : '—'}</span>
      {onClick && <ChevronRight size={12} className="text-text-muted shrink-0 -mr-1" />}
    </>
  );
  const cls = 'flex items-center gap-2 text-xs py-1.5 border-b border-border last:border-0 w-full';
  return onClick ? (
    <button onClick={onClick} className={`${cls} active:opacity-70`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Column captions for a breakdown card, lined up with StatRow's fixed columns. */
function ColHeads() {
  return (
    <div className="flex items-center gap-2 text-[9px] uppercase tracking-wide text-text-muted pb-1 border-b border-border">
      <span className="flex-1" />
      <span className="w-11 text-right">W-L-P</span>
      <span className="w-16 text-right">P/L</span>
      <span className="w-14 text-right">ROI</span>
    </div>
  );
}

type StatsTab = 'overview' | 'markets' | 'trends' | 'matchups';

/** One bar per week, profit up and loss down from a shared baseline. */
function WeeklyBars({ weeks }: { weeks: { week: WeekId; pl: number }[] }) {
  const maxAbs = Math.max(1, ...weeks.map((w) => Math.abs(w.pl)));
  const HALF = 44;
  return (
    <div className="flex items-stretch gap-1.5 overflow-x-auto pb-1">
      {weeks.map((w) => {
        const h = Math.max(2, Math.round((Math.abs(w.pl) / maxAbs) * HALF));
        return (
          <div key={String(w.week)} className="flex flex-col items-center shrink-0 w-7" title={`${weekLabel(w.week)}: ${formatCents(w.pl)}`}>
            <div className="flex items-end" style={{ height: HALF }}>
              {w.pl >= 0 && <div className="w-4 rounded-t bg-profit" style={{ height: h }} />}
            </div>
            <div className="w-full h-px bg-border" />
            <div className="flex items-start" style={{ height: HALF }}>
              {w.pl < 0 && <div className="w-4 rounded-b bg-loss" style={{ height: h }} />}
            </div>
            <span className="text-[9px] text-text-muted mt-0.5">{typeof w.week === 'number' ? w.week : weekLabel(w.week).slice(0, 3)}</span>
          </div>
        );
      })}
    </div>
  );
}

function PlayerList({ title, rows, onPick }: { title: string; rows: PlayerRecord[]; onPick: (name: string) => void }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-text-muted mb-0.5">{title}</p>
      {rows.map((r) => (
        <button key={r.playerName} onClick={() => onPick(r.playerName)} className="flex items-center gap-2 text-xs py-1.5 border-b border-border last:border-0 w-full active:opacity-70">
          <span className="font-medium flex-1 min-w-0 truncate text-left">{r.playerName}</span>
          <span className="text-text-muted w-11 text-right whitespace-nowrap">
            {r.wins}-{r.losses}-{r.pushes}
          </span>
          <span className={`w-16 text-right whitespace-nowrap ${r.pl >= 0 ? 'text-profit' : 'text-loss'}`}>{formatCents(r.pl)}</span>
          <span className="text-text-muted w-8 text-right whitespace-nowrap">{r.picks}x</span>
          <ChevronRight size={12} className="text-text-muted shrink-0 -mr-1" />
        </button>
      ))}
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
  const plStyle = usePlStyle();
  const navigate = useNavigate();
  const [tab, setTab] = useState<StatsTab>('overview');
  // Past weeks' rosters are what perfect weeks are judged from.
  useEnsureSettledWeekRosters(league);

  // manual v0.3.0 §5: browse any league member's stats, defaulting to the signed-in
  // user's own team -- same member-selector pattern as Season Schedule. Landing here
  // from BetHistory's "View league stats ->" link (Sept 2026 chat) presets the
  // league-aggregate view via router state, same convention as Auth/ProfileSetup's
  // location.state 'next' handoff.
  const presetState = location.state as { view?: 'league'; team?: string } | null;
  const presetView = presetState?.view;
  // A tapped row on Leaderboards opens that team's stats directly.
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(presetView === 'league' ? LEAGUE_VIEW_ID : (presetState?.team ?? null));
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

  // Tap a row to see the bets behind it: lands on Bets with the filter already applied.
  const teamForPreset = isLeagueView ? LEAGUE_VIEW_ID : viewedTeam!.id;
  const drill = (preset: Omit<BetPreset, 'team' | 'settledOnly'>) => () =>
    navigate('/bet-history', { state: { preset: { team: teamForPreset, settledOnly: true, ...preset } } });

  const weekly = weeklyPL(bets);
  const { best: bestWeek, worst: worstWeek } = bestAndWorstWeek(weekly);
  const highlights = playerHighlights(playerRecords(bets));
  const unspent = isLeagueView
    ? league.teams.reduce((sum, t) => sum + unspentCredits(league, t.id).total, 0)
    : unspentCredits(league, viewedTeam!.id).total;
  const matchup = isLeagueView ? null : matchupStats(league, viewedTeam!.id);
  const marketRows = (Object.entries(stats.byMarket) as [keyof typeof MARKET_LABELS, RecordPL][]).sort(([, a], [, b]) => b.wagered - a.wagered);
  const tabs: { id: StatsTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'markets', label: 'Markets' },
    { id: 'trends', label: 'Trends' },
    ...(isLeagueView ? [] : [{ id: 'matchups' as StatsTab, label: 'Matchups' }]),
  ];
  const activeTab: StatsTab = tabs.some((t) => t.id === tab) ? tab : 'overview';
  const edge = (stats.winRate - stats.impliedWinRate) * 100;
  const breakEven = stats.avgWin + stats.avgLoss > 0 ? stats.avgLoss / (stats.avgWin + stats.avgLoss) : 0;
  const teamName = (id: string) => league.teams.find((t) => t.id === id);

  // Share: the numbers on this screen as one picture (a fixed-size card, not a screenshot).
  const perfectCount = !isLeagueView && viewedTeam ? perfectWeeksForTeam(league, viewedTeam.id).length : null;
  const shareData: StatsCardData = {
    leagueName: league.name,
    title: isLeagueView ? 'League Stats' : 'Season Stats',
    subtitle: `${stats.settledBets} settled bet${stats.settledBets === 1 ? '' : 's'}`,
    identity: isLeagueView ? league : viewedTeam!,
    initials: isLeagueView ? league.name.slice(0, 2).toUpperCase() : viewedTeam!.abbrev,
    name: isLeagueView ? league.name : viewedTeam!.teamName,
    totalPL: stats.totalPL,
    plRef: isLeagueView ? REFERENCE_FLOOR_SHARE * leagueSeasonAtRisk(league) : seasonScaleRef(league),
    roiText: pct(stats.roi),
    roiPositive: stats.roi >= 0,
    tiles: [
      { label: 'RECORD', value: `${stats.wins}-${stats.losses}-${stats.pushes}` },
      { label: 'WIN RATE', value: `${Math.round(stats.winRate * 100)}%` },
      { label: 'AVG STAKE', value: formatCents(stats.avgStake) },
      { label: 'BIGGEST WIN', value: formatCents(stats.biggestWin), tone: 'profit' },
      { label: 'WIN STREAK', value: String(stats.longestWinStreak), tone: 'profit' },
      perfectCount != null
        ? { label: 'PERFECT WEEKS', value: String(perfectCount) }
        : { label: 'WAGERED', value: formatCents(stats.totalWagered) },
    ],
    winRate: stats.winRate,
    impliedWinRate: stats.impliedWinRate,
    markets: marketRows
      .filter(([, rec]) => rec.wins + rec.losses > 0)
      .sort(([, a], [, b]) => b.pl - a.pl)
      .slice(0, 3)
      .map(([key, rec]) => ({ label: MARKET_LABELS[key], record: `${rec.wins}-${rec.losses}-${rec.pushes}`, pl: rec.pl })),
  };

  // Each tab shares its own picture: Overview is the headline card, the others mirror what the tab
  // lists (tables, weekly bars, head-to-head), so the image matches the screen you are on.
  const hasData = (rec: RecordPL | undefined): rec is RecordPL => !!rec && rec.wins + rec.losses + rec.pushes > 0;
  const recCells = (rec: RecordPL): ShareCell[] => [
    { text: `${rec.wins}-${rec.losses}-${rec.pushes}` },
    { text: formatCents(rec.pl), amount: rec.pl },
    { text: rec.wagered > 0 ? pct(rec.pl / rec.wagered) : '-', muted: true },
  ];
  type Rec = { label: string; rec: RecordPL | undefined };
  const recTable = (title: string, items: Rec[], minRows = 1, maxRows = 99): TabBlock | null => {
    const rows: TableRow[] = items
      .filter((x): x is { label: string; rec: RecordPL } => hasData(x.rec))
      .slice(0, maxRows)
      .map((x) => ({ label: x.label, cells: recCells(x.rec) }));
    return rows.length >= minRows ? { kind: 'table', title, heads: ['W-L-P', 'P/L', 'ROI'], rows } : null;
  };
  const playerTable = (title: string, rows: PlayerRecord[]): TabBlock | null =>
    rows.length === 0
      ? null
      : {
          kind: 'table',
          title,
          heads: ['W-L-P', 'P/L', 'PICKS'],
          rows: rows.slice(0, 3).map((r) => ({
            label: r.playerName,
            cells: [{ text: `${r.wins}-${r.losses}-${r.pushes}` }, { text: formatCents(r.pl), amount: r.pl }, { text: `${r.picks}x`, muted: true }],
          })),
        };
  const compact = <T,>(items: (T | null)[]): T[] => items.filter((x): x is T => x !== null);
  const recText = (rec: RecordPL) => `${rec.wins}-${rec.losses}-${rec.pushes}`;
  /** The best (or worst) entry by profit among the ones with decided bets. */
  const extreme = (items: Rec[], dir: 'best' | 'worst', label: string, requireLoss = false): Highlight | null => {
    const decided = items.filter((x): x is { label: string; rec: RecordPL } => !!x.rec && x.rec.wins + x.rec.losses > 0);
    if (decided.length === 0) return null;
    const pick = decided.reduce((a, b) => ((dir === 'best' ? b.rec.pl > a.rec.pl : b.rec.pl < a.rec.pl) ? b : a));
    if (requireLoss && !(pick.rec.pl < 0)) return null;
    return { label, name: pick.label, value: formatCents(pick.rec.pl), amount: pick.rec.pl, sub: recText(pick.rec) };
  };
  const marketItems: Rec[] = marketRows.map(([key, rec]) => ({ label: MARKET_LABELS[key], rec }));
  const slotItems: Rec[] = (['QB', 'RB', 'WR', 'TE', 'K', 'ML'] as const).map((pos) => ({ label: pos, rec: stats.byPosition[pos] }));
  const oddsItems: Rec[] = ODDS_BUCKETS.map((b) => ({ label: ODDS_BUCKET_LABELS[b].split(' (')[0], rec: stats.byOddsBucket[b] }));
  const daySlotItems: Rec[] = (['TNF', 'SUN_EARLY', 'SUN_LATE', 'SNF', 'MNF'] as const).map((slot) => ({ label: slot.replace('_', ' '), rec: stats.byDaySlot[slot] }));
  const byProfit = (items: Rec[]) => [...items].sort((a, b) => (b.rec?.pl ?? 0) - (a.rec?.pl ?? 0));
  const tabBlocks = (): TabBlock[] => {
    if (activeTab === 'markets') {
      const ou: Rec[] = [{ label: 'Overs', rec: stats.byOverUnder.over }, { label: 'Unders', rec: stats.byOverUnder.under }];
      const items = compact<Highlight>([
        extreme(marketItems, 'best', 'BEST MARKET'),
        extreme(marketItems, 'worst', 'WORST MARKET', true),
        extreme(slotItems, 'best', 'BEST SLOT'),
        extreme(oddsItems, 'best', 'BEST ODDS RANGE'),
        hasData(stats.byOverUnder.over) && hasData(stats.byOverUnder.under) ? extreme(ou, 'best', 'OVER VS UNDER') : null,
      ]).slice(0, 4);
      return compact<TabBlock>([
        items.length > 0 ? { kind: 'highlights', items } : null,
        recTable('Top markets', byProfit(marketItems), 1, 5),
        recTable('Position slots', slotItems),
      ]);
    }
    if (activeTab === 'trends') {
      const wk = (w: WeekId) => (typeof w === 'number' ? `Week ${w}` : weekLabel(w));
      const topPlayer = highlights.best[0] ?? highlights.mostPicked[0];
      const items = compact<Highlight>([
        bestWeek ? { label: 'BEST WEEK', name: wk(bestWeek.week), value: formatCents(bestWeek.pl), amount: bestWeek.pl } : null,
        worstWeek && weekly.length > 1 ? { label: 'WORST WEEK', name: wk(worstWeek.week), value: formatCents(worstWeek.pl), amount: worstWeek.pl } : null,
        extreme(daySlotItems, 'best', 'BEST DAY SLOT'),
        topPlayer
          ? { label: highlights.best[0] ? 'TOP PLAYER' : 'MOST PICKED', name: topPlayer.playerName, value: formatCents(topPlayer.pl), amount: topPlayer.pl, sub: `${topPlayer.picks}x` }
          : null,
      ]);
      return compact<TabBlock>([
        items.length > 0 ? { kind: 'highlights', items } : null,
        weekly.length === 0
          ? null
          : {
              kind: 'bars',
              title: 'Profit by week',
              weeks: weekly.map((w) => ({ label: typeof w.week === 'number' ? String(w.week) : weekLabel(w.week).slice(0, 3), pl: w.pl })),
            },
        recTable('By day slot', daySlotItems),
        recTable(
          'By stake size',
          [
            { label: 'Small (< $10)', rec: stats.byStakeSize.small },
            { label: 'Medium ($10 to $25)', rec: stats.byStakeSize.medium },
            { label: 'Large (> $25)', rec: stats.byStakeSize.large },
          ],
          2,
        ),
        playerTable('Best for profit', highlights.best),
      ]);
    }
    if (activeTab === 'matchups' && matchup && matchup.weeks > 0) {
      const dash = (w: number, l: number, t: number) => `${w}-${l}${t ? `-${t}` : ''}`;
      return compact<TabBlock>([
        {
          kind: 'tiles',
          cols: 2,
          tiles: [
            { label: 'MATCHUP RECORD', value: dash(matchup.record.wins, matchup.record.losses, matchup.record.ties) },
            { label: 'ALL-PLAY RECORD', value: dash(matchup.allPlay.wins, matchup.allPlay.losses, matchup.allPlay.ties) },
            { label: 'POINTS FOR', value: formatCents(matchup.pointsFor), amount: matchup.pointsFor },
            { label: 'POINTS AGAINST', value: formatCents(matchup.pointsAgainst), amount: matchup.pointsAgainst },
          ],
        },
        matchup.headToHead.length === 0
          ? null
          : {
              kind: 'table',
              title: 'Head to head',
              heads: ['W-L', 'MARGIN'],
              rows: matchup.headToHead.map((h) => {
                const opp = teamName(h.opponentId);
                const diff = h.pointsFor - h.pointsAgainst;
                return {
                  label: opp?.teamName ?? 'Unknown',
                  logo: opp ? { identity: opp, initials: opp.abbrev } : undefined,
                  cells: [{ text: dash(h.wins, h.losses, h.ties) }, { text: formatCents(diff), amount: diff }],
                };
              }),
            },
      ]);
    }
    return [];
  };
  const tabShareTitle = activeTab === 'overview' ? 'Overview' : activeTab === 'markets' ? 'Markets' : activeTab === 'trends' ? 'Trends' : 'Matchups';
  const tabSharable = activeTab === 'overview' || tabBlocks().length > 0;
  const renderShareCard = () =>
    activeTab === 'overview' ? (
      <StatsShareCard {...shareData} />
    ) : (
      <StatsTabShareCard
        leagueName={league.name}
        title={tabShareTitle}
        subtitle={`${isLeagueView ? league.name : viewedTeam!.teamName} · ${stats.settledBets} settled bet${stats.settledBets === 1 ? '' : 's'}`}
        blocks={tabBlocks()}
      />
    );

  return (
    <div className="flex flex-col">
      <BackHeader
        title={title}
        fallback="/bet-history"
        right={<ShareButton title={activeTab === 'overview' ? title : `${title} ${tabShareTitle}`} label={activeTab === 'overview' ? 'Share these stats' : `Share ${tabShareTitle.toLowerCase()}`} disabled={!tabSharable} renderCard={renderShareCard} />}
      />
      <div className="p-4 space-y-4">
        <MemberSelector teams={league.teams} selectedTeamId={viewedTeamId ?? userTeam.id} onSelect={setSelectedTeamId} showLeagueOption />
        <div className="grid grid-cols-4 gap-2 text-center">
          <Card className="py-3 px-1.5">
            <p className={`text-sm font-bold whitespace-nowrap ${stats.roi >= 0 ? 'text-profit' : 'text-loss'}`}>{pct(stats.roi)}</p>
            <p className="text-[10px] text-text-muted">ROI</p>
          </Card>
          <Card className="py-3 px-1.5">
            <p
              className={`text-sm font-bold whitespace-nowrap ${stats.totalPL >= 0 ? 'text-profit' : 'text-loss'}`}
              style={plStyle(stats.totalPL, isLeagueView ? REFERENCE_FLOOR_SHARE * leagueSeasonAtRisk(league) : seasonScaleRef(league))}
            >
              {formatCents(stats.totalPL)}
            </p>
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

        <div className="flex bg-bg-raised rounded-lg overflow-hidden">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 py-1.5 text-xs font-semibold ${activeTab === t.id ? 'seg-active' : 'text-text-muted'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === 'overview' && (
          <>
            <Card className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs text-text-muted">Hit rate vs. the odds</p>
                <span className={`text-xs font-bold ${edge >= 0 ? 'text-profit' : 'text-loss'}`}>
                  {edge >= 0 ? '+' : ''}
                  {edge.toFixed(1)} pts
                </span>
              </div>
              {[
                { label: 'Actual win rate', value: stats.winRate, cls: 'bg-primary' },
                { label: 'What the odds implied', value: stats.impliedWinRate, cls: 'bg-text-muted/50' },
              ].map((r) => (
                <div key={r.label}>
                  <div className="flex justify-between text-[11px] mb-0.5">
                    <span>{r.label}</span>
                    <span className="font-semibold">{(r.value * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-bg-raised overflow-hidden">
                    <div className={`h-full rounded-full ${r.cls}`} style={{ width: `${Math.min(100, r.value * 100)}%` }} />
                  </div>
                </div>
              ))}
              <p className="text-[10px] text-text-muted">Above the line means the picks are beating the odds. Wins and losses only.</p>
            </Card>

            <Card className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] text-text-muted">Average win</p>
                <p className="text-sm font-bold text-profit whitespace-nowrap">{formatCents(stats.avgWin)}</p>
              </div>
              <div>
                <p className="text-[10px] text-text-muted">Average loss</p>
                <p className="text-sm font-bold text-loss whitespace-nowrap">{formatCents(-stats.avgLoss)}</p>
              </div>
              <p className="col-span-2 text-[10px] text-text-muted">
                {stats.wins > 0 && stats.losses > 0
                  ? `At these averages, picks need to hit ${(breakEven * 100).toFixed(0)}% to break even. Yours hit ${(stats.winRate * 100).toFixed(0)}%.`
                  : 'Needs at least one win and one loss.'}
              </p>
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

            {!isLeagueView && viewedTeam && (() => {
              const perfect = perfectWeeksForTeam(league, viewedTeam.id);
              return (
                <Card className={`flex items-center justify-between gap-3 ${perfect.length > 0 ? 'pl-slip pl-slip-r' : ''}`}>
                  <div className="min-w-0">
                    <p className="text-xs text-text-muted">Perfect weeks</p>
                    <p className="text-[10px] text-text-muted">
                      {perfect.length > 0 ? perfect.map((w) => (typeof w === 'number' ? `W${w}` : weekLabel(w))).join(', ') : 'A full roster with no lost bets'}
                    </p>
                  </div>
                  <p className={`text-lg font-bold shrink-0 flex items-center gap-1.5 ${perfect.length > 0 ? '' : 'text-text-muted'}`}>
                    {perfect.length > 0 && <Flame size={18} fill="currentColor" style={{ color: 'var(--pl-flame-mid)', filter: 'drop-shadow(0 0 4px rgba(var(--pl-ember), 0.7))' }} />}
                    <span className={perfect.length > 0 ? 'pl-fire-hero' : ''}>{perfect.length}</span>
                  </p>
                </Card>
              );
            })()}

            <Card className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-text-muted">Unspent credits</p>
                <p className="text-[10px] text-text-muted">Left on the table in finished weeks</p>
              </div>
              <p className="text-sm font-bold whitespace-nowrap">{formatCents(unspent)}</p>
            </Card>
          </>
        )}

        {activeTab === 'markets' && (
          <>
            <Card>
              <p className="text-xs text-text-muted mb-1">By market</p>
              <ColHeads />
              {marketRows.map(([key, rec]) => (
                <StatRow key={key} label={MARKET_LABELS[key]} rec={rec} onClick={drill({ market: key })} />
              ))}
              <p className="text-[10px] text-text-muted mt-1.5">Tap a row to see those bets.</p>
            </Card>

            <Card>
              <p className="text-xs text-text-muted mb-1">By position slot</p>
              <ColHeads />
              {(['QB', 'RB', 'WR', 'TE', 'K', 'ML'] as const).map(
                (pos) => stats.byPosition[pos] && <StatRow key={pos} label={pos} rec={stats.byPosition[pos]!} onClick={drill({ position: pos })} />,
              )}
            </Card>

            <Card>
              <p className="text-xs text-text-muted mb-1">By odds</p>
              <ColHeads />
              {ODDS_BUCKETS.map((b) => {
                const rec = stats.byOddsBucket[b];
                return rec.wins + rec.losses + rec.pushes > 0 ? <StatRow key={b} label={ODDS_BUCKET_LABELS[b]} rec={rec} onClick={drill({ oddsBucket: b })} /> : null;
              })}
            </Card>

            <Card>
              <p className="text-xs text-text-muted mb-1">Over vs. under</p>
              <ColHeads />
              <StatRow label="Over" rec={stats.byOverUnder.over} onClick={drill({ side: 'over' })} />
              <StatRow label="Under" rec={stats.byOverUnder.under} onClick={drill({ side: 'under' })} />
            </Card>
          </>
        )}

        {activeTab === 'trends' && (
          <>
            <Card className="space-y-2">
              <p className="text-xs text-text-muted">Profit by week</p>
              {weekly.length === 0 ? <p className="text-[11px] text-text-muted">No settled weeks yet.</p> : <WeeklyBars weeks={weekly} />}
              {bestWeek && worstWeek && weekly.length > 1 && (
                <div className="grid grid-cols-2 gap-3 pt-1 border-t border-border">
                  <div>
                    <p className="text-[10px] text-text-muted">Best week · {weekLabel(bestWeek.week)}</p>
                    <p className={`text-sm font-bold whitespace-nowrap ${bestWeek.pl >= 0 ? 'text-profit' : 'text-loss'}`}>{formatCents(bestWeek.pl)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-text-muted">Worst week · {weekLabel(worstWeek.week)}</p>
                    <p className={`text-sm font-bold whitespace-nowrap ${worstWeek.pl >= 0 ? 'text-profit' : 'text-loss'}`}>{formatCents(worstWeek.pl)}</p>
                  </div>
                </div>
              )}
            </Card>

            <Card>
              <p className="text-xs text-text-muted mb-1">By stake size</p>
              <ColHeads />
              <StatRow label="Small (< $10)" rec={stats.byStakeSize.small} onClick={drill({ stake: 'small' })} />
              <StatRow label="Medium ($10–25)" rec={stats.byStakeSize.medium} onClick={drill({ stake: 'medium' })} />
              <StatRow label="Large (> $25)" rec={stats.byStakeSize.large} onClick={drill({ stake: 'large' })} />
            </Card>

            <Card>
              <p className="text-xs text-text-muted mb-1">By day slot</p>
              <ColHeads />
              {(['TNF', 'SUN_EARLY', 'SUN_LATE', 'SNF', 'MNF'] as const).map(
                (slot) => stats.byDaySlot[slot] && <StatRow key={slot} label={slot.replace('_', ' ')} rec={stats.byDaySlot[slot]!} />,
              )}
            </Card>

            <Card className="space-y-3">
              <p className="text-xs text-text-muted">Players</p>
              <PlayerList title="Most picked" rows={highlights.mostPicked} onPick={(name) => drill({ player: name })()} />
              <PlayerList title="Best for profit" rows={highlights.best} onPick={(name) => drill({ player: name })()} />
              <PlayerList title="Worst for profit" rows={highlights.worst} onPick={(name) => drill({ player: name })()} />
              {highlights.mostPicked.length === 0 && <p className="text-[11px] text-text-muted">No player picks yet.</p>}
              <p className="text-[10px] text-text-muted">Best and worst need at least two settled picks on a player.</p>
            </Card>
          </>
        )}

        {activeTab === 'matchups' && matchup && (
          <>
            {matchup.weeks === 0 ? (
              <EmptyState icon={<TrendingUp size={36} strokeWidth={1.5} />} title="No finished matchups yet" subtitle="Matchup stats show up once a week is final." />
            ) : (
              <>
                <Card className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-text-muted">Matchup record</p>
                    <p className="text-sm font-bold whitespace-nowrap">
                      {matchup.record.wins}-{matchup.record.losses}
                      {matchup.record.ties ? `-${matchup.record.ties}` : ''}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-text-muted">All-play record</p>
                    <p className="text-sm font-bold whitespace-nowrap">
                      {matchup.allPlay.wins}-{matchup.allPlay.losses}
                      {matchup.allPlay.ties ? `-${matchup.allPlay.ties}` : ''}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-text-muted">Points for (weekly P/L)</p>
                    <p className={`text-sm font-bold whitespace-nowrap ${matchup.pointsFor >= 0 ? 'text-profit' : 'text-loss'}`}>{formatCents(matchup.pointsFor)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] text-text-muted">Points against</p>
                    <p className={`text-sm font-bold whitespace-nowrap ${matchup.pointsAgainst >= 0 ? 'text-profit' : 'text-loss'}`}>{formatCents(matchup.pointsAgainst)}</p>
                  </div>
                  <p className="col-span-2 text-[10px] text-text-muted">
                    All-play scores each week against every other team, so it shows how much luck the schedule added.
                  </p>
                </Card>

                <Card>
                  <p className="text-xs text-text-muted mb-1">Head to head</p>
                  {matchup.headToHead.map((h) => {
                    const opp = teamName(h.opponentId);
                    const diff = h.pointsFor - h.pointsAgainst;
                    return (
                      <div key={h.opponentId} className="flex items-center gap-2 text-xs py-1.5 border-b border-border last:border-0">
                        {opp && <TeamLogo team={opp} size="xs" />}
                        <span className="font-medium flex-1 min-w-0 truncate">{opp?.teamName ?? 'Unknown'}</span>
                        <span className="text-text-muted w-12 text-right whitespace-nowrap">
                          {h.wins}-{h.losses}
                          {h.ties ? `-${h.ties}` : ''}
                        </span>
                        <span className={`w-16 text-right whitespace-nowrap ${diff >= 0 ? 'text-profit' : 'text-loss'}`}>{formatCents(diff)}</span>
                      </div>
                    );
                  })}
                  <p className="text-[10px] text-text-muted mt-1.5">Right column is the combined score margin in those matchups.</p>
                </Card>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
