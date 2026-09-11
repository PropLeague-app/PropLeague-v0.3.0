// Server-side settlement + full automatic season progression for real NFL
// weeks. Cron-triggered, no request body required (auto-discovers every week
// that has a league currently sitting on it) -- this is what lets the app
// "just work on its own" per Hunter's explicit ask: no DevPanel, no
// commissioner button, no client action of any kind. A `week`/`season` body
// still works for manual/testing invocation, same as before.
//
// Per league, per pass:
//   1. Grade every pending wager whose game is now final (unchanged from the
//      previous version of this file).
//   2. Score this week's matchups + recompute season standings from scratch
//      (unchanged).
//   3. NEW: if every real_games row for this week is final, decide whether to
//      advance the league -- regular season -> next regular week, regular
//      season -> playoffs (builds + seeds the bracket), or one playoff round
//      -> the next (using supabase/functions/_shared/playoffLogic.ts, a
//      deliberate copy of src/engine/playoffs.ts -- see that file's header).
//   4. NEW: advances the league's real-dollar prize pool for the week the
//      same way (also ported from src/engine/prizePool.ts).
//
// NOT done here: Weekly Moments (src/engine/moments.ts). That needs per-wager
// roster data in a shape real settlement doesn't have a working equivalent
// for yet -- explicitly deferred, flagged in chat, not a bug.
//
// Incomplete-lineup penalty (per Hunter's explicit choice in chat to port
// the original spec's stricter behavior rather than leave it unenforced):
// once a week is fully final, any team that left a roster slot empty or
// never hit submit eats its unallocated weekly credits as a straight loss --
// including a team that placed zero picks all week and has no
// weekly_rosters row at all. Mirrors src/engine/scoring.ts's
// computeIncompleteLineupPenalty; only assessed once weekComplete so a team
// still filling in a later-week slot isn't penalized mid-week.
//
// Grading logic mirrors src/engine/realGameResult.ts + engine/settlement.ts's
// settleWager -- duplicated rather than imported, to avoid a cross-directory
// import surprise on `supabase functions deploy`. Keep the two in sync.
//
// Player-prop wagers only get graded once a matching row exists in
// real_player_stats (populated by fetch-balldontlie-player-stats, which only
// writes rows for games balldontlie itself has marked final -- see that
// file's header). No matching row means "not ingested yet", not "recorded a
// zero" -- a wager in that state is left pending rather than defaulted to a
// loss/win, which is what happened before this fix (see chat: the Mack
// Hollins incident). balldontlie replaced an earlier SportsDataIO-based
// version of this after SportsDataIO's trial key was confirmed to return
// perturbed stat numbers, not real ones (see chat).

import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  type PlayoffFieldSize,
  type PlayoffBracket,
  type PrizePool,
  type StandingLine,
  type MatchupLine,
  type WeekId,
  buildBracket,
  buildConferenceBracket,
  conferenceBracketSupported,
  advanceBracket,
  sortStandings,
  computeStandingMultipliers,
  advancePoolForWeek,
  lockPool,
  regularSeasonWeeksFor,
  playoffWeekSequence,
} from '../_shared/playoffLogic.ts';

type MarketKey =
  | 'h2h' | 'spreads' | 'totals'
  | 'player_pass_yds' | 'player_pass_tds' | 'player_pass_interceptions'
  | 'player_rush_yds' | 'player_rush_attempts' | 'player_anytime_td'
  | 'player_reception_yds' | 'player_receptions' | 'player_rush_reception_yds'
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

/** Minimal shape of LeagueSettings that this function actually reads. Everything
 * else on the real client type is irrelevant here. A league with `settings: null`
 * (not yet saved by the client -- see chat) falls back to these app-wide defaults
 * so older/unconfigured leagues don't get stuck mid-season. */
interface SettingsSlice {
  weeklyCredits: number;
  playoffTeams: number;
  eliminationType: 'single' | 'double';
  conferencesEnabled: boolean;
  buyInEnabled: boolean;
  buyInAmount: number;
  poolMultipliers: { enabled: boolean; basis: 'rank' | 'record' | 'seasonPL'; spread: number };
  /** Needed to know how many slots a full roster actually has, for the
   * incomplete-lineup penalty (see chat: engine/scoring.ts's
   * computeIncompleteLineupPenalty, ported into this function below). */
  lineupSlots: Record<string, number>;
}

const DEFAULT_LINEUP_SLOTS: Record<string, number> = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, ML: 1 };

const DEFAULT_SETTINGS: SettingsSlice = {
  weeklyCredits: 100,
  playoffTeams: 4,
  eliminationType: 'single',
  conferencesEnabled: false,
  buyInEnabled: false,
  buyInAmount: 0,
  poolMultipliers: { enabled: false, basis: 'rank', spread: 0 },
  lineupSlots: DEFAULT_LINEUP_SLOTS,
};

function settingsFrom(raw: unknown): SettingsSlice {
  if (!raw || typeof raw !== 'object') return DEFAULT_SETTINGS;
  const r = raw as Partial<SettingsSlice> & { poolMultipliers?: Partial<SettingsSlice['poolMultipliers']> };
  return {
    weeklyCredits: r.weeklyCredits ?? DEFAULT_SETTINGS.weeklyCredits,
    playoffTeams: r.playoffTeams ?? DEFAULT_SETTINGS.playoffTeams,
    eliminationType: r.eliminationType ?? DEFAULT_SETTINGS.eliminationType,
    conferencesEnabled: r.conferencesEnabled ?? DEFAULT_SETTINGS.conferencesEnabled,
    buyInEnabled: r.buyInEnabled ?? DEFAULT_SETTINGS.buyInEnabled,
    buyInAmount: r.buyInAmount ?? DEFAULT_SETTINGS.buyInAmount,
    poolMultipliers: { ...DEFAULT_SETTINGS.poolMultipliers, ...(r.poolMultipliers ?? {}) },
    lineupSlots: r.lineupSlots && typeof r.lineupSlots === 'object' ? (r.lineupSlots as Record<string, number>) : DEFAULT_SETTINGS.lineupSlots,
  };
}

function fieldSizeFor(settings: SettingsSlice): PlayoffFieldSize {
  return (([2, 4, 6, 8, 16] as const).includes(settings.playoffTeams as PlayoffFieldSize) ? settings.playoffTeams : 4) as PlayoffFieldSize;
}

function parseWeekId(raw: string): WeekId {
  return raw === 'WC' || raw === 'DIV' || raw === 'CONF' ? raw : Number(raw);
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
  } else if (marketKey === 'player_rush_reception_yds') {
    const actual = (stat?.rushing_yards ?? 0) + (stat?.receiving_yards ?? 0);
    const diff = actual - point;
    result = diff === 0 ? 'push' : diff > 0 ? 'over' : 'under';
  } else {
    const field = STAT_FIELD[marketKey];
    const actual = field ? (stat?.[field] ?? 0) : 0;
    const diff = actual - point;
    result = diff === 0 ? 'push' : diff > 0 ? 'over' : 'under';
  }

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
  let body: { week?: string | number; season?: number } = {};
  try {
    body = await req.json();
  } catch {
    // Cron invocations send no body at all -- that's the normal case now.
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // Auto-discover every week currently "live" for at least one league, unless
  // the caller explicitly asked for one (manual/testing invocation).
  let weeksToProcess: string[];
  if (body.week != null) {
    weeksToProcess = [String(body.week)];
  } else {
    const { data: activeLeagues, error: activeErr } = await supabase
      .from('leagues')
      .select('current_week')
      .in('season_phase', ['regular', 'playoffs']);
    if (activeErr) return new Response(JSON.stringify({ ok: false, error: activeErr.message }), { status: 500 });
    weeksToProcess = [...new Set((activeLeagues ?? []).map((l) => String(l.current_week)))];
  }

  const season = body.season ?? null;
  const summary: Record<string, unknown>[] = [];

  for (const weekStr of weeksToProcess) {
    const { data: games, error: gamesErr } = await supabase
      .from('real_games')
      .select('id, home_team, away_team, home_score, away_score, status')
      .eq('week', weekStr);
    if (gamesErr) {
      summary.push({ week: weekStr, error: gamesErr.message });
      continue;
    }
    const finalGames = (games ?? []).filter((g) => g.status === 'final') as RealGame[];
    const weekComplete = (games ?? []).length > 0 && finalGames.length === (games ?? []).length;
    if (finalGames.length === 0) {
      summary.push({ week: weekStr, note: 'no final real_games for this week yet' });
      continue;
    }
    const gameById = new Map(finalGames.map((g) => [g.id, g]));

    let statsQuery = supabase.from('real_player_stats').select('*').eq('week', weekStr);
    if (season != null) statsQuery = statsQuery.eq('season', season);
    const { data: statRows } = await statsQuery;
    const statByPlayerName = new Map<string, StatRow>((statRows ?? []).map((r: StatRow) => [r.player_name.trim().toLowerCase(), r]));

    const { data: leagues, error: leaguesErr } = await supabase
      .from('leagues')
      .select('id, current_week, season_phase, bracket, settings, prize_pool, target_team_count')
      .eq('current_week', weekStr)
      .in('season_phase', ['regular', 'playoffs']);
    if (leaguesErr) {
      summary.push({ week: weekStr, error: leaguesErr.message });
      continue;
    }

    for (const league of leagues ?? []) {
      const leagueId = league.id as string;
      const settings = settingsFrom(league.settings);
      const fieldSize = fieldSizeFor(settings);

      // Fetched up-front (not just later for standings) so a team that placed
      // zero picks all week -- and thus has no weekly_rosters row at all -- can
      // still be caught by the incomplete-lineup penalty below.
      const { data: teams } = await supabase.from('teams').select('id, conference_id').eq('league_id', leagueId);
      const totalSlots = Object.values(settings.lineupSlots).reduce((a, b) => a + b, 0);

      const { data: rosterRows } = await supabase
        .from('weekly_rosters')
        .select('team_id, submitted, wagers(id, game_id, market_key, player_id, player_name, side, point, odds_at_placement, stake, status, settled_profit), teams!inner(league_id)')
        .eq('teams.league_id', leagueId)
        .eq('week', weekStr);

      const weeklyScoreByTeam = new Map<string, number>();
      let gradedCount = 0;
      // Previously this RPC call's result was never checked -- gradedCount and
      // teamTotal got incremented unconditionally, so a failing write (RLS,
      // a signature mismatch, settle_wager not existing at all -- this repo's
      // RPCs are largely hand-created in the SQL editor, not migration-tracked,
      // see chat) would silently report success while the wager's row in
      // Supabase never actually changed. `errors` (shared with the two RPC
      // calls below) surfaces that instead of swallowing it.
      const errors: string[] = [];
      for (const row of rosterRows ?? []) {
        let teamTotal = 0;
        const wagers = (row as any).wagers ?? [];
        for (const wager of wagers) {
          if (wager.status !== 'pending') {
            teamTotal += wager.settled_profit ?? 0;
            continue;
          }
          const game = gameById.get(wager.game_id);
          if (!game) continue; // this wager's game isn't final yet -- leave pending
          const stat = wager.player_name ? statByPlayerName.get(String(wager.player_name).trim().toLowerCase()) : undefined;
          // A player-prop market with no matching stat row means the stats
          // provider hasn't ingested this player's game yet -- NOT that they
          // recorded a zero. gradeWager defaults a missing field to 0, which
          // silently auto-lost every "Over" and auto-won every "Under" for any
          // player not yet in real_player_stats (see chat: the Mack Hollins
          // incident -- his real 51 receiving yards got graded as a loss
          // because nflverse had no 2026 data at all). Game-level markets
          // (h2h/spreads/totals) don't need a player stat row at all, so they
          // aren't gated by this.
          const isPlayerMarket = wager.market_key !== 'h2h' && wager.market_key !== 'spreads' && wager.market_key !== 'totals';
          if (isPlayerMarket && !stat) continue; // stat not ingested yet -- leave pending
          const { status, profit } = gradeWager(wager, game, stat);
          const { error: settleErr } = await supabase.rpc('settle_wager', { p_wager_id: wager.id, p_status: status, p_settled_profit: profit });
          if (settleErr) {
            errors.push(`wager ${wager.id}: ${settleErr.message}`);
            continue; // don't count it as graded or fold its profit into the team's score -- it's still 'pending' in the DB
          }
          teamTotal += profit;
          gradedCount++;
        }
        // Incomplete-lineup penalty, ported from engine/scoring.ts's
        // computeIncompleteLineupPenalty (see chat): once the week is fully
        // final, any weekly credits a team never allocated -- because it left
        // a slot empty or never hit submit -- count as a straight loss,
        // matching the original product spec. Gated on weekComplete so a
        // team still filling in a later slot isn't penalized mid-week.
        if (weekComplete) {
          const allocated = wagers.reduce((sum: number, w: any) => sum + (w.stake ?? 0), 0);
          const unallocated = Math.max(0, settings.weeklyCredits - allocated);
          const hasEmptySlot = wagers.length < totalSlots;
          if (!(row as any).submitted || hasEmptySlot) {
            teamTotal -= unallocated;
          }
        }
        weeklyScoreByTeam.set((row as any).team_id, teamTotal);
      }

      // Teams with zero picks all week have no weekly_rosters row at all, so they
      // never entered the loop above -- give every one of them an entry here
      // regardless of weekComplete (0 mid-week, the full incomplete-lineup penalty
      // once the week is actually final). Previously this whole block only ran once
      // weekComplete, which meant a team with nothing rostered had NO entry here
      // while the week was still in progress -- the matchup-scoring loop right below
      // then skips writing anything at all for a matchup with an undefined score
      // (aScore == null || bScore == null), so whatever score happened to already be
      // sitting in that matchups row (e.g. from an earlier, since-reset test week, or
      // simply never written yet) stayed displayed indefinitely instead of the $0 a
      // genuinely empty roster should show mid-week (see chat: "both screens should
      // default to $0 until a bet settles one way or another").
      for (const t of teams ?? []) {
        const teamId = (t as any).id as string;
        if (!weeklyScoreByTeam.has(teamId)) {
          weeklyScoreByTeam.set(teamId, weekComplete ? -settings.weeklyCredits : 0);
        }
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
        // Scores themselves still update live as each team's bets settle through the
        // week (that's the "ROI/bet record can move progressively" part -- see chat),
        // but the actual W/L/T verdict is deliberately held back until every real_games
        // row for this week is final (weekComplete -- Monday night's game finishing, or
        // the Tuesday failsafe settle-week run catching it). Before that, winner_id/is_tie
        // stay null/false, which the standings recompute below already treats as
        // "not decided yet" and skips incrementing wins/losses/ties for -- so a team's
        // official record can't flip mid-week off a snapshot that later changes.
        const isTie = weekComplete && aScore === bScore;
        const winnerId = weekComplete ? (isTie ? null : aScore > bScore ? m.team_a_id : m.team_b_id) : null;
        const { error: matchupErr } = await supabase.rpc('upsert_matchup', {
          p_league_id: leagueId, p_week: weekStr,
          p_team_a_id: m.team_a_id, p_team_b_id: m.team_b_id,
          p_team_a_score: aScore, p_team_b_score: bScore,
          p_winner_id: winnerId, p_is_tie: isTie,
        });
        if (matchupErr) errors.push(`matchup ${m.team_a_id}/${m.team_b_id}: ${matchupErr.message}`);
      }

      // Recompute standings from scratch across the whole season.
      // (teams was already fetched above, before the roster-grading loop.)
      const { data: allMatchups } = await supabase.from('matchups').select('*').eq('league_id', leagueId);
      const { data: allRosterRows } = await supabase
        .from('weekly_rosters')
        .select('team_id, wagers(status, stake), teams!inner(league_id)')
        .eq('teams.league_id', leagueId);

      const standingsMap = new Map(
        (teams ?? []).map((t) => [t.id, { teamId: t.id, wins: 0, losses: 0, ties: 0, totalPL: 0, betsWon: 0, betsLost: 0, betsPushed: 0, bestWeekPL: -Infinity, totalWagered: 0, weeklyScores: {} as Record<string, number> }]),
      );
      for (const m of allMatchups ?? []) {
        if (m.team_a_score == null || m.team_b_score == null) continue;
        const a = standingsMap.get(m.team_a_id);
        const b = standingsMap.get(m.team_b_id);
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
        const s = standingsMap.get((row as any).team_id);
        if (!s) continue;
        for (const w of (row as any).wagers ?? []) {
          if (w.status === 'won') s.betsWon++;
          else if (w.status === 'lost') s.betsLost++;
          else if (w.status === 'push') s.betsPushed++;
          // Every wager placed counts toward total wagered regardless of status
          // (matches the client's old totalWageredByTeam semantics -- see chat).
          s.totalWagered += w.stake ?? 0;
        }
      }
      for (const [teamId, s] of standingsMap) {
        const { error: standingErr } = await supabase.rpc('upsert_standing', {
          p_team_id: teamId, p_wins: s.wins, p_losses: s.losses, p_ties: s.ties,
          p_total_pl: s.totalPL, p_bets_won: s.betsWon, p_bets_lost: s.betsLost, p_bets_pushed: s.betsPushed,
          p_best_week_pl: s.bestWeekPL === -Infinity ? 0 : s.bestWeekPL, p_weekly_scores: s.weeklyScores,
          p_total_wagered: s.totalWagered,
        });
        if (standingErr) errors.push(`standing ${teamId}: ${standingErr.message}`);
      }

      // --- Automatic season progression (only once every real_games row for
      // this week is final) -----------------------------------------------
      let advancement: Record<string, unknown> | null = null;
      if (weekComplete) {
        const standingLines: StandingLine[] = [...standingsMap.values()].map((s) => ({
          teamId: s.teamId, wins: s.wins, losses: s.losses, ties: s.ties, totalPL: s.totalPL,
          betsWon: s.betsWon, betsLost: s.betsLost, bestWeekPL: s.bestWeekPL === -Infinity ? 0 : s.bestWeekPL,
        }));
        const matchupLines: MatchupLine[] = (allMatchups ?? []).map((m) => ({ teamAId: m.team_a_id, teamBId: m.team_b_id, winnerId: m.winner_id }));
        const sorted = sortStandings(standingLines, matchupLines);
        const teamCount = (teams ?? []).length || league.target_team_count || sorted.length;

        let newWeek: string = weekStr;
        let newPhase: string = league.season_phase;
        let newBracket: PlayoffBracket | null = (league.bracket as PlayoffBracket | null) ?? null;
        let seasonJustCompleted = false;

        if (league.season_phase === 'regular') {
          const regWeeks = regularSeasonWeeksFor(fieldSize, settings.eliminationType);
          const currentWeekNum = Number(weekStr);
          if (Number.isFinite(currentWeekNum) && currentWeekNum < regWeeks) {
            newWeek = String(currentWeekNum + 1);
            newPhase = 'regular';
          } else {
            // Regular season just ended -- build and seed the playoff bracket.
            let bracket: PlayoffBracket;
            const conferenceIds = new Set((teams ?? []).map((t: any) => t.conference_id).filter(Boolean));
            if (settings.conferencesEnabled && conferenceIds.size === 2 && conferenceBracketSupported(fieldSize, settings.eliminationType, 2)) {
              const [confA, confB] = [...conferenceIds];
              const seedsA = sorted.filter((s) => (teams ?? []).find((t: any) => t.id === s.teamId)?.conference_id === confA).map((s) => s.teamId);
              const seedsB = sorted.filter((s) => (teams ?? []).find((t: any) => t.id === s.teamId)?.conference_id === confB).map((s) => s.teamId);
              bracket = buildConferenceBracket([seedsA, seedsB], fieldSize);
            } else {
              bracket = buildBracket(sorted.slice(0, fieldSize).map((s) => s.teamId), fieldSize, settings.eliminationType);
            }
            const firstPlayoffWeek = playoffWeekSequence(fieldSize, settings.eliminationType)[0] ?? 'WC';
            bracket = advanceBracket(bracket, null, () => null, firstPlayoffWeek);
            newWeek = String(firstPlayoffWeek);
            newPhase = 'playoffs';
            newBracket = bracket;
          }
        } else if (league.season_phase === 'playoffs' && newBracket) {
          const sequence = playoffWeekSequence(fieldSize, settings.eliminationType);
          const settledWeekId = parseWeekId(weekStr);
          const currentIdx = sequence.findIndex((w) => String(w) === weekStr);
          // Fallback for the rare bracket-reset round, which sits one week past
          // the precomputed sequence (only reachable in double-elimination).
          const nextWeekId: WeekId = currentIdx >= 0 && currentIdx + 1 < sequence.length
            ? sequence[currentIdx + 1]
            : (typeof settledWeekId === 'number' ? settledWeekId + 1 : 'CONF');
          const scoresFor = (teamId: string): number | null => weeklyScoreByTeam.get(teamId) ?? null;
          const advanced = advanceBracket(newBracket, settledWeekId, scoresFor, nextWeekId);
          newBracket = advanced;
          if (advanced.championId) {
            newPhase = 'complete';
            newWeek = weekStr; // season is over -- leave current_week as the final played week
            seasonJustCompleted = true;
          } else {
            newPhase = 'playoffs';
            newWeek = String(nextWeekId);
          }
        }

        // Prize pool -- advances on every settled week, regular season or
        // playoffs, same as the client engine did.
        let pool = (league.prize_pool as PrizePool | null) ?? null;
        if (!pool && settings.buyInEnabled) {
          const initial = teamCount * settings.buyInAmount;
          pool = { initial, current: initial, locked: false, history: [] };
        }
        if (pool && !pool.locked) {
          const multipliers = settings.poolMultipliers.enabled && league.season_phase === 'regular'
            ? computeStandingMultipliers(standingLines, settings.poolMultipliers.basis, settings.poolMultipliers.spread)
            : Object.fromEntries(standingLines.map((s) => [s.teamId, 1]));
          pool = advancePoolForWeek(pool, parseWeekId(weekStr), weeklyScoreByTeam, settings.weeklyCredits, teamCount, multipliers);
          if (seasonJustCompleted) pool = lockPool(pool);
        }

        // Optimistic-concurrency guard: only write if this league is still
        // where we started (protects against two overlapping cron runs).
        const { error: updateErr } = await supabase
          .from('leagues')
          .update({ current_week: newWeek, season_phase: newPhase, bracket: newBracket, prize_pool: pool })
          .eq('id', leagueId)
          .eq('current_week', weekStr)
          .eq('season_phase', league.season_phase);
        advancement = { from: `${league.season_phase} ${weekStr}`, to: `${newPhase} ${newWeek}`, updateErr: updateErr?.message ?? null };
      }

      summary.push({ leagueId, week: weekStr, wagersGraded: gradedCount, teamsScored: weeklyScoreByTeam.size, matchupsScored: (weekMatchups ?? []).length, weekComplete, advancement, errors });
    }
  }

  return new Response(JSON.stringify({ ok: true, weeksProcessed: weeksToProcess, leagues: summary }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
