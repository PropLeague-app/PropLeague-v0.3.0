// Weekly Moments v2 (manual v0.03 §4) — eight auto-generated weekly awards, computed
// from settled wager history at weekly close. Pure + unit-tested like the rest of
// engine/, following the same injected-lookup pattern as stats.ts.

import type { GameResult } from './settlement';
import { findMarketResult } from './settlement';
import type { League, LeagueTeam, MomentCategory, NFLGame, SlotPosition, Wager, WeekId } from '../types';
import { weekOrder } from '../types';
import { nflTeamById } from '../data/nflTeams';
import { wagerCompactLabel } from '../data/propsGenerator';
import { collectTeamBets, computeIndividualStats, computeTeamStreak } from './stats';

export interface GeneratedMoment {
  category: MomentCategory;
  teamId: string;
  extra: string;
  /** Set for single-wager categories (worstBeat/boldestBet/bestBet) so the card can
   * show a position-colored badge (manual v0.1.1 §4 #8). */
  position?: SlotPosition;
}

interface Candidate {
  teamId: string;
  /** Always "higher is the winner" — callers negate where the category's natural
   * direction is a minimum (biggest loser, worst beat) so tie-break logic stays generic. */
  value: number;
  extra: string;
  position?: SlotPosition;
}

function formatSigned(n: number): string {
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}`;
}

function formatOddsSigned(price: number): string {
  return price > 0 ? `+${price}` : `${price}`;
}

function totalStakeForTeamThisWeek(league: League, teamId: string, week: WeekId): number {
  const roster = Object.values(league.rostersByTeamWeek).find((r) => r.teamId === teamId && r.week === week);
  if (!roster) return 0;
  return roster.slots.reduce((sum, s) => sum + (s.wager?.stake ?? 0), 0);
}

/** Ties per manual §4.3: higher total stake (this week) wins; final fallback alphabetical. */
function pickWinner(league: League, week: WeekId, candidates: Candidate[]): Candidate | null {
  if (candidates.length === 0) return null;
  const teams = league.teams;
  const nameOf = (id: string) => teams.find((t) => t.id === id)?.teamName ?? '';
  const stakeOf = (id: string) => totalStakeForTeamThisWeek(league, id, week);
  const sorted = [...candidates].sort((a, b) => {
    if (b.value !== a.value) return b.value - a.value;
    const stakeDiff = stakeOf(b.teamId) - stakeOf(a.teamId);
    if (stakeDiff !== 0) return stakeDiff;
    return nameOf(a.teamId).localeCompare(nameOf(b.teamId));
  });
  return sorted[0];
}

/** "Player, prop, odds, stake, profit" per manual §4.2's card-content column — with
 * stat context on the prop itself (manual v0.1.1 §3 #6), e.g. "Puka Nacua over 68 rec
 * yds @ +120, $12.00 stake". */
function ticketLabel(wager: Wager): string {
  const profitStr = wager.settledProfit != null ? `, ${formatSigned(wager.settledProfit)}` : '';
  return `${wagerCompactLabel(wager)} @ ${formatOddsSigned(wager.oddsAtPlacement)}, $${wager.stake.toFixed(2)} stake${profitStr}`;
}

/** How far a lost bet's simulated outcome came from clearing its own line — always a
 * non-negative distance. Returns null for markets with no continuous "how close"
 * concept (anytime TD) or when the underlying game result can't be found. */
function distanceForLostBet(
  wager: Wager,
  gameLookup: (gameId: string) => NFLGame | undefined,
  resultLookup: (gameId: string) => GameResult | undefined,
): number | null {
  const game = gameLookup(wager.gameId);
  const result = resultLookup(wager.gameId);
  if (!game || !result) return null;
  const marketResult = findMarketResult(result, wager.marketKey, wager.playerId);
  if (!marketResult || marketResult.simulatedValue == null) return null;

  if (wager.marketKey === 'h2h' || wager.marketKey === 'spreads') {
    const homeAbbrev = nflTeamById(game.homeTeamId).abbrev;
    const isHomeSide = wager.side === homeAbbrev;
    const teamMargin = isHomeSide ? marketResult.simulatedValue : -marketResult.simulatedValue;
    const point = wager.marketKey === 'spreads' ? (wager.point ?? 0) : 0;
    return Math.abs(teamMargin + point);
  }
  // totals / player over-under: distance from the wager's own (possibly alt) line.
  return Math.abs(marketResult.simulatedValue - (wager.point ?? 0));
}

function previousWeekScore(league: League, teamId: string, week: WeekId): number | null {
  const standing = league.standings.find((s) => s.teamId === teamId);
  if (!standing) return null;
  const thisOrder = weekOrder(week);
  const priorWeeks = Object.keys(standing.weeklyScores)
    .map((w) => (isNaN(Number(w)) ? (w as WeekId) : (Number(w) as WeekId)))
    .filter((w) => weekOrder(w) < thisOrder)
    .sort((a, b) => weekOrder(b) - weekOrder(a));
  if (priorWeeks.length === 0) return null;
  return standing.weeklyScores[String(priorWeeks[0])] ?? null;
}

/** Computes every eligible weekly moment (manual v0.03 §4.2/§4.3). `league` must
 * already reflect this week's just-settled rosters/standings (the caller merges those
 * in before calling, same as the rest of engine/simulateWeek.ts's per-week pipeline).
 * A category is entirely omitted when it has no qualifier this week (e.g. no won bets
 * -> no Boldest Bet). Disabled categories (settings.moments[cat].enabled === false) are
 * skipped by the caller, not here, so this stays a pure "what happened" computation. */
export function computeWeeklyMoments(
  league: League,
  week: WeekId,
  weeklyScores: Map<string, number>,
  gameLookup: (gameId: string) => NFLGame | undefined,
  resultLookup: (gameId: string) => GameResult | undefined,
): GeneratedMoment[] {
  const moments: GeneratedMoment[] = [];
  const teams: LeagueTeam[] = league.teams;
  const rostersThisWeek = Object.values(league.rostersByTeamWeek).filter((r) => r.week === week);

  // 1/2: biggest winner / biggest loser — best/worst weekly P/L.
  const scoreCandidates: Candidate[] = [...weeklyScores.entries()].map(([teamId, score]) => ({
    teamId,
    value: score,
    extra: formatSigned(score),
  }));
  const winner = pickWinner(league, week, scoreCandidates);
  if (winner) moments.push({ category: 'biggestWinner', teamId: winner.teamId, extra: winner.extra });
  const loser = pickWinner(
    league,
    week,
    scoreCandidates.map((c) => ({ ...c, value: -c.value })),
  );
  if (loser) moments.push({ category: 'biggestLoser', teamId: loser.teamId, extra: loser.extra });

  // 3: worst beat — the lost bet that came closest to winning, league-wide.
  const worstBeatCandidates: Candidate[] = [];
  for (const roster of rostersThisWeek) {
    for (const slot of roster.slots) {
      const wager = slot.wager;
      if (!wager || wager.status !== 'lost') continue;
      const distance = distanceForLostBet(wager, gameLookup, resultLookup);
      if (distance == null) continue;
      worstBeatCandidates.push({
        teamId: roster.teamId,
        value: -distance,
        extra: `${ticketLabel(wager)} — missed by ${distance.toFixed(1)}`,
        position: slot.position,
      });
    }
  }
  const worstBeat = pickWinner(league, week, worstBeatCandidates);
  if (worstBeat) moments.push({ category: 'worstBeat', teamId: worstBeat.teamId, extra: worstBeat.extra, position: worstBeat.position });

  // 4/5: boldest bet (longest odds won) / best bet (most profit from one bet).
  const wonBetCandidates: { teamId: string; wager: Wager; position: SlotPosition }[] = [];
  for (const roster of rostersThisWeek) {
    for (const slot of roster.slots) {
      if (slot.wager?.status === 'won') wonBetCandidates.push({ teamId: roster.teamId, wager: slot.wager, position: slot.position });
    }
  }
  const boldest = pickWinner(
    league,
    week,
    wonBetCandidates.map((c) => ({ teamId: c.teamId, value: c.wager.oddsAtPlacement, extra: ticketLabel(c.wager), position: c.position })),
  );
  if (boldest) moments.push({ category: 'boldestBet', teamId: boldest.teamId, extra: boldest.extra, position: boldest.position });
  const best = pickWinner(
    league,
    week,
    wonBetCandidates.map((c) => ({ teamId: c.teamId, value: c.wager.settledProfit ?? 0, extra: ticketLabel(c.wager), position: c.position })),
  );
  if (best) moments.push({ category: 'bestBet', teamId: best.teamId, extra: best.extra, position: best.position });

  // 6/7: hottest / coldest bettor — head-to-head MATCHUP win/loss streak (manual
  // v0.1.1 §4 #9, not a bet-level streak — that stays bet-level only in My Stats).
  // Ties break by ROI (highest for hot, lowest for cold), then alphabetical.
  const nameOf = (id: string) => teams.find((t) => t.id === id)?.teamName ?? '';
  const roiOf = (teamId: string) => computeIndividualStats(collectTeamBets(league, teamId), gameLookup).roi;
  const matchupStreaks = teams.map((t) => ({ teamId: t.id, streak: computeTeamStreak(league, t.id) }));

  const hottestEligible = matchupStreaks.filter((s) => s.streak.type === 'W' && s.streak.count > 0);
  const hottestSorted = [...hottestEligible].sort((a, b) => {
    if (b.streak.count !== a.streak.count) return b.streak.count - a.streak.count;
    const roiDiff = roiOf(b.teamId) - roiOf(a.teamId); // highest ROI wins the tie
    if (roiDiff !== 0) return roiDiff;
    return nameOf(a.teamId).localeCompare(nameOf(b.teamId));
  });
  if (hottestSorted.length > 0) {
    const top = hottestSorted[0];
    moments.push({ category: 'hottestBettor', teamId: top.teamId, extra: `W${top.streak.count}` });
  }

  const coldestEligible = matchupStreaks.filter((s) => s.streak.type === 'L' && s.streak.count > 0);
  const coldestSorted = [...coldestEligible].sort((a, b) => {
    if (b.streak.count !== a.streak.count) return b.streak.count - a.streak.count;
    const roiDiff = roiOf(a.teamId) - roiOf(b.teamId); // lowest ROI wins the tie
    if (roiDiff !== 0) return roiDiff;
    return nameOf(a.teamId).localeCompare(nameOf(b.teamId));
  });
  if (coldestSorted.length > 0) {
    const top = coldestSorted[0];
    moments.push({ category: 'coldestBettor', teamId: top.teamId, extra: `L${top.streak.count}` });
  }

  // 8: biggest swing — largest week-over-week P/L reversal, either direction.
  const swingCandidates: Candidate[] = [];
  for (const [teamId, thisWeek] of weeklyScores.entries()) {
    const prev = previousWeekScore(league, teamId, week);
    if (prev == null) continue;
    swingCandidates.push({ teamId, value: Math.abs(thisWeek - prev), extra: `${formatSigned(prev)} → ${formatSigned(thisWeek)}` });
  }
  const swing = pickWinner(league, week, swingCandidates);
  if (swing) moments.push({ category: 'biggestSwing', teamId: swing.teamId, extra: swing.extra });

  return moments;
}
