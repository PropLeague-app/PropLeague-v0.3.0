// Read-only client-side fetch of real_player_stats, added to power the
// settled-wager result ticker (Sept 2026 chat: "frame of reference for how
// much someone won/lost by" next to the Won/Lost pill). Grading itself still
// happens exclusively server-side in supabase/functions/settle-week -- this
// is a separate, presentation-only read of the same table.
//
// A row only exists here once fetch-balldontlie-player-stats has ingested a
// FINAL game (see that function's header) -- there is currently no live/
// in-progress box-score ingestion, so the ticker can't tick up mid-game for
// player-prop markets; it appears at essentially the same moment the wager
// itself settles. (Moneyline/spread/total tickers are different -- those read
// real_games.home_score/away_score directly, which balldontlie does sync
// continuously while a game is live, so those can show a running score.)
import { supabase } from '../lib/supabaseClient';
import type { RealPlayerStatLine } from '../engine/realGameResult';
import type { WeekId } from '../types';

interface RealPlayerStatRow {
  player_name: string;
  recent_team?: string | null;
  passing_yards?: number | null;
  passing_tds?: number | null;
  passing_interceptions?: number | null;
  rushing_yards?: number | null;
  rushing_tds?: number | null;
  rushing_attempts?: number | null;
  receiving_yards?: number | null;
  receiving_tds?: number | null;
  receptions?: number | null;
  field_goals_made?: number | null;
  kicking_points?: number | null;
  passing_attempts?: number | null;
  passing_completions?: number | null;
  long_rushing?: number | null;
  long_reception?: number | null;
  extra_points_made?: number | null;
}

function mapRow(row: RealPlayerStatRow): RealPlayerStatLine {
  return {
    playerName: row.player_name,
    recentTeam: row.recent_team ?? '',
    passingYards: row.passing_yards ?? undefined,
    passingTds: row.passing_tds ?? undefined,
    passingInterceptions: row.passing_interceptions ?? undefined,
    rushingYards: row.rushing_yards ?? undefined,
    rushingTds: row.rushing_tds ?? undefined,
    rushingAttempts: row.rushing_attempts ?? undefined,
    receivingYards: row.receiving_yards ?? undefined,
    receivingTds: row.receiving_tds ?? undefined,
    receptions: row.receptions ?? undefined,
    fieldGoalsMade: row.field_goals_made ?? undefined,
    kickingPoints: row.kicking_points ?? undefined,
    passingAttempts: row.passing_attempts ?? undefined,
    passingCompletions: row.passing_completions ?? undefined,
    longRushing: row.long_rushing ?? undefined,
    longReception: row.long_reception ?? undefined,
    extraPointsMade: row.extra_points_made ?? undefined,
  };
}

// PostgREST caps an unranged select at 1000 rows by default and truncates
// silently rather than erroring -- same bug class as loadActiveRoster in
// supabaseOdds.ts (see that file's comment). A full week's real_player_stats
// (every skill player + kicker across all 16 games, once everything's final)
// sits close enough to that ceiling that it silently clipped off the LAST
// rows written -- Dak Prescott, CeeDee Lamb, Cam Skattebo, Jaxson Dart, all
// from Cowboys@Giants, the last game of the week to finish ingesting (see
// chat, Sept 2026) -- which is why their ticker went blank on every reload
// while everyone ingested earlier in the day kept working. Paginating here
// the same way fixes it regardless of how large the table grows.
const PAGE_SIZE = 1000;

/** Keyed by player_name.trim().toLowerCase() -- the exact same normalization
 * settle-week's own statByPlayerName map uses (see
 * supabase/functions/settle-week/index.ts), so a ticker value can never
 * disagree with what actually got graded. */
export async function fetchRealPlayerStatsForWeek(week: WeekId): Promise<Record<string, RealPlayerStatLine>> {
  const out: Record<string, RealPlayerStatLine> = {};
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('real_player_stats')
      .select('*')
      .eq('week', String(week))
      .range(from, from + PAGE_SIZE - 1);
    if (error || !data) break;
    for (const row of data as RealPlayerStatRow[]) {
      out[row.player_name.trim().toLowerCase()] = mapRow(row);
    }
    if (data.length < PAGE_SIZE) break; // last page reached
    from += PAGE_SIZE;
  }
  return out;
}
