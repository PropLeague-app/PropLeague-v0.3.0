// Supabase Edge Function: generate-bot-lineups (see chat, Sept 2026 -- Fix 2)
//
// Places a real, valid lineup for every is_simulated ("bot") team that doesn't
// have one yet for the coming week -- covers both a league that launched short
// of real signups (the actual near-term case Hunter flagged: filling the last
// 1-2 slots of a new league) and a team vacated via leave_league. Uses the exact
// same generateAutoLineup engine and real odds/games pipeline real human picks
// already go through (see _shared/autoLineupReal.ts and
// _shared/realGamesForBots.ts's headers for why those are faithful ports, not
// new logic), then places it through the same place_wager/submit_roster RPCs a
// human client calls, now authorized for is_simulated teams via
// 0019_bot_lineup_service_role.sql's can_manage_team change.
//
// Timing: deliberately piggybacks on the SAME per-day-slot windows already used
// by send-roster-reminders (45-75 min before a day_slot's earliest kickoff, see
// that function's header) rather than inventing new schedule logic -- Hunter's
// call, since it's already correct, already scheduled, and means bot lineups
// firm up right before real odds lock, same as when a human gets nudged. Fires
// once per team per week (idempotent: the first due day_slot of the week
// generates the WHOLE week's lineup in one shot and submits it; later due slots
// that same week find the roster already submitted and no-op) rather than
// filling slots incrementally per day_slot -- simpler, and by the time the
// FIRST slate of the week is ~an hour out, real sportsbooks have normally
// already priced the whole week, not just that slate.
//
// Cross-team duplicate-claim avoidance during generation is best-effort only
// (an in-memory tracker for this one run) -- place_wager's own maxDuplicatePicks
// check is the real, atomic backstop, the same protection a real human's pick
// already gets (see that RPC's definition).
//
// Deploy: supabase functions deploy generate-bot-lineups
// Schedule: same as send-roster-reminders -- every 15 min, every day.
// Secrets: none beyond the auto-injected SUPABASE_URL/service role key.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { getSupabaseAdminKey } from '../_shared/supabaseAdminKey.ts';
import { teamsActiveInWeek, type PlayoffBracket, type WeekId } from '../_shared/playoffLogic.ts';
import { fetchRealGamesForWeek, type Position } from '../_shared/realGamesForBots.ts';
import { generateAutoLineup, type AutoLineupSettings, type Wager } from '../_shared/autoLineupReal.ts';

const REMINDER_WINDOW_MIN_MS = 45 * 60 * 1000;
const REMINDER_WINDOW_MAX_MS = 75 * 60 * 1000;

const DEFAULT_LINEUP_SLOTS: Record<Position | 'ML', number> = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, ML: 1 };
const DEFAULT_SETTINGS: AutoLineupSettings = {
  weeklyCredits: 100,
  lineupSlots: DEFAULT_LINEUP_SLOTS,
  minBetPerSlot: 1,
  maxMLBet: 15,
  singleBetCapPct: 0.8,
};

function settingsFrom(raw: unknown): AutoLineupSettings {
  if (!raw || typeof raw !== 'object') return DEFAULT_SETTINGS;
  const r = raw as Partial<AutoLineupSettings>;
  return {
    weeklyCredits: r.weeklyCredits ?? DEFAULT_SETTINGS.weeklyCredits,
    lineupSlots: r.lineupSlots && typeof r.lineupSlots === 'object' ? (r.lineupSlots as Record<Position | 'ML', number>) : DEFAULT_SETTINGS.lineupSlots,
    minBetPerSlot: r.minBetPerSlot ?? DEFAULT_SETTINGS.minBetPerSlot,
    maxMLBet: r.maxMLBet ?? DEFAULT_SETTINGS.maxMLBet,
    singleBetCapPct: r.singleBetCapPct ?? DEFAULT_SETTINGS.singleBetCapPct,
  };
}

function claimKey(gameId: string, marketKey: string, playerId: string | undefined, side: string, point: number | undefined): string {
  return `${gameId}|${marketKey}|${playerId ?? ''}|${side}|${point ?? ''}`;
}

function parseWeekId(raw: string): WeekId {
  return raw === 'WC' || raw === 'DIV' || raw === 'CONF' ? raw : Number(raw);
}

Deno.serve(async (_req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, getSupabaseAdminKey());
  const now = Date.now();
  const summary: Record<string, unknown>[] = [];

  const { data: leagues, error: leaguesErr } = await supabase
    .from('leagues')
    .select('id, current_week, season_phase, bracket, settings, season_start_week')
    .in('season_phase', ['regular', 'playoffs']);
  if (leaguesErr) return new Response(JSON.stringify({ ok: false, error: leaguesErr.message }), { status: 500 });

  for (const league of leagues ?? []) {
    const leagueId = league.id as string;
    const weekStr = String(league.current_week);

    // Same season-start gate as settle-week (0013_season_start_week.sql): a week
    // this league never actually played never gets bot picks either.
    const seasonStartWeekNum = league.season_start_week != null ? Number(league.season_start_week) : null;
    const thisWeekNum = Number(weekStr);
    const seasonStarted =
      seasonStartWeekNum != null && (!Number.isFinite(thisWeekNum) || !Number.isFinite(seasonStartWeekNum) || thisWeekNum >= seasonStartWeekNum);
    if (!seasonStarted) {
      summary.push({ leagueId, week: weekStr, note: 'season not started for this league yet' });
      continue;
    }

    const { data: gameRows, error: gamesErr } = await supabase.from('real_games').select('day_slot, kickoff').eq('week', weekStr);
    if (gamesErr) {
      summary.push({ leagueId, week: weekStr, error: gamesErr.message });
      continue;
    }
    const earliestKickoffBySlot = new Map<string, number>();
    for (const g of gameRows ?? []) {
      if (!g.day_slot || !g.kickoff) continue;
      const ms = new Date(g.kickoff).getTime();
      const existing = earliestKickoffBySlot.get(g.day_slot);
      if (existing == null || ms < existing) earliestKickoffBySlot.set(g.day_slot, ms);
    }
    const inDueWindow = [...earliestKickoffBySlot.values()].some((kickoffMs) => {
      const untilKickoff = kickoffMs - now;
      return untilKickoff >= REMINDER_WINDOW_MIN_MS && untilKickoff <= REMINDER_WINDOW_MAX_MS;
    });
    if (!inDueWindow) {
      summary.push({ leagueId, week: weekStr, note: 'no slate in the generation window right now' });
      continue;
    }

    const { data: teams } = await supabase.from('teams').select('id, is_simulated').eq('league_id', leagueId);
    const botTeamIds = (teams ?? []).filter((t) => t.is_simulated).map((t) => t.id as string);
    if (botTeamIds.length === 0) continue;

    // During playoffs, an eliminated bot team never plays again -- mirrors
    // src/engine/simulateWeek.ts's activeTeamsForWeek exactly (every team is
    // "active" all regular season; teamsActiveInWeek only matters once a bracket
    // exists). Reused directly from _shared/playoffLogic.ts, not re-derived.
    let activeTeamIds = botTeamIds;
    if (league.season_phase === 'playoffs' && league.bracket) {
      const activeAny = teamsActiveInWeek(league.bracket as PlayoffBracket, parseWeekId(weekStr));
      activeTeamIds = botTeamIds.filter((id) => activeAny.includes(id));
    }
    if (activeTeamIds.length === 0) continue;

    const { data: existingRosters } = await supabase
      .from('weekly_rosters')
      .select('team_id, submitted')
      .eq('week', weekStr)
      .in('team_id', activeTeamIds);
    const alreadySubmitted = new Set((existingRosters ?? []).filter((r) => r.submitted).map((r) => r.team_id as string));
    const pendingTeamIds = activeTeamIds.filter((id) => !alreadySubmitted.has(id));
    if (pendingTeamIds.length === 0) {
      summary.push({ leagueId, week: weekStr, note: 'every bot team already has a submitted roster' });
      continue;
    }

    // Fairness fix (see chat, Sept 29 2026, the RPC-lockdown follow-up): this used to
    // hand generateAutoLineup every game in the week, unfiltered by status. That's
    // fine early in the week, but once a later day-slot's generation window opens
    // (e.g. the MNF window, ~60min before kickoff), the pool still includes every
    // Thursday/Sunday game from earlier that week -- most of them already final. A
    // bot could "pick" a game whose real outcome is already known, at the expense of
    // whichever real team it's matched against. Filtering to status === 'upcoming'
    // here closes it at the source, rather than relying on place_wager's kickoff-lock
    // (added in the same pass) to reject it slot-by-slot and just leave that slot
    // empty instead of picking a fair one.
    const allGames = await fetchRealGamesForWeek(supabase, weekStr);
    const games = allGames.filter((g) => g.status === 'upcoming');
    if (games.length === 0) {
      summary.push({ leagueId, week: weekStr, note: 'no upcoming real_games rows for this week yet -- nothing to pick from' });
      continue;
    }

    const settings = settingsFrom(league.settings);
    const claimedThisRun = new Set<string>();
    let generated = 0;
    const errors: string[] = [];

    for (const teamId of pendingTeamIds) {
      const { slots } = generateAutoLineup(teamId, weekStr, settings, games, (gameId, marketKey, playerId, side, point) =>
        claimedThisRun.has(claimKey(gameId, marketKey, playerId, side, point)),
      );

      let placedAny = false;
      for (const slot of slots) {
        const wager = slot.wager as Wager | null;
        if (!wager) continue;
        const { error: placeErr } = await supabase.rpc('place_wager', {
          p_team_id: teamId,
          p_week: weekStr,
          p_slot_id: wager.slotId,
          p_game_id: wager.gameId,
          p_market_key: wager.marketKey,
          p_player_id: wager.playerId ?? null,
          p_player_name: wager.playerName ?? null,
          p_side: wager.side,
          p_point: wager.point ?? null,
          p_odds: wager.oddsAtPlacement,
          p_stake: wager.stake,
        });
        if (placeErr) {
          // A maxDuplicatePicks rejection here just means another team (bot or
          // human) already claimed the exact same pick since this lineup was
          // generated -- expected occasionally, not an error worth failing the
          // whole team's lineup over. Left as a bare slot, same as when
          // generateAutoLineup itself can't find a valid untaken pick.
          errors.push(`team ${teamId} slot ${wager.slotId}: ${placeErr.message}`);
          continue;
        }
        claimedThisRun.add(claimKey(wager.gameId, wager.marketKey, wager.playerId, wager.side, wager.point));
        placedAny = true;
      }

      if (placedAny) {
        const { error: submitErr } = await supabase.rpc('submit_roster', { p_team_id: teamId, p_week: weekStr });
        if (submitErr) errors.push(`team ${teamId} submit: ${submitErr.message}`);
        else generated++;
      }
    }

    summary.push({ leagueId, week: weekStr, dueSlots: [...earliestKickoffBySlot.keys()], pendingTeams: pendingTeamIds.length, generated, errors });
  }

  return new Response(JSON.stringify({ ok: true, summary }), { status: 200, headers: { 'content-type': 'application/json' } });
});
