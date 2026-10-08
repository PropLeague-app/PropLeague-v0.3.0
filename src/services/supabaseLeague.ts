import { supabase } from '../lib/supabaseClient';
import type { LeagueSettings } from '../types';

export interface RealLeagueMeta {
  id: string;
  name: string;
  inviteCode: string;
  commissionerTeamId: string | null;
  targetTeamCount: number;
  isPublic: boolean;
  /** Server-persisted LeagueSettings (see chat: previously 100% client-local,
   * which blocked server-side automatic advancement from ever knowing a
   * league's playoff/elimination/pool-multiplier configuration). Null for a
   * league whose settings haven't been saved to Supabase yet -- callers fall
   * back to DEFAULT_LEAGUE_SETTINGS the same way the edge functions do. */
  settings: Partial<LeagueSettings> | null;
  /** Gameplay changes scheduled for the next week (leagues.pending_settings, migration 0027). */
  pendingSettings: Partial<LeagueSettings> | null;
  /** The league's own logo. Fetched with the rest of the meta so the league switcher can show every
   * league's real logo at launch, not just the one that has been opened and refreshed. */
  logoStoragePath: string | null;
  logoMode: string | null;
  logoEmoji: string | null;
  logoColor: string | null;
  /** Null until the commissioner presses "Start Season" (see chat,
   * 0013_season_start_week.sql / start_season RPC). */
  seasonStartWeek: string | null;
}

export interface RealLeagueTeam {
  id: string;
  teamName: string;
  abbrev: string;
  ownerName: string; // real username, or 'Simulated' for AI-controlled teams
  isSimulated: boolean;
  logoMode: string | null;
  logoEmoji: string | null;
  logoColor: string;
  logoStoragePath: string | null;
  conferenceId: string | null;
}

type ServiceResult<T> = { ok: true } & T | { ok: false; error: string };

/** Row shape returned by the nested select in fetchLeagueTeams. Supabase's
 * FK-based embedding nests the related row(s) under the table name. */
interface TeamRow {
  id: string;
  team_name: string;
  abbrev: string;
  is_simulated: boolean;
  logo_mode: string | null;
  logo_emoji: string | null;
  logo_color: string;
  logo_storage_path: string | null;
  conference_id: string | null;
  league_memberships: { profiles: { username: string } | null } | null;
}

export interface MyLeagueMembership {
  leagueId: string;
  teamId: string;
}

/** Discovers every league + team the currently authenticated user actually
 * belongs to in Supabase -- the missing piece that let a fresh login/install
 * see nothing even with real existing memberships (see chat: RootRedirect only
 * ever checked local on-device state, never asked Supabase at all). Two simple
 * top-level-filtered queries rather than one query with a nested-table filter --
 * deliberately, since I can't verify PostgREST's exact embedded-filter syntax
 * without a live instance to test against, and this is launch-critical enough
 * to want the pattern I'm actually certain works (used successfully everywhere
 * else in this codebase), not the one I'm merely fairly confident about. */
export async function fetchMyLeagueMemberships(): Promise<ServiceResult<{ memberships: MyLeagueMembership[] }>> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return { ok: false, error: userError?.message ?? 'Not signed in.' };

  const { data: membershipRows, error: membershipError } = await supabase
    .from('league_memberships')
    .select('id, league_id')
    .eq('profile_id', userData.user.id);
  if (membershipError || !membershipRows) return { ok: false, error: membershipError?.message ?? 'Could not load your memberships.' };
  if (membershipRows.length === 0) return { ok: true, memberships: [] };

  const membershipIds = membershipRows.map((m) => m.id as string);
  const { data: teamRows, error: teamError } = await supabase.from('teams').select('id, membership_id').in('membership_id', membershipIds);
  if (teamError || !teamRows) return { ok: false, error: teamError?.message ?? 'Could not load your teams.' };

  const teamIdByMembership = new Map((teamRows as { id: string; membership_id: string }[]).map((t) => [t.membership_id, t.id]));
  const memberships: MyLeagueMembership[] = (membershipRows as { id: string; league_id: string }[])
    .map((m) => ({ leagueId: m.league_id, teamId: teamIdByMembership.get(m.id) }))
    .filter((m): m is MyLeagueMembership => m.teamId != null);

  return { ok: true, memberships };
}

export async function createRealLeague(params: {
  name: string;
  targetTeamCount: number;
  isPublic: boolean;
  userTeamName: string;
  userTeamAbbrev: string;
  userLogoColor: string;
}): Promise<ServiceResult<{ leagueId: string; teamId: string; inviteCode: string }>> {
  const { data: leagueId, error } = await supabase.rpc('create_league', {
    p_name: params.name,
    p_target_team_count: params.targetTeamCount,
    p_is_public: params.isPublic,
    p_team_name: params.userTeamName,
    p_team_abbrev: params.userTeamAbbrev,
    p_logo_color: params.userLogoColor,
  });
  if (error || !leagueId) return { ok: false, error: error?.message ?? 'Could not create the league.' };

  const meta = await fetchLeagueMeta(leagueId);
  if (!meta.ok) return { ok: false, error: meta.error };
  if (!meta.commissionerTeamId) return { ok: false, error: 'League created but no commissioner team was found.' };

  return { ok: true, leagueId, teamId: meta.commissionerTeamId, inviteCode: meta.inviteCode };
}

export async function joinRealLeague(params: {
  inviteCode: string;
  teamName: string;
  teamAbbrev: string;
  logoColor: string;
}): Promise<ServiceResult<{ leagueId: string; teamId: string }>> {
  const { data: teamId, error } = await supabase.rpc('join_league_by_code', {
    p_invite_code: params.inviteCode.trim().toUpperCase(),
    p_team_name: params.teamName,
    p_team_abbrev: params.teamAbbrev,
    p_logo_color: params.logoColor,
  });
  if (error || !teamId) return { ok: false, error: error?.message ?? 'Could not join that league.' };

  const { data, error: fetchError } = await supabase.from('teams').select('league_id').eq('id', teamId).single();
  if (fetchError || !data) return { ok: false, error: fetchError?.message ?? 'Joined, but could not load the league.' };

  return { ok: true, leagueId: data.league_id as string, teamId };
}

/** Reclaims the caller's own previously-vacated team in a league (see chat, Sept 28
 * 2026, and 0018_rejoin_league_by_code.sql): leave_league converts a departing
 * member's team to a bot rather than deleting it, so the same person coming back
 * with the same invite code should get that exact team -- same id, name, abbrev,
 * logo, and full pick/matchup/standings history -- back, not a brand new one. Returns
 * noRejoinableTeam: true (not a generic error) when this profile has no vacated team
 * waiting in that league, so the caller knows to fall back to joinRealLeague's normal
 * create-a-new-team flow instead of surfacing this as a failure. */
export async function rejoinRealLeague(params: {
  inviteCode: string;
}): Promise<
  | { ok: true; leagueId: string; teamId: string }
  | { ok: false; error: string; noRejoinableTeam?: boolean }
> {
  const { data: teamId, error } = await supabase.rpc('rejoin_league_by_code', {
    p_invite_code: params.inviteCode.trim().toUpperCase(),
  });
  if (error || !teamId) {
    const noRejoinableTeam = error?.message?.includes('NO_REJOINABLE_TEAM') ?? false;
    return { ok: false, error: error?.message ?? 'Could not rejoin that league.', noRejoinableTeam };
  }

  const { data, error: fetchError } = await supabase.from('teams').select('league_id').eq('id', teamId).single();
  if (fetchError || !data) return { ok: false, error: fetchError?.message ?? 'Rejoined, but could not load the league.' };

  return { ok: true, leagueId: data.league_id as string, teamId };
}

export async function fetchLeagueMeta(leagueId: string): Promise<ServiceResult<RealLeagueMeta>> {
  const { data, error } = await supabase
    .from('leagues')
    .select('id, name, invite_code, commissioner_team_id, target_team_count, is_public, settings, pending_settings, season_start_week, logo_storage_path, logo_mode, logo_emoji, logo_color')
    .eq('id', leagueId)
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? 'League not found.' };
  return {
    ok: true,
    id: data.id,
    name: data.name,
    inviteCode: data.invite_code,
    commissionerTeamId: data.commissioner_team_id,
    targetTeamCount: data.target_team_count,
    isPublic: data.is_public,
    seasonStartWeek: data.season_start_week,
    settings: data.settings ?? null,
    pendingSettings: (data as { pending_settings?: Partial<LeagueSettings> | null }).pending_settings ?? null,
    logoStoragePath: data.logo_storage_path ?? null,
    logoMode: data.logo_mode ?? null,
    logoEmoji: data.logo_emoji ?? null,
    logoColor: data.logo_color ?? null,
  };
}

/** What update_league_settings / discard_pending_settings return (migration 0027). */
export interface SettingsRpcState {
  /** A pick already exists this week, so gameplay edits were scheduled instead of applied. */
  locked: boolean;
  week: string;
  settings: Partial<LeagueSettings>;
  pending: Partial<LeagueSettings> | null;
}

function parseSettingsState(data: unknown): SettingsRpcState {
  const d = (data ?? {}) as { locked?: boolean; week?: string; settings?: Partial<LeagueSettings>; pending_settings?: Partial<LeagueSettings> | null };
  return { locked: !!d.locked, week: String(d.week ?? ''), settings: d.settings ?? {}, pending: d.pending_settings ?? null };
}

/** Saves league settings through update_league_settings (migration 0027). Pass only the keys
 * that changed. The server decides what applies now and what waits for rollover, rejects a
 * combination that can never produce a legal roster (the error text names what to change), and
 * is the only path allowed to write leagues.settings. Also used right after a league is created
 * (CreateLeague.tsx) with the full settings object, when nothing is locked yet. */
export async function updateLeagueSettingsRemote(
  leagueId: string,
  patch: Partial<LeagueSettings>,
): Promise<{ ok: true; state: SettingsRpcState } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('update_league_settings', { p_league_id: leagueId, p_patch: patch });
  if (error) return { ok: false, error: error.message };
  return { ok: true, state: parseSettingsState(data) };
}

/** "Discard scheduled changes": drops everything waiting for next week. */
export async function discardPendingSettingsRemote(
  leagueId: string,
): Promise<{ ok: true; state: SettingsRpcState } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('discard_pending_settings', { p_league_id: leagueId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, state: parseSettingsState(data) };
}

/** True once any pick (human or bot) exists in the league's current week. Null if the
 * check failed, in which case callers keep whatever they had. */
export async function fetchSettingsLocked(leagueId: string): Promise<boolean | null> {
  const { data, error } = await supabase.rpc('league_settings_locked', { p_league_id: leagueId });
  if (error || typeof data !== 'boolean') return null;
  return data;
}

/** Was missing entirely (see chat): useAppStore's leaveLeague only ever flipped
 * local state, so a departed member stayed a real, active member server-side --
 * still got lineup reminders, still showed up as a real team on any other
 * device/build. This calls the leave_league RPC (0012_leave_league.sql), which
 * does the actual work: refuses if the caller is still commissioner, converts
 * their team to simulated (schedule/history untouched), and deletes their
 * league_memberships row so is_league_member() -- and everything gated on it --
 * correctly stops treating them as a member. */
export async function leaveRealLeague(leagueId: string): Promise<ServiceResult<object>> {
  const { error } = await supabase.rpc('leave_league', { p_league_id: leagueId });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Was also missing (see chat): transferCommissioner in useAppStore was 100%
 * local-only, same bug as leaveLeague above -- commissioner_team_id never
 * reached Supabase, so a transfer would silently revert on the next device's
 * hydration (now that hydrateMyLeagues correctly treats it as server-
 * authoritative) and could leave leave_league's server-side commissioner check
 * refusing an exit the UI already showed as handed off. No new RPC needed:
 * `leagues` already has an UPDATE policy gated on is_league_commissioner(id)
 * for both USING and WITH CHECK, so a plain update from the current
 * commissioner's own session is already correctly authorized. */
export async function updateLeagueCommissionerRemote(leagueId: string, newCommissionerTeamId: string): Promise<ServiceResult<object>> {
  const { error } = await supabase.from('leagues').update({ commissioner_team_id: newCommissionerTeamId }).eq('id', leagueId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Called alongside the existing schedule-generation flow (fillWithSimulatedTeams /
 * startSeason in useAppStore.ts -- no new button, no user-facing change; see chat,
 * 0013_season_start_week.sql). Stamps leagues.season_start_week AND current_week
 * with the real live NFL week right now, not week 1, so a league started after the
 * real season is already underway doesn't get auto-settled for weeks it never
 * played. Idempotent server-side -- a second call just returns the already-
 * stamped value. Commissioner-only, enforced server-side. */
export async function markSeasonStartedRemote(leagueId: string): Promise<ServiceResult<{ seasonStartWeek: string }>> {
  const { data, error } = await supabase.rpc('mark_season_started', { p_league_id: leagueId });
  if (error) return { ok: false, error: error.message };
  return { ok: true, seasonStartWeek: data as string };
}

export async function fetchLeagueTeams(leagueId: string): Promise<ServiceResult<{ teams: RealLeagueTeam[] }>> {
  const { data, error } = await supabase
    .from('teams')
    .select('id, team_name, abbrev, is_simulated, logo_mode, logo_emoji, logo_color, logo_storage_path, conference_id, league_memberships(profiles(username))')
    .eq('league_id', leagueId)
    .order('created_at', { ascending: true });
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not load teams.' };

  const teams: RealLeagueTeam[] = (data as unknown as TeamRow[]).map((row) => ({
    id: row.id,
    teamName: row.team_name,
    abbrev: row.abbrev,
    ownerName: row.league_memberships?.profiles?.username ?? 'Simulated',
    isSimulated: row.is_simulated,
    logoMode: row.logo_mode,
    logoEmoji: row.logo_emoji,
    logoColor: row.logo_color,
    logoStoragePath: row.logo_storage_path,
    conferenceId: row.conference_id,
  }));
  return { ok: true, teams };
}

export async function addSimulatedTeamRemote(
  leagueId: string,
  teamName: string,
  teamAbbrev: string,
  logoColor: string,
  logoMode?: string,
  logoEmoji?: string,
): Promise<ServiceResult<{ teamId: string }>> {
  const { data: teamId, error } = await supabase.rpc('add_simulated_team', {
    p_league_id: leagueId,
    p_team_name: teamName,
    p_team_abbrev: teamAbbrev,
    p_logo_color: logoColor,
  });
  if (error || !teamId) return { ok: false, error: error?.message ?? 'Could not add a simulated team.' };
  // add_simulated_team (pre-dates migrations/, never captured as a migration file --
  // see 0020) has no logo_mode/logo_emoji params, so a separate narrow RPC applies
  // the rest of generateSimulatedTeamIdentities' randomized identity (emoji vs.
  // initials, which emoji) right after creation. Best-effort: a real, varied name/
  // abbrev/color already landed above, so a failure here just leaves this one team
  // on the 'initials' default rather than blocking league creation entirely.
  if (logoMode && logoMode !== 'initials') {
    const { error: logoError } = await supabase.rpc('set_simulated_team_logo', {
      p_team_id: teamId,
      p_logo_mode: logoMode,
      p_logo_emoji: logoEmoji ?? '',
    });
    if (logoError) console.error('set_simulated_team_logo failed', logoError);
  }
  return { ok: true, teamId };
}
/** Direct table update rather than a new RPC -- consistent with the existing
 * uploadTeamLogo/uploadLeagueLogo pattern (see chat: this codebase's RLS
 * already permits an authenticated client to update its own team/league rows
 * this way; a stricter "must own this team" check is part of the still-open
 * RPC/RLS security lockdown, not something this step attempts). Only send the
 * fields that actually changed -- callers pass a partial patch. */
export async function updateTeamIdentityRemote(
  teamId: string,
  partial: Partial<{ teamName: string; abbrev: string; logoMode: string; logoEmoji: string; logoColor: string }>,
): Promise<ServiceResult<object>> {
  const patch: Record<string, string> = {};
  if (partial.teamName !== undefined) patch.team_name = partial.teamName;
  if (partial.abbrev !== undefined) patch.abbrev = partial.abbrev;
  if (partial.logoMode !== undefined) patch.logo_mode = partial.logoMode;
  if (partial.logoEmoji !== undefined) patch.logo_emoji = partial.logoEmoji;
  if (partial.logoColor !== undefined) patch.logo_color = partial.logoColor;
  if (Object.keys(patch).length === 0) return { ok: true };
  const { error } = await supabase.from('teams').update(patch).eq('id', teamId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function updateLeagueIdentityRemote(
  leagueId: string,
  partial: Partial<{ logoMode: string; logoEmoji: string; logoColor: string }>,
): Promise<ServiceResult<object>> {
  const patch: Record<string, string> = {};
  if (partial.logoMode !== undefined) patch.logo_mode = partial.logoMode;
  if (partial.logoEmoji !== undefined) patch.logo_emoji = partial.logoEmoji;
  if (partial.logoColor !== undefined) patch.logo_color = partial.logoColor;
  if (Object.keys(patch).length === 0) return { ok: true };
  const { error } = await supabase.from('leagues').update(patch).eq('id', leagueId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Commissioner drag-team-between-conferences (SettingsHome) -- was local-only
 * before (see chat), so it reverted on every sign-out. */
export async function updateTeamConferenceRemote(teamId: string, conferenceId: string): Promise<ServiceResult<object>> {
  const { error } = await supabase.from('teams').update({ conference_id: conferenceId }).eq('id', teamId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
