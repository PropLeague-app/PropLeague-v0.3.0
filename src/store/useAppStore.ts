import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { League, LeagueSettings, LeagueTeam, MarketKey, OddsFormat, PlayoffFieldSize, UserProfile, WeekId } from '../types';
import * as leagueService from '../services/leagueService';
import * as simulationService from '../services/simulationService';
import { buildEmptyRoster, rosterKey } from '../engine/rosterSlots';
import { validateLineup } from '../engine/validation';
import { isWagerScratched } from '../engine/settlement';
import { findClaimingTeam, ClaimTracker } from '../engine/duplicatePicks';
import { generateAutoLineup } from '../engine/autoLineup';
import { fieldSizeOptionsForTeamCount, doubleEliminationAvailable } from '../engine/playoffs';
import { getGame } from '../services/oddsService';
import { addSimulatedTeamRemote } from '../services/supabaseLeague';
import { placeWagerRemote, updateWagerStakeRemote, clearWagerRemote, submitRosterRemote, fetchLeagueRostersForWeek } from '../services/supabaseRoster';
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
  syncVoidedPicks: (leagueId: string, week: WeekId) => void;

  advanceWeek: (leagueId: string) => void;
  simulateToWeek: (leagueId: string, week: number) => void;
  autoFillUserLineup: (leagueId: string) => void;
  resetSeason: (leagueId: string) => void;
  factoryReset: () => void;
  setGameOverride: (leagueId: string, gameId: string, status: 'live' | 'final') => void;
  simulateDay: (leagueId: string, daySlot: string) => void;
  postAnnouncement: (leagueId: string, message: string) => void;
  reactToActivity: (leagueId: string, itemId: string, emoji: string) => void;
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

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      profile: null,
      leagues: {},
      currentLeagueId: null,

      setProfile: (profile) => set({ profile }),
      updateProfile: (partial) =>
        set((state) => ({ profile: state.profile ? { ...state.profile, ...partial } : state.profile })),
      setOddsFormat: (format) =>
        set((state) => ({ profile: state.profile ? { ...state.profile, oddsFormat: format } : state.profile })),
      updateUserTeam: (leagueId, partial) =>
        set((state) =>
          updateLeague(state, leagueId, (league) => ({
            ...league,
            teams: league.teams.map((t) => (t.isUser ? { ...t, ...partial } : t)),
          })),
        ),
      updateLeagueLogo: (leagueId, partial) =>
        set((state) => updateLeague(state, leagueId, (league) => ({ ...league, ...partial }))),
      setTeamConference: (leagueId, teamId, conferenceId) =>
        set((state) =>
          updateLeague(state, leagueId, (league) => ({
            ...league,
            teams: league.teams.map((t) => (t.id === teamId ? { ...t, conferenceId } : t)),
          })),
        ),

      addLeague: (league) => set((state) => ({ leagues: { ...state.leagues, [league.id]: league }, currentLeagueId: league.id })),

      fillWithSimulatedTeams: async (leagueId, teamCount) => {
        const league = get().leagues[leagueId];
        if (!league) return { ok: false, error: 'League not found.' };
        const slotsToFill = Math.max(0, teamCount - league.teams.length);
        if (slotsToFill === 0) return { ok: true };

        const identities = leagueService.generateSimulatedTeamIdentities(`${leagueId}-simteams`, slotsToFill);
        const withIds: (leagueService.SimulatedTeamIdentity & { id: string })[] = [];
        for (const identity of identities) {
          const result = await addSimulatedTeamRemote(leagueId, identity.teamName, identity.abbrev, identity.logoColor);
          if (!result.ok) return { ok: false, error: result.error };
          withIds.push({ ...identity, id: result.teamId });
        }

        set((state) => updateLeague(state, leagueId, (l) => leagueService.fillWithSimulatedTeams(l, withIds)));
        return { ok: true };
      },

      // manual v0.2.0 §2 #3: team count can only be resized pre-season — once
      // simulated members have joined, the schedule/rosters/standings built around the
      // old count already exist, so this mirrors the same "not yet filled" gate the UI
      // enforces (league.teams.length <= 1). Auto-corrects the playoff field/elim type
      // the same way the Create League slider does, so settings can never end up
      // invalid for the new (smaller) count.
      updateTargetTeamCount: (leagueId, count) =>
        set((state) =>
          updateLeague(state, leagueId, (league) => {
            if (league.teams.length > 1) return league;
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

      updateSettings: (leagueId, partial) =>
        set((state) =>
          updateLeague(state, leagueId, (league) => {
            const updated = leagueService.updateLeagueSettings(league, partial);
            // `settings.leagueName` and the top-level `league.name` (what headers/invite
            // screens actually render) are kept in sync here so editing the League name
            // field in Settings is visibly effective everywhere, not just in settings.
            return partial.leagueName != null ? { ...updated, name: partial.leagueName } : updated;
          }),
        ),

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
          updateLeague(state, leagueId, (league) => ({
            ...league,
            rostersByTeamWeek: { ...league.rostersByTeamWeek, ...result.rosters },
          })),
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
            const game = getGame(slot.wager.gameId, league.currentWeek, league.settings.lineMovementEnabled, league.manualGameOverrides);
            if (!game || game.status !== 'upcoming') return slot;
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

      advanceWeek: (leagueId) =>
        set((state) => updateLeague(state, leagueId, (league) => simulationService.advanceWeek(league))),

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
      factoryReset: () => set({ profile: null, leagues: {}, currentLeagueId: null }),

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

      postAnnouncement: (leagueId, message) =>
        set((state) =>
          updateLeague(state, leagueId, (league) => ({
            ...league,
            activity: [
              { id: `announcement-${leagueId}-${Date.now()}`, ts: new Date().toISOString(), type: 'announcement' as const, message, pinned: true },
              ...league.activity,
            ].slice(0, 40),
          })),
        ),

      reactToActivity: (leagueId, itemId, emoji) =>
        set((state) =>
          updateLeague(state, leagueId, (league) => ({
            ...league,
            activity: league.activity.map((item) =>
              item.id === itemId ? { ...item, reactions: { ...item.reactions, [emoji]: (item.reactions?.[emoji] ?? 0) + 1 } } : item,
            ),
          })),
        ),
    }),
    {
      name: 'propleague-storage',
      version: STORE_VERSION,
      migrate: migratePersistedState,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        return { ...current, ...p, leagues: normalizeLeagues(p.leagues as unknown as Record<string, unknown>) };
      },
    },
  ),
);