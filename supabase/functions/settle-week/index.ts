// Server-side settlement for one real, finished NFL week: grades every pending
// wager against real results, scores this week's matchups, and recomputes
// league standings, using the service role key so no client has to be trusted
// to compute (let alone report) its own result.
//
// Rewritten after finding the real schema (this comment left in place as a
// record, since it's the second version of this file): real_games has no
// bookmakers-derived id/game linkage issue to worry about, and grading needs
// no bookmakers jsonb parsing at all. Every wager already stores its own
// frozen `side`/`point` from placement time, so a wager is graded directly
// against the real final score (for h2h/spreads/totals) or a real
// `real_player_stats` row matched by player name (for props). real_player_stats
// has no game_id/player_id -- rows are matched by week (+ season, optional)
// and player_name.
//
// SCOPE, on purpose: settles wagers, scores this week's matchups, recomputes
// standings. Does NOT advance current_week/season_phase, touch the playoff
// bracket, or run prize-pool/moments logic -- those still live in
// engine/simulateWeek.ts's advanceLeagueWeek, a separate follow-up once this
// is verified. Trigger this (via cron, once a week's real_games are all
// status='final') before whatever still calls advanceWeek for that week.
//
// KNOWN GAP: computeIncompleteLineupPenalty (engine/scoring.ts) isn't applied
// here yet -- needs each league's weeklyCredits/lineupSlots settings, not
// wired in until you confirm where those live in your schema.
//
// Grading logic mirrors src/engine/realGameResult.ts + engine/settlement.ts's
// settleWager -- duplicated rather than imported, to avoid a cross-directory
// import surprise on `supabase functions deploy`. Keep the two in sync.

import { createClient } from 'npm:@supabase/supabase-js@2';

type MarketKey =
  | 'h2h' | 'spreads' | 'totals'
  | 'player_pass_yds' | 'player_pass_tds' | 'player_pass_interceptions'
  | 'player_rush_yds' | 'player_rush_attempts' | 'player_anytime_td'
  | 'player_reception_yds' | 'player_receptions'
  | 'player_kicking_points' | 'player_field_goals';

interface RealGame { id: string; home_team: string; away_team: string; home_score: number; away_score: number }

interface StatRow {
  player_name: string;
  passing_yards?: number; passing_tds?: number; passing_interceptions?: number;
  rushing_yards?: number; rushing_tds?: number; rushing_attempts?: number;
  receiving_yards?: number; receiving_tds?: number; receptions?: number;
  field_goals_made?: number; kicking_points?: number;
}

const STAT_FIELD: Partial<Record<MarketKey, keyof StatRow>> = {
  player_pass_yds: 'passing_yards',
  player_pass_tds: 'passing_tds',
  player_pass_interceptions: 'passing_interceptions',
  player_rush_yds: 'rushing_yards',
  player_rush_attempts: 'rushing_attempts',
  player_reception_yds: 'receiving_yards',
  player_receptions: 'receptions',
  player_kicking_points: 'kicking_points',
  player_field_goals: 'field_goals_made',
};

interface WagerRow {
  id: string; game_id: string; market_key: string; player_id: string | null;
  player_name: string | null; side: string; point: number | null;
  odds_at_placement: number; stake: number; status: string; settled_profit: number | null;
}

/** Mirrors src/engine/realGameResult.ts's buildRealGameResult + engine/settlement.ts's
 * settleWager, collapsed into one step since the edge function only ever needs the
 * final status/profit, not the intermediate GameResult shape. */
function gradeWager(wager: WagerRow, game: RealGame, stat: StatRow | undefined): { status: string; profit: number } {
  const marketKey = wager.market_key as MarketKey;
  const homeMargin = game.home_score - game.away_score;
  const point = wager.point ?? 0;
  let result: string;

  if (marketKey === 'h2h') {
    result = homeMargin > 0 ? game.home_team : game.away_team;
  } else if (marketKey === 'spreads') {
    const sideIsHome = wager.side === game.home_team;
    const sideMargin = sideIsHome ? homeMargin : -homeMargin;
    const covered = sideMargin + point;
    result = covered === 0 ? 'push' : covered > 0 ? wager.side : sideIsHome ? game.away_team : game.home_team;
  } else if (marketKey === 'totals') {
    const diff = game.home_score + game.away_score - point;
    result = diff === 0 ? 'push' : diff > 0 ? 'over' : 'under';
  } else if (marketKey === 'player_anytime_td') {
    const hit = ((stat?.rushing_tds ?? 0) + (stat?.receiving_tds ?? 0)) > 0;
    result = hit ? 'yes' : 'no';
  } else {
    const field = STAT_FIELD[marketKey];
    const actual = field ? (stat?.[field] ?? 0) : 0;
    const diff = actual - point;
    result = diff === 0 ? 'push' : diff > 0 ? 'over' : 'under';
  }

  // Same win/lose/push decision as engine/settlement.ts's settleWager.
  let outcome: 'win' | 'lose' | 'push';
  if (result === 'push') outcome = 'push';
  else if (result === 'yes' || result === 'no') outcome = result === 'yes' ? 'win' : 'lose';
  else if (result === 'over' || result === 'under') outcome = wager.side.toLowerCase() === result ? 'win' : 'lose';
  else outcome = wager.side === result ? 'win' : 'lose';

  if (outcome === 'push') return { status: 'push', profit: 0 };
  if (outcome === 'lose') return { status: 'lost', profit: -wager.stake };
  const odds = wager.odds_at_placement;
  const profit = odds > 0 ? wager.stake * (odds / 100) : wager.stake * (100 / Math.abs(odds));
  return { status: 'won', profit };
}

Deno.serve(async (req) => {
  const { week, season } = await req.json();
  if (week == null) return new Response(JSON.stringify({ ok: false, error: 'missing week' }), { status: 400 });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const weekStr = String(week);

  const { data: games, error: gamesErr } = await supabase
    .from('real_games')
    .select('id, home_team, away_team, home_score, away_score, status')
    .eq('week', weekStr)
    .eq('status', 'final');
  if (gamesErr) return new Response(JSON.stringify({ ok: false, error: gamesErr.message }), { status: 500 });
  if (!games || games.length === 0) {
    return new Response(JSON.stringify({ ok: true, note: `no final real_games for week ${weekStr} yet` }));
  }
  const gameById = new Map((games as RealGame[]).map((g) => [g.id, g]));

  let statsQuery = supabase.from('real_player_stats').select('*').eq('week', weekStr);
  if (season != null) statsQuery = statsQuery.eq('season', season);
  const { data: statRows } = await statsQuery;
  const statByPlayerName = new Map<string, StatRow>((statRows ?? []).map((r: StatRow) => [r.player_name.trim().toLowerCase(), r]));

  const { data: leagues, error: leaguesErr } = await supabase
    .from('leagues')
    .select('id')
    .eq('current_week', weekStr)
    .in('season_phase', ['regular', 'playoffs']);
  if (leaguesErr) return new Response(JSON.stringify({ ok: false, error: leaguesErr.message }), { status: 500 });

  const summary: Record<string, unknown>[] = [];

  for (const league of leagues ?? []) {
    const leagueId = league.id;

    const { data: rosterRows } = await supabase
      .from('weekly_rosters')
      .select('team_id, wagers(id, game_id, market_key, player_id, player_name, side, point, odds_at_placement, stake, status, settled_profit), teams!inner(league_id)')
      .eq('teams.league_id', leagueId)
      .eq('week', weekStr);

    const weeklyScoreByTeam = new Map<string, number>();
    let gradedCount = 0;
    for (const row of rosterRows ?? []) {
      let teamTotal = 0;
      for (const wager of (row as any).wagers ?? []) {
        if (wager.status !== 'pending') {
          teamTotal += wager.settled_profit ?? 0;
          continue;
        }
        const game = gameById.get(wager.game_id);
        if (!game) continue; // this wager's game isn't final yet -- leave pending
        const stat = wager.player_name ? statByPlayerName.get(String(wager.player_name).trim().toLowerCase()) : undefined;
        const { status, profit } = gradeWager(wager, game, stat);
        await supabase.rpc('settle_wager', { p_wager_id: wager.id, p_status: status, p_settled_profit: profit });
        teamTotal += profit;
        gradedCount++;
      }
      weeklyScoreByTeam.set((row as any).team_id, teamTotal);
      // NOTE: computeIncompleteLineupPenalty isn't applied -- see file-level comment.
    }

    const { data: weekMatchups } = await supabase
      .from('matchups')
      .select('team_a_id, team_b_id')
      .eq('league_id', leagueId)
      .eq('week', weekStr);

    for (const m of weekMatchups ?? []) {
      const aScore = weeklyScoreByTeam.get(m.team_a_id);
      const bScore = weeklyScoreByTeam.get(m.team_b_id);
      if (aScore == null || bScore == null) continue;
      const isTie = aScore === bScore;
      const winnerId = isTie ? null : aScore > bScore ? m.team_a_id : m.team_b_id;
      await supabase.rpc('upsert_matchup', {
        p_league_id: leagueId, p_week: weekStr,
        p_team_a_id: m.team_a_id, p_team_b_id: m.team_b_id,
        p_team_a_score: aScore, p_team_b_score: bScore,
        p_winner_id: winnerId, p_is_tie: isTie,
      });
    }

    // Recompute standings from scratch across the whole season, same design as
    // engine/standings.ts's computeStandings -- upsert_standing takes the full
    // recomputed line, not a delta.
    const { data: teams } = await supabase.from('teams').select('id').eq('league_id', leagueId);
    const { data: allMatchups } = await supabase.from('matchups').select('*').eq('league_id', leagueId);
    const { data: allRosterRows } = await supabase
      .from('weekly_rosters')
      .select('team_id, wagers(status), teams!inner(league_id)')
      .eq('teams.league_id', leagueId);

    const standings = new Map(
      (teams ?? []).map((t) => [t.id, { wins: 0, losses: 0, ties: 0, totalPL: 0, betsWon: 0, betsLost: 0, betsPushed: 0, bestWeekPL: -Infinity, weeklyScores: {} as Record<string, number> }]),
    );
    for (const m of allMatchups ?? []) {
      if (m.team_a_score == null || m.team_b_score == null) continue;
      const a = standings.get(m.team_a_id);
      const b = standings.get(m.team_b_id);
      if (!a || !b) continue;
      a.weeklyScores[m.week] = m.team_a_score;
      b.weeklyScores[m.week] = m.team_b_score;
      a.totalPL += m.team_a_score;
      b.totalPL += m.team_b_score;
      a.bestWeekPL = Math.max(a.bestWeekPL, m.team_a_score);
      b.bestWeekPL = Math.max(b.bestWeekPL, m.team_b_score);
      if (m.is_tie) { a.ties++; b.ties++; }
      else if (m.winner_id === m.team_a_id) { a.wins++; b.losses++; }
      else if (m.winner_id === m.team_b_id) { b.wins++; a.losses++; }
    }
    for (const row of allRosterRows ?? []) {
      const s = standings.get((row as any).team_id);
      if (!s) continue;
      for (const w of (row as any).wagers ?? []) {
        if (w.status === 'won') s.betsWon++;
        else if (w.status === 'lost') s.betsLost++;
        else if (w.status === 'push') s.betsPushed++;
      }
    }
    for (const [teamId, s] of standings) {
      await supabase.rpc('upsert_standing', {
        p_team_id: teamId, p_wins: s.wins, p_losses: s.losses, p_ties: s.ties,
        p_total_pl: s.totalPL, p_bets_won: s.betsWon, p_bets_lost: s.betsLost, p_bets_pushed: s.betsPushed,
        p_best_week_pl: s.bestWeekPL === -Infinity ? 0 : s.bestWeekPL, p_weekly_scores: s.weeklyScores,
      });
    }

    summary.push({ leagueId, wagersGraded: gradedCount, teamsScored: weeklyScoreByTeam.size, matchupsScored: (weekMatchups ?? []).length });
  }

  return new Response(JSON.stringify({ ok: true, week: weekStr, finalGames: games.length, leagues: summary }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
