import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ActivityItem, League, LeagueSettings, LeagueTeam, MarketKey, Matchup, MatchupDetailMode, NFLGame, OddsFormat, PlayoffFieldSize, ThemeMode, UserProfile, WeekId } from '../types';
import { DEFAULT_LEAGUE_SETTINGS, TEAM_LOGO_EMOJIS } from '../types';
import { calendarIndex } from '../engine/playoffs';
import * as leagueService from '../services/leagueService';
import { buildEmptyRoster, rosterKey } from '../engine/rosterSlots';
import { validateLineup } from '../engine/validation';
import { isWagerScratched } from '../engine/settlement';
import { findClaimingTeam } from '../engine/duplicatePicks';
import { fieldSizeOptionsForTeamCount, doubleEliminationAvailable } from '../engine/playoffs';
import { resolveGame, gameHasStarted } from '../services/oddsService';
import {
  addSimulatedTeamRemote,
  fetchLeagueTeams,
  fetchMyLeagueMemberships,
  fetchLeagueMeta,
  updateLeagueSettingsRemote,
  discardPendingSettingsRemote,
  applyPendingSettingsNowRemote,
  rebuildPoolRemote,
  fetchSettingsLocked,
  updateTeamIdentityRemote,
  updateLeagueIdentityRemote,
  updateTeamConferenceRemote,
  leaveRealLeague,
  updateLeagueCommissionerRemote,
  markSeasonStartedRemote,
} from '../services/supabaseLeague';
import { placeWagerRemote, updateWagerStakeRemote, clearWagerRemote, submitRosterRemote, fetchLeagueRostersForWeek } from '../services/supabaseRoster';
import { upsertMatchupRemote, upsertStandingRemote, fetchLeagueMatchups, fetchLeagueStandings, fetchLeagueProgress } from '../services/supabaseSettlement';
import { postAnnouncementRemote, setAnnouncementPinnedRemote, reactToActivityRemote, postSystemActivityRemote, fetchLeagueActivity, deleteAnnouncementRemote } from '../services/supabaseActivity';
import { postChatMessageRemote, fetchLeagueChat, deleteChatMessageRemote } from '../services/supabaseChat';
import { getLogoPublicUrl } from '../services/supabaseLogo';
import { fetchRealGamesForWeek, fetchRealGame } from '../services/supabaseOdds';
import { fetchRealPlayerStatsForWeek } from '../services/supabaseStats';
import type { RealPlayerStatLine } from '../engine/realGameResult';
import { STORE_VERSION, migratePersistedState, normalizeLeagues } from './migrations';
import { moveReactor } from '../engine/reactions';
import { effectiveSettings, meaningfulPending, nextWeekLabel, splitPendingSettings } from '../engine/settingsRules';
import { majorSettingsChanges, settingsNewsMessage } from '../engine/settingsNews';

interface PlaceWagerParams {
  leagueId: string;
  teamId: string;
  week: WeekId;
  slotId: string;
  gameId: string;
  marketKey: MarketKey;
  side: string;
  price: number;
  point?: number;
  playerId?: string;
  playerName?: string;
  stake: number;
}

interface AppState {
  profile: UserProfile | null;
  leagues: Record<string, League>;
  currentLeagueId: string | null;
  /** Real games/odds — global, not per-league (the real NFL slate is the same
   * for everyone), unlike everything else in `leagues`. Keyed by String(week);
   * absence means "not loaded yet or nothing real for that week", in which case
   * callers fall back to the local simulated engine — see chat: touching only
   * MarketBrowser/Lineup for now, not all 13 places that read odds data. */
  realGamesByWeek: Record<string, NFLGame[]>;
  realGamesById: Record<string, NFLGame>;
  /** Final real box-score lines, per week -- keyed by player_name.trim().toLowerCase()
   * (same normalization settle-week's own grading map uses), populated only for
   * games balldontlie has marked final (see fetch-balldontlie-player-stats's header).
   * Powers the settled-wager result ticker (Sept 2026 chat: "frame of reference for
   * how much someone won/lost by") -- absence means "not loaded yet, or this
   * player's game isn't final/ingested yet", not "confirmed zero". */
  realPlayerStatsByWeek: Record<string, Record<string, RealPlayerStatLine>>;
  /** Whether hydrateMyLeagues has run (successfully or not) for the current
   * session -- gates RootRedirect's routing decision so a returning user with
   * a real Supabase membership isn't bounced to Create League before we've
   * even checked, and gets reset on sign-out so a different person logging in
   * on the same device gets their own leagues, not a stale skip. */
  leaguesHydrated: boolean;
  /** Per-league "last time the user looked at the Chat tab" timestamp (ISO
      string), used only to compute an unread-count badge on that tab (see
      chat, Sept 2026: "unread chats" bubble, distinct from the lineup-needed
      indicator). Persisted like the rest of the store so the badge doesn't
      reset every time the app restarts. */
  lastSeenChatByLeague: Record<string, string>;
  /** Matchup ids (see engine/weeklyResults.ts -- a composite `${teamAId}-${teamBId}-${week}`
   * string, not a DB uuid) the user has already been shown the Tuesday win/loss reveal
   * popup for. Persisted so a decided matchup doesn't pop up again on every app open
   * (see chat, Sept 2026: "once per matchup, then never again", mirroring ESPN
   * Fantasy's one-time Tuesday reveal rather than a recurring nag). */
  seenMatchupResultIds: Record<string, true>;

  setProfile: (profile: UserProfile) => void;
  updateProfile: (partial: Partial<UserProfile>) => void;
  setOddsFormat: (format: OddsFormat) => void;
  setThemeMode: (mode: ThemeMode) => void;
  setAccentColor: (accent: NonNullable<UserProfile['accentColor']>) => void;
  setMatchupDetailMode: (mode: MatchupDetailMode) => void;
  updateUserTeam: (
    leagueId: string,
    partial: Partial<Pick<LeagueTeam, 'teamName' | 'abbrev' | 'logoMode' | 'logoEmoji' | 'logoColor' | 'logoDataUrl'>>,
  ) => void;
  updateLeagueLogo: (leagueId: string, partial: Partial<Pick<League, 'logoMode' | 'logoEmoji' | 'logoDataUrl' | 'logoColor'>>) => void;
  setTeamConference: (leagueId: string, teamId: string, conferenceId: string) => void;

  addLeague: (league: League) => void;
  fillWithSimulatedTeams: (leagueId: string, teamCount: number) => Promise<{ ok: boolean; error?: string }>;
  /** Commissioner-triggered, works with whatever teams already exist (real-only,
   * sim-only, or a mix) -- doesn't require the league to ever have gone through
   * fillWithSimulatedTeams. See chat: this is the fix for leagues that filled up
   * with real invite-code joins and had no way left to ever get a schedule. */
  startSeason: (leagueId: string) => Promise<{ ok: boolean; error?: string }>;
  updateTargetTeamCount: (leagueId: string, count: number) => void;
  setCurrentLeague: (leagueId: string) => void;
  updateSettings: (leagueId: string, partial: Partial<LeagueSettings>) => Promise<{ ok: boolean; error?: string }>;
  discardPendingSettings: (leagueId: string) => Promise<{ ok: boolean; error?: string }>;
  /** Applies scheduled changes that only affect new picks right away (1.2.11). */
  applyPendingSettingsNow: (leagueId: string, keys: string[]) => Promise<{ ok: boolean; error?: string }>;
  refreshLeagueSettings: (leagueId: string) => Promise<void>;
  /** Recalculates the tracked prize pool from stored results (commissioner only). */
  refreshPrizePool: (leagueId: string) => Promise<void>;
  transferCommissioner: (leagueId: string, newCommissionerTeamId: string) => Promise<{ ok: boolean; reason?: string }>;
  leaveLeague: (leagueId: string) => Promise<{ ok: boolean; reason?: string }>;

  placeWager: (params: PlaceWagerParams) => Promise<{ ok: boolean; claimedByTeamId?: string; error?: string }>;
  updateWagerStake: (leagueId: string, teamId: string, week: WeekId, slotId: string, stake: number) => Promise<{ ok: boolean; error?: string }>;
  clearSlot: (leagueId: string, teamId: string, week: WeekId, slotId: string) => Promise<{ ok: boolean; error?: string }>;
  submitLineup: (leagueId: string, teamId: string, week: WeekId) => Promise<boolean>;
  loadWeekRosters: (leagueId: string, week: WeekId) => Promise<void>;
  loadLeagueResults: (leagueId: string) => Promise<void>;
  syncVoidedPicks: (leagueId: string, week: WeekId) => void;

  factoryReset: () => void;
  postAnnouncement: (leagueId: string, message: string, pinned?: boolean) => Promise<{ ok: boolean; error?: string }>;
  setAnnouncementPinned: (leagueId: string, itemId: string, pinned: boolean) => Promise<{ ok: boolean; error?: string }>;
  deleteAnnouncement: (leagueId: string, itemId: string) => Promise<{ ok: boolean; error?: string }>;
  markMatchupResultSeen: (matchupId: string) => void;
  reactToActivity: (leagueId: string, itemId: string, emoji: string) => Promise<void>;
  postChatMessage: (leagueId: string, message: string) => Promise<void>;
  deleteChatMessage: (leagueId: string, itemId: string) => Promise<{ ok: boolean; error?: string }>;
  markChatSeen: (leagueId: string) => void;

  loadRealGamesForWeek: (week: WeekId) => Promise<void>;
  loadRealGame: (gameId: string) => Promise<void>;
  loadRealPlayerStatsForWeek: (week: WeekId) => Promise<void>;
  hydrateMyLeagues: () => Promise<void>;
}

function updateLeague(
  state: AppState,
  leagueId: string,
  updater: (league: League) => League,
): Partial<AppState> {
  const league = state.leagues[leagueId];
  if (!league) return {};
  return { leagues: { ...state.leagues, [leagueId]: updater(league) } };
}

/** Pushes whatever's newly present in `next` but wasn't in `prev` (by id) to
 * Supabase as commissioner-authored system activity — used after any local
 * computation that generates activity items (fillWithSimulatedTeams, advanceWeek).
 * Item ids are deterministic/content-addressed (see leagueService.ts/simulateWeek.ts),
 * so a simple id-presence diff correctly identifies genuinely new items even once
 * the 40-item cap starts trimming old ones off the end. */
async function syncNewActivity(leagueId: string, prev: ActivityItem[], next: ActivityItem[]) {
  const prevIds = new Set(prev.map((item) => item.id));
  const newItems = next.filter((item) => !prevIds.has(item.id));
  for (const item of newItems) {
    await postSystemActivityRemote(leagueId, item);
  }
}

/** Pushes a freshly-generated season -- matchups for every week, initial
 * standings, and any conference assignment -- to Supabase. This is the write-
 * side gap that meant settle-week's cron automation had nothing to grade against
 * until a schedule was actually synced server-side (see chat: neither
 * fillWithSimulatedTeams nor the old dev-panel-only advanceWeek ever did this for
 * the *initial* schedule, only for week-by-week results afterward). Shared by
 * fillWithSimulatedTeams and startSeason, since both end by calling
 * leagueService.startSeason.
 *
 * The start week itself (season_start_week/current_week, 0013) is stamped first by beginSeason below,
 * so a league started mid-season is never scored for weeks it did not play. */
async function pushSeasonStart(leagueId: string, league: League): Promise<void> {
  for (const matchups of Object.values(league.matchupsByWeek)) {
    for (const m of matchups) {
      await upsertMatchupRemote(leagueId, String(m.week), m.teamAId, m.teamBId, m.teamAScore, m.teamBScore, m.winnerId, m.isTie);
    }
  }
  for (const standing of league.standings) {
    await upsertStandingRemote(standing);
  }
  for (const team of league.teams) {
    if (team.conferenceId) await updateTeamConferenceRemote(team.id, team.conferenceId);
  }
}

function parseStartWeek(raw: string | null): WeekId | null {
  if (raw == null) return null;
  if (raw === 'WC' || raw === 'DIV' || raw === 'CONF') return raw;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Starts the season (1.2.11 order): stamp the real start week first, then build the schedule from that
 * week (so there are no made-up matchups for earlier weeks) and save it. `build` makes the started
 * league from the start week. If stamping fails, the season still starts from Week 1 as before. */
async function beginSeason(
  leagueId: string,
  league: League,
  build: (startWeek: WeekId | null) => League,
): Promise<{ updatedLeague: League; seasonStartWeek: string | null; currentWeek: WeekId }> {
  const started = await markSeasonStartedRemote(leagueId);
  const startWeek = started.ok ? parseStartWeek(started.seasonStartWeek) : null;
  const updatedLeague = build(startWeek);
  await pushSeasonStart(leagueId, updatedLeague);
  return { updatedLeague, seasonStartWeek: started.ok ? started.seasonStartWeek : null, currentWeek: startWeek ?? league.currentWeek };
}

// League news for major settings changes (1.2.11): saves are gathered for a few seconds (a slider or
// several fields in a row make one post), then the change from before the first save to now is posted as
// one short line, split into what applies now and what starts next week.
const settingsNewsQueue = new Map<string, { live: LeagueSettings; effective: LeagueSettings; timer: ReturnType<typeof setTimeout> }>();

function queueSettingsNews(leagueId: string, beforeLive: LeagueSettings, beforeEffective: LeagueSettings) {
  const entry = settingsNewsQueue.get(leagueId);
  if (entry) clearTimeout(entry.timer);
  const live = entry?.live ?? beforeLive;
  const effective = entry?.effective ?? beforeEffective;
  const timer = setTimeout(() => void postSettingsNews(leagueId, live, effective), 4000);
  settingsNewsQueue.set(leagueId, { live, effective, timer });
}

async function postSettingsNews(leagueId: string, beforeLive: LeagueSettings, beforeEffective: LeagueSettings, nowOnly = false) {
  settingsNewsQueue.delete(leagueId);
  const league = useAppStore.getState().leagues[leagueId];
  if (!league) return;
  const now = majorSettingsChanges(beforeLive, league.settings);
  const later = nowOnly
    ? []
    : majorSettingsChanges(beforeEffective, effectiveSettings(league.settings, league.pendingSettings)).filter((c) => !now.includes(c));
  const message = settingsNewsMessage(now, later, nextWeekLabel(league.currentWeek));
  if (!message) return;
  const item: ActivityItem = { id: `settings-${Date.now()}`, ts: new Date().toISOString(), type: 'announcement', message };
  const res = await postSystemActivityRemote(leagueId, item);
  if (!res.ok) return;
  useAppStore.setState((state) => updateLeague(state, leagueId, (l) => ({ ...l, activity: [{ ...item, id: res.itemId }, ...l.activity] })));
}

/** Settings that change the tracked prize pool; saving one recalculates it right away. */
const POOL_KEYS = ['buyInEnabled', 'buyInAmount', 'poolMultipliers', 'aiTeamsAffectPool', 'poolTrackFromWeek', 'poolMultipliersBackfill', 'poolMultipliersSince'] as const;

/** After a playoff structure change (field size, elimination type, championship week), the regular season
 * can gain weeks, e.g. a 4-team league now playing in Wild Card week. Any upcoming regular-season week with
 * no matchups yet gets them from the same schedule generator; weeks that already have matchups keep them,
 * and weeks that are now playoff weeks are left for the bracket. */
export async function fillScheduleGaps(leagueId: string): Promise<void> {
  const league = useAppStore.getState().leagues[leagueId];
  if (!league || league.seasonStartWeek == null || league.seasonPhase !== 'regular') return;
  if (Object.keys(league.matchupsByWeek).length === 0) return;
  const schedule = leagueService.regularSeasonSchedule(league, league.seasonStartWeek);
  const currentIdx = calendarIndex(league.currentWeek);
  const added: Record<string, Matchup[]> = {};
  for (const [week, rows] of Object.entries(schedule)) {
    if (calendarIndex(week) <= currentIdx || (league.matchupsByWeek[week] ?? []).length > 0) continue;
    for (const m of rows) {
      const res = await upsertMatchupRemote(leagueId, week, m.teamAId, m.teamBId, null, null, null, false);
      if (!res.ok) return; // try again on the next structure change rather than half-filling locally
    }
    added[week] = rows;
  }
  if (Object.keys(added).length === 0) return;
  useAppStore.setState((state) =>
    updateLeague(state, leagueId, (l) => ({ ...l, matchupsByWeek: { ...l.matchupsByWeek, ...added } })),
  );
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      profile: null,
      leagues: {},
      currentLeagueId: null,
      realGamesByWeek: {},
      realGamesById: {},
      realPlayerStatsByWeek: {},
      leaguesHydrated: false,
      lastSeenChatByLeague: {},
      seenMatchupResultIds: {},

      // Merges onto the existing profile rather than replacing it outright --
      // this is called from useAuthStore's syncAppStoreProfile on every auth
      // init/session restore with only the Supabase-backed subset of fields
      // (username/avatarEmoji/oddsFormat). A full replace here wiped the
      // local-only themeMode/matchupDetailMode back to undefined on every cold
      // launch, which is why dark mode and Simple view kept resetting on force
      // quit (see chat, Sept 2026). factoryReset/signOut still null the whole
      // profile out first, so a real account switch on the same device still
      // starts fresh.
      setProfile: (profile) =>
        set((state) => ({ profile: state.profile ? { ...state.profile, ...profile } : profile })),
      updateProfile: (partial) =>
        set((state) => ({ profile: state.profile ? { ...state.profile, ...partial } : state.profile })),
      setOddsFormat: (format) =>
        set((state) => ({ profile: state.profile ? { ...state.profile, oddsFormat: format } : state.profile })),
      setThemeMode: (mode) =>
        set((state) => ({ profile: state.profile ? { ...state.profile, themeMode: mode } : state.profile })),
      setAccentColor: (accent) =>
        set((state) => ({ profile: state.profile ? { ...state.profile, accentColor: accent } : state.profile })),
      setMatchupDetailMode: (mode) =>
        set((state) => ({ profile: state.profile ? { ...state.profile, matchupDetailMode: mode } : state.profile })),
      // Local set is immediate/optimistic; the remote push is fire-and-forget
      // (same pattern as updateSettings) -- was 100% local-only before (see chat),
      // which is why a team rename/logo change always reverted on the next
      // sign-out (factoryReset wipes local state, and re-hydration re-reads
      // whatever Supabase actually has).
      updateUserTeam: (leagueId, partial) => {
        set((state) =>
          updateLeague(state, leagueId, (league) => ({
            ...league,
            teams: league.teams.map((t) => (t.isUser ? { ...t, ...partial } : t)),
          })),
        );
        const team = get().leagues[leagueId]?.teams.find((t) => t.isUser);
        if (team) void updateTeamIdentityRemote(team.id, partial);
      },
      updateLeagueLogo: (leagueId, partial) => {
        set((state) => updateLeague(state, leagueId, (league) => ({ ...league, ...partial })));
        void updateLeagueIdentityRemote(leagueId, partial);
      },
      setTeamConference: (leagueId, teamId, conferenceId) => {
        set((state) =>
          updateLeague(state, leagueId, (league) => ({
            ...league,
            teams: league.teams.map((t) => (t.id === teamId ? { ...t, conferenceId } : t)),
          })),
        );
        void updateTeamConferenceRemote(teamId, conferenceId);
      },

      addLeague: (league) => set((state) => ({ leagues: { ...state.leagues, [league.id]: league }, currentLeagueId: league.id })),

      fillWithSimulatedTeams: async (leagueId, teamCount) => {
        const league = get().leagues[leagueId];
        if (!league) return { ok: false, error: 'League not found.' };
        if (Object.keys(league.matchupsByWeek).length > 0) return { ok: true }; // already started

        const slotsToFill = Math.max(0, teamCount - league.teams.length);
        if (slotsToFill === 0) {
          // Real invite-code joins alone already reached the target count --
          // still need to actually start the season, just with no bots to add
          // (see chat: this used to silently no-op here, leaving a fully-real,
          // fully-joined league with no schedule and the invite screen's button
          // about to disappear behind "Continue to League" anyway).
          const { updatedLeague, seasonStartWeek, currentWeek } = await beginSeason(leagueId, league, (w) => leagueService.startSeason(league, w));
          set((state) => updateLeague(state, leagueId, () => ({ ...updatedLeague, seasonStartWeek, currentWeek })));
          await syncNewActivity(leagueId, league.activity, updatedLeague.activity);
          return { ok: true };
        }

        const identities = leagueService.generateSimulatedTeamIdentities(`${leagueId}-simteams`, slotsToFill);
        const withIds: (leagueService.SimulatedTeamIdentity & { id: string })[] = [];
        for (const identity of identities) {
          const result = await addSimulatedTeamRemote(
            leagueId,
            identity.teamName,
            identity.abbrev,
            identity.logoColor,
            identity.logoMode,
            identity.logoEmoji,
          );
          if (!result.ok) return { ok: false, error: result.error };
          withIds.push({ ...identity, id: result.teamId });
        }

        const { updatedLeague, seasonStartWeek, currentWeek } = await beginSeason(leagueId, league, (w) =>
          leagueService.fillWithSimulatedTeams(league, withIds, w),
        );
        set((state) => updateLeague(state, leagueId, () => ({ ...updatedLeague, seasonStartWeek, currentWeek })));
        await syncNewActivity(leagueId, league.activity, updatedLeague.activity);
        return { ok: true };
      },

      // Commissioner-only "Start Season" (SettingsHome) -- works from whatever
      // teams already exist, real or simulated, without requiring the league to
      // ever have gone through fillWithSimulatedTeams (see chat: a league that
      // filled up entirely with real invite-code joins had no path left to ever
      // get a schedule).
      startSeason: async (leagueId) => {
        const league = get().leagues[leagueId];
        if (!league) return { ok: false, error: 'League not found.' };
        if (league.teams.length < 2) return { ok: false, error: 'Need at least 2 teams to start the season.' };
        if (Object.keys(league.matchupsByWeek).length > 0) return { ok: false, error: 'This season has already started.' };

        const { updatedLeague, seasonStartWeek, currentWeek } = await beginSeason(leagueId, league, (w) => leagueService.startSeason(league, w));
        set((state) => updateLeague(state, leagueId, () => ({ ...updatedLeague, seasonStartWeek, currentWeek })));
        await syncNewActivity(leagueId, league.activity, updatedLeague.activity);
        return { ok: true };
      },

      // manual v0.2.0 §2 #3: team count can only be resized pre-season -- once
      // startSeason has run, the schedule/rosters/standings built around the old
      // count already exist, so this gates on the season actually having started
      // (matchupsByWeek non-empty) rather than team count (see chat: the old
      // `teams.length > 1` gate assumed a league could only ever fill up via
      // fillWithSimulatedTeams, which stopped being true once real invite-code
      // joins and the commissioner-triggered Start Season button could leave a
      // multi-team, still-unstarted league). Auto-corrects the playoff field/elim
      // type the same way the Create League slider does, so settings can never
      // end up invalid for the new (smaller) count.
      updateTargetTeamCount: (leagueId, count) =>
        set((state) =>
          updateLeague(state, leagueId, (league) => {
            if (Object.keys(league.matchupsByWeek).length > 0) return league;
            const clamped = Math.max(4, Math.min(32, count));
            const validFieldSizes = fieldSizeOptionsForTeamCount(clamped);
            const playoffTeams: PlayoffFieldSize = validFieldSizes.includes(league.settings.playoffTeams as PlayoffFieldSize)
              ? (league.settings.playoffTeams as PlayoffFieldSize)
              : validFieldSizes[validFieldSizes.length - 1];
            const eliminationType = doubleEliminationAvailable(playoffTeams) ? league.settings.eliminationType : 'single';
            return {
              ...league,
              targetTeamCount: clamped,
              settings: { ...league.settings, playoffTeams, eliminationType },
            };
          }),
        ),

      setCurrentLeague: (leagueId) => set({ currentLeagueId: leagueId }),

      // Saves go through the update_league_settings RPC (migration 0027), which is the
      // only path allowed to write leagues.settings. The screen updates optimistically,
      // using the same rule the server applies: once any pick exists this week, gameplay
      // settings are scheduled for next week (`pendingSettings`) instead of applied, and
      // everything else applies now. If the server refuses (an unreachable combination,
      // not the commissioner, network), the previous state is put back and the reason is
      // returned so the screen can show it. On success the server's answer wins.
      updateSettings: async (leagueId, partial) => {
        const before = get().leagues[leagueId];
        if (!before) return { ok: false, error: 'League not found.' };
        const working = { ...effectiveSettings(before.settings, before.pendingSettings), ...partial };
        const split = splitPendingSettings(before.settings, working, !!before.settingsLocked);
        set((state) =>
          updateLeague(state, leagueId, (league) => {
            const updated = leagueService.updateLeagueSettings(league, split.settings);
            // `settings.leagueName` and the top-level `league.name` (what headers/invite
            // screens actually render) are kept in sync here so editing the League name
            // field in Settings is visibly effective everywhere, not just in settings.
            const named = partial.leagueName != null ? { ...updated, name: partial.leagueName } : updated;
            return { ...named, pendingSettings: split.pending };
          }),
        );

        const res = await updateLeagueSettingsRemote(leagueId, partial);
        if (res.ok) queueSettingsNews(leagueId, before.settings, effectiveSettings(before.settings, before.pendingSettings));
        if (res.ok && POOL_KEYS.some((k) => k in partial)) {
          // Pool settings apply now (1.2.11): recalculate the tracked pool right away.
          void rebuildPoolRemote(leagueId).then((r) => {
            if (r.ok && r.pool !== undefined) {
              useAppStore.setState((state) => updateLeague(state, leagueId, (l) => ({ ...l, prizePool: (r.pool as League['prizePool']) ?? null })));
            }
          });
        }
        if (res.ok && (['playoffTeams', 'eliminationType', 'championshipWeek'] as const).some((k) => k in partial)) {
          // Applied after the state update below; the season calendar may now include new regular weeks.
          queueMicrotask(() => void fillScheduleGaps(leagueId));
        }
        if (!res.ok) {
          set((state) =>
            updateLeague(state, leagueId, (league) => ({
              ...league,
              settings: before.settings,
              pendingSettings: before.pendingSettings ?? null,
              name: before.name,
              prizePool: before.prizePool,
            })),
          );
          return { ok: false, error: res.error };
        }
        set((state) =>
          updateLeague(state, leagueId, (league) => {
            const settings = { ...league.settings, ...res.state.settings } as LeagueSettings;
            return {
              ...league,
              settings,
              pendingSettings: meaningfulPending(settings, res.state.pending),
              settingsLocked: res.state.locked,
            };
          }),
        );
        return { ok: true };
      },

      applyPendingSettingsNow: async (leagueId, keys) => {
        const beforeLive = get().leagues[leagueId]?.settings;
        const res = await applyPendingSettingsNowRemote(leagueId, keys);
        if (!res.ok) return { ok: false, error: res.error };
        set((state) =>
          updateLeague(state, leagueId, (league) => {
            const settings = { ...league.settings, ...res.state.settings } as LeagueSettings;
            return { ...league, settings, pendingSettings: meaningfulPending(settings, res.state.pending), settingsLocked: res.state.locked };
          }),
        );
        if (beforeLive) void postSettingsNews(leagueId, beforeLive, beforeLive, true);
        return { ok: true };
      },

      discardPendingSettings: async (leagueId) => {
        const res = await discardPendingSettingsRemote(leagueId);
        if (!res.ok) return { ok: false, error: res.error };
        set((state) =>
          updateLeague(state, leagueId, (league) => ({
            ...league,
            settings: { ...league.settings, ...res.state.settings } as LeagueSettings,
            pendingSettings: null,
            settingsLocked: res.state.locked,
          })),
        );
        return { ok: true };
      },

      // Re-pulls the server-authoritative league settings/identity for ONE league, so a
      // non-commissioner looking at the (read-only) Settings screen sees what the
      // commissioner has right now instead of whatever was cached at app launch --
      // hydrateMyLeagues only runs once per session, and there are no realtime
      // subscriptions. Same merge as buildLeagueFromRealTeams (defaults <- server
      // settings, name/isPublic from their own columns). Deliberately only called for
      // non-commissioners: the commissioner's own edits are optimistic and written
      // fire-and-forget, so a refetch could race one and briefly revert it. A failed
      // fetch is ignored (keeps whatever is cached), and an unchanged result returns
      // the same league object so nothing re-renders.
      refreshLeagueSettings: async (leagueId) => {
        const [meta, locked] = await Promise.all([fetchLeagueMeta(leagueId), fetchSettingsLocked(leagueId)]);
        if (!meta.ok) return;
        // The name and visibility used to be saved only inside the settings blob, never in
        // their own columns, so prefer the blob's copy when present (it is what the
        // commissioner actually typed); the RPC now keeps both in step.
        const { name, isPublic } = leagueService.resolveLeagueIdentity(meta);
        const settings: LeagueSettings = {
          ...DEFAULT_LEAGUE_SETTINGS,
          ...meta.settings,
          leagueName: name,
          isPublic,
        };
        const pendingSettings = meaningfulPending(settings, meta.pendingSettings);
        set((state) =>
          updateLeague(state, leagueId, (league) => {
            const commissionerTeamId = meta.commissionerTeamId ?? league.commissionerTeamId;
            const settingsLocked = locked ?? league.settingsLocked ?? false;
            const unchanged =
              JSON.stringify(league.settings) === JSON.stringify(settings) &&
              JSON.stringify(league.pendingSettings ?? null) === JSON.stringify(pendingSettings) &&
              (league.settingsLocked ?? false) === settingsLocked &&
              league.name === name &&
              league.targetTeamCount === meta.targetTeamCount &&
              league.commissionerTeamId === commissionerTeamId;
            if (unchanged) return league;
            return { ...league, name, targetTeamCount: meta.targetTeamCount, commissionerTeamId, settings, pendingSettings, settingsLocked };
          }),
        );
      },

      refreshPrizePool: async (leagueId) => {
        const res = await rebuildPoolRemote(leagueId);
        if (!res.ok || res.pool === undefined) return;
        set((state) => updateLeague(state, leagueId, (l) => ({ ...l, prizePool: (res.pool as League['prizePool']) ?? null })));
      },

      // manual v0.2.0 §6 #12: the commissioner role must move to another team before
      // the current holder can leave — enforced by leaveLeague below refusing to
      // proceed while `commissionerTeamId` still points at the departing user's team.
      //
      // Was local-only until now (see chat) -- same bug as leaveLeague below, and a
      // load-bearing one: leaveLeague's server-side check now trusts the REAL
      // commissioner_team_id, so a transfer that never reached Supabase would leave
      // the departing commissioner unable to actually leave right after the UI told
      // them they'd handed the role off. Awaited and checked before touching local
      // state, rather than fire-and-forget, so a rejected write (RLS, network) surfaces
      // here instead of silently diverging from the server the way the settings write
      // used to.
      transferCommissioner: async (leagueId, newCommissionerTeamId) => {
        const result = await updateLeagueCommissionerRemote(leagueId, newCommissionerTeamId);
        if (!result.ok) return { ok: false, reason: result.error };
        set((state) => updateLeague(state, leagueId, (league) => ({ ...league, commissionerTeamId: newCommissionerTeamId })));
        return { ok: true };
      },

      // manual v0.2.0 §6 #12: "Leave This League" — the departing member's team
      // converts to a simulated one (schedule/standings/history untouched, so future
      // weeks just auto-fill it like any other bot team) rather than being removed,
      // mirroring how real fantasy apps handle a manager dropping out mid-season.
      // Blocked while the user is still commissioner; transferCommissioner must run
      // first. Returns ok:false with a reason instead of throwing, since this is
      // reachable from a confirm dialog that needs to explain why it's disabled.
      //
      // Was 100% local-only until now (see chat) -- flipped isUser/isSimulated only
      // in this device's state, so the departing profile stayed a real, active member
      // server-side forever: still got lineup reminders, still showed up as a real
      // team on any other device/build. Now calls the leave_league RPC (see
      // 0012_leave_league.sql) first and only touches local state on success -- and
      // on success it drops the league from local state entirely (rather than just
      // flipping fields), since it's no longer "mine" at all, not just simulated.
      leaveLeague: async (leagueId) => {
        const state = get();
        const league = state.leagues[leagueId];
        if (!league) return { ok: false, reason: 'League not found.' };
        const userTeam = league.teams.find((t) => t.isUser);
        if (!userTeam) return { ok: false, reason: 'You are not a member of this league.' };
        if (league.commissionerTeamId === userTeam.id) {
          return { ok: false, reason: 'Transfer the commissioner role to another team first.' };
        }
        const result = await leaveRealLeague(leagueId);
        if (!result.ok) return { ok: false, reason: result.error };
        set((s) => {
          const { [leagueId]: _removed, ...rest } = s.leagues;
          return { leagues: rest, currentLeagueId: s.currentLeagueId === leagueId ? null : s.currentLeagueId };
        });
        return { ok: true };
      },

      placeWager: async (params) => {
        const state = get();
        const league = state.leagues[params.leagueId];
        if (!league) return { ok: false };

        // Fast local pre-check — a UI hint only, not authoritative. The RPC below
        // enforces the cap for real, atomically, against the whole league's live data.
        const claimedByTeamId = findClaimingTeam(
          league,
          params.week,
          { gameId: params.gameId, marketKey: params.marketKey, playerId: params.playerId, side: params.side, point: params.point },
          params.teamId,
        );
        if (claimedByTeamId) return { ok: false, claimedByTeamId };

        const result = await placeWagerRemote({
          teamId: params.teamId,
          week: params.week,
          slotId: params.slotId,
          gameId: params.gameId,
          marketKey: params.marketKey,
          playerId: params.playerId,
          playerName: params.playerName,
          side: params.side,
          point: params.point,
          odds: params.price,
          stake: params.stake,
        });
        if (!result.ok) return { ok: false, error: result.error };

        set((s) => {
          const lg = s.leagues[params.leagueId];
          if (!lg) return {};
          const key = rosterKey(params.teamId, params.week);
          const existing = lg.rostersByTeamWeek[key] ?? buildEmptyRoster(params.teamId, params.week, lg.settings.lineupSlots);
          const slots = existing.slots.map((slot) =>
            slot.slotId === params.slotId
              ? {
                  ...slot,
                  wager: {
                    id: result.wagerId,
                    slotId: params.slotId,
                    gameId: params.gameId,
                    marketKey: params.marketKey,
                    playerId: params.playerId,
                    playerName: params.playerName,
                    side: params.side,
                    point: params.point,
                    oddsAtPlacement: params.price,
                    stake: params.stake,
                    placedAt: new Date().toISOString(),
                    status: 'pending' as const,
                    settledProfit: null,
                  },
                }
              : slot,
          );
          const updatedRoster = { ...existing, slots, submitted: false };
          return {
            leagues: {
              ...s.leagues,
              [params.leagueId]: {
                ...lg,
                rostersByTeamWeek: { ...lg.rostersByTeamWeek, [key]: updatedRoster },
              },
            },
          };
        });
        return { ok: true };
      },

      updateWagerStake: async (leagueId, teamId, week, slotId, stake) => {
        const result = await updateWagerStakeRemote(teamId, week, slotId, stake);
        // Propagated so the lineup can show why a stake was refused (the server now enforces the
        // stake rules); local state only changes once the server accepts.
        if (!result.ok) return { ok: false, error: result.error };
        set((state) => {
          const league = state.leagues[leagueId];
          if (!league) return {};
          const key = rosterKey(teamId, week);
          const existing = league.rostersByTeamWeek[key];
          if (!existing) return {};
          const slots = existing.slots.map((slot) =>
            slot.slotId === slotId && slot.wager ? { ...slot, wager: { ...slot.wager, stake } } : slot,
          );
          const updatedRoster = { ...existing, slots, submitted: false };
          return {
            leagues: {
              ...state.leagues,
              [leagueId]: { ...league, rostersByTeamWeek: { ...league.rostersByTeamWeek, [key]: updatedRoster } },
            },
          };
        });
        return { ok: true };
      },

      clearSlot: async (leagueId, teamId, week, slotId) => {
        const result = await clearWagerRemote(teamId, week, slotId);
        // Propagated (was swallowed before -- see chat, Sept 2026) so the
        // confirm-before-remove sheet in Lineup.tsx can show a real error
        // instead of silently closing as if the pick were actually removed.
        if (!result.ok) return { ok: false, error: result.error };
        set((state) => {
          const league = state.leagues[leagueId];
          if (!league) return {};
          const key = rosterKey(teamId, week);
          const existing = league.rostersByTeamWeek[key];
          if (!existing) return {};
          const slots = existing.slots.map((slot) => (slot.slotId === slotId ? { ...slot, wager: null } : slot));
          const updatedRoster = { ...existing, slots, submitted: false };
          return {
            leagues: {
              ...state.leagues,
              [leagueId]: { ...league, rostersByTeamWeek: { ...league.rostersByTeamWeek, [key]: updatedRoster } },
            },
          };
        });
        return { ok: true };
      },

      submitLineup: async (leagueId, teamId, week) => {
        const state = get();
        const league = state.leagues[leagueId];
        if (!league) return false;
        const key = rosterKey(teamId, week);
        const roster = league.rostersByTeamWeek[key];
        if (!roster) return false;
        const result = validateLineup(roster, league.settings);
        if (!result.valid) return false;
        const remote = await submitRosterRemote(teamId, week);
        if (!remote.ok) return false;
        set((s) => ({
          leagues: {
            ...s.leagues,
            [leagueId]: {
              ...league,
              rostersByTeamWeek: { ...league.rostersByTeamWeek, [key]: { ...roster, submitted: true } },
            },
          },
        }));
        return true;
      },

      loadWeekRosters: async (leagueId, week) => {
        const result = await fetchLeagueRostersForWeek(leagueId, week);
        if (!result.ok) return;
        set((state) =>
          updateLeague(state, leagueId, (league) => {
            const rostersByTeamWeek = { ...league.rostersByTeamWeek };
            for (const [teamId, { wagers, submitted }] of Object.entries(result.wagersByTeam)) {
              // Merge fetched wagers onto a full, correctly-sized roster
              // (buildEmptyRoster) rather than treating the fetched wagers as
              // the whole roster -- a team with only some slots filled (the
              // normal case for most of a season, not an edge case) would
              // otherwise lose every empty slot the instant this ran.
              const base = buildEmptyRoster(teamId, week, league.settings.lineupSlots);
              const wagerBySlotId = new Map(wagers.map((w) => [w.slotId, w.wager]));
              const slots = base.slots.map((slot) => ({ ...slot, wager: wagerBySlotId.get(slot.slotId) ?? null }));
              rostersByTeamWeek[rosterKey(teamId, week)] = { ...base, slots, submitted };
            }
            return { ...league, rostersByTeamWeek };
          }),
        );
      },

      syncVoidedPicks: (leagueId, week) =>
        set((state) => {
          const league = state.leagues[leagueId];
          if (!league) return {};
          const userTeam = league.teams.find((t) => t.isUser);
          if (!userTeam) return {};
          const key = rosterKey(userTeam.id, week);
          const roster = league.rostersByTeamWeek[key];
          if (!roster) return {};
          let changed = false;
          const slots = roster.slots.map((slot) => {
            if (!slot.wager || slot.wager.status !== 'pending') return slot;
            // Was calling getGame() directly, which only knows about simulated
            // games -- for a real wager this always returned undefined, so
            // `!game` was true and the function silently skipped the
            // scratch-void check for every real-game pick, every time. Same
            // bug class already fixed in LeagueHome/MatchupCard/BetHistory/
            // MyStats/Leaderboards/MatchupDetail (see oddsService.ts), but
            // NOT using gameHasStarted()'s "unresolved counts as not started"
            // default the way those screens do -- this action actually voids
            // a wager and returns credits, so an unresolved game (a brief
            // loading gap, not the norm now that resolveGame checks
            // realGamesById first) should skip for now rather than risk
            // voiding a wager whose game may already be live.
            const game = resolveGame(slot.wager.gameId, state.realGamesById, league.currentWeek, league.settings.lineMovementEnabled);
            if (!game || gameHasStarted(game)) return slot;
            // isWagerScratched() is the SIMULATOR's fake "player ruled out" roll (a
            // deterministic ~3% hash of the wager id, see engine/settlement.ts) --
            // it means nothing for a real game. Applied to real picks it locally
            // wiped ~3% of them and posted a bogus "voided, credits returned"
            // notice every time the Lineup screen mounted (the refetch from
            // Supabase restored the pick, so it re-fired each visit). Real
            // scratches are handled server-side: settle-week voids a pick whose
            // player has no stat line once the game is final.
            if (state.realGamesById[slot.wager.gameId]) return slot;
            if (!isWagerScratched(slot.wager.id)) return slot;
            changed = true;
            return { ...slot, wager: null };
          });
          if (!changed) return {};
          return {
            leagues: {
              ...state.leagues,
              [leagueId]: {
                ...league,
                rostersByTeamWeek: { ...league.rostersByTeamWeek, [key]: { ...roster, slots, submitted: false } },
                activity: [
                  {
                    id: `voided-${leagueId}-${week}-${Date.now()}`,
                    ts: new Date().toISOString(),
                    type: 'settled' as const,
                    message: 'One of your picks was voided before kickoff — credits returned.',
                  },
                  ...league.activity,
                ].slice(0, 40),
              },
            },
          };
        }),

      loadLeagueResults: async (leagueId) => {
        const viewerTeamId = get().leagues[leagueId]?.teams.find((t) => t.isUser)?.id;
        const [matchupsResult, standingsResult, progressResult, activityResult, chatResult, teamsResult] = await Promise.all([
          fetchLeagueMatchups(leagueId),
          fetchLeagueStandings(leagueId),
          fetchLeagueProgress(leagueId),
          fetchLeagueActivity(leagueId, viewerTeamId),
          fetchLeagueChat(leagueId),
          fetchLeagueTeams(leagueId),
        ]);
        set((state) =>
          updateLeague(state, leagueId, (league) => {
            // The server is authoritative for anything it has ever persisted. The
            // ONLY activity items that legitimately never show up in a fetch are
            // purely-local synthetic notices with no backing DB row at all -- today
            // that's just the "voided pick" notice from syncVoidedPicks (id prefixed
            // `voided-`). Anything else missing from the fresh fetch was either
            // never actually synced, or has since been deleted/corrected
            // server-side (e.g. a moment manually corrected via SQL, as happened
            // with the Week 1 Heartbreaker) -- in both cases the server's current
            // list must win. Previously this filter preserved ANY local item not
            // present in the fresh fetch, which meant a server-deleted item (like
            // the stale Drew Stevens Heartbreaker) got permanently resurrected from
            // the persisted local cache on every load, surviving refreshes and even
            // app restarts since the store is Zustand-persisted.
            const LOCAL_ONLY_ACTIVITY_ID_PREFIXES = ['voided-'];
            const activity = activityResult.ok
              ? [
                  ...activityResult.activity,
                  ...league.activity.filter(
                    (item) =>
                      LOCAL_ONLY_ACTIVITY_ID_PREFIXES.some((prefix) => item.id.startsWith(prefix)) &&
                      !activityResult.activity.some((f) => f.id === item.id),
                  ),
                ]
                  .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime())
                  .slice(0, 40)
              : league.activity;
            const chat = chatResult.ok
              ? [...league.chat.filter((item) => !chatResult.chat.some((f) => f.id === item.id)), ...chatResult.chat]
                  .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
                  .slice(-100)
              : league.chat;
            // Full identity sync now (see chat: name/abbrev/logo edits are pushed to
            // Supabase as of this step, so a fresh fetch here is the real, current
            // value -- from this device or any other member's). An uploaded image
            // still wins over a plain color/emoji choice, same as before.
            const teams = teamsResult.ok
              ? [
                  ...league.teams.map((localTeam) => {
                    const fresh = teamsResult.teams.find((t) => t.id === localTeam.id);
                    if (!fresh) return localTeam;
                    if (fresh.logoStoragePath) {
                      return { ...localTeam, teamName: fresh.teamName, abbrev: fresh.abbrev, logoMode: 'image' as const, logoDataUrl: getLogoPublicUrl(fresh.logoStoragePath) };
                    }
                    return {
                      ...localTeam,
                      teamName: fresh.teamName,
                      abbrev: fresh.abbrev,
                      logoMode: (fresh.logoMode as LeagueTeam['logoMode']) ?? localTeam.logoMode,
                      logoEmoji: fresh.logoEmoji ?? localTeam.logoEmoji,
                      logoColor: fresh.logoColor,
                    };
                  }),
                  // A team present in the fresh server list but not yet in local
                  // state -- someone joined (or the commissioner added a
                  // simulated team) after this device last built its team list.
                  // The .map() above only ever UPDATES an existing local team by
                  // id, it never adds one, so without this a newly-joined member
                  // stayed invisible on every other device until that device's
                  // user signed out and back in (the only other place the team
                  // list gets rebuilt from scratch -- see hydrateMyLeagues's
                  // leaguesHydrated guard) -- and matchups involving them looked
                  // broken/missing too, since they reference a team id this
                  // array didn't have an entry for at all.
                  ...teamsResult.teams
                    .filter((fresh) => !league.teams.some((t) => t.id === fresh.id))
                    .map(
                      (fresh): LeagueTeam => ({
                        id: fresh.id,
                        ownerName: fresh.ownerName,
                        teamName: fresh.teamName,
                        abbrev: fresh.abbrev,
                        logoMode: fresh.logoStoragePath ? 'image' : ((fresh.logoMode as LeagueTeam['logoMode']) ?? 'initials'),
                        logoEmoji: fresh.logoEmoji ?? TEAM_LOGO_EMOJIS[0],
                        logoColor: fresh.logoColor,
                        logoDataUrl: fresh.logoStoragePath ? getLogoPublicUrl(fresh.logoStoragePath) : null,
                        isUser: false,
                        isSimulated: fresh.isSimulated,
                        conferenceId: fresh.conferenceId,
                      }),
                    ),
                ]
              : league.teams;
            const leagueLogo = !progressResult.ok
              ? {}
              : progressResult.logoStoragePath
                ? { logoMode: 'image' as const, logoDataUrl: getLogoPublicUrl(progressResult.logoStoragePath) }
                : {
                    ...(progressResult.logoMode ? { logoMode: progressResult.logoMode as League['logoMode'] } : {}),
                    ...(progressResult.logoEmoji ? { logoEmoji: progressResult.logoEmoji } : {}),
                    ...(progressResult.logoColor ? { logoColor: progressResult.logoColor } : {}),
                  };
            return {
              ...league,
              matchupsByWeek: matchupsResult.ok ? { ...league.matchupsByWeek, ...matchupsResult.matchupsByWeek } : league.matchupsByWeek,
              standings: standingsResult.ok && standingsResult.standings.length > 0 ? standingsResult.standings : league.standings,
              currentWeek: progressResult.ok ? progressResult.currentWeek : league.currentWeek,
              seasonPhase: progressResult.ok ? (progressResult.seasonPhase as League['seasonPhase']) : league.seasonPhase,
              bracket: progressResult.ok ? progressResult.bracket : league.bracket,
              prizePool: progressResult.ok ? progressResult.prizePool : league.prizePool,
              activity,
              chat,
              teams,
              ...leagueLogo,
            };
          }),
        );
      },

      // manual v0.1.1 §7 #11: wipes every persisted field (profile, leagues,
      // currentLeagueId) and drops back to onboarding.
      factoryReset: () => set({ profile: null, leagues: {}, currentLeagueId: null, leaguesHydrated: false, lastSeenChatByLeague: {}, seenMatchupResultIds: {} }),
      markMatchupResultSeen: (matchupId) =>
        set((state) => ({ seenMatchupResultIds: { ...state.seenMatchupResultIds, [matchupId]: true } })),

      postAnnouncement: async (leagueId, message, pinned = false) => {
        const userTeam = get().leagues[leagueId]?.teams.find((t) => t.isUser);
        const result = await postAnnouncementRemote(leagueId, message, pinned);
        if (!result.ok) return { ok: false, error: result.error };
        set((state) =>
          updateLeague(state, leagueId, (league) => ({
            ...league,
            activity: [
              { id: result.itemId, ts: new Date().toISOString(), type: 'announcement' as const, message, pinned: pinned || undefined, postedByTeamId: userTeam?.id },
              ...league.activity,
            ].slice(0, 40),
          })),
        );
        return { ok: true };
      },

      // Commissioner pin toggle. Server-checked (commissioner only, max 3 pinned);
      // local state only changes once the server agrees.
      setAnnouncementPinned: async (leagueId, itemId, pinned) => {
        const result = await setAnnouncementPinnedRemote(itemId, pinned);
        if (!result.ok) return { ok: false, error: result.error };
        set((state) =>
          updateLeague(state, leagueId, (league) => ({
            ...league,
            activity: league.activity.map((item) => (item.id === itemId ? { ...item, pinned: pinned || undefined } : item)),
          })),
        );
        return { ok: true };
      },

      // manual v0.3.0 §6: one reaction per person -- tapping the emoji you already
      // picked removes it, tapping a different one switches. Mirrors exactly what
      // react_to_activity does server-side (see chat) so the local optimistic
      // update never drifts from what a fresh fetch would show: decrement whatever
      // this team's previous reaction was (if any), then either stop (same emoji =
      // un-react) or apply the new one.
      reactToActivity: async (leagueId, itemId, emoji) => {
        const result = await reactToActivityRemote(itemId, emoji);
        if (!result.ok) return;
        const myTeamId = get().leagues[leagueId]?.teams.find((t) => t.isUser)?.id;
        set((state) =>
          updateLeague(state, leagueId, (league) => ({
            ...league,
            activity: league.activity.map((item) => {
              if (item.id !== itemId) return item;
              const prev = item.myReaction;
              const reactions = { ...item.reactions };
              if (prev) {
                const next = (reactions[prev] ?? 1) - 1;
                if (next > 0) reactions[prev] = next;
                else delete reactions[prev];
              }
              const reactors = myTeamId ? moveReactor(item.reactors, myTeamId, emoji) : item.reactors;
              if (prev === emoji) {
                return { ...item, reactions, reactors, myReaction: undefined };
              }
              reactions[emoji] = (reactions[emoji] ?? 0) + 1;
              return { ...item, reactions, reactors, myReaction: emoji };
            }),
          })),
        );
      },

      // manual v0.3.0 §6: "delete the announcements I send" -- delete_announcement
      // re-checks type + permission server-side (commissioner or original poster),
      // this is not a trust-the-client removal.
      deleteAnnouncement: async (leagueId, itemId) => {
        const result = await deleteAnnouncementRemote(itemId);
        if (!result.ok) return { ok: false, error: result.error };
        set((state) => updateLeague(state, leagueId, (league) => ({ ...league, activity: league.activity.filter((item) => item.id !== itemId) })));
        return { ok: true };
      },

      postChatMessage: async (leagueId, message) => {
        const userTeam = get().leagues[leagueId]?.teams.find((t) => t.isUser);
        if (!userTeam) return;
        const result = await postChatMessageRemote(leagueId, message);
        if (!result.ok) return;
        set((state) =>
          updateLeague(state, leagueId, (league) => ({
            ...league,
            chat: [...league.chat, { id: result.itemId, ts: new Date().toISOString(), teamId: userTeam.id, message }].slice(-100),
          })),
        );
      },

      // manual v0.3.0 §6: "a person should be able to delete their own chats too" --
      // delete_chat_message re-checks that the caller's own resolved team matches
      // the message's team_id server-side.
      deleteChatMessage: async (leagueId, itemId) => {
        const result = await deleteChatMessageRemote(itemId);
        if (!result.ok) return { ok: false, error: result.error };
        set((state) => updateLeague(state, leagueId, (league) => ({ ...league, chat: league.chat.filter((item) => item.id !== itemId) })));
        return { ok: true };
      },

      markChatSeen: (leagueId) =>
        set((state) => ({ lastSeenChatByLeague: { ...state.lastSeenChatByLeague, [leagueId]: new Date().toISOString() } })),

      loadRealGamesForWeek: async (week) => {
        const games = await fetchRealGamesForWeek(week);
        if (games.length === 0) return; // don't overwrite a previously-loaded slate with an empty result
        set((state) => ({
          realGamesByWeek: { ...state.realGamesByWeek, [String(week)]: games },
          realGamesById: { ...state.realGamesById, ...Object.fromEntries(games.map((g) => [g.id, g])) },
        }));
      },

      loadRealGame: async (gameId) => {
        const game = await fetchRealGame(gameId);
        if (!game) return;
        set((state) => ({ realGamesById: { ...state.realGamesById, [gameId]: game } }));
      },

      loadRealPlayerStatsForWeek: async (week) => {
        const stats = await fetchRealPlayerStatsForWeek(week);
        if (Object.keys(stats).length === 0) return; // nothing ingested yet -- don't clobber a previous load
        set((state) => ({ realPlayerStatsByWeek: { ...state.realPlayerStatsByWeek, [String(week)]: stats } }));
      },

      // Discovers every league the currently authenticated user actually
      // belongs to in Supabase and reconstructs local League objects for
      // them -- the fix for a real, serious gap: previously the app only
      // ever knew about leagues that were created/joined THIS SESSION on
      // THIS DEVICE, so a returning user on a fresh install (every
      // TestFlight tester's actual situation) or after signing back in
      // would see no leagues at all despite having real ones, and could
      // end up creating a duplicate team by going through Create/Join again.
      hydrateMyLeagues: async () => {
        if (get().leaguesHydrated) return;
        const membershipsResult = await fetchMyLeagueMemberships();
        if (!membershipsResult.ok) {
          set({ leaguesHydrated: true }); // don't loop forever retrying on a real error
          return;
        }

        const builtLeagues: Record<string, League> = {};
        for (const { leagueId, teamId } of membershipsResult.memberships) {
          const [metaResult, teamsResult, lockedResult] = await Promise.all([fetchLeagueMeta(leagueId), fetchLeagueTeams(leagueId), fetchSettingsLocked(leagueId)]);
          if (!metaResult.ok || !teamsResult.ok) continue; // skip a league we couldn't load rather than fail the whole hydration
          // Same name/visibility rule as refreshLeagueSettings, so the league switcher and header show the
          // commissioner's real name without having to open that league's Settings first.
          const identity = leagueService.resolveLeagueIdentity(metaResult);
          const league = leagueService.buildLeagueFromRealTeams({
            id: metaResult.id,
            name: identity.name,
            inviteCode: metaResult.inviteCode,
            commissionerTeamId: metaResult.commissionerTeamId ?? '',
            targetTeamCount: metaResult.targetTeamCount,
            isPublic: identity.isPublic,
            teams: teamsResult.teams,
            settingsOverrides: metaResult.settings,
            seasonStartWeek: metaResult.seasonStartWeek,
          });
          // buildLeagueFromRealTeams only knows placeholder logos (initials, trophy, no image), so apply the
          // real ones here. Without this every league that had not been opened and refreshed this session
          // showed initials in the league switcher, and image logos on teams vanished until a refresh.
          const leagueLogo: Partial<League> = metaResult.logoStoragePath
            ? { logoMode: 'image', logoDataUrl: getLogoPublicUrl(metaResult.logoStoragePath) }
            : {
                ...(metaResult.logoMode ? { logoMode: metaResult.logoMode as League['logoMode'] } : {}),
                ...(metaResult.logoEmoji ? { logoEmoji: metaResult.logoEmoji } : {}),
                ...(metaResult.logoColor ? { logoColor: metaResult.logoColor } : {}),
              };
          builtLeagues[league.id] = {
            ...league,
            ...leagueLogo,
            pendingSettings: meaningfulPending(league.settings, metaResult.pendingSettings),
            settingsLocked: lockedResult ?? false,
            teams: league.teams.map((t) => {
              const logoPath = teamsResult.teams.find((f) => f.id === t.id)?.logoStoragePath;
              const withLogo = logoPath ? { ...t, logoMode: 'image' as const, logoDataUrl: getLogoPublicUrl(logoPath) } : t;
              return t.id === teamId ? { ...withLogo, isUser: true } : withLogo;
            }),
          };
        }

        // Field-level merge, NOT a whole-object spread (see chat: a whole-object
        // spread of `state.leagues` over `builtLeagues` -- or vice versa -- gets
        // this wrong one way or the other). Server-authoritative fields (identity,
        // settings, teams) must come from this fresh fetch every single time --
        // `buildLeagueFromRealTeams` is the only path a non-commissioner device has
        // for ever seeing a commissioner's Settings change (hidePicks, etc.), since
        // that device never writes those fields locally itself. Spreading the old
        // persisted league over the fresh one (the previous approach) meant a
        // device that had ever loaded a league before would keep that first-load
        // settings snapshot forever -- surviving relaunches and even app updates,
        // since neither clears persisted storage -- because it always won over
        // whatever Supabase actually had. But `buildLeagueFromRealTeams` also
        // always rebuilds a handful of fields as empty/defaulted (currentWeek: 1,
        // seasonPhase: 'regular', matchupsByWeek/rostersByTeamWeek/chat: {}/[],
        // etc. -- it has no way to know the season has actually progressed), so
        // for THOSE fields the existing richer local state (from loadLeagueResults
        // and friends) should win when it's present. Split explicitly rather than
        // guessing via a blanket spread in either direction.
        // Real memberships this fetch actually confirmed still exist -- used below
        // to DROP any locally-cached league that's no longer one of them (see chat:
        // leaveLeague used to be local-only, so a departed league stuck around in
        // persisted storage forever, on every device, including ones that never ran
        // the leave action themselves -- e.g. a second install/build still showing a
        // league that was left from the phone). Built from `membershipsResult`, not
        // from `builtLeagues`: a league that's still a real membership but merely
        // failed to load THIS pass (the `continue` above) must not be pruned just
        // because it's temporarily missing from builtLeagues.
        const validLeagueIds = new Set(membershipsResult.memberships.map((m) => m.leagueId));

        set((state) => {
          const merged: Record<string, League> = {};
          for (const [id, existing] of Object.entries(state.leagues)) {
            if (validLeagueIds.has(id)) merged[id] = existing;
          }
          for (const [id, fresh] of Object.entries(builtLeagues)) {
            const existing = state.leagues[id];
            merged[id] = existing
              ? {
                  ...fresh, // server-authoritative: id/name/inviteCode/commissionerTeamId/settings/targetTeamCount/logo*/teams
                  currentWeek: existing.currentWeek,
                  seasonPhase: existing.seasonPhase,
                  matchupsByWeek: existing.matchupsByWeek,
                  rostersByTeamWeek: existing.rostersByTeamWeek,
                  standings: existing.standings,
                  bracket: existing.bracket,
                  activity: existing.activity,
                  chat: existing.chat,
                  prizePool: existing.prizePool,
                }
              : fresh;
          }
          return {
            leagues: merged,
            leaguesHydrated: true,
            currentLeagueId: state.currentLeagueId && !validLeagueIds.has(state.currentLeagueId) ? null : state.currentLeagueId,
          };
        });
      },
    }),
    {
      name: 'propleague-storage',
      version: STORE_VERSION,
      migrate: migratePersistedState,
      // realGamesByWeek/realGamesById are excluded: they're a pure, cheaply
      // re-fetchable cache (odds/bookmaker data can be sizeable), not something
      // that needs to survive a page reload — re-fetched fresh via the loading
      // useEffect in whichever screen needs it, same as rosters/standings/etc.
      partialize: (state) => {
        const {
          realGamesByWeek: _realGamesByWeek,
          realGamesById: _realGamesById,
          realPlayerStatsByWeek: _realPlayerStatsByWeek,
          leaguesHydrated: _leaguesHydrated,
          ...rest
        } = state;
        return rest;
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        return { ...current, ...p, leagues: normalizeLeagues(p.leagues as unknown as Record<string, unknown>) };
      },
    },
  ),
);