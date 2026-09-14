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
  };
}

/** Keyed by player_name.trim().toLowerCase() -- the exact same normalization
 * settle-week's own statByPlayerName map uses (see
 * supabase/functions/settle-week/index.ts), so a ticker value can never
 * disagree with what actually got graded. */
export async function fetchRealPlayerStatsForWeek(week: WeekId): Promise<Record<string, RealPlayerStatLine>> {
  const { data, error } = await supabase.from('real_player_stats').select('*').eq('week', String(week));
  if (error || !data) return {};
  const out: Record<string, RealPlayerStatLine> = {};
  for (const row of data as RealPlayerStatRow[]) {
    out[row.player_name.trim().toLowerCase()] = mapRow(row);
  }
  return out;
}
