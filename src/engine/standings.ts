import type { Matchup, TeamStanding, WeeklyRoster } from '../types';

export function emptyStanding(teamId: string): TeamStanding {
  return {
    teamId,
    wins: 0,
    losses: 0,
    ties: 0,
    totalPL: 0,
    betsWon: 0,
    betsLost: 0,
    betsPushed: 0,
    bestWeekPL: -Infinity,
    weeklyScores: {},
  };
}

/** Rebuilds every team's standing line from scratch given all scored matchups + rosters. */
export function computeStandings(
  teamIds: string[],
  matchupsByWeek: Record<string, Matchup[]>,
  rostersByTeamWeek: Record<string, WeeklyRoster>,
): TeamStanding[] {
  const standings = new Map(teamIds.map((id) => [id, emptyStanding(id)]));

  for (const matchups of Object.values(matchupsByWeek)) {
    for (const m of matchups) {
      if (m.teamAScore == null || m.teamBScore == null) continue;
      const a = standings.get(m.teamAId);
      const b = standings.get(m.teamBId);
      if (!a || !b) continue;
      a.weeklyScores[String(m.week)] = m.teamAScore;
      b.weeklyScores[String(m.week)] = m.teamBScore;
      a.totalPL += m.teamAScore;
      b.totalPL += m.teamBScore;
      a.bestWeekPL = Math.max(a.bestWeekPL, m.teamAScore);
      b.bestWeekPL = Math.max(b.bestWeekPL, m.teamBScore);
      if (m.isTie) {
        a.ties++;
        b.ties++;
      } else if (m.winnerId === m.teamAId) {
        a.wins++;
        b.losses++;
      } else if (m.winnerId === m.teamBId) {
        b.wins++;
        a.losses++;
      }
    }
  }

  for (const roster of Object.values(rostersByTeamWeek)) {
    const standing = standings.get(roster.teamId);
    if (!standing) continue;
    for (const slot of roster.slots) {
      const status = slot.wager?.status;
      if (status === 'won') standing.betsWon++;
      else if (status === 'lost') standing.betsLost++;
      else if (status === 'push') standing.betsPushed++;
    }
  }

  return Array.from(standings.values()).map((s) => ({
    ...s,
    bestWeekPL: s.bestWeekPL === -Infinity ? 0 : s.bestWeekPL,
  }));
}

function winPct(s: TeamStanding): number {
  const played = s.wins + s.losses + s.ties;
  if (played === 0) return 0;
  return (s.wins + s.ties * 0.5) / played;
}

function headToHead(aId: string, bId: string, matchupsByWeek: Record<string, Matchup[]>): number {
  let aWins = 0;
  let bWins = 0;
  for (const matchups of Object.values(matchupsByWeek)) {
    for (const m of matchups) {
      const involves = (m.teamAId === aId && m.teamBId === bId) || (m.teamAId === bId && m.teamBId === aId);
      if (!involves || !m.winnerId) continue;
      if (m.winnerId === aId) aWins++;
      else if (m.winnerId === bId) bWins++;
    }
  }
  return bWins - aWins; // negative => a ranks above b
}

/**
 * Tiebreaker chain per spec §4: overall W-L -> season P/L -> bet W/L record ->
 * head-to-head vs tied team(s) -> best single week.
 */
export function sortStandings(
  standings: TeamStanding[],
  matchupsByWeek: Record<string, Matchup[]>,
): TeamStanding[] {
  return [...standings].sort((a, b) => {
    const pctDiff = winPct(b) - winPct(a);
    if (Math.abs(pctDiff) > 1e-9) return pctDiff;

    if (a.totalPL !== b.totalPL) return b.totalPL - a.totalPL;

    const aBetRec = a.betsWon - a.betsLost;
    const bBetRec = b.betsWon - b.betsLost;
    if (aBetRec !== bBetRec) return bBetRec - aBetRec;

    const h2h = headToHead(a.teamId, b.teamId, matchupsByWeek);
    if (h2h !== 0) return h2h;

    return b.bestWeekPL - a.bestWeekPL;
  });
}
