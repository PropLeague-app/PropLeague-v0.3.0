// Supabase Edge Function: send-roster-reminders
//
// Push notification #1 of 3 (see chat, Sept 2026): a nudge roughly one hour
// before each of the week's kickoff windows (Thursday Night, Sunday Early,
// Sunday Late, Sunday Night, Monday Night) if a team's lineup isn't fully
// submitted yet. Fires per (league, week, day_slot, team) -- a team that's
// still incomplete gets reminded again before the next slate, but only once
// per slate, via notification_dedup (see _shared/pushNotifications.ts).
//
// "Incomplete" mirrors settle-week's own incomplete-lineup check exactly:
// no weekly_rosters row at all, not submitted, or fewer wagers than the
// league's lineupSlots total -- same three cases, same reasoning (see that
// file's DEFAULT_LINEUP_SLOTS / settingsFrom).
//
// Deploy: Supabase Dashboard -> Edge Functions -> Deploy a new function -> Via Editor
// Secrets needed: APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_AUTH_KEY
// (see _shared/pushNotifications.ts header for what each one is).
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (or the new SUPABASE_SECRET_KEYS,
// see _shared/supabaseAdminKey.ts) are auto-injected, nothing to set.
// Schedule: Dashboard -> Integrations -> Cron -> every 15 min, every day --
// the reminder window below is intentionally wider than the cron interval
// (30 min wide vs a 15 min cron tick) so a single slow run or a missed tick
// still gets caught by the next one; notification_dedup keeps it to one send.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendPushToProfile, claimNotification } from '../_shared/pushNotifications.ts';
import { getSupabaseAdminKey } from '../_shared/supabaseAdminKey.ts';

const REMINDER_WINDOW_MIN_MS = 45 * 60 * 1000; // remind once kickoff is this close...
const REMINDER_WINDOW_MAX_MS = 75 * 60 * 1000; // ...but not yet this close (still "about an hour out")

const DAY_SLOT_LABELS: Record<string, string> = {
  WED: 'Wednesday',
  TNF: 'Thursday Night',
  SAT: 'Saturday',
  SUN_EARLY: 'the Sunday early slate',
  SUN_LATE: 'the Sunday late slate',
  SNF: 'Sunday Night',
  MNF: 'Monday Night',
};

// Same shape/defaults as settle-week's SettingsSlice -- only the one field
// this function actually needs, deliberately not the whole thing (see that
// file's header on why these are duplicated rather than cross-imported).
const DEFAULT_LINEUP_SLOTS: Record<string, number> = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, ML: 1 };
function lineupSlotsFrom(rawSettings: unknown): Record<string, number> {
  if (!rawSettings || typeof rawSettings !== 'object') return DEFAULT_LINEUP_SLOTS;
  const slots = (rawSettings as { lineupSlots?: unknown }).lineupSlots;
  return slots && typeof slots === 'object' ? (slots as Record<string, number>) : DEFAULT_LINEUP_SLOTS;
}

function notifPrefsAllow(rawPrefs: unknown, key: string): boolean {
  if (!rawPrefs || typeof rawPrefs !== 'object') return true; // null prefs = every notification on by default
  const v = (rawPrefs as Record<string, unknown>)[key];
  return v !== false;
}

Deno.serve(async (_req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, getSupabaseAdminKey());
  const now = Date.now();
  const summary: Record<string, unknown>[] = [];

  const { data: leagues, error: leaguesErr } = await supabase
    .from('leagues')
    .select('id, current_week, settings')
    .in('season_phase', ['regular', 'playoffs']);
  if (leaguesErr) return new Response(JSON.stringify({ ok: false, error: leaguesErr.message }), { status: 500 });

  for (const league of leagues ?? []) {
    const leagueId = league.id as string;
    const weekStr = String(league.current_week);
    const totalSlots = Object.values(lineupSlotsFrom(league.settings)).reduce((a, b) => a + b, 0);

    const { data: games, error: gamesErr } = await supabase
      .from('real_games')
      .select('day_slot, kickoff')
      .eq('week', weekStr);
    if (gamesErr) {
      summary.push({ leagueId, week: weekStr, error: gamesErr.message });
      continue;
    }

    // Earliest kickoff per day_slot this week -- that's the moment this
    // slate's games start locking picks, so the reminder is timed off it.
    const earliestKickoffBySlot = new Map<string, number>();
    for (const g of games ?? []) {
      if (!g.day_slot || !g.kickoff) continue;
      const ms = new Date(g.kickoff).getTime();
      const existing = earliestKickoffBySlot.get(g.day_slot);
      if (existing == null || ms < existing) earliestKickoffBySlot.set(g.day_slot, ms);
    }

    const dueSlots = [...earliestKickoffBySlot.entries()].filter(([, kickoffMs]) => {
      const untilKickoff = kickoffMs - now;
      return untilKickoff >= REMINDER_WINDOW_MIN_MS && untilKickoff <= REMINDER_WINDOW_MAX_MS;
    });
    if (dueSlots.length === 0) {
      summary.push({ leagueId, week: weekStr, note: 'no slate in the reminder window right now' });
      continue;
    }

    const { data: teams } = await supabase.from('teams').select('id, membership_id, is_simulated').eq('league_id', leagueId);
    const realTeams = (teams ?? []).filter((t) => !t.is_simulated && t.membership_id) as { id: string; membership_id: string }[];
    if (realTeams.length === 0) continue;

    const teamIds = realTeams.map((t) => t.id);
    const { data: rosterRows } = await supabase
      .from('weekly_rosters')
      .select('team_id, submitted, wagers(id)')
      .eq('week', weekStr)
      .in('team_id', teamIds);
    const rosterByTeam = new Map((rosterRows ?? []).map((r: { team_id: string }) => [r.team_id, r]));

    const incompleteTeamIds = realTeams
      .filter((t) => {
        const roster = rosterByTeam.get(t.id) as { submitted: boolean; wagers: { id: string }[] } | undefined;
        if (!roster) return true; // no picks placed at all this week
        return !roster.submitted || roster.wagers.length < totalSlots;
      })
      .map((t) => t.id);
    if (incompleteTeamIds.length === 0) {
      summary.push({ leagueId, week: weekStr, dueSlots: dueSlots.map(([slot]) => slot), note: 'every team already complete' });
      continue;
    }

    const membershipIds = realTeams.filter((t) => incompleteTeamIds.includes(t.id)).map((t) => t.membership_id);
    const { data: memberships } = await supabase.from('league_memberships').select('id, profile_id').in('id', membershipIds);
    const profileIdByMembership = new Map((memberships ?? []).map((m: { id: string; profile_id: string }) => [m.id, m.profile_id]));

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, notification_prefs')
      .in('id', [...profileIdByMembership.values()]);
    const prefsByProfile = new Map((profiles ?? []).map((p: { id: string; notification_prefs: unknown }) => [p.id, p.notification_prefs]));

    let remindersSent = 0;
    for (const [daySlot, kickoffMs] of dueSlots) {
      for (const teamId of incompleteTeamIds) {
        const membership = realTeams.find((t) => t.id === teamId)?.membership_id;
        const profileId = membership ? profileIdByMembership.get(membership) : null;
        if (!profileId) continue;
        if (!notifPrefsAllow(prefsByProfile.get(profileId), 'lineupReminders')) continue;

        const dedupKey = `roster-lock:${leagueId}:${weekStr}:${daySlot}:${teamId}`;
        const claimed = await claimNotification(supabase, dedupKey);
        if (!claimed) continue;

        const minutesOut = Math.round((kickoffMs - now) / 60000);
        await sendPushToProfile(supabase, profileId, {
          title: 'Lineup reminder',
          body: `${DAY_SLOT_LABELS[daySlot] ?? daySlot} kicks off in about ${minutesOut} minutes -- finish your Week ${weekStr} lineup before it locks.`,
          data: { screen: 'lineup', leagueId, week: weekStr },
        });
        remindersSent++;
      }
    }
    summary.push({ leagueId, week: weekStr, dueSlots: dueSlots.map(([slot]) => slot), incompleteTeams: incompleteTeamIds.length, remindersSent });
  }

  return new Response(JSON.stringify({ ok: true, summary }), { status: 200, headers: { 'content-type': 'application/json' } });
});
