import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Flame } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { collectLeagueBets, computeLeagueLeaderboards, LEAGUE_VIEW_ID } from '../engine/stats';
import { computeSkillBoards, weekScoreboard, MIN_DECIDED_FOR_EDGE, MIN_BETS_FOR_MARKET_SPECIALIST, type TeamValue } from '../engine/leaderboardsExtra';
import { playerHighlights, playerRecords, type PlayerRecord } from '../engine/statsExtra';
import { isTeamWeekPerfect } from '../engine/perfectWeek';
import { seasonScaleRef, weekScaleRef } from '../engine/plColor';
import { resolveGame, gameHasStarted } from '../services/oddsService';
import { formatCents } from '../engine/oddsMath';
import { BackHeader } from '../components/layout/BackHeader';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { TeamLogo } from '../components/common/TeamLogo';
import { PositionBadge } from '../components/common/PositionBadge';
import { PillSelect } from '../components/common/PillSelect';
import { usePlStyle } from '../components/common/usePlStyle';
import { useEnsureSettledWeekRosters } from '../components/common/useEnsureWeekRosters';
import { MARKET_LABELS, MARKET_SHORT_LABELS } from '../data/propsGenerator';
import { weekLabel, weekOrder, type LeagueTeam, type WeekId } from '../types';
import { ShareButton } from '../share/ShareButton';
import { LeaderboardShareCard, type LeaderRow } from '../share/cards/LeaderboardShareCard';
import { C, POS_COLOR } from '../share/palette';

type Tab = 'overall' | 'skills' | 'week' | 'players';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overall', label: 'Overall' },
  { id: 'skills', label: 'Skills' },
  { id: 'week', label: 'This week' },
  { id: 'players', label: 'Players' },
];

const COLLAPSED_ROWS = 5;

/** How a board's value reads in its share picture: the text, plus a P/L amount (and the reference
 * the screen scales it by) so the picture colors it the way the screen does. */
type ShareValue = { text: string; amount?: number; ref?: number; gold?: boolean };

const pctText = (n: number, signed = true) => `${signed && n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;

/** Same rank for equal values (1, 1, 3), so a tie never reads as one team being better. */
function rankOf(rows: TeamValue[], i: number): number {
  let r = i;
  while (r > 0 && rows[r - 1].value === rows[i].value) r -= 1;
  return r + 1;
}

function RankChip({ rank }: { rank: number }) {
  // Gold, silver, bronze for the podium; plain number after that.
  const podium =
    rank === 1
      ? { background: 'rgba(var(--pl-gold), 0.28)', color: 'var(--pl-gold-text)' }
      : rank === 2
        ? { background: 'rgba(148, 163, 184, 0.28)', color: 'var(--color-text)' }
        : rank === 3
          ? { background: 'rgba(205, 127, 50, 0.28)', color: 'var(--pl-loss-mid)' }
          : null;
  return (
    <span
      className={`w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold ${podium ? '' : 'text-text-muted'}`}
      style={podium ?? undefined}
    >
      {rank}
    </span>
  );
}

function TeamCell({ team, flame }: { team: LeagueTeam | undefined; flame?: boolean }) {
  return (
    <span className="flex items-center gap-1.5 min-w-0 flex-1">
      {team && <TeamLogo team={team} size="xs" />}
      <span className={`truncate ${team?.isUser ? 'text-primary font-semibold' : 'font-medium'}`}>{team?.teamName ?? 'Unknown'}</span>
      {flame && <Flame size={11} className="shrink-0 text-warning" />}
    </span>
  );
}

function Board({
  title,
  hint,
  rows,
  teamById,
  renderValue,
  onTeam,
  flameFor,
  empty,
  leagueName,
  shareValue,
}: {
  title: string;
  hint?: string;
  rows: TeamValue[];
  teamById: (id: string) => LeagueTeam | undefined;
  renderValue: (row: TeamValue) => ReactNode;
  onTeam: (teamId: string) => void;
  flameFor?: (teamId: string) => boolean;
  empty?: string;
  leagueName: string;
  /** Text and coloring for the share picture. */
  shareValue: (row: TeamValue) => ShareValue;
}) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, COLLAPSED_ROWS);
  const shareRows = (): LeaderRow[] =>
    rows.map((row, i) => {
      const team = teamById(row.teamId);
      const v = shareValue(row);
      return {
        rank: rankOf(rows, i),
        name: team?.teamName ?? 'Unknown',
        logo: team ? { identity: team, initials: team.abbrev } : undefined,
        isUser: !!team?.isUser,
        flame: flameFor?.(row.teamId),
        value: v.text,
        amount: v.amount,
        ref: v.ref,
        gold: v.gold,
      };
    });
  return (
    <Card className="!p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold">{title}</p>
          {hint && <p className="text-[10px] text-text-muted mb-1">{hint}</p>}
        </div>
        <ShareButton
          size="sm"
          title={title}
          label={`Share ${title}`}
          disabled={rows.length === 0}
          renderCard={() => <LeaderboardShareCard leagueName={leagueName} title={title} subtitle={hint} rows={shareRows()} />}
        />
      </div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-text-muted py-2">{empty ?? 'Nothing to rank yet.'}</p>
      ) : (
        <div className="mt-1 -mx-1.5">
          {visible.map((row, i) => (
            <button
              key={row.teamId}
              onClick={() => onTeam(row.teamId)}
              className={`flex items-center gap-2 text-xs py-1.5 px-1.5 w-full border-b border-border last:border-0 active:opacity-70 ${
                teamById(row.teamId)?.isUser ? 'bg-primary/5' : ''
              }`}
            >
              <RankChip rank={rankOf(rows, i)} />
              <TeamCell team={teamById(row.teamId)} flame={flameFor?.(row.teamId)} />
              <span className="shrink-0 whitespace-nowrap text-right">{renderValue(row)}</span>
              <ChevronRight size={12} className="text-text-muted shrink-0 -mr-1" />
            </button>
          ))}
          {rows.length > COLLAPSED_ROWS && (
            <button onClick={() => setShowAll((v) => !v)} className="w-full pt-2 text-[11px] font-semibold text-primary active:opacity-70">
              {showAll ? 'Show fewer' : `Show all ${rows.length}`}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

function PlayerBoard({
  title,
  hint,
  rows,
  onPlayer,
  leagueName,
}: {
  title: string;
  hint?: string;
  rows: PlayerRecord[];
  onPlayer: (name: string) => void;
  leagueName: string;
}) {
  const shareRows = (): LeaderRow[] =>
    rows.map((r, i) => ({
      rank: i + 1,
      name: r.playerName,
      sub: `${r.wins}-${r.losses}-${r.pushes} · ${r.picks} pick${r.picks === 1 ? '' : 's'}`,
      value: formatCents(r.pl),
      amount: r.pl,
    }));
  return (
    <Card className="!p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold">{title}</p>
          {hint && <p className="text-[10px] text-text-muted mb-1">{hint}</p>}
        </div>
        <ShareButton
          size="sm"
          title={title}
          label={`Share ${title}`}
          disabled={rows.length === 0}
          renderCard={() => <LeaderboardShareCard leagueName={leagueName} title={title} subtitle={hint} rows={shareRows()} />}
        />
      </div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-text-muted py-2">Nothing to show yet.</p>
      ) : (
        <div className="mt-1">
          {rows.map((r, i) => (
            <button
              key={r.playerName}
              onClick={() => onPlayer(r.playerName)}
              className="flex items-center gap-2 text-xs py-1.5 w-full border-b border-border last:border-0 active:opacity-70"
            >
              <RankChip rank={i + 1} />
              <span className="font-medium flex-1 min-w-0 truncate text-left">{r.playerName}</span>
              <span className="text-text-muted whitespace-nowrap">
                {r.wins}-{r.losses}-{r.pushes}
              </span>
              <span className={`w-14 text-right whitespace-nowrap ${r.pl >= 0 ? 'text-profit' : 'text-loss'}`}>{formatCents(r.pl)}</span>
              <span className="text-text-muted w-7 text-right whitespace-nowrap">{r.picks}x</span>
              <ChevronRight size={12} className="text-text-muted shrink-0 -mr-1" />
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

export function Leaderboards() {
  const navigate = useNavigate();
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const realGamesById = useAppStore((s) => s.realGamesById);
  const loadRealGame = useAppStore((s) => s.loadRealGame);
  const plStyle = usePlStyle();
  const [tab, setTab] = useState<Tab>('overall');
  const [pickedWeek, setPickedWeek] = useState<string | null>(null);
  // Perfect weeks are judged from past rosters.
  useEnsureSettledWeekRosters(league);

  const userTeam = league?.teams.find((t) => t.isUser);

  // Leaderboards span every team's entire bet history, not just one team's, so every
  // real game across the league needs to be loaded (see resolveGame in oddsService.ts).
  useEffect(() => {
    if (!league) return;
    const gameIds = new Set<string>();
    for (const roster of Object.values(league.rostersByTeamWeek)) {
      for (const slot of roster.slots) if (slot.wager) gameIds.add(slot.wager.gameId);
    }
    for (const gameId of gameIds) if (!realGamesById[gameId]) loadRealGame(gameId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league]);

  if (!league) return null;

  const gameLookup = (gameId: string) =>
    resolveGame(gameId, realGamesById, league.currentWeek, league.settings.lineMovementEnabled, league.manualGameOverrides);
  const boards = computeLeagueLeaderboards(league, gameLookup, userTeam?.id);
  const skills = computeSkillBoards(league, gameLookup);
  const teamById = (id: string) => league.teams.find((t) => t.id === id);
  const openTeam = (teamId: string) => navigate('/my-stats', { state: { team: teamId } });
  const seasonRef = seasonScaleRef(league);

  const weeksWithScores = Object.keys(league.matchupsByWeek)
    .filter((w) => weekScoreboard(league, w).length > 0)
    .map((w) => (Number.isNaN(Number(w)) ? (w as WeekId) : (Number(w) as WeekId)))
    .sort((a, b) => weekOrder(a) - weekOrder(b));
  const week: WeekId = pickedWeek != null && weeksWithScores.some((w) => String(w) === pickedWeek) ? (weeksWithScores.find((w) => String(w) === pickedWeek) as WeekId) : league.currentWeek;
  const scoreboard = weekScoreboard(league, week);
  const weekRef = weekScaleRef(league, week);
  const isCurrentWeek = String(week) === String(league.currentWeek);

  // Players tab is league-wide, so it reads every team's bets (picks stay hidden per the hide-picks rule).
  const isGameStarted = (gameId: string) => gameHasStarted(gameLookup(gameId));
  const highlights = tab === 'players' ? playerHighlights(playerRecords(collectLeagueBets(league, userTeam?.id, isGameStarted)), 5) : null;
  const openPlayer = (name: string) => navigate('/bet-history', { state: { preset: { team: LEAGUE_VIEW_ID, player: name } } });

  return (
    <div className="flex flex-col">
      <BackHeader title="Leaderboards" fallback="/home" />
      <div className="p-4 space-y-3">
        <div className="flex bg-bg-raised rounded-lg overflow-hidden">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 py-1.5 text-xs font-semibold ${tab === t.id ? 'seg-active' : 'text-text-muted'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'overall' && (
          <>
            <Board
              title="Best ROI"
              leagueName={league.name}
              shareValue={(r) => ({ text: pctText(r.value), amount: r.value })}
              hint="Profit per dollar wagered"
              rows={boards.bestROI}
              teamById={teamById}
              onTeam={openTeam}
              renderValue={(r) => <span className={r.value >= 0 ? 'text-profit' : 'text-loss'}>{pctText(r.value)}</span>}
            />
            <Board
              title="Most total profit"
              leagueName={league.name}
              shareValue={(r) => ({ text: formatCents(r.value), amount: r.value, ref: seasonRef })}
              rows={boards.mostProfit}
              teamById={teamById}
              onTeam={openTeam}
              renderValue={(r) => (
                <span className={r.value >= 0 ? 'text-profit' : 'text-loss'} style={plStyle(r.value, seasonRef)}>
                  {formatCents(r.value)}
                </span>
              )}
            />
            <Board
              title="Best single week"
              leagueName={league.name}
              shareValue={(r) => ({ text: formatCents(r.value), amount: r.value })}
              rows={boards.bestSingleWeek}
              teamById={teamById}
              onTeam={openTeam}
              renderValue={(r) => <span className={r.value >= 0 ? 'text-profit' : 'text-loss'}>{formatCents(r.value)}</span>}
            />
            <Board
              title="Most bets won"
              leagueName={league.name}
              shareValue={(r) => ({ text: String(r.value) })}
              rows={boards.mostBetsWon}
              teamById={teamById}
              onTeam={openTeam}
              renderValue={(r) => r.value}
            />
            {skills.perfectWeeks.length > 0 && (
              <Board
                title="Perfect weeks"
                leagueName={league.name}
                shareValue={(r) => ({ text: String(r.value), gold: true })}
                hint="Every slot filled and every bet won"
                rows={skills.perfectWeeks}
                teamById={teamById}
                onTeam={openTeam}
                flameFor={() => true}
                renderValue={(r) => <span className="pl-gold-text font-semibold">{r.value}</span>}
              />
            )}
          </>
        )}

        {tab === 'skills' && (
          <>
            <Board
              title="Beating the odds"
              leagueName={league.name}
              shareValue={(r) => ({ text: `${r.value >= 0 ? '+' : ''}${r.value.toFixed(1)} pts`, amount: r.value })}
              hint={`Win rate minus what the odds implied. Needs ${MIN_DECIDED_FOR_EDGE}+ decided bets.`}
              rows={skills.hitRateEdge}
              teamById={teamById}
              onTeam={openTeam}
              empty="Shows up once teams have a few decided bets."
              renderValue={(r) => (
                <span className={r.value >= 0 ? 'text-profit' : 'text-loss'}>
                  {r.value >= 0 ? '+' : ''}
                  {r.value.toFixed(1)} pts
                </span>
              )}
            />
            <Board
              title="Longest win streak"
              leagueName={league.name}
              shareValue={(r) => ({ text: String(r.value) })}
              hint="Bets won in a row"
              rows={skills.longestWinStreak}
              teamById={teamById}
              onTeam={openTeam}
              renderValue={(r) => r.value}
            />
            <Board
              title="Biggest single win"
              leagueName={league.name}
              shareValue={(r) => ({ text: formatCents(r.value), amount: r.value })}
              rows={skills.biggestWin}
              teamById={teamById}
              onTeam={openTeam}
              renderValue={(r) => <span className="text-profit">{formatCents(r.value)}</span>}
            />

            <Card className="!p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold">Position specialists</p>
                  <p className="text-[10px] text-text-muted mb-1">Best ROI at each position</p>
                </div>
                <ShareButton
                  size="sm"
                  title="Position specialists"
                  label="Share position specialists"
                  disabled={boards.positionSpecialists.length === 0}
                  renderCard={() => (
                    <LeaderboardShareCard
                      leagueName={league.name}
                      title="Position specialists"
                      subtitle="Best ROI at each position"
                      rows={boards.positionSpecialists.map((sp) => {
                        const team = teamById(sp.teamId);
                        return {
                          rank: null,
                          name: team?.teamName ?? 'Unknown',
                          logo: team ? { identity: team, initials: team.abbrev } : undefined,
                          tag: { text: sp.position, color: POS_COLOR[sp.position] ?? POS_COLOR.WR },
                          isUser: !!team?.isUser,
                          value: pctText(sp.roi),
                          amount: sp.roi,
                        };
                      })}
                    />
                  )}
                />
              </div>
              {boards.positionSpecialists.length === 0 && <p className="text-[11px] text-text-muted py-2">Nothing to rank yet.</p>}
              {boards.positionSpecialists.map((s) => (
                <button
                  key={s.position}
                  onClick={() => openTeam(s.teamId)}
                  className="flex items-center gap-2 text-xs py-1.5 w-full border-b border-border last:border-0 active:opacity-70"
                >
                  <span className="w-9 shrink-0 flex">
                    <PositionBadge position={s.position} />
                  </span>
                  <TeamCell team={teamById(s.teamId)} />
                  <span className={`shrink-0 whitespace-nowrap ${s.roi >= 0 ? 'text-profit' : 'text-loss'}`}>{pctText(s.roi)}</span>
                  <ChevronRight size={12} className="text-text-muted shrink-0 -mr-1" />
                </button>
              ))}
            </Card>

            <Card className="!p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold">Market specialists</p>
                  <p className="text-[10px] text-text-muted mb-1">Best ROI per prop type. Needs {MIN_BETS_FOR_MARKET_SPECIALIST}+ bets in it.</p>
                </div>
                <ShareButton
                  size="sm"
                  title="Market specialists"
                  label="Share market specialists"
                  disabled={skills.marketSpecialists.length === 0}
                  renderCard={() => (
                    <LeaderboardShareCard
                      leagueName={league.name}
                      title="Market specialists"
                      subtitle={`Best ROI per prop type. ${MIN_BETS_FOR_MARKET_SPECIALIST}+ bets in it.`}
                      rows={skills.marketSpecialists.map((sp) => {
                        const team = teamById(sp.teamId);
                        return {
                          rank: null,
                          name: team?.teamName ?? 'Unknown',
                          logo: team ? { identity: team, initials: team.abbrev } : undefined,
                          tag: { text: MARKET_SHORT_LABELS[sp.market] ?? MARKET_LABELS[sp.market], color: C.primary, width: 170 },
                          isUser: !!team?.isUser,
                          value: pctText(sp.roi),
                          amount: sp.roi,
                        };
                      })}
                    />
                  )}
                />
              </div>
              {skills.marketSpecialists.length === 0 && <p className="text-[11px] text-text-muted py-2">Nothing to rank yet.</p>}
              {skills.marketSpecialists.map((s) => (
                <button
                  key={s.market}
                  onClick={() => openTeam(s.teamId)}
                  className="flex items-center gap-2 text-xs py-1.5 w-full border-b border-border last:border-0 active:opacity-70"
                >
                  <span className="w-20 shrink-0 text-left text-text-muted truncate">{MARKET_SHORT_LABELS[s.market] ?? MARKET_LABELS[s.market]}</span>
                  <TeamCell team={teamById(s.teamId)} />
                  <span className={`shrink-0 whitespace-nowrap ${s.roi >= 0 ? 'text-profit' : 'text-loss'}`}>{pctText(s.roi)}</span>
                  <ChevronRight size={12} className="text-text-muted shrink-0 -mr-1" />
                </button>
              ))}
            </Card>
          </>
        )}

        {tab === 'week' && (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-text-muted">{isCurrentWeek ? 'Live scores for the current week' : 'Final scores'}</p>
              {weeksWithScores.length > 1 && (
                <PillSelect
                  value={String(week)}
                  onChange={setPickedWeek}
                  ariaLabel="Week"
                  options={weeksWithScores.map((w) => ({ value: String(w), label: weekLabel(w) }))}
                  active={!isCurrentWeek}
                />
              )}
            </div>
            <Board
              title={`${weekLabel(week)} scoreboard`}
              leagueName={league.name}
              shareValue={(r) => ({ text: formatCents(r.value), amount: r.value, ref: weekRef })}
              rows={scoreboard}
              teamById={teamById}
              onTeam={openTeam}
              flameFor={(id) => isTeamWeekPerfect(league, id, week)}
              empty="No scores yet this week."
              renderValue={(r) => (
                <span className={r.value >= 0 ? 'text-profit' : 'text-loss'} style={plStyle(r.value, weekRef)}>
                  {formatCents(r.value)}
                </span>
              )}
            />
            {isCurrentWeek && boards.mostPickedPropsThisWeek.length > 0 && (
              <Card className="!p-3">
                <p className="text-xs font-semibold">Most-picked props</p>
                <p className="text-[10px] text-text-muted mb-1">Visible picks only, so hidden ones are not counted</p>
                {boards.mostPickedPropsThisWeek.map((p) => (
                  <div key={`${p.playerName}-${p.marketKey}`} className="flex items-center gap-2 text-xs py-1.5 border-b border-border last:border-0">
                    <span className="flex-1 min-w-0 truncate font-medium">
                      {p.playerName} <span className="text-text-muted font-normal">{MARKET_SHORT_LABELS[p.marketKey] ?? MARKET_LABELS[p.marketKey]}</span>
                    </span>
                    <span className="shrink-0 whitespace-nowrap text-text-muted">
                      {p.count} {p.count === 1 ? 'team' : 'teams'}
                    </span>
                  </div>
                ))}
              </Card>
            )}
          </>
        )}

        {tab === 'players' && highlights && (
          highlights.mostPicked.length === 0 ? (
            <EmptyState title="No player data yet" subtitle="Player boards fill in once picks are locked in." />
          ) : (
            <>
              <PlayerBoard title="Most picked players" hint="Across the whole league" rows={highlights.mostPicked} onPlayer={openPlayer} leagueName={league.name} />
              <PlayerBoard title="League favorites that paid" hint="Biggest combined profit. 2+ settled bets." rows={highlights.best} onPlayer={openPlayer} leagueName={league.name} />
              <PlayerBoard title="Trap players" hint="Biggest combined loss. 2+ settled bets." rows={highlights.worst} onPlayer={openPlayer} leagueName={league.name} />
            </>
          )
        )}
      </div>
    </div>
  );
}
