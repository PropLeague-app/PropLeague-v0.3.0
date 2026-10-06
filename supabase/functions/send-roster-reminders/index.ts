// Supabase Edge Function: send-roster-reminders (v2, Build 6)
//
// Push notification #1 of 3: a heads-up roughly one hour before each of the
// week's kickoff windows (Thursday Night, Sunday Early, Sunday Late, Sunday
// Night, Monday Night). Fires per (league, week, day_slot, team), once per
// slate, via notification_dedup (see _shared/pushNotifications.ts).
//
// WHO gets one is decided by the account's slate-update mode, stored in
// profiles.notification_prefs.slateUpdates (missing = 'needs_work'):
//   needs_work  -> only when the lineup needs work (default, the old behavior,
//                  minus the nagging of full rosters)
//   trailing    -> also when the team is behind in its matchup
//   every_slate -> before every slate
// profiles.notification_prefs.lineupReminders === false still silences all of
// it (master switch).
//
// "Needs work" is judged from the roster itself, NOT the `submitted` flag
// (any pick edit resets that flag, which is why full rosters used to be
// nagged): an empty slot, credits not fully allocated, or fewer distinct games
// than the league's minimum. Correlation / duplicate rules are not re-checked
// here, they are enforced when the picks are placed.
//
// Text: title "Monday Night kicks off in 75 min", subtitle = league name, body
// "TU1: 5/8 picks in. $25 unspent. -$10 vs BB." plus a min-games risk line only
// when it applies. Only graded results feed the matchup number, so hidePicks
// leagues leak nothing.
//
// Preview: call with ?dry=1 (with the normal Authorization header). It returns
// the would-be messages for each league's NEXT slate, ignoring the time window,
// and sends nothing and consumes no dedup keys.
//
// Deploy: Supabase Dashboard -> Edge Functions -> send-roster-reminders -> Code
// Secrets needed: APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_AUTH_KEY
// Schedule: Dashboard -> Integrations -> Cron -> every 15 min (job 13). The
// window below is wider than the tick so a missed run is still caught.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendPushToProfile, claimNotification } from '../_shared/pushNotifications.ts';
import { getSupabaseAdminKey } from '../_shared/supabaseAdminKey.ts';

const REMINDER_WINDOW_MIN_MS = 45 * 60 * 1000; // remind once kickoff is this close...
const REMINDER_WINDOW_MAX_MS = 75 * 60 * 1000; // ...but not yet this close (still "about an hour out")

const DAY_SLOT_LABELS: Record<string, string> = {
  WED: 'Wednesday',
  TNF: 'Thursday Night',
  SAT: 'Saturday',
  SUN_EARLY: 'Sunday early',
  SUN_LATE: 'Sunday late',
  SNF: 'Sunday Night',
  MNF: 'Monday Night',
};
const slotLabel = (slot: string) => DAY_SLOT_LABELS[slot] ?? slot;

type SlateMode = 'needs_work' | 'trailing' | 'every_slate';
function slateModeFrom(rawPrefs: unknown): SlateMode {
  const v = rawPrefs && typeof rawPrefs === 'object' ? (rawPrefs as Record<string, unknown>).slateUpdates : null;
  return v === 'trailing' || v === 'every_slate' ? v : 'needs_work';
}
function remindersEnabled(rawPrefs: unknown): boolean {
  if (!rawPrefs || typeof rawPrefs !== 'object') return true; // null prefs = every notification on by default
  return (rawPrefs as Record<string, unknown>).lineupReminders !== false;
}

// Same shape/defaults as settle-week's SettingsSlice, only the fields this
// function needs (see that file's header on why these are duplicated).
const DEFAULT_LINEUP_SLOTS: Record<string, number> = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, ML: 1 };
function settingsSliceFrom(raw: unknown): { totalSlots: number; weeklyCredits: number; minGames: number; lineupSlots: Record<string, number> } {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const slots = r.lineupSlots && typeof r.lineupSlots === 'object' ? (r.lineupSlots as Record<string, number>) : DEFAULT_LINEUP_SLOTS;
  return {
    lineupSlots: slots,
    totalSlots: Object.values(slots).reduce((a, b) => a + b, 0),
    weeklyCredits: typeof r.weeklyCredits === 'number' ? r.weeklyCredits : 100,
    minGames: typeof r.minGamesPerRoster === 'number' ? r.minGamesPerRoster : 2, // baseline of 2 always applies
  };
}

const fmtMoney = (n: number) => {
  const abs = Math.abs(n);
  const body = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  return `${n < 0 ? '-' : '+'}$${body}`;
};

interface WagerLite { id: string; slot_id: string | null; game_id: string | null; stake: number | null; status: string; settled_profit: number | null }
interface TeamLite { id: string; membership_id: string; team_name: string | null; abbrev: string | null }

Deno.serve(async (req) => {
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, getSupabaseAdminKey());
  const dry = new URL(req.url).searchParams.get('dry') === '1';
  const now = Date.now();
  const summary: Record<string, unknown>[] = [];

  const { data: leagues, error: leaguesErr } = await supabase
    .from('leagues')
    .select('id, name, current_week, settings')
    .in('season_phase', ['regular', 'playoffs']);
  if (leaguesErr) return new Response(JSON.stringify({ ok: false, error: leaguesErr.message }), { status: 500 });

  for (const league of leagues ?? []) {
    const leagueId = league.id as string;
    const weekStr = String(league.current_week);
    const { totalSlots, weeklyCredits, minGames, lineupSlots } = settingsSliceFrom(league.settings);

    const { data: games, error: gamesErr } = await supabase.from('real_games').select('id, day_slot, kickoff').eq('week', weekStr);
    if (gamesErr) {
      summary.push({ leagueId, week: weekStr, error: gamesErr.message });
      continue;
    }

    // Earliest kickoff per day_slot: the moment that slate starts locking picks.
    // Also the distinct upcoming games (and their slates) for the min-games math.
    const earliestKickoffBySlot = new Map<string, number>();
    const upcomingGameIds = new Set<string>();
    const upcomingSlots = new Map<string, number>(); // slot -> earliest kickoff, upcoming games only
    for (const g of games ?? []) {
      if (!g.day_slot || !g.kickoff) continue;
      const ms = new Date(g.kickoff).getTime();
      const existing = earliestKickoffBySlot.get(g.day_slot);
      if (existing == null || ms < existing) earliestKickoffBySlot.set(g.day_slot, ms);
      if (ms > now) {
        upcomingGameIds.add(g.id as string);
        const u = upcomingSlots.get(g.day_slot);
        if (u == null || ms < u) upcomingSlots.set(g.day_slot, ms);
      }
    }
    const remainingSlates = [...upcomingSlots.entries()].sort((a, b) => a[1] - b[1]).map(([slot]) => slotLabel(slot));
    const gamesLeft = upcomingGameIds.size;

    let dueSlots = [...earliestKickoffBySlot.entries()].filter(([, kickoffMs]) => {
      const untilKickoff = kickoffMs - now;
      return untilKickoff >= REMINDER_WINDOW_MIN_MS && untilKickoff <= REMINDER_WINDOW_MAX_MS;
    });
    if (dry) {
      // Preview: the league's next slate, whenever that is.
      const next = [...earliestKickoffBySlot.entries()].filter(([, ms]) => ms > now).sort((a, b) => a[1] - b[1])[0];
      dueSlots = next ? [next] : [];
    }
    if (dueSlots.length === 0) {
      summary.push({ leagueId, week: weekStr, note: 'no slate in the reminder window right now' });
      continue;
    }

    const { data: teams } = await supabase.from('teams').select('id, membership_id, is_simulated, team_name, abbrev').eq('league_id', leagueId);
    const allTeams = (teams ?? []) as (TeamLite & { is_simulated: boolean })[];
    const realTeams = allTeams.filter((t) => !t.is_simulated && t.membership_id);
    if (realTeams.length === 0) continue;
    const teamById = new Map(allTeams.map((t) => [t.id, t]));

    const { data: rosterRows } = await supabase
      .from('weekly_rosters')
      .select('team_id, wagers(id, slot_id, game_id, stake, status, settled_profit)')
      .eq('week', weekStr)
      .in('team_id', allTeams.map((t) => t.id));
    const wagersByTeam = new Map<string, WagerLite[]>(
      (rosterRows ?? []).map((r: { team_id: string; wagers: WagerLite[] }) => [r.team_id, r.wagers ?? []]),
    );

    const { data: matchupRows } = await supabase
      .from('matchups')
      .select('team_a_id, team_b_id, team_a_score, team_b_score')
      .eq('league_id', leagueId)
      .eq('week', weekStr);
    const matchupByTeam = new Map<string, { oppId: string; mine: number; theirs: number }>();
    for (const m of matchupRows ?? []) {
      const a = Number(m.team_a_score ?? 0);
      const b = Number(m.team_b_score ?? 0);
      matchupByTeam.set(m.team_a_id as string, { oppId: m.team_b_id as string, mine: a, theirs: b });
      matchupByTeam.set(m.team_b_id as string, { oppId: m.team_a_id as string, mine: b, theirs: a });
    }

    const { data: memberships } = await supabase
      .from('league_memberships')
      .select('id, profile_id')
      .in('id', realTeams.map((t) => t.membership_id));
    const profileIdByMembership = new Map((memberships ?? []).map((m: { id: string; profile_id: string }) => [m.id, m.profile_id]));
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, notification_prefs')
      .in('id', [...profileIdByMembership.values()]);
    const prefsByProfile = new Map((profiles ?? []).map((p: { id: string; notification_prefs: unknown }) => [p.id, p.notification_prefs]));

    const leagueName = (league.name as string | null) ?? 'your league';
    let remindersSent = 0;
    const previews: Record<string, unknown>[] = [];

    for (const [daySlot, kickoffMs] of dueSlots) {
      const minutesOut = Math.max(0, Math.round((kickoffMs - now) / 60000));
      for (const team of realTeams) {
        const profileId = profileIdByMembership.get(team.membership_id);
        if (!profileId) continue;
        const prefs = prefsByProfile.get(profileId);
        if (!remindersEnabled(prefs)) continue;
        const mode = slateModeFrom(prefs);

        // ---- roster state, from the roster itself (not the `submitted` flag)
        const wagers = wagersByTeam.get(team.id) ?? [];
        const picksIn = wagers.length;
        const allocated = wagers.reduce((s, w) => s + (w.stake ?? 0), 0);
        const distinctGames = new Set(wagers.map((w) => w.game_id).filter(Boolean)).size;
        const slotsFull = picksIn >= totalSlots;
        const creditsAllocated = allocated >= weeklyCredits - 0.005;
        const gamesNeeded = Math.max(0, minGames - distinctGames);
        const needsWork = !slotsFull || !creditsAllocated || gamesNeeded > 0;

        // ---- matchup state
        const mu = matchupByTeam.get(team.id);
        const hasScore = !!mu && (mu.mine !== 0 || mu.theirs !== 0);
        const trailing = !!mu && mu.mine < mu.theirs;

        const shouldSend = needsWork || mode === 'every_slate' || (mode === 'trailing' && trailing);
        if (!shouldSend) continue;

        // ---- message
        // Short on purpose: a lock screen shows about four lines. The title carries the event
        // ("Monday Night kicks off in 75 min"), the subtitle the league, and the body the team's
        // state, most important first: picks in, unspent credits, the matchup, then the one risk.
        // Which positions are still empty ("QB, 2 WR"), from each filled wager's slot id ("WR-1").
        const filled: Record<string, number> = {};
        for (const w of wagers) {
          const pos = String(w.slot_id ?? '').split('-')[0];
          if (pos) filled[pos] = (filled[pos] ?? 0) + 1;
        }
        const emptyNames = Object.entries(lineupSlots)
          .map(([pos, count]) => ({ pos, open: Math.max(0, count - (filled[pos] ?? 0)) }))
          .filter((e) => e.open > 0)
          .map((e) => (e.open > 1 ? `${e.open} ${e.pos}` : e.pos));
        const parts = [`${team.abbrev ?? team.team_name ?? 'You'}: ${picksIn}/${totalSlots} picks in.`];
        if (emptyNames.length > 0 && emptyNames.length <= 4) parts.push(`Empty: ${emptyNames.join(', ')}.`);
        if (!creditsAllocated) parts.push(`$${Math.max(0, weeklyCredits - allocated).toFixed(2).replace(/\.00$/, '')} unspent.`);
        if (mu && hasScore) {
          const opp = teamById.get(mu.oppId);
          const oppName = opp?.abbrev ?? opp?.team_name ?? 'opp';
          const diff = Math.round((mu.mine - mu.theirs) * 100) / 100;
          parts.push(diff === 0 ? `Even vs ${oppName}.` : `${fmtMoney(diff)} vs ${oppName}.`);
        }
        if (gamesNeeded > 0) {
          const s = gamesNeeded > 1 ? 's' : '';
          if (gamesLeft < gamesNeeded) {
            parts.push(`Can't reach the ${minGames}-game minimum now. New picks still count.`);
          } else if (gamesLeft === gamesNeeded) {
            parts.push(`Need ${gamesNeeded} more different game${s}, only ${gamesLeft} left.${slotsFull ? ' Swap a pick.' : ''}`);
          } else {
            parts.push(`Need ${gamesNeeded} more different game${s}.${slotsFull ? ' Swap a pick.' : ''}`);
          }
        }

        const message = {
          title: `${slotLabel(daySlot)} kicks off in ${minutesOut} min`,
          subtitle: leagueName,
          body: parts.join(' '),
          data: { screen: 'lineup', leagueId, week: weekStr },
          // Each league stacks on its own, a later reminder for the same slate replaces an earlier
          // one, and the "your lineup is not done" reminders can break through Focus once the app
          // has the Time Sensitive capability.
          threadId: leagueId,
          collapseId: `roster-${leagueId.slice(0, 8)}-${daySlot}-${team.id.slice(0, 8)}`,
          interruptionLevel: needsWork ? ('time-sensitive' as const) : ('active' as const),
        };

        if (dry) {
          previews.push({ team: team.team_name, mode, daySlot, needsWork, trailing, ...message });
          continue;
        }
        const dedupKey = `roster-lock:${leagueId}:${weekStr}:${daySlot}:${team.id}`;
        if (!(await claimNotification(supabase, dedupKey))) continue;
        await sendPushToProfile(supabase, profileId, message);
        remindersSent++;
      }
    }
    summary.push(
      dry
        ? { leagueId, league: leagueName, week: weekStr, dueSlots: dueSlots.map(([s]) => s), previews }
        : { leagueId, week: weekStr, dueSlots: dueSlots.map(([s]) => s), remindersSent },
    );
  }

  return new Response(JSON.stringify({ ok: true, dry, summary }, null, dry ? 2 : 0), { status: 200, headers: { 'content-type': 'application/json' } });
});
