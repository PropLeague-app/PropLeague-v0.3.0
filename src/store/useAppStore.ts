import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ActivityItem, League, LeagueSettings, LeagueTeam, MarketKey, NFLGame, OddsFormat, PlayoffFieldSize, UserProfile, WeekId } from '../types';
import { TEAM_LOGO_EMOJIS } from '../types';
import * as leagueService from '../services/leagueService';
import * as simulationService from '../services/simulationService';
import { buildEmptyRoster, rosterKey } from '../engine/rosterSlots';
import { validateLineup } from '../engine/validation';
import { isWagerScratched } from '../engine/settlement';
import { findClaimingTeam, ClaimTracker } from '../engine/duplicatePicks';
import { generateAutoLineup } from '../engine/autoLineup';
import { fieldSizeOptionsForTeamCount, doubleEliminationAvailable } from '../engine/playoffs';
import { resolveGame, gameHasStarted } from '../services/oddsService';
import {
  addSimulatedTeamRemote,
  fetchLeagueTeams,
  fetchMyLeagueMemberships,
  fetchLeagueMeta,
  updateLeagueSettingsRemote,
  updateTeamIdentityRemote,
  updateLeagueIdentityRemote,
  updateTeamConferenceRemote,
} from '../services/supabaseLeague';
import { placeWagerRemote, updateWagerStakeRemote, clearWagerRemote, submitRosterRemote, fetchLeagueRostersForWeek } from '../services/supabaseRoster';
import { upsertMatchupRemote, upsertStandingRemote, settleWagerRemote, updateLeagueWeekRemote, fetchLeagueMatchups, fetchLeagueStandings, fetchLeagueProgress } from '../services/supabaseSettlement';
import { postAnnouncementRemote, reactToActivityRemote, postSystemActivityRemote, fetchLeagueActivity } from '../services/supabaseActivity';
import { postChatMessageRemote, fetchLeagueChat } from '../services/supabaseChat';
import { getLogoPublicUrl } from '../services/supabaseLogo';
import { fetchRealGamesForWeek, fetchRealGame } from '../services/supabaseOdds';
import { fetchRealPlayerStatsForWeek } from '../services/supabaseStats';
import type { RealPlayerStatLine } from '../engine/realGameResult';
import { gamesForWeek } from '../data/seed';
import { FUNNY_OWNER_NAMES } from '../data/simulatedTeamNames';
import { STORE_VERSION, migratePersistedState, normalizeLeagues } from './migrations';

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

  setProfile: (profile: UserProfile) => void;
  updateProfile: (partial: Partial<UserProfile>) => void;
  setOddsFormat: (format: OddsFormat) => void;
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
  updateSettings: (leagueId: string, partial: Partial<LeagueSettings>) => void;
  transferCommissioner: (leagueId: string, newCommissionerTeamId: string) => void;
  leaveLeague: (leagueId: string) => { ok: boolean; reason?: string };

  placeWager: (params: PlaceWagerParams) => Promise<{ ok: boolean; claimedByTeamId?: string; error?: string }>;
  updateWagerStake: (leagueId: string, teamId: string, week: WeekId, slotId: string, stake: number) => Promise<void>;
  clearSlot: (leagueId: string, teamId: string, week: WeekId, slotId: string) => Promise<void>;
  submitLineup: (leagueId: string, teamId: string, week: WeekId) => Promise<boolean>;
  loadWeekRosters: (leagueId: string, week: WeekId) => Promise<void>;
  loadLeagueResults: (leagueId: string) => Promise<void>;
  syncVoidedPicks: (leagueId: string, week: WeekId) => void;

  advanceWeek: (leagueId: string) => Promise<void>;
  simulateToWeek: (leagueId: string, week: number) => void;
  autoFillUserLineup: (leagueId: string) => void;
  resetSeason: (leagueId: string) => void;
  factoryReset: () => void;
  setGameOverride: (leagueId: string, gameId: string, status: 'live' | 'final') => void;
  simulateDay: (leagueId: string, daySlot: string) => void;
  postAnnouncement: (leagueId: string, message: string) => Promise<void>;
  reactToActivity: (leagueId: string, itemId: string, emoji: string) => Promise<void>;
  postChatMessage: (leagueId: string, message: string) => Promise<void>;
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
 * leagueService.startSeason. */
async function pushSeasonStart(leagueId: string, league: League) {
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

      setProfile: (profile) => set({ profile }),
      updateProfile: (partial) =>
        set((state) => ({ profile: state.profile ? { ...state.profile, ...partial } : state.profile })),
      setOddsFormat: (format) =>
        set((state) => ({ profile: state.profile ? { ...state.profile, oddsFormat: format } : state.profile })),
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
          const updatedLeague = leagueService.startSeason(league);
          await pushSeasonStart(leagueId, updatedLeague);
          set((state) => updateLeague(state, leagueId, () => updatedLeague));
          await syncNewActivity(leagueId, league.activity, updatedLeague.activity);
          return { ok: true };
        }

        const identities = leagueService.generateSimulatedTeamIdentities(`${leagueId}-simteams`, slotsToFill);
        const withIds: (leagueService.SimulatedTeamIdentity & { id: string })[] = [];
        for (const identity of identities) {
          const result = await addSimulatedTeamRemote(leagueId, identity.teamName, identity.abbrev, identity.logoColor);
          if (!result.ok) return { ok: false, error: result.error };
          withIds.push({ ...identity, id: result.teamId });
        }

        const updatedLeague = leagueService.fillWithSimulatedTeams(league, withIds);
        await pushSeasonStart(leagueId, updatedLeague);
        set((state) => updateLeague(state, leagueId, () => updatedLeague));
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

        const updatedLeague = leagueService.startSeason(league);
        await pushSeasonStart(leagueId, updatedLeague);
        set((state) => updateLeague(state, leagueId, () => updatedLeague));
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

      updateSettings: (leagueId, partial) => {
        set((state) =>
          updateLeague(state, leagueId, (league) => {
            const updated = leagueService.updateLeagueSettings(league, partial);
            // `settings.leagueName` and the top-level `league.name` (what headers/invite
            // screens actually render) are kept in sync here so editing the League name
            // field in Settings is visibly effective everywhere, not just in settings.
            return partial.leagueName != null ? { ...updated, name: partial.leagueName } : updated;
          }),
        );
        // Was local-only until now (see chat) -- every commissioner Settings save is the
        // only place league settings change post-creation, so this is the one spot that
        // needs to push them to Supabase for settle-week's automatic season progression
        // (and every other member's device) to ever see the real values. Fire-and-forget:
        // the local state above is already updated optimistically.
        const updatedLeague = get().leagues[leagueId];
        if (updatedLeague) void updateLeagueSettingsRemote(leagueId, updatedLeague.settings);
      },

      // manual v0.2.0 §6 #12: the commissioner role must move to another team before
      // the current holder can leave — enforced by leaveLeague below refusing to
      // proceed while `commissionerTeamId` still points at the departing user's team.
      transferCommissioner: (leagueId, newCommissionerTeamId) =>
        set((state) => updateLeague(state, leagueId, (league) => ({ ...league, commissionerTeamId: newCommissionerTeamId }))),

      // manual v0.2.0 §6 #12: "Leave This League" — the departing member's team
      // converts to a simulated one (schedule/standings/history untouched, so future
      // weeks just auto-fill it like any other bot team) rather than being removed,
      // mirroring how real fantasy apps handle a manager dropping out mid-season.
      // Blocked while the user is still commissioner; transferCommissioner must run
      // first. Returns ok:false with a reason instead of throwing, since this is
      // reachable from a confirm dialog that needs to explain why it's disabled.
      leaveLeague: (leagueId) => {
        const state = get();
        const league = state.leagues[leagueId];
        if (!league) return { ok: false, reason: 'League not found.' };
        const userTeam = league.teams.find((t) => t.isUser);
        if (!userTeam) return { ok: false, reason: 'You are not a member of this league.' };
        if (league.commissionerTeamId === userTeam.id) {
          return { ok: false, reason: 'Transfer the commissioner role to another team first.' };
        }
        const ownerName = FUNNY_OWNER_NAMES[Math.floor(Math.random() * FUNNY_OWNER_NAMES.length)];
        set((s) =>
          updateLeague(s, leagueId, (lg) => ({
            ...lg,
            teams: lg.teams.map((t) => (t.id === userTeam.id ? { ...t, isUser: false, isSimulated: true, ownerName } : t)),
          })),
        );
        set((s) => (s.currentLeagueId === leagueId ? { currentLeagueId: null } : {}));
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
        if (!result.ok) return;
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
      },

      clearSlot: async (leagueId, teamId, week, slotId) => {
        const result = await clearWagerRemote(teamId, week, slotId);
        if (!result.ok) return;
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
            const game = resolveGame(slot.wager.gameId, state.realGamesById, league.currentWeek, league.settings.lineMovementEnabled, league.manualGameOverrides);
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
        const [matchupsResult, standingsResult, progressResult, activityResult, chatResult, teamsResult] = await Promise.all([
          fetchLeagueMatchups(leagueId),
          fetchLeagueStandings(leagueId),
          fetchLeagueProgress(leagueId),
          fetchLeagueActivity(leagueId),
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

      // The season simulation itself is still computed locally exactly as before —
      // see the chat for why porting the whole playoffs/moments/prize-pool engine to
      // SQL right now would be both risky and premature. What's new: once computed,
      // the settled week's matchup results, standings, and wager statuses are pushed
      // to Supabase so every real league member sees the same shared result, not just
      // whoever clicked Advance Week. This makes the commissioner a trusted reporter
      // of results, not a cryptographically-enforced one — an accepted trade-off for
      // now, worth hardening once real settlement data (vs. today's simulated
      // outcomes) makes server-side enforcement actually meaningful.
      advanceWeek: async (leagueId) => {
        const league = get().leagues[leagueId];
        if (!league) return;

        const settledWeek = league.currentWeek;
        const updatedLeague = simulationService.advanceWeek(league);
        if (updatedLeague === league) return;

        const settledMatchups = updatedLeague.matchupsByWeek[String(settledWeek)] ?? [];
        for (const m of settledMatchups) {
          await upsertMatchupRemote(leagueId, String(settledWeek), m.teamAId, m.teamBId, m.teamAScore, m.teamBScore, m.winnerId, m.isTie);
        }

        // Bot-team wagers never went through place_wager (Step 4 scope boundary — see
        // chat), so there's no real row for them to settle. Real teams only.
        const realTeamIds = new Set(updatedLeague.teams.filter((t) => !t.isSimulated).map((t) => t.id));
        for (const team of updatedLeague.teams) {
          if (!realTeamIds.has(team.id)) continue;
          const roster = updatedLeague.rostersByTeamWeek[rosterKey(team.id, settledWeek)];
          if (!roster) continue;
          for (const slot of roster.slots) {
            if (!slot.wager || slot.wager.status === 'pending') continue;
            await settleWagerRemote(slot.wager.id, slot.wager.status, slot.wager.settledProfit);
          }
        }

        for (const standing of updatedLeague.standings) {
          await upsertStandingRemote(standing);
        }

        await updateLeagueWeekRemote(leagueId, String(updatedLeague.currentWeek), updatedLeague.seasonPhase, updatedLeague.bracket);
        await syncNewActivity(leagueId, league.activity, updatedLeague.activity);

        set((state) => updateLeague(state, leagueId, () => updatedLeague));
      },

      autoFillUserLineup: (leagueId) =>
        set((state) =>
          updateLeague(state, leagueId, (league) => {
            const userTeam = league.teams.find((t) => t.isUser);
            if (!userTeam) return league;
            const key = rosterKey(userTeam.id, league.currentWeek);
            const games = gamesForWeek(league.currentWeek);
            const claims = new ClaimTracker(league, league.currentWeek);
            const roster = generateAutoLineup(userTeam.id, league.currentWeek, league.settings, games, (g, m, p, s, pt) =>
              claims.isTaken(g, m, p, s, pt),
            );
            return { ...league, rostersByTeamWeek: { ...league.rostersByTeamWeek, [key]: roster } };
          }),
        ),

      simulateToWeek: (leagueId, week) =>
        set((state) => updateLeague(state, leagueId, (league) => simulationService.simulateToWeek(league, week))),

      resetSeason: (leagueId) =>
        set((state) => updateLeague(state, leagueId, (league) => simulationService.resetSeason(league))),

      // manual v0.1.1 §7 #11: wipes every persisted field (profile, leagues,
      // currentLeagueId) and drops back to onboarding — distinct from Reset Season,
      // which only rewinds one league's season data and keeps the profile/league intact.
      factoryReset: () => set({ profile: null, leagues: {}, currentLeagueId: null, leaguesHydrated: false, lastSeenChatByLeague: {} }),

      setGameOverride: (leagueId, gameId, status) =>
        set((state) =>
          updateLeague(state, leagueId, (league) => ({
            ...league,
            manualGameOverrides: { ...league.manualGameOverrides, [gameId]: status },
          })),
        ),

      simulateDay: (leagueId, daySlot) =>
        set((state) =>
          updateLeague(state, leagueId, (league) => {
            const dayGames = gamesForWeek(league.currentWeek).filter((g) => g.daySlot === daySlot);
            const overrides = { ...league.manualGameOverrides };
            for (const g of dayGames) overrides[g.id] = 'final';
            return { ...league, manualGameOverrides: overrides };
          }),
        ),

      postAnnouncement: async (leagueId, message) => {
        const result = await postAnnouncementRemote(leagueId, message);
        if (!result.ok) return;
        set((state) =>
          updateLeague(state, leagueId, (league) => ({
            ...league,
            activity: [
              { id: result.itemId, ts: new Date().toISOString(), type: 'announcement' as const, message, pinned: true },
              ...league.activity,
            ].slice(0, 40),
          })),
        );
      },

      reactToActivity: async (leagueId, itemId, emoji) => {
        const result = await reactToActivityRemote(itemId, emoji);
        if (!result.ok) return;
        set((state) =>
          updateLeague(state, leagueId, (league) => ({
            ...league,
            activity: league.activity.map((item) =>
              item.id === itemId ? { ...item, reactions: { ...item.reactions, [emoji]: (item.reactions?.[emoji] ?? 0) + 1 } } : item,
            ),
          })),
        );
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
          const [metaResult, teamsResult] = await Promise.all([fetchLeagueMeta(leagueId), fetchLeagueTeams(leagueId)]);
          if (!metaResult.ok || !teamsResult.ok) continue; // skip a league we couldn't load rather than fail the whole hydration
          const league = leagueService.buildLeagueFromRealTeams({
            id: metaResult.id,
            name: metaResult.name,
            inviteCode: metaResult.inviteCode,
            commissionerTeamId: metaResult.commissionerTeamId ?? '',
            targetTeamCount: metaResult.targetTeamCount,
            isPublic: metaResult.isPublic,
            teams: teamsResult.teams,
            settingsOverrides: metaResult.settings,
          });
          builtLeagues[league.id] = {
            ...league,
            teams: league.teams.map((t) => (t.id === teamId ? { ...t, isUser: true } : t)),
          };
        }

        // builtLeagues spread first, then existing state.leagues spread over
        // it: if hydration ever runs again with richer local state already
        // present (rosters/standings from loadLeagueResults), that state
        // wins rather than being clobbered by this leaner reconstruction.
        set((state) => ({ leagues: { ...builtLeagues, ...state.leagues }, leaguesHydrated: true }));
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