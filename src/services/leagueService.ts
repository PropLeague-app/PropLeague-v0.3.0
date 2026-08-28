// League lifecycle operations. Pure functions over League objects so the store
// stays a thin persistence/dispatch layer — this is the seam a real backend
// would slot in behind later.

import type { League, LeagueSettings, LeagueTeam, Matchup, PlayoffFieldSize, TeamStanding } from '../types';
import { DEFAULT_LEAGUE_SETTINGS, TEAM_LOGO_EMOJIS } from '../types';
import { FUNNY_TEAM_NAMES, FUNNY_OWNER_NAMES, TEAM_LOGO_COLORS, abbrevFromName } from '../data/simulatedTeamNames';
import { generateMatchupSchedule, generateConferenceWeightedSchedule } from '../engine/matchups';
import { conferencesEligible, assignConferencesRandomly } from '../engine/conferences';
import { regularSeasonWeeksFor } from '../engine/playoffs';
import { ensurePool } from '../engine/prizePool';
import { ClaimTracker } from '../engine/duplicatePicks';
import { generateAutoLineup } from '../engine/autoLineup';
import { emptyStanding } from '../engine/standings';
import { rosterKey } from '../engine/rosterSlots';
import { gamesForWeek } from '../data/seed';
import { createRng, shuffle } from '../engine/random';

function regularSeasonWeeksForSettings(settings: LeagueSettings): number {
  const fieldSize = (([2, 4, 6, 8, 16] as const).includes(settings.playoffTeams as PlayoffFieldSize)
    ? settings.playoffTeams
    : 4) as PlayoffFieldSize;
  return regularSeasonWeeksFor(fieldSize, settings.eliminationType);
}

/** Builds the season schedule, weighting toward in-conference matchups when
 * conferences are enabled and the team count is eligible (even, per manual §3.1).
 * Regular season length varies by playoff field size/elimination type — a 16-team or
 * double-elim bracket needs more weeks than WC/DIV/CONF alone, so it starts earlier
 * (manual §3.2: "start earlier — Week 17/18 as needed"). */
function buildSeasonSchedule(teams: LeagueTeam[], settings: LeagueSettings, seed: string): Record<number, [string, string][]> {
  const teamIds = teams.map((t) => t.id);
  const weeks = regularSeasonWeeksForSettings(settings);
  if (settings.conferencesEnabled && conferencesEligible(teams.length)) {
    const conferenceOf: Record<string, string> = {};
    for (const t of teams) if (t.conferenceId) conferenceOf[t.id] = t.conferenceId;
    return generateConferenceWeightedSchedule(teamIds, conferenceOf, weeks, `${seed}-schedule`);
  }
  return generateMatchupSchedule(teamIds, weeks);
}

function matchupsFromSchedule(scheduleByWeek: Record<number, [string, string][]>): Record<string, Matchup[]> {
  const matchupsByWeek: Record<string, Matchup[]> = {};
  for (const [week, pairings] of Object.entries(scheduleByWeek)) {
    matchupsByWeek[week] = pairings.map(([teamAId, teamBId], i) => ({
      id: `W${week}-M${i + 1}`,
      week: Number(week),
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

function randomInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export interface CreateLeagueParams {
  id: string;
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
    id: 'user',
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
    inviteCode: randomInviteCode(),
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
    matchupsByWeek: {},
    rostersByTeamWeek: {},
    standings: [emptyStanding(userTeam.id)],
    bracket: null,
    prizePool: null,
    manualGameOverrides: {},
    activity: [
      {
        id: `welcome-${params.id}`,
        ts: new Date().toISOString(),
        type: 'announcement',
        message: `Welcome to ${params.name}! Fill the league with simulated teams to kick off Week 1.`,
      },
    ],
  };
}

/** Populates remaining league slots (up to `teamCount`) with AI-controlled teams,
 * generates the season's H2H schedule, and auto-submits their Week 1 lineups. */
export function fillWithSimulatedTeams(league: League, teamCount: number): League {
  const rng = createRng(`${league.id}-simteams`);
  const namePool = shuffle(rng, FUNNY_TEAM_NAMES);
  const ownerPool = shuffle(rng, FUNNY_OWNER_NAMES);
  const colorPool = shuffle(rng, TEAM_LOGO_COLORS);
  const slotsToFill = Math.max(0, teamCount - league.teams.length);

  const emojiPool = shuffle(rng, TEAM_LOGO_EMOJIS);
  const simTeams: LeagueTeam[] = Array.from({ length: slotsToFill }, (_, i) => {
    const name = namePool[i % namePool.length];
    return {
      id: `sim-${i + 1}`,
      ownerName: ownerPool[i % ownerPool.length],
      teamName: name,
      abbrev: abbrevFromName(name),
      // Mix of modes so a filled league showcases both at a glance.
      logoMode: rng() < 0.5 ? 'emoji' : 'initials',
      logoEmoji: emojiPool[i % emojiPool.length],
      logoColor: colorPool[i % colorPool.length],
      isUser: false,
      isSimulated: true,
      conferenceId: null,
      logoDataUrl: null,
    };
  });

  let teams = [...league.teams, ...simTeams];

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

  const matchupsByWeek = matchupsFromSchedule(buildSeasonSchedule(teams, league.settings, league.id));

  const week1Games = gamesForWeek(1);
  const rostersByTeamWeek = { ...league.rostersByTeamWeek };
  const claims = new ClaimTracker(league, 1);
  for (const team of simTeams) {
    const roster = generateAutoLineup(team.id, 1, league.settings, week1Games, (g, m, p, s, pt) => claims.isTaken(g, m, p, s, pt));
    claims.claimRoster(roster);
    rostersByTeamWeek[rosterKey(team.id, 1)] = roster;
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
        id: `filled-${league.id}`,
        ts: new Date().toISOString(),
        type: 'announcement',
        message: `${slotsToFill} simulated teams joined the league. Build your Week 1 lineup!`,
      },
      ...league.activity,
    ],
  };
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

/** Rebuilds the season from Week 1 with the same teams/settings/conference assignment
 * — dev-panel "Reset Season". */
export function resetLeagueSeason(league: League): League {
  const matchupsByWeek = matchupsFromSchedule(buildSeasonSchedule(league.teams, league.settings, `${league.id}-reset-${Date.now()}`));

  const week1Games = gamesForWeek(1);
  const rostersByTeamWeek: League['rostersByTeamWeek'] = {};
  const claims = new ClaimTracker({ ...league, rostersByTeamWeek: {} }, 1);
  for (const team of league.teams) {
    if (team.isSimulated) {
      const roster = generateAutoLineup(team.id, 1, league.settings, week1Games, (g, m, p, s, pt) => claims.isTaken(g, m, p, s, pt));
      claims.claimRoster(roster);
      rostersByTeamWeek[rosterKey(team.id, 1)] = roster;
    }
  }

  return {
    ...league,
    currentWeek: 1,
    seasonPhase: 'regular',
    matchupsByWeek,
    rostersByTeamWeek,
    standings: league.teams.map((t) => emptyStanding(t.id)),
    bracket: null,
    prizePool: null,
    manualGameOverrides: {},
    activity: [
      {
        id: `reset-${league.id}-${Date.now()}`,
        ts: new Date().toISOString(),
        type: 'announcement',
        message: 'Season reset to Week 1.',
      },
    ],
  };
}
