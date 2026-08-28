import type { DaySlot, League, MarketKey, NFLGame, SlotPosition, WagerStatus, WeekId, WeeklyRoster } from '../types';
import { weekOrder } from '../types';

/** manual v0.3.0 §5: the same "hidden until kickoff" rule the matchup screen already
 * enforces for an opponent's current-week picks, generalized so it applies whenever
 * *anyone* browses a team that isn't their own — league-wide stats/bets browsing and
 * the leaderboards' "most picked this week" list both funnel through this so the
 * guardrail lives in one place, not reimplemented per screen. Only ever hides a
 * pending pick, for the current week, on a game that hasn't started — a settled bet or
 * one whose game already kicked off is always browsable, and a viewer's own team is
 * never hidden from themselves. */
export function isWagerVisibleToViewer(params: {
  isOwnTeam: boolean;
  hidePicks: boolean;
  wagerWeek: WeekId;
  currentWeek: WeekId;
  wagerStatus: WagerStatus;
  gameStarted: boolean;
}): boolean {
  if (params.isOwnTeam || !params.hidePicks) return true;
  if (params.wagerWeek !== params.currentWeek) return true;
  if (params.wagerStatus !== 'pending') return true;
  return params.gameStarted;
}

/** Injected rather than imported so stats.ts stays pure/unit-testable like the rest of
 * src/engine — `isGameStarted` mirrors the `getGame(...).status !== 'upcoming'` check
 * every other hide-picks call site (MatchupDetail, SlotMini) already uses. */
export interface BetVisibility {
  isOwnTeam: boolean;
  isGameStarted: (gameId: string) => boolean;
}

export interface RecordPL {
  wins: number;
  losses: number;
  pushes: number;
  pl: number;
  wagered: number;
}

function emptyRecord(): RecordPL {
  return { wins: 0, losses: 0, pushes: 0, pl: 0, wagered: 0 };
}

function addToRecord(rec: RecordPL, status: 'won' | 'lost' | 'push', stake: number, profit: number) {
  if (status === 'won') rec.wins += 1;
  else if (status === 'lost') rec.losses += 1;
  else rec.pushes += 1;
  rec.pl += profit;
  rec.wagered += stake;
}

export interface TeamBet {
  week: WeekId;
  position: SlotPosition;
  gameId: string;
  side: string;
  stake: number;
  oddsAtPlacement: number;
  status: 'pending' | 'won' | 'lost' | 'push' | 'voided';
  settledProfit: number | null;
  placedAt: string;
  playerName?: string;
  marketKey: MarketKey;
}

/** Flattens a team's full wager history across every week into a chronologically
 * sortable list — the shared base every stats/leaderboard function builds on. `visibility`
 * is omitted for a team looking at its own data (the overwhelmingly common case);
 * pass it whenever the viewer might not be `teamId`'s owner (manual v0.3.0 §5) so the
 * hide-picks guardrail is enforced here, in the data itself, not left to callers. */
export function collectTeamBets(league: League, teamId: string, visibility?: BetVisibility): TeamBet[] {
  const bets: TeamBet[] = [];
  for (const roster of Object.values(league.rostersByTeamWeek)) {
    if (roster.teamId !== teamId) continue;
    for (const slot of roster.slots) {
      if (!slot.wager) continue;
      if (
        visibility &&
        !isWagerVisibleToViewer({
          isOwnTeam: visibility.isOwnTeam,
          hidePicks: league.settings.hidePicks,
          wagerWeek: roster.week,
          currentWeek: league.currentWeek,
          wagerStatus: slot.wager.status,
          gameStarted: visibility.isGameStarted(slot.wager.gameId),
        })
      ) {
        continue;
      }
      bets.push({
        week: roster.week,
        position: slot.position,
        gameId: slot.wager.gameId,
        side: slot.wager.side,
        stake: slot.wager.stake,
        oddsAtPlacement: slot.wager.oddsAtPlacement,
        status: slot.wager.status,
        settledProfit: slot.wager.settledProfit,
        placedAt: slot.wager.placedAt,
        playerName: slot.wager.playerName,
        marketKey: slot.wager.marketKey,
      });
    }
  }
  return bets.sort((a, b) => weekOrder(a.week) - weekOrder(b.week) || (a.placedAt < b.placedAt ? -1 : 1));
}

export interface IndividualStats {
  totalBets: number;
  settledBets: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  totalWagered: number;
  totalPL: number;
  roi: number;
  avgStake: number;
  byPosition: Partial<Record<SlotPosition, RecordPL>>;
  byOddsRange: { favorite: RecordPL; underdog: RecordPL };
  byStakeSize: { small: RecordPL; medium: RecordPL; large: RecordPL };
  byOverUnder: { over: RecordPL; under: RecordPL };
  byDaySlot: Partial<Record<DaySlot, RecordPL>>;
  longestWinStreak: number;
  longestLossStreak: number;
  biggestWin: number;
  biggestLoss: number;
}

function stakeBucket(stake: number): 'small' | 'medium' | 'large' {
  if (stake < 10) return 'small';
  if (stake <= 25) return 'medium';
  return 'large';
}

/** Derives every individual stat from settled wager history — no new stored state.
 * `gameLookup` is injected (rather than imported from services/oddsService) so this
 * stays a pure, unit-testable function like the rest of src/engine. */
export function computeIndividualStats(bets: TeamBet[], gameLookup: (gameId: string) => NFLGame | undefined): IndividualStats {
  const settled = bets.filter((b) => b.status !== 'pending');
  const stats: IndividualStats = {
    totalBets: bets.length,
    settledBets: settled.length,
    wins: 0,
    losses: 0,
    pushes: 0,
    voids: bets.filter((b) => b.status === 'voided').length,
    totalWagered: bets.reduce((s, b) => s + b.stake, 0),
    totalPL: settled.reduce((s, b) => s + (b.settledProfit ?? 0), 0),
    roi: 0,
    avgStake: bets.length > 0 ? bets.reduce((s, b) => s + b.stake, 0) / bets.length : 0,
    byPosition: {},
    byOddsRange: { favorite: emptyRecord(), underdog: emptyRecord() },
    byStakeSize: { small: emptyRecord(), medium: emptyRecord(), large: emptyRecord() },
    byOverUnder: { over: emptyRecord(), under: emptyRecord() },
    byDaySlot: {},
    longestWinStreak: 0,
    longestLossStreak: 0,
    biggestWin: 0,
    biggestLoss: 0,
  };

  stats.roi = stats.totalWagered > 0 ? stats.totalPL / stats.totalWagered : 0;

  let curWinStreak = 0;
  let curLossStreak = 0;

  for (const bet of settled) {
    if (bet.status === 'won' || bet.status === 'lost' || bet.status === 'push') {
      if (bet.status === 'won') stats.wins += 1;
      else if (bet.status === 'lost') stats.losses += 1;
      else stats.pushes += 1;

      const profit = bet.settledProfit ?? 0;

      const posRec = stats.byPosition[bet.position] ?? emptyRecord();
      addToRecord(posRec, bet.status, bet.stake, profit);
      stats.byPosition[bet.position] = posRec;

      const oddsRec = bet.oddsAtPlacement < 0 ? stats.byOddsRange.favorite : stats.byOddsRange.underdog;
      addToRecord(oddsRec, bet.status, bet.stake, profit);

      const stakeRec = stats.byStakeSize[stakeBucket(bet.stake)];
      addToRecord(stakeRec, bet.status, bet.stake, profit);

      if (bet.side === 'Over' || bet.side === 'Under') {
        const ouRec = bet.side === 'Over' ? stats.byOverUnder.over : stats.byOverUnder.under;
        addToRecord(ouRec, bet.status, bet.stake, profit);
      }

      const game = gameLookup(bet.gameId);
      if (game) {
        const daySlotRec = stats.byDaySlot[game.daySlot] ?? emptyRecord();
        addToRecord(daySlotRec, bet.status, bet.stake, profit);
        stats.byDaySlot[game.daySlot] = daySlotRec;
      }

      if (bet.status === 'won') {
        curWinStreak += 1;
        curLossStreak = 0;
        stats.longestWinStreak = Math.max(stats.longestWinStreak, curWinStreak);
        stats.biggestWin = Math.max(stats.biggestWin, profit);
      } else if (bet.status === 'lost') {
        curLossStreak += 1;
        curWinStreak = 0;
        stats.longestLossStreak = Math.max(stats.longestLossStreak, curLossStreak);
        stats.biggestLoss = Math.min(stats.biggestLoss, profit);
      } else {
        curWinStreak = 0;
        curLossStreak = 0;
      }
    }
  }

  return stats;
}

// --- League-wide leaderboards ------------------------------------------------

export interface LeaderboardEntry {
  teamId: string;
  value: number;
}

export interface PositionSpecialist {
  position: SlotPosition;
  teamId: string;
  roi: number;
}

export interface PropPickCount {
  playerName: string;
  marketKey: MarketKey;
  count: number;
}

export interface LeagueLeaderboards {
  bestROI: LeaderboardEntry[];
  mostProfit: LeaderboardEntry[];
  bestSingleWeek: LeaderboardEntry[];
  mostBetsWon: LeaderboardEntry[];
  positionSpecialists: PositionSpecialist[];
  mostPickedPropsThisWeek: PropPickCount[];
}

/** `viewerTeamId` (manual v0.3.0 §5) only gates `mostPickedPropsThisWeek` — every other
 * board is built from settled wagers only (via computeIndividualStats' own `settled`
 * filter), so a pending, not-yet-hidden-or-not current-week pick can never influence
 * ROI/profit/win-count numbers regardless of who's viewing. */
export function computeLeagueLeaderboards(
  league: League,
  gameLookup: (gameId: string) => NFLGame | undefined,
  viewerTeamId?: string,
): LeagueLeaderboards {
  const perTeam = league.teams.map((t) => ({
    teamId: t.id,
    stats: computeIndividualStats(collectTeamBets(league, t.id), gameLookup),
  }));

  const bestROI = [...perTeam]
    .filter((t) => t.stats.totalWagered > 0)
    .sort((a, b) => b.stats.roi - a.stats.roi)
    .map((t) => ({ teamId: t.teamId, value: t.stats.roi }));

  const mostProfit = [...perTeam].sort((a, b) => b.stats.totalPL - a.stats.totalPL).map((t) => ({ teamId: t.teamId, value: t.stats.totalPL }));

  const bestSingleWeek = league.standings
    .map((s) => ({ teamId: s.teamId, value: s.bestWeekPL }))
    .sort((a, b) => b.value - a.value);

  const mostBetsWon = [...perTeam].sort((a, b) => b.stats.wins - a.stats.wins).map((t) => ({ teamId: t.teamId, value: t.stats.wins }));

  const positions: SlotPosition[] = ['QB', 'RB', 'WR', 'TE', 'K', 'ML'];
  const positionSpecialists: PositionSpecialist[] = positions
    .map((position) => {
      const ranked = perTeam
        .map((t) => ({ teamId: t.teamId, rec: t.stats.byPosition[position] }))
        .filter((t): t is { teamId: string; rec: RecordPL } => !!t.rec && t.rec.wagered > 0)
        .sort((a, b) => b.rec.pl / b.rec.wagered - a.rec.pl / a.rec.wagered);
      const best = ranked[0];
      return best ? { position, teamId: best.teamId, roi: best.rec.pl / best.rec.wagered } : null;
    })
    .filter((x): x is PositionSpecialist => x !== null);

  const pickCounts = new Map<string, PropPickCount>();
  for (const roster of Object.values(league.rostersByTeamWeek)) {
    if (roster.week !== league.currentWeek) continue;
    const isOwnTeam = roster.teamId === viewerTeamId;
    for (const slot of roster.slots) {
      if (!slot.wager?.playerName) continue;
      if (
        !isWagerVisibleToViewer({
          isOwnTeam,
          hidePicks: league.settings.hidePicks,
          wagerWeek: roster.week,
          currentWeek: league.currentWeek,
          wagerStatus: slot.wager.status,
          gameStarted: gameLookup(slot.wager.gameId)?.status !== 'upcoming',
        })
      ) {
        continue;
      }
      const key = `${slot.wager.playerName}-${slot.wager.marketKey}`;
      const existing = pickCounts.get(key);
      if (existing) existing.count += 1;
      else pickCounts.set(key, { playerName: slot.wager.playerName, marketKey: slot.wager.marketKey, count: 1 });
    }
  }
  const mostPickedPropsThisWeek = [...pickCounts.values()].sort((a, b) => b.count - a.count).slice(0, 8);

  return { bestROI, mostProfit, bestSingleWeek, mostBetsWon, positionSpecialists, mostPickedPropsThisWeek };
}

// --- Standings-screen advanced columns ---------------------------------------

export interface TeamStreak {
  type: 'W' | 'L' | 'T' | null;
  count: number;
}

/** Trailing streak from the most recently settled week backward. */
export function computeTeamStreak(league: League, teamId: string): TeamStreak {
  const weeks = Object.keys(league.matchupsByWeek)
    .filter((w) => (league.matchupsByWeek[w] ?? []).some((m) => m.teamAId === teamId || m.teamBId === teamId))
    .sort((a, b) => weekOrder(a as WeekId) - weekOrder(b as WeekId));

  let streak: TeamStreak = { type: null, count: 0 };
  for (const w of weeks) {
    const matchup = league.matchupsByWeek[w].find((m) => m.teamAId === teamId || m.teamBId === teamId);
    if (!matchup || matchup.teamAScore == null) continue;
    const result: 'W' | 'L' | 'T' = matchup.isTie ? 'T' : matchup.winnerId === teamId ? 'W' : 'L';
    if (result === streak.type) streak.count += 1;
    else streak = { type: result, count: 1 };
  }
  return streak;
}

export function totalWageredByTeam(league: League, teamId: string): number {
  let total = 0;
  for (const roster of Object.values(league.rostersByTeamWeek) as WeeklyRoster[]) {
    if (roster.teamId !== teamId) continue;
    for (const slot of roster.slots) total += slot.wager?.stake ?? 0;
  }
  return total;
}
