// Supabase Edge Function: live-activities (Build 8)
//
// Drives the two Live Activities (lock screen + Dynamic Island), see migration 0034:
//
//   lineup  A countdown to the first kickoff of a day (Thursday night, Saturday, Sunday early,
//           Monday night) with picks in and unspent credits. Only for a roster that still needs
//           work, only in the 90 minutes before kickoff, gone at kickoff or as soon as the roster
//           is complete. (Sunday late and Sunday night get the normal push reminders only.)
//   score   Your score against your opponent's, from kickoff of a window until your picks in that
//           window have settled. Windows: Thursday night, Saturday, Sunday (early + late), Sunday
//           night, Monday night. Only for a team with at least one pick in that window, so a
//           Thursday with no Thursday picks shows nothing.
//
// Two ways in:
//   cron (service role)       a tick, every 5 minutes. Builds what should be showing for everyone,
//                             starts what is missing (push to start, iOS 17.2+), updates what
//                             changed, ends what is done.
//   app  {mode:'plan'} (user) returns what should be showing for the caller, so the app can start
//                             or update activities itself on iOS 16.2 to 17.1, and when it is open.
//
// The score is the same one the Matchup screen shows: settle-week writes matchups.team_a_score and
// team_b_score every ~15 minutes as picks settle, so it moves as games finish, not play by play.
//
// A profile with two devices keeps one tracked activity per (league, week, kind, window); the most
// recently registered device wins. Fine for now.
//
// Deploy: supabase functions deploy live-activities
// Schedule: Dashboard -> Integrations -> Cron -> every 5 minutes (same way as send-roster-reminders)
// Secrets needed: APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_AUTH_KEY (same as the others).
// Preview: call with ?dry=1 and the service key, returns what it would do and sends nothing.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendLiveActivityPush } from '../_shared/pushNotifications.ts';
import { favoriteLeagueId, leagueMuted, notifAllowed } from '../_shared/leaguePrefs.ts';
import { getSupabaseAdminKey } from '../_shared/supabaseAdminKey.ts';
import { lossReference, sideDistribution, winProbability, type WinProbPick } from '../_shared/winProb.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const MIN = 60 * 1000;
const LINEUP_LEAD_MS = 90 * MIN; // lineup activity appears this long before kickoff
const LINEUP_TAIL_MS = 20 * MIN; // and an ending one is still sent this long after kickoff
const SCORE_FAILSAFE_MS = 7 * 60 * MIN; // a score activity ends this long after its last kickoff regardless
const START_RETRY_MS = 10 * MIN; // resend a start that never produced a push token
const PROBE_MS = 10 * MIN; // push an unchanged state this often, so a dead activity (app force-quit) is noticed
const MAX_RESTARTS = 1; // a dead activity is started again once; a second death (swiped away on purpose) stays gone

const SLOT_LABEL: Record<string, string> = {
  WED: 'Wednesday',
  TNF: 'Thursday Night',
  SAT: 'Saturday',
  SUN_EARLY: 'Sunday early',
  SUN_LATE: 'Sunday late',
  SNF: 'Sunday Night',
  MNF: 'Monday Night',
};
// Sunday early and late share one score activity (about 7 hours, inside Apple's 8 hour limit);
// Sunday night starts a fresh one.
const WINDOW_OF_SLOT: Record<string, string> = { WED: 'WED', TNF: 'TNF', SAT: 'SAT', SUN_EARLY: 'SUN', SUN_LATE: 'SUN', SNF: 'SNF', MNF: 'MNF' };
const WINDOW_LABEL: Record<string, string> = { WED: 'Wednesday', TNF: 'Thursday Night', SAT: 'Saturday', SUN: 'Sunday', SNF: 'Sunday Night', MNF: 'Monday Night' };
const LINEUP_SLOTS = ['TNF', 'SAT', 'SUN_EARLY', 'MNF'];

const DEFAULT_LINEUP_SLOTS: Record<string, number> = { QB: 1, RB: 2, WR: 2, TE: 1, K: 1, ML: 1 };
function settingsSliceFrom(raw: unknown) {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const slots = r.lineupSlots && typeof r.lineupSlots === 'object' ? (r.lineupSlots as Record<string, number>) : DEFAULT_LINEUP_SLOTS;
  return {
    lineupSlots: slots,
    totalSlots: Object.values(slots).reduce((a, b) => a + b, 0),
    weeklyCredits: typeof r.weeklyCredits === 'number' ? r.weeklyCredits : 100,
    minGames: typeof r.minGamesPerRoster === 'number' ? r.minGamesPerRoster : 2,
    hidePicks: r.hidePicks === true,
    hideEmptySlots: r.hideEmptySlots !== false,
    emptySlotFloor: typeof r.emptySlotFloor === 'number' ? r.emptySlotFloor : null,
  };
}
/** Above any league's own ranking (at most 95) and below the island switch's 100. */
const FAVORITE_RELEVANCE = 98;

type Kind = 'lineup' | 'score';
interface Desired {
  profileId: string;
  leagueId: string;
  teamId: string;
  week: string;
  kind: Kind;
  windowKey: string;
  attributes: Record<string, unknown>;
  state: Record<string, unknown>;
  /** Default ranking for the Dynamic Island (higher shows first); a league the person switched to gets 100. */
  relevance: number;
  /** True when this activity is finished: if one is showing it gets an end push, otherwise nothing. */
  ending: boolean;
  staleDate?: number;
  /** Alert shown the moment a pushed start appears. */
  alert?: { title: string; body: string };
}
const keyOf = (d: { profileId: string; leagueId: string; week: string; kind: string; windowKey: string }) =>
  `${d.profileId}|${d.leagueId}|${d.week}|${d.kind}|${d.windowKey}`;

interface WagerLite {
  slot_id: string | null;
  game_id: string | null;
  stake: number | null;
  status: string;
  odds_at_placement: number | null;
  settled_profit: number | null;
  market_key: string | null;
  player_name: string | null;
  side: string | null;
  point: number | null;
}
interface GameLite { id: string; day_slot: string | null; kickoff: string | null; status: string | null }

interface SlotLine {
  pos: string;
  name: string;
  line: string;
  stake: number;
  /** pending | live | won | lost | push | empty */
  status: string;
}

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'ML'];
// Short labels for the pick line (a copy of MARKET_SHORT_LABELS in src/data/propsGenerator.ts).
const MARKET_SHORT: Record<string, string> = {
  player_pass_yds: 'pass yds',
  player_pass_tds: 'pass TDs',
  player_pass_interceptions: 'INTs',
  player_rush_yds: 'rush yds',
  player_rush_attempts: 'rush att',
  player_pass_rush_yds: 'pass+rush yds',
  player_anytime_td: 'anytime TD',
  player_reception_yds: 'rec yds',
  player_receptions: 'receptions',
  player_rush_reception_yds: 'rush+rec yds',
  player_kicking_points: 'kicking pts',
  player_field_goals: 'FGs made',
  player_pass_attempts: 'pass att',
  player_pass_completions: 'completions',
  player_rush_longest: 'longest rush',
  player_reception_longest: 'longest rec',
  player_pats: 'XPs made',
};

/** "Over 85.5 rec yds", "Anytime TD", "GB -3.5", "GB ML": the pick without the player's name. */
function pickLine(w: WagerLite): string {
  const key = w.market_key ?? '';
  if (key === 'player_anytime_td') return 'Anytime TD';
  const side = w.side ?? '';
  const point = w.point != null ? ` ${w.point}` : '';
  const label = MARKET_SHORT[key];
  if (!label) return `${side}${point}${key === 'h2h' ? ' ML' : ''}`.trim();
  return `${side}${point} ${label}`.trim();
}

/** The lineup in slot order (QB, RB, WR, TE, K, ML) with every slot, filled or empty, for the
 * card's scroller. Only ever built for the viewer's own team. */
function slotLines(wagers: WagerLite[], lineupSlots: Record<string, number>, gameById: Map<string, GameLite>, now: number): SlotLine[] {
  const byPos = new Map<string, WagerLite[]>();
  for (const w of [...wagers].sort((a, b) => String(a.slot_id ?? '').localeCompare(String(b.slot_id ?? ''), undefined, { numeric: true }))) {
    const pos = String(w.slot_id ?? '').split('-')[0];
    if (!pos) continue;
    byPos.set(pos, [...(byPos.get(pos) ?? []), w]);
  }
  const positions = [...POSITION_ORDER.filter((p) => p in lineupSlots), ...Object.keys(lineupSlots).filter((p) => !POSITION_ORDER.includes(p))];
  const out: SlotLine[] = [];
  for (const pos of positions) {
    const count = lineupSlots[pos] ?? 0;
    const picks = byPos.get(pos) ?? [];
    for (let i = 0; i < count; i++) {
      const w = picks[i];
      if (!w) {
        out.push({ pos, name: '', line: '', stake: 0, status: 'empty' });
        continue;
      }
      let status = 'pending';
      if (w.status === 'won') status = 'won';
      else if (w.status === 'lost') status = 'lost';
      else if (w.status === 'push' || w.status === 'voided') status = 'push';
      else {
        const g = w.game_id ? gameById.get(w.game_id) : undefined;
        const k = g?.kickoff ? new Date(g.kickoff).getTime() : null;
        if (k != null && k <= now && g?.status !== 'final') status = 'live';
      }
      out.push({
        pos,
        name: (w.player_name ?? '').slice(0, 26),
        line: pickLine(w),
        stake: Math.round((w.stake ?? 0) * 100) / 100,
        status,
      });
    }
  }
  return out;
}

const zeroState = {
  picksIn: 0,
  totalSlots: 0,
  unspent: 0,
  hint: '',
  myScore: 0,
  oppScore: 0,
  picksAlive: 0,
  picksSettled: 0,
  // Weekly W-L-P record and how many picks are in a game that is on right now, per side.
  myWon: 0, myLost: 0, myPush: 0, myLive: 0,
  oppWon: 0, oppLost: 0, oppPush: 0, oppLive: 0,
  // My win probability (null when the opponent's picks are still hidden), the loss that counts as
  // full red for scaled P/L colors, and my lineup slots for the scroller.
  winProb: null as number | null,
  lossRef: 0,
  slots: [] as SlotLine[],
  // How many leagues have a live score activity right now, so the island can offer a switch button.
  liveLeagues: 0,
};

// deno-lint-ignore no-explicit-any
async function buildDesired(supabase: any, now: number, onlyProfileId?: string): Promise<Desired[]> {
  const out: Desired[] = [];
  const { data: leagues } = await supabase.from('leagues').select('id, name, current_week, settings, logo_mode, logo_emoji, logo_color, logo_storage_path').in('season_phase', ['regular', 'playoffs']);
  if (!leagues || leagues.length === 0) return out;

  const leagueIds = leagues.map((l: { id: string }) => l.id as string);
  const weeks = [...new Set(leagues.map((l: { current_week: unknown }) => String(l.current_week)))] as string[];

  const { data: games } = await supabase.from('real_games').select('id, week, day_slot, kickoff, status').in('week', weeks);
  const gamesByWeek = new Map<string, GameLite[]>();
  for (const g of games ?? []) {
    const arr = gamesByWeek.get(String(g.week)) ?? [];
    arr.push(g as GameLite);
    gamesByWeek.set(String(g.week), arr);
  }

  const { data: teams } = await supabase
    .from('teams')
    .select('id, league_id, membership_id, is_simulated, team_name, abbrev, logo_color, logo_mode, logo_emoji, logo_storage_path')
    .in('league_id', leagueIds);
  const teamById = new Map<string, Record<string, unknown>>((teams ?? []).map((t: { id: string }) => [t.id, t as Record<string, unknown>]));
  const realTeams = (teams ?? []).filter((t: { is_simulated: boolean; membership_id: string | null }) => !t.is_simulated && t.membership_id);

  const { data: memberships } = await supabase
    .from('league_memberships')
    .select('id, profile_id')
    .in('id', realTeams.map((t: { membership_id: string }) => t.membership_id));
  const profileByMembership = new Map<string, string>((memberships ?? []).map((m: { id: string; profile_id: string }) => [m.id, m.profile_id]));
  const profileIds = [...new Set(profileByMembership.values())].filter((id) => !onlyProfileId || id === onlyProfileId);
  if (profileIds.length === 0) return out;
  const { data: profiles } = await supabase.from('profiles').select('id, notification_prefs').in('id', profileIds);
  const prefsByProfile = new Map<string, unknown>((profiles ?? []).map((p: { id: string; notification_prefs: unknown }) => [p.id, p.notification_prefs]));

  const { data: rosterRows } = await supabase
    .from('weekly_rosters')
    .select('team_id, week, wagers(slot_id, game_id, stake, status, odds_at_placement, settled_profit, market_key, player_name, side, point)')
    .in('week', weeks)
    .in('team_id', (teams ?? []).map((t: { id: string }) => t.id));
  const wagersByTeamWeek = new Map<string, WagerLite[]>(
    (rosterRows ?? []).map((r: { team_id: string; week: string; wagers: WagerLite[] }) => [`${r.team_id}|${r.week}`, r.wagers ?? []]),
  );

  const { data: matchupRows } = await supabase
    .from('matchups')
    .select('league_id, week, team_a_id, team_b_id, team_a_score, team_b_score')
    .in('league_id', leagueIds)
    .in('week', weeks);
  const matchupByTeamWeek = new Map<string, { oppId: string; mine: number; theirs: number }>();
  for (const m of matchupRows ?? []) {
    const a = Number(m.team_a_score ?? 0);
    const b = Number(m.team_b_score ?? 0);
    matchupByTeamWeek.set(`${m.team_a_id}|${m.week}`, { oppId: m.team_b_id as string, mine: a, theirs: b });
    matchupByTeamWeek.set(`${m.team_b_id}|${m.week}`, { oppId: m.team_a_id as string, mine: b, theirs: a });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const identity = (t: Record<string, unknown> | undefined, prefix: 'my' | 'opp') => {
    const mode = (t?.logo_mode as string | null) ?? 'initials';
    const path = t?.logo_storage_path as string | null;
    return {
      [`${prefix}Abbrev`]: (t?.abbrev as string | null) ?? (t?.team_name as string | null) ?? '',
      [`${prefix}Color`]: (t?.logo_color as string | null) ?? '#4C8DF5',
      [`${prefix}LogoMode`]: mode,
      [`${prefix}Emoji`]: (t?.logo_emoji as string | null) ?? '',
      // Image logos live in the public "logos" bucket; the app downloads it into the shared folder
      // the widget reads from (a widget cannot fetch images itself).
      [`${prefix}LogoUrl`]: mode === 'image' && path ? `${supabaseUrl}/storage/v1/object/public/logos/${path}` : '',
    };
  };

  for (const league of leagues) {
    const leagueId = league.id as string;
    const week = String(league.current_week);
    const leagueMode = (league.logo_mode as string | null) ?? 'initials';
    const leaguePath = league.logo_storage_path as string | null;
    const leagueLogo = {
      leagueColor: (league.logo_color as string | null) ?? '#4C8DF5',
      leagueLogoMode: leagueMode,
      leagueEmoji: (league.logo_emoji as string | null) ?? '',
      leagueLogoUrl: leagueMode === 'image' && leaguePath ? `${supabaseUrl}/storage/v1/object/public/logos/${leaguePath}` : '',
    };
    const wkGames = gamesByWeek.get(week) ?? [];
    if (wkGames.length === 0) continue;
    const { lineupSlots, totalSlots, weeklyCredits, minGames, hidePicks, hideEmptySlots, emptySlotFloor } = settingsSliceFrom(league.settings);

    // Weekly record (W-L-P, a voided pick counts as a push like the app's matchup card) and how many
    // picks are in a game that has kicked off and is not final. Only graded picks and picks whose game
    // is already on are counted, so an opponent's still-hidden picks are never revealed.
    const gameById = new Map<string, GameLite>(wkGames.map((g) => [g.id, g]));
    const tally = (ws: WagerLite[]) => {
      let won = 0;
      let lost = 0;
      let push = 0;
      let live = 0;
      for (const x of ws) {
        if (x.status === 'won') won++;
        else if (x.status === 'lost') lost++;
        else if (x.status === 'push' || x.status === 'voided') push++;
        else if (x.status === 'pending') {
          const g = x.game_id ? gameById.get(x.game_id) : undefined;
          const k = g?.kickoff ? new Date(g.kickoff).getTime() : null;
          if (k != null && k <= now && g?.status !== 'final') live++;
        }
      }
      return { won, lost, push, live };
    };

    // Every game of the week has kicked off: an empty slot can no longer be filled.
    const weekLocked = wkGames.length > 0 && wkGames.every((g) => g.kickoff != null && new Date(g.kickoff).getTime() <= now);
    // The worst score in this league this week, for scaled P/L colors.
    let worstLoss = 0;
    for (const m of matchupRows ?? []) {
      if (m.league_id !== leagueId || String(m.week) !== week) continue;
      worstLoss = Math.min(worstLoss, Number(m.team_a_score ?? 0), Number(m.team_b_score ?? 0));
    }
    const lossRef = lossReference(-worstLoss, weeklyCredits);
    const toPicks = (ws: WagerLite[]): WinProbPick[] =>
      ws.map((x) => ({ stake: x.stake ?? 0, status: x.status, odds: x.odds_at_placement, settledProfit: x.settled_profit }));

    // Earliest kickoff per slot, and per score window the games, first and last kickoff.
    const kickoffBySlot = new Map<string, number>();
    const windows = new Map<string, { ids: Set<string>; first: number; last: number; allFinal: boolean }>();
    for (const g of wkGames) {
      if (!g.day_slot || !g.kickoff) continue;
      const ms = new Date(g.kickoff).getTime();
      const prev = kickoffBySlot.get(g.day_slot);
      if (prev == null || ms < prev) kickoffBySlot.set(g.day_slot, ms);
      const wk = WINDOW_OF_SLOT[g.day_slot];
      if (!wk) continue;
      const w = windows.get(wk) ?? { ids: new Set<string>(), first: ms, last: ms, allFinal: true };
      w.ids.add(g.id);
      w.first = Math.min(w.first, ms);
      w.last = Math.max(w.last, ms);
      if (g.status !== 'final') w.allFinal = false;
      windows.set(wk, w);
    }

    for (const team of realTeams.filter((t: { league_id: string }) => t.league_id === leagueId)) {
      const profileId = profileByMembership.get(team.membership_id as string);
      if (!profileId || !profileIds.includes(profileId)) continue;
      const prefs = prefsByProfile.get(profileId);
      // Global switch, the league's own choice (League notifications) and mute in one check. When
      // it says no, nothing is desired here, so any open activity for this league is closed below.
      if (!notifAllowed(prefs, leagueId, 'liveActivities')) continue;

      const wagers = wagersByTeamWeek.get(`${team.id}|${week}`) ?? [];
      const mu = matchupByTeamWeek.get(`${team.id}|${week}`);
      const opp = mu ? teamById.get(mu.oppId) : undefined;
      const baseAttrs = {
        leagueId,
        teamId: team.id as string,
        week,
        leagueName: (league.name as string | null) ?? '',
        ...leagueLogo,
        ...identity(team as Record<string, unknown>, 'my'),
        ...identity(opp, 'opp'),
        oppTeamId: mu?.oppId ?? '',
      };

      // ---- lineup activity
      if (notifAllowed(prefs, leagueId, 'lineupReminders')) {
        const picksIn = wagers.length;
        const allocated = wagers.reduce((s, w) => s + (w.stake ?? 0), 0);
        const distinctGames = new Set(wagers.map((w) => w.game_id).filter(Boolean)).size;
        const slotsFull = picksIn >= totalSlots;
        const creditsAllocated = allocated >= weeklyCredits - 0.005;
        const gamesNeeded = Math.max(0, minGames - distinctGames);
        const needsWork = !slotsFull || !creditsAllocated || gamesNeeded > 0;
        const unspent = Math.max(0, Math.round((weeklyCredits - allocated) * 100) / 100);

        const filled: Record<string, number> = {};
        for (const w of wagers) {
          const pos = String(w.slot_id ?? '').split('-')[0];
          if (pos) filled[pos] = (filled[pos] ?? 0) + 1;
        }
        const emptyNames = Object.entries(lineupSlots)
          .map(([pos, count]) => ({ pos, open: Math.max(0, count - (filled[pos] ?? 0)) }))
          .filter((e) => e.open > 0)
          .map((e) => (e.open > 1 ? `${e.open} ${e.pos}` : e.pos));
        const hint =
          emptyNames.length > 0 && emptyNames.length <= 4
            ? `Empty: ${emptyNames.join(', ')}`
            : gamesNeeded > 0
              ? `Need ${gamesNeeded} more game${gamesNeeded > 1 ? 's' : ''}`
              : unspent > 0
                ? `$${String(unspent).replace(/\.0+$/, '')} unspent`
                : '';

        for (const slot of LINEUP_SLOTS) {
          const k = kickoffBySlot.get(slot);
          if (k == null) continue;
          if (now < k - LINEUP_LEAD_MS || now >= k + LINEUP_TAIL_MS) continue;
          const locked = now >= k;
          const ending = locked || !needsWork;
          out.push({
            profileId,
            leagueId,
            teamId: team.id as string,
            week,
            kind: 'lineup',
            windowKey: slot,
            attributes: { ...baseAttrs, kind: 'lineup', windowKey: slot, title: SLOT_LABEL[slot] ?? slot, kickoff: Math.floor(k / 1000) },
            state: { ...zeroState, phase: locked ? 'locked' : needsWork ? 'open' : 'ready', picksIn, totalSlots, unspent, hint },
            ending,
            relevance: locked ? 20 : needsWork ? 90 : 40,
            staleDate: Math.floor(k / 1000),
            alert: { title: `${SLOT_LABEL[slot] ?? slot} kicks off soon`, body: hint || 'Your lineup needs work.' },
          });
        }
      }

      // ---- score activity
      if (mu) {
        for (const [windowKey, w] of windows) {
          if (now < w.first) continue; // not started yet
          const inWindow = wagers.filter((x) => x.game_id && w.ids.has(x.game_id));
          if (inWindow.length === 0) continue; // no picks in this window, nothing to follow
          const settledAll = inWindow.every((x) => x.status !== 'pending');
          const finished = (settledAll && w.allFinal) || now > w.last + SCORE_FAILSAFE_MS;
          const picksAlive = wagers.filter((x) => x.status === 'pending').length;
          const picksSettled = inWindow.filter((x) => x.status === 'won' || x.status === 'lost' || x.status === 'push').length;
          const mine = tally(wagers);
          const oppWagers = wagersByTeamWeek.get(`${mu.oppId}|${week}`) ?? [];
          const theirs = tally(oppWagers);
          // Same rule as the app's matchup card: with Hide Picks on, an opponent who still has a
          // pick in a game that has not started (or an empty slot that reads Hidden) gets no
          // probability, since it would give those picks away.
          const oppHasHidden =
            hidePicks &&
            (oppWagers.some((x) => {
              if (x.status !== 'pending') return false;
              const g = x.game_id ? gameById.get(x.game_id) : undefined;
              const k = g?.kickoff ? new Date(g.kickoff).getTime() : null;
              return k == null || k > now;
            }) ||
              (hideEmptySlots && !weekLocked && oppWagers.length < totalSlots));
          const winProb =
            oppHasHidden && !finished
              ? null
              : Math.round(
                  winProbability(
                    sideDistribution({ picks: toPicks(wagers), totalSlots }, { weeklyCredits, emptySlotFloor }, weekLocked),
                    sideDistribution({ picks: toPicks(oppWagers), totalSlots }, { weeklyCredits, emptySlotFloor }, weekLocked),
                  ) * 1000,
                ) / 1000;
          out.push({
            profileId,
            leagueId,
            teamId: team.id as string,
            week,
            kind: 'score',
            windowKey,
            attributes: { ...baseAttrs, kind: 'score', windowKey, title: WINDOW_LABEL[windowKey] ?? windowKey, kickoff: Math.floor(w.first / 1000) },
            state: {
              ...zeroState,
              phase: finished ? 'final' : 'live',
              myScore: mu.mine,
              oppScore: mu.theirs,
              picksAlive,
              picksSettled,
              myWon: mine.won,
              myLost: mine.lost,
              myPush: mine.push,
              myLive: mine.live,
              oppWon: theirs.won,
              oppLost: theirs.lost,
              oppPush: theirs.push,
              oppLive: theirs.live,
              winProb,
              lossRef: Math.round(lossRef * 100) / 100,
              slots: slotLines(wagers, lineupSlots, gameById, now),
            },
            ending: finished,
            // More picks live and a closer matchup rank higher (60 to 95); a finished one drops to 20.
            relevance: finished
              ? 20
              : 60 + Math.min(10, mine.live + theirs.live) * 2 + (winProb == null ? 5 : Math.round(15 * (1 - Math.abs(winProb - 0.5) * 2))),
          });
        }
      }
    }
  }
  // Tell each score activity how many leagues are live for this person (drives the island switch).
  const liveByProfile = new Map<string, Set<string>>();
  for (const d of out) {
    if (d.kind !== 'score' || d.ending) continue;
    const set = liveByProfile.get(d.profileId) ?? new Set<string>();
    set.add(d.leagueId);
    liveByProfile.set(d.profileId, set);
  }
  for (const d of out) {
    if (d.kind === 'score') d.state = { ...d.state, liveLeagues: liveByProfile.get(d.profileId)?.size ?? 0 };
    // The favorite league leads the island by default. The island's switch button (is_front, 100)
    // still wins when the person picks another league for now.
    if (favoriteLeagueId(prefsByProfile.get(d.profileId)) === d.leagueId) {
      d.relevance = Math.max(d.relevance, FAVORITE_RELEVANCE);
      d.state = { ...d.state, favorite: true }; // the card draws a small star by the league logo
    }
  }
  return out;
}

// Keys sorted at every level, so two states with the same content compare equal (an array replacer
// would also drop the keys of nested objects like the lineup slots).
const canon = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(canon)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])]))
      : v;
const stateJson = (s: Record<string, unknown>) => JSON.stringify(canon(s));

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const url = Deno.env.get('SUPABASE_URL')!;
  const adminKey = getSupabaseAdminKey();
  const supabase = createClient(url, adminKey);
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  // Accept the project's secret key in either form (new sb_secret_ key or the legacy service_role
  // JWT), so the cron works whichever one its Authorization header was set up with.
  const legacyKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const isService = bearer !== '' && (bearer === adminKey || (legacyKey !== '' && bearer === legacyKey));
  const now = Date.now();

  let body: { mode?: string } = {};
  try {
    body = await req.json();
  } catch {
    // cron sends no body
  }

  // ---- the app asking what should be showing for the signed-in user
  if (!isService) {
    if (body.mode !== 'plan') {
      // Say what kind of key arrived (never the key itself) so a miswired cron is easy to spot.
      const got = bearer === ''
        ? 'no key'
        : bearer.startsWith('sb_publishable_')
          ? 'a publishable key'
          : bearer.startsWith('sb_secret_')
            ? 'a secret key that is not this project\'s default secret key'
            : bearer.startsWith('eyJ')
              ? 'a JWT (anon, service_role from another project, or a user token)'
              : 'an unrecognized key';
      return json({ ok: false, error: 'unauthorized', hint: `Received ${got}. The cron must send this project's default secret key (or legacy service_role key) as a Bearer token.` }, 401);
    }
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!anonKey || !authHeader) return json({ ok: false, error: 'unauthorized' }, 401);
    const asUser = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData } = await asUser.auth.getUser();
    const callerId = userData?.user?.id;
    if (!callerId) return json({ ok: false, error: 'unauthorized' }, 401);
    const desired = await buildDesired(supabase, now, callerId);
    const { data: frontRows } = await supabase
      .from('live_activities')
      .select('league_id, week, kind, window_key')
      .eq('profile_id', callerId)
      .eq('is_front', true)
      .is('ended_at', null);
    const frontKeys = new Set<string>((frontRows ?? []).map((r: Record<string, unknown>) => keyOf({ profileId: callerId, leagueId: r.league_id as string, week: r.week as string, kind: r.kind as string, windowKey: r.window_key as string })));
    return json({
      ok: true,
      items: desired.map((d) => ({
        kind: d.kind,
        leagueId: d.leagueId,
        teamId: d.teamId,
        week: d.week,
        windowKey: d.windowKey,
        attributes: d.attributes,
        state: d.state,
        ending: d.ending,
        staleDate: d.staleDate ?? null,
        relevance: frontKeys.has(keyOf(d)) ? 100 : d.relevance,
      })),
    });
  }

  // ---- the cron tick
  const dry = new URL(req.url).searchParams.get('dry') === '1';
  const desired = await buildDesired(supabase, now);

  const { data: openRows } = await supabase.from('live_activities').select('*').is('ended_at', null);
  const { data: allRows } = await supabase.from('live_activities').select('id, profile_id, league_id, week, kind, window_key, ended_at, meta');
  const openByKey = new Map<string, Record<string, unknown>>((openRows ?? []).map((r: Record<string, unknown>) => [keyOf({ profileId: r.profile_id as string, leagueId: r.league_id as string, week: r.week as string, kind: r.kind as string, windowKey: r.window_key as string }), r]));
  const everByKey = new Set<string>((allRows ?? []).map((r: Record<string, unknown>) => keyOf({ profileId: r.profile_id as string, leagueId: r.league_id as string, week: r.week as string, kind: r.kind as string, windowKey: r.window_key as string })));

  // Rows the server closed because a push to the activity failed (the phone dropped it): candidates for
  // one restart. Rows closed because the league was muted restart whenever it is unmuted again.
  const closedByKey = new Map<string, { id: string; meta: Record<string, unknown>; restarts: number; muted: boolean }>();
  for (const r of allRows ?? []) {
    const meta = ((r as Record<string, unknown>).meta as Record<string, unknown> | null) ?? {};
    if (r.ended_at && (meta.endedBy === 'push_failed' || meta.endedBy === 'muted')) {
      closedByKey.set(keyOf({ profileId: r.profile_id as string, leagueId: r.league_id as string, week: r.week as string, kind: r.kind as string, windowKey: r.window_key as string }), {
        id: r.id as string,
        meta,
        restarts: typeof meta.restarts === 'number' ? meta.restarts : 0,
        muted: meta.endedBy === 'muted',
      });
    }
  }

  const { data: startTokens } = await supabase
    .from('live_activity_start_tokens')
    .select('profile_id, token, last_seen_at')
    .order('last_seen_at', { ascending: false });
  const startTokenByProfile = new Map<string, string>();
  for (const t of startTokens ?? []) if (!startTokenByProfile.has(t.profile_id as string)) startTokenByProfile.set(t.profile_id as string, t.token as string);

  const log: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  const endActivity = async (row: Record<string, unknown>, state: Record<string, unknown>, dismissAfterSec: number, mutedEnd = false) => {
    const rowKey = row.id as string;
    if (!dry && row.push_token) {
      const r = await sendLiveActivityPush(row.push_token as string, { event: 'end', contentState: state, dismissalDate: Math.floor(now / 1000) + dismissAfterSec, priority: 10 });
      if (!r.ok) log.push({ end: rowKey, failure: r.failure.reason });
    }
    if (!dry) {
      const meta = { ...(row.meta as Record<string, unknown> | null), endedBy: mutedEnd ? 'muted' : null };
      await supabase.from('live_activities').update({ ended_at: new Date(now).toISOString(), last_state: state, meta }).eq('id', rowKey);
    }
    log.push({ ended: rowKey, kind: row.kind, window: row.window_key });
  };

  for (const d of desired) {
    const key = keyOf(d);
    seen.add(key);
    const row = openByKey.get(key);

    if (d.ending) {
      if (row) await endActivity(row, d.state, d.kind === 'score' ? 30 * 60 : d.state.phase === 'ready' ? 90 : 30);
      continue;
    }

    // An activity the phone ended on its own (the app was force-quit) gets one fresh start while its window is still open.
    const restartable = !row && everByKey.has(key) && closedByKey.get(key) != null && (closedByKey.get(key)!.muted || closedByKey.get(key)!.restarts < MAX_RESTARTS);
    if (!row && restartable) {
      const startToken = startTokenByProfile.get(d.profileId);
      if (!startToken) continue;
      const prev = closedByKey.get(key)!;
      if (!dry) {
        const r = await sendLiveActivityPush(startToken, { event: 'start', contentState: d.state, attributes: d.attributes, staleDate: d.staleDate, relevanceScore: d.relevance, priority: 10 });
        if (!r.ok) {
          log.push({ restart: key, failure: r.failure.reason });
          if (r.failure.shouldDeleteToken) await supabase.from('live_activity_start_tokens').delete().eq('token', startToken);
          continue;
        }
        await supabase.from('live_activities').update({
          ended_at: null, push_token: null, activity_id: null, started_at: new Date(now).toISOString(), last_pushed_at: new Date(now).toISOString(),
          last_state: d.state, meta: { ...prev.meta, endedBy: null, restarts: prev.muted ? prev.restarts : prev.restarts + 1 },
        }).eq('id', prev.id);
      }
      log.push({ restarted_after_end: key });
      continue;
    }

    if (!row) {
      if (everByKey.has(key)) continue; // already ran and ended for this window, never restart it
      const startToken = startTokenByProfile.get(d.profileId);
      if (!startToken) continue; // no push-to-start (older iOS): the app starts it itself when opened
      if (!dry) {
        const r = await sendLiveActivityPush(startToken, { event: 'start', contentState: d.state, attributes: d.attributes, staleDate: d.staleDate, alert: d.alert, relevanceScore: d.relevance, priority: 10 });
        if (!r.ok) {
          log.push({ start: key, failure: r.failure.reason });
          if (r.failure.shouldDeleteToken) await supabase.from('live_activity_start_tokens').delete().eq('token', startToken);
          continue;
        }
        await supabase.from('live_activities').insert({
          profile_id: d.profileId, league_id: d.leagueId, team_id: d.teamId, week: d.week, kind: d.kind, window_key: d.windowKey,
          last_state: d.state, meta: { title: d.attributes.title, kickoff: d.attributes.kickoff }, last_pushed_at: new Date(now).toISOString(),
        });
      }
      log.push({ started: key });
      continue;
    }

    // Showing already. No push token yet means the start has not landed (or the device was offline).
    if (!row.push_token) {
      const startedAt = new Date(row.started_at as string).getTime();
      const startToken = startTokenByProfile.get(d.profileId);
      if (startToken && now - startedAt > START_RETRY_MS) {
        if (!dry) {
          await sendLiveActivityPush(startToken, { event: 'start', contentState: d.state, attributes: d.attributes, staleDate: d.staleDate, relevanceScore: d.relevance, priority: 10 });
          await supabase.from('live_activities').update({ started_at: new Date(now).toISOString() }).eq('id', row.id as string);
        }
        log.push({ restarted: key });
      }
      continue;
    }

    const lastPushed = row.last_pushed_at ? new Date(row.last_pushed_at as string).getTime() : 0;
    const unchanged = stateJson((row.last_state as Record<string, unknown>) ?? {}) === stateJson(d.state);
    if (unchanged && now - lastPushed < PROBE_MS) continue; // nothing changed, and checked recently
    if (!dry) {
      const r = await sendLiveActivityPush(row.push_token as string, {
        event: 'update',
        contentState: d.state,
        staleDate: d.staleDate,
        // The league the person switched to in the island keeps the top score.
        relevanceScore: row.is_front ? 100 : d.relevance,
        priority: !unchanged && d.kind === 'score' ? 10 : 5,
      });
      if (!r.ok) {
        log.push({ update: key, failure: r.failure.reason });
        if (r.failure.shouldDeleteToken) {
          const meta = { ...(row.meta as Record<string, unknown> | null), endedBy: 'push_failed' };
          await supabase.from('live_activities').update({ ended_at: new Date(now).toISOString(), meta }).eq('id', row.id as string);
        }
        continue;
      }
      await supabase.from('live_activities').update({ last_state: d.state, last_pushed_at: new Date(now).toISOString() }).eq('id', row.id as string);
    }
    log.push({ updated: key });
  }

  // Anything still showing that nothing asks for any more (week moved on, league ended): close it.
  // A league the person just muted is cleared right away instead of lingering as "final" for minutes.
  const stale = [...openByKey].filter(([key]) => !seen.has(key));
  const mutedPrefs = new Map<string, unknown>();
  if (stale.length > 0) {
    const ids = [...new Set(stale.map(([, row]) => row.profile_id as string))];
    const { data: prefRows } = await supabase.from('profiles').select('id, notification_prefs').in('id', ids);
    for (const p of prefRows ?? []) mutedPrefs.set(p.id as string, p.notification_prefs);
  }
  for (const [, row] of stale) {
    const last = (row.last_state as Record<string, unknown>) ?? { ...zeroState };
    // Muted, or turned off for this league (live scores, or lineup reminders for the lineup island):
    // clear it right away instead of lingering, and let it start again once turned back on.
    const rowPrefs = mutedPrefs.get(row.profile_id as string);
    const rowLeague = row.league_id as string;
    const muted =
      leagueMuted(rowPrefs, rowLeague) ||
      !notifAllowed(rowPrefs, rowLeague, 'liveActivities') ||
      (row.kind === 'lineup' && !notifAllowed(rowPrefs, rowLeague, 'lineupReminders'));
    await endActivity(row, { ...last, phase: row.kind === 'score' ? 'final' : 'locked' }, muted ? 1 : 5 * 60, muted);
  }

  return json({ ok: true, dry, desired: desired.length, log }, 200);
});
