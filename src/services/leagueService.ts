// League lifecycle operations. Pure functions over League objects so the store
// stays a thin persistence/dispatch layer — this is the seam a real backend
// would slot in behind later.

import type { League, LeagueSettings, LeagueTeam, Matchup, PlayoffFieldSize, TeamStanding, WeekId } from '../types';
import { DEFAULT_LEAGUE_SETTINGS, TEAM_LOGO_EMOJIS, weekLabel } from '../types';
import { FUNNY_TEAM_NAMES, FUNNY_OWNER_NAMES, TEAM_LOGO_COLORS, abbrevFromName } from '../data/simulatedTeamNames';
import { generateMatchupSchedule, generateConferenceWeightedSchedule } from '../engine/matchups';
import { conferencesEligible, assignConferencesRandomly } from '../engine/conferences';
import { seasonPlan } from '../engine/playoffs';
import { ensurePool } from '../engine/prizePool';
import { ClaimTracker } from '../engine/duplicatePicks';
import { generateAutoLineup } from '../engine/autoLineup';
import { emptyStanding } from '../engine/standings';
import { rosterKey } from '../engine/rosterSlots';
import { gamesForWeek } from '../data/seed';
import { createRng, shuffle } from '../engine/random';

/** The league's regular-season weeks (1.2.11): from its start week up to the first playoff round, which
 * is set by the field size, elimination type and championship week. */
export function regularSeasonWeeksForLeague(settings: LeagueSettings, startWeek: WeekId | string | null): WeekId[] {
  const fieldSize = (([2, 4, 6, 8, 16] as const).includes(settings.playoffTeams as PlayoffFieldSize)
    ? settings.playoffTeams
    : 4) as PlayoffFieldSize;
  return seasonPlan(startWeek, settings.championshipWeek, fieldSize, settings.eliminationType).regularWeeks;
}

/** Builds the regular-season schedule for the given weeks, weighting toward in-conference matchups when
 * conferences are enabled and the team count is eligible (even, per manual §3.1). Keyed by week text. */
function buildSeasonSchedule(teams: LeagueTeam[], settings: LeagueSettings, seed: string, weeks: WeekId[]): Record<string, [string, string][]> {
  const teamIds = teams.map((t) => t.id);
  let byIndex: Record<number, [string, string][]>;
  if (settings.conferencesEnabled && conferencesEligible(teams.length)) {
    const conferenceOf: Record<string, string> = {};
    for (const t of teams) if (t.conferenceId) conferenceOf[t.id] = t.conferenceId;
    byIndex = generateConferenceWeightedSchedule(teamIds, conferenceOf, weeks.length, `${seed}-schedule`);
  } else {
    byIndex = generateMatchupSchedule(teamIds, weeks.length);
  }
  const out: Record<string, [string, string][]> = {};
  weeks.forEach((w, i) => {
    out[String(w)] = byIndex[i + 1] ?? [];
  });
  return out;
}

function matchupsFromSchedule(scheduleByWeek: Record<string, [string, string][]>, weeks: WeekId[]): Record<string, Matchup[]> {
  const matchupsByWeek: Record<string, Matchup[]> = {};
  for (const week of weeks) {
    const pairings = scheduleByWeek[String(week)] ?? [];
    matchupsByWeek[String(week)] = pairings.map(([teamAId, teamBId]) => ({
      id: `${teamAId}-${teamBId}-${week}`,
      week,
      teamAId,
      teamBId,
      teamAScore: null,
      teamBScore: null,
      winnerId: null,
      isTie: false,
    }));
  }
  return matchupsByWeek;
}

/** The full regular-season schedule for a league that starts in `startWeek` with its current teams and
 * settings. Used to start the season and to fill in weeks added later by a structure change. */
export function regularSeasonSchedule(league: Pick<League, 'id' | 'teams' | 'settings'>, startWeek: WeekId | string | null): Record<string, Matchup[]> {
  const weeks = regularSeasonWeeksForLeague(league.settings, startWeek);
  return matchupsFromSchedule(buildSeasonSchedule(league.teams, league.settings, league.id, weeks), weeks);
}

/**
 * The league's display name and visibility as the commissioner last set them. Both used to be saved
 * only inside the settings blob (never in their own columns), so a league renamed before the settings
 * RPC started keeping the columns in step still has its real name only in the blob. Prefer the blob's
 * copy when present, and fall back to the column.
 */
export function resolveLeagueIdentity(meta: {
  name: string;
  isPublic: boolean;
  settings?: Partial<LeagueSettings> | null;
}): { name: string; isPublic: boolean } {
  const blobName = typeof meta.settings?.leagueName === 'string' ? meta.settings.leagueName.trim() : '';
  const isPublic = typeof meta.settings?.isPublic === 'boolean' ? meta.settings.isPublic : meta.isPublic;
  return { name: blobName || meta.name, isPublic };
}

export interface CreateLeagueParams {
  id: string;
  inviteCode: string;
  userTeamId: string;
  name: string;
  teamCount: number;
  isPublic: boolean;
  settingsOverrides?: Partial<LeagueSettings>;
  userTeamName: string;
  userTeamAbbrev: string;
  userLogoColor: string;
}

export function createLeague(params: CreateLeagueParams): League {
  const userTeam: LeagueTeam = {
    id: params.userTeamId,
    ownerName: 'You',
    teamName: params.userTeamName,
    abbrev: params.userTeamAbbrev,
    logoMode: 'initials',
    logoEmoji: TEAM_LOGO_EMOJIS[0],
    logoColor: params.userLogoColor,
    isUser: true,
    isSimulated: false,
    conferenceId: null,
    logoDataUrl: null,
  };

  const settings: LeagueSettings = {
    ...DEFAULT_LEAGUE_SETTINGS,
    ...params.settingsOverrides,
    leagueName: params.name,
    isPublic: params.isPublic,
  };

  return {
    id: params.id,
    name: params.name,
    inviteCode: params.inviteCode,
    commissionerTeamId: userTeam.id,
    settings,
    targetTeamCount: params.teamCount,
    logoMode: 'initials',
    logoEmoji: '🏆',
    logoDataUrl: null,
    logoColor: TEAM_LOGO_COLORS[0],
    teams: [userTeam],
    currentWeek: 1,
    seasonPhase: 'regular',
    seasonStartWeek: null, // brand new -- matches the real leagues.season_start_week default
    matchupsByWeek: {},
    rostersByTeamWeek: {},
    standings: [emptyStanding(userTeam.id)],
    bracket: null,
    prizePool: null,
    activity: [
      {
        id: `welcome-${params.id}`,
        ts: new Date().toISOString(),
        type: 'announcement',
        message: `Welcome to ${params.name}! Fill the league with simulated teams to kick off Week 1.`,
      },
    ],
    chat: [],
  };
}

/** Used when JOINING an existing real league rather than creating one — builds a
 * local League shell around whatever real teams already exist in Supabase for it,
 * instead of assuming exactly one starting team. Matchups/rosters are deliberately
 * left empty: this joiner's browser has no access to the commissioner's locally-
 * simulated schedule (that only becomes shared once Steps 4-6 move it to Supabase
 * too), so showing a real team list with an honestly-empty season beats faking one. */
export interface RealTeamInput {
  id: string;
  teamName: string;
  abbrev: string;
  ownerName: string;
  isSimulated: boolean;
  logoMode: string | null;
  logoEmoji: string | null;
  logoColor: string;
  conferenceId: string | null;
}

export function buildLeagueFromRealTeams(params: {
  id: string;
  name: string;
  inviteCode: string;
  commissionerTeamId: string;
  targetTeamCount: number;
  isPublic: boolean;
  teams: RealTeamInput[];
  /** Server-persisted settings for this league, when available (see chat: settings
   * are now written to Supabase at creation and on every commissioner save). Merged
   * over DEFAULT_LEAGUE_SETTINGS the same way createLeague's settingsOverrides works,
   * so a returning/new-device user sees the league's real configuration instead of
   * always-default values. */
  settingsOverrides?: Partial<LeagueSettings> | null;
  /** Real `leagues.season_start_week` value (see chat, 0013_season_start_week.sql) --
   * unlike currentWeek/seasonPhase just below (placeholder 1/'regular' here, real
   * progress tracked separately via fetchLeagueProgress), this one IS the real,
   * authoritative value straight from fetchLeagueMeta, so every hydration must pass
   * it through rather than guessing. Null means the commissioner hasn't pressed
   * "Start Season" yet -- settle-week won't score or penalize ANY week for this
   * league until they do. */
  seasonStartWeek: string | null;
}): League {
  const teams: LeagueTeam[] = params.teams.map((t) => ({
    id: t.id,
    ownerName: t.ownerName,
    teamName: t.teamName,
    abbrev: t.abbrev,
    // logo_mode/logo_emoji are nullable on older rows (see chat: added alongside
    // the identity-persistence fix) -- fall back to the same defaults this always
    // used, rather than forcing every existing team to re-pick a logo.
    logoMode: (t.logoMode as LeagueTeam['logoMode']) ?? 'initials',
    logoEmoji: t.logoEmoji ?? TEAM_LOGO_EMOJIS[0],
    logoColor: t.logoColor,
    isUser: false, // caller overwrites this for whichever team is actually theirs
    isSimulated: t.isSimulated,
    conferenceId: t.conferenceId,
    logoDataUrl: null,
  }));

  const settings: LeagueSettings = {
    ...DEFAULT_LEAGUE_SETTINGS,
    ...params.settingsOverrides,
    leagueName: params.name,
    isPublic: params.isPublic,
  };

  return {
    id: params.id,
    name: params.name,
    inviteCode: params.inviteCode,
    commissionerTeamId: params.commissionerTeamId,
    settings,
    targetTeamCount: params.targetTeamCount,
    logoMode: 'initials',
    logoEmoji: '🏆',
    logoDataUrl: null,
    logoColor: TEAM_LOGO_COLORS[0],
    teams,
    currentWeek: 1,
    seasonPhase: 'regular',
    seasonStartWeek: params.seasonStartWeek,
    matchupsByWeek: {},
    rostersByTeamWeek: {},
    standings: teams.map((t) => emptyStanding(t.id)),
    bracket: null,
    prizePool: null,
    activity: [
      {
        id: `joined-${params.id}`,
        ts: new Date().toISOString(),
        type: 'announcement',
        message: `Welcome to ${params.name}!`,
      },
    ],
    chat: [],
  };
}

export interface SimulatedTeamIdentity {
  ownerName: string;
  teamName: string;
  abbrev: string;
  logoMode: LeagueTeam['logoMode'];
  logoEmoji: string;
  logoColor: string;
}

/** Generates the cosmetic identity (name/abbrev/colors/etc) for `count` simulated
 * teams, seeded so repeat calls with the same seed are stable. Deliberately doesn't
 * assign ids — those only exist once the real Supabase row is created via
 * add_simulated_team, so the caller attaches them after. */
export function generateSimulatedTeamIdentities(seed: string, count: number): SimulatedTeamIdentity[] {
  const rng = createRng(seed);
  const namePool = shuffle(rng, FUNNY_TEAM_NAMES);
  const ownerPool = shuffle(rng, FUNNY_OWNER_NAMES);
  const colorPool = shuffle(rng, TEAM_LOGO_COLORS);
  const emojiPool = shuffle(rng, TEAM_LOGO_EMOJIS);
  return Array.from({ length: count }, (_, i) => {
    const name = namePool[i % namePool.length];
    return {
      ownerName: ownerPool[i % ownerPool.length],
      teamName: name,
      abbrev: abbrevFromName(name),
      // Mix of modes so a filled league showcases both at a glance.
      logoMode: rng() < 0.5 ? 'emoji' : 'initials',
      logoEmoji: emojiPool[i % emojiPool.length],
      logoColor: colorPool[i % colorPool.length],
    };
  });
}

/** Builds the season — schedule, conference lock, standings, and Week 1 bot
 * lineups — from whatever teams already exist on `league.teams` right now. This
 * is the one place a schedule is ever generated, whether the roster is all real
 * teams, all simulated, or a mix. Callers must only invoke it once per league
 * (both call sites below guard on `matchupsByWeek` being empty first) -- calling
 * it twice regenerates a fresh schedule from Week 1. */
export function startSeason(league: League, startWeek: WeekId | null = null): League {
  let teams = league.teams;

  // Conference assignment happens once, right here, when the full roster is first
  // known — this is the "locked at season start" moment (manual §3.1). Auto-random
  // by default; the commissioner can still drag members between conferences
  // afterward for standings/seeding purposes, but the schedule generated below is
  // what's actually fixed for the season.
  if (league.settings.conferencesEnabled && conferencesEligible(teams.length)) {
    const assignRng = createRng(`${league.id}-conferences`);
    const assignment = assignConferencesRandomly(teams.map((t) => t.id), league.settings.conferences, assignRng);
    teams = teams.map((t) => ({ ...t, conferenceId: assignment[t.id] ?? t.conferenceId }));
  }

  // The schedule starts in the league's real start week (1.2.11), so there are no made-up matchups
  // for weeks before it.
  const matchupsByWeek = regularSeasonSchedule({ ...league, teams }, startWeek);
  const firstWeek: WeekId = Object.values(matchupsByWeek)[0]?.[0]?.week ?? startWeek ?? 1;
  const firstWeekNum = typeof firstWeek === 'number' ? firstWeek : 1;

  const firstGames = gamesForWeek(firstWeekNum);
  const rostersByTeamWeek = { ...league.rostersByTeamWeek };
  const claims = new ClaimTracker(league, firstWeekNum);
  for (const team of teams.filter((t) => t.isSimulated)) {
    const roster = generateAutoLineup(team.id, firstWeekNum, league.settings, firstGames, (g, m, p, s, pt) => claims.isTaken(g, m, p, s, pt));
    claims.claimRoster(roster);
    rostersByTeamWeek[rosterKey(team.id, firstWeekNum)] = roster;
  }

  const standings: TeamStanding[] = teams.map((t) => emptyStanding(t.id));

  return {
    ...league,
    teams,
    matchupsByWeek,
    rostersByTeamWeek,
    standings,
    activity: [
      {
        id: `season-started-${league.id}`,
        ts: new Date().toISOString(),
        type: 'announcement',
        message: `The season is underway! ${weekLabel(firstWeek)} matchups are set.`,
      },
      ...league.activity,
    ],
  };
}

/** Adds already-identified simulated teams (real ids already assigned by the
 * caller, from the real Supabase rows) into the league, then calls `startSeason`
 * to build the schedule/lineups/standings around the full (real + sim) roster. */
export function fillWithSimulatedTeams(league: League, simIdentities: (SimulatedTeamIdentity & { id: string })[], startWeek: WeekId | null = null): League {
  const simTeams: LeagueTeam[] = simIdentities.map((t) => ({
    id: t.id,
    ownerName: t.ownerName,
    teamName: t.teamName,
    abbrev: t.abbrev,
    logoMode: t.logoMode,
    logoEmoji: t.logoEmoji,
    logoColor: t.logoColor,
    isUser: false,
    isSimulated: true,
    conferenceId: null,
    logoDataUrl: null,
  }));

  return startSeason({ ...league, teams: [...league.teams, ...simTeams] }, startWeek);
}

/** manual v0.2.0 §3 #7: `ensurePool` was previously only ever called lazily from
 * `simulateWeek` (i.e. the next Advance Week), so toggling buy-in ON mid-week left
 * `league.prizePool` null until then — the "show real $ at stake" display chain reads
 * `pool.current` directly, so with no pool yet it silently rendered nothing and looked
 * broken. Creating the pool immediately here means turning buy-in on takes effect the
 * moment it's toggled, matching every other league setting. */
export function updateLeagueSettings(league: League, partial: Partial<LeagueSettings>): League {
  const updated = { ...league, settings: { ...league.settings, ...partial } };
  return { ...updated, prizePool: ensurePool(updated) };
}
