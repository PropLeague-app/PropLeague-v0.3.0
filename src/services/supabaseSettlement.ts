import { supabase } from '../lib/supabaseClient';
import type { Matchup, TeamStanding, WagerStatus, WeekId } from '../types';

type ServiceResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export async function upsertMatchupRemote(
  leagueId: string,
  week: string,
  teamAId: string,
  teamBId: string,
  teamAScore: number | null,
  teamBScore: number | null,
  winnerId: string | null,
  isTie: boolean,
): Promise<ServiceResult> {
  const { error } = await supabase.rpc('upsert_matchup', {
    p_league_id: leagueId,
    p_week: week,
    p_team_a_id: teamAId,
    p_team_b_id: teamBId,
    p_team_a_score: teamAScore,
    p_team_b_score: teamBScore,
    p_winner_id: winnerId,
    p_is_tie: isTie,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function upsertStandingRemote(standing: TeamStanding): Promise<ServiceResult> {
  const { error } = await supabase.rpc('upsert_standing', {
    p_team_id: standing.teamId,
    p_wins: standing.wins,
    p_losses: standing.losses,
    p_ties: standing.ties,
    p_total_pl: standing.totalPL,
    p_bets_won: standing.betsWon,
    p_bets_lost: standing.betsLost,
    p_bets_pushed: standing.betsPushed,
    p_best_week_pl: standing.bestWeekPL,
    p_weekly_scores: standing.weeklyScores,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** No-ops for a still-pending wager — nothing to report yet. Bot-team wagers are
 * silently skipped by the caller before this is ever invoked (see useAppStore's
 * advanceWeek): they never went through place_wager, so there's no real row to
 * settle — that's an accepted Step 4 scope boundary, not a bug here. */
export async function settleWagerRemote(wagerId: string, status: WagerStatus, settledProfit: number | null): Promise<ServiceResult> {
  if (status === 'pending') return { ok: true };
  const { error } = await supabase.rpc('settle_wager', { p_wager_id: wagerId, p_status: status, p_settled_profit: settledProfit });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function updateLeagueWeekRemote(leagueId: string, currentWeek: string, seasonPhase: string): Promise<ServiceResult> {
  const { error } = await supabase.from('leagues').update({ current_week: currentWeek, season_phase: seasonPhase }).eq('id', leagueId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

function parseWeekId(raw: string): WeekId {
  return raw === 'WC' || raw === 'DIV' || raw === 'CONF' ? raw : Number(raw);
}

interface MatchupRow {
  week: string;
  team_a_id: string;
  team_b_id: string;
  team_a_score: number | null;
  team_b_score: number | null;
  winner_id: string | null;
  is_tie: boolean;
}

export async function fetchLeagueMatchups(leagueId: string): Promise<ServiceResult<{ matchupsByWeek: Record<string, Matchup[]> }>> {
  const { data, error } = await supabase
    .from('matchups')
    .select('week, team_a_id, team_b_id, team_a_score, team_b_score, winner_id, is_tie')
    .eq('league_id', leagueId);
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not load matchups.' };

  const matchupsByWeek: Record<string, Matchup[]> = {};
  for (const row of data as MatchupRow[]) {
    const list = matchupsByWeek[row.week] ?? (matchupsByWeek[row.week] = []);
    list.push({
      id: `${row.team_a_id}-${row.team_b_id}-${row.week}`,
      week: parseWeekId(row.week),
      teamAId: row.team_a_id,
      teamBId: row.team_b_id,
      teamAScore: row.team_a_score,
      teamBScore: row.team_b_score,
      winnerId: row.winner_id,
      isTie: row.is_tie,
    });
  }
  return { ok: true, matchupsByWeek };
}

interface StandingRow {
  team_id: string;
  wins: number;
  losses: number;
  ties: number;
  total_pl: number;
  bets_won: number;
  bets_lost: number;
  bets_pushed: number;
  best_week_pl: number;
  weekly_scores: Record<string, number>;
}

export async function fetchLeagueStandings(leagueId: string): Promise<ServiceResult<{ standings: TeamStanding[] }>> {
  const { data, error } = await supabase
    .from('standings')
    .select('team_id, wins, losses, ties, total_pl, bets_won, bets_lost, bets_pushed, best_week_pl, weekly_scores')
    .eq('league_id', leagueId);
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not load standings.' };

  const standings: TeamStanding[] = (data as StandingRow[]).map((row) => ({
    teamId: row.team_id,
    wins: row.wins,
    losses: row.losses,
    ties: row.ties,
    totalPL: row.total_pl,
    betsWon: row.bets_won,
    betsLost: row.bets_lost,
    betsPushed: row.bets_pushed,
    bestWeekPL: row.best_week_pl,
    weeklyScores: row.weekly_scores,
  }));
  return { ok: true, standings };
}

export async function fetchLeagueCurrentWeek(leagueId: string): Promise<ServiceResult<{ currentWeek: WeekId; seasonPhase: string }>> {
  const { data, error } = await supabase.from('leagues').select('current_week, season_phase').eq('id', leagueId).single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not load league.' };
  return { ok: true, currentWeek: parseWeekId(data.current_week), seasonPhase: data.season_phase };
}
