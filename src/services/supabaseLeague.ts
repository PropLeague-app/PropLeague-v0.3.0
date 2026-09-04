import { supabase } from '../lib/supabaseClient';

export interface RealLeagueMeta {
  id: string;
  name: string;
  inviteCode: string;
  commissionerTeamId: string | null;
  targetTeamCount: number;
  isPublic: boolean;
}

export interface RealLeagueTeam {
  id: string;
  teamName: string;
  abbrev: string;
  ownerName: string; // real username, or 'Simulated' for AI-controlled teams
  isSimulated: boolean;
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

export async function fetchLeagueMeta(leagueId: string): Promise<ServiceResult<RealLeagueMeta>> {
  const { data, error } = await supabase
    .from('leagues')
    .select('id, name, invite_code, commissioner_team_id, target_team_count, is_public')
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
  };
}

export async function fetchLeagueTeams(leagueId: string): Promise<ServiceResult<{ teams: RealLeagueTeam[] }>> {
  const { data, error } = await supabase
    .from('teams')
    .select('id, team_name, abbrev, is_simulated, logo_color, logo_storage_path, conference_id, league_memberships(profiles(username))')
    .eq('league_id', leagueId)
    .order('created_at', { ascending: true });
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not load teams.' };

  const teams: RealLeagueTeam[] = (data as unknown as TeamRow[]).map((row) => ({
    id: row.id,
    teamName: row.team_name,
    abbrev: row.abbrev,
    ownerName: row.league_memberships?.profiles?.username ?? 'Simulated',
    isSimulated: row.is_simulated,
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
): Promise<ServiceResult<{ teamId: string }>> {
  const { data: teamId, error } = await supabase.rpc('add_simulated_team', {
    p_league_id: leagueId,
    p_team_name: teamName,
    p_team_abbrev: teamAbbrev,
    p_logo_color: logoColor,
  });
  if (error || !teamId) return { ok: false, error: error?.message ?? 'Could not add a simulated team.' };
  return { ok: true, teamId };
}