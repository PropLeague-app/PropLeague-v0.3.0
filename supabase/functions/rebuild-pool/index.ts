// Supabase Edge Function: rebuild-pool (1.2.11)
//
// Recalculates a league's tracked prize pool right after its commissioner changes a pool setting
// (buy-in on/off or amount, multipliers, AI teams in the pool, the week it is tracked from), instead of
// waiting for the next week to close. Same calculation as settle-week (_shared/poolRebuild.ts): from the
// tracking week through the last closed week, under the league's current rules.
//
// Body: { leagueId }. Only the league's commissioner may call it.
// Deploy: supabase functions deploy rebuild-pool

import { createClient } from 'npm:@supabase/supabase-js@2';
import { getSupabaseAdminKey } from '../_shared/supabaseAdminKey.ts';
import { calendarIndex, seasonPlan, SEASON_CALENDAR, type PlayoffBracket, type PlayoffFieldSize, type PrizePool, type WeekId } from '../_shared/playoffLogic.ts';
import { buildLeaguePool, type PoolSettingsSlice } from '../_shared/poolRebuild.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const asWeek = (v: unknown): WeekId | null => (calendarIndex(v as WeekId) >= 0 ? (v as WeekId) : null);

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  let leagueId = '';
  try {
    leagueId = String((await req.json())?.leagueId ?? '');
  } catch {
    return json({ ok: false, error: 'bad body' }, 400);
  }
  if (!leagueId) return json({ ok: false, error: 'bad request' }, 400);

  // Only the commissioner (checked with the caller's own token).
  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!anonKey || !authHeader) return json({ ok: false, error: 'unauthorized' }, 401);
  const asUser = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await asUser.auth.getUser();
  const callerId = userData?.user?.id;
  if (!callerId) return json({ ok: false, error: 'unauthorized' }, 401);

  const supabase = createClient(url, getSupabaseAdminKey());
  const { data: league } = await supabase
    .from('leagues')
    .select('id, commissioner_team_id, current_week, season_phase, season_start_week, settings, bracket, prize_pool')
    .eq('id', leagueId)
    .maybeSingle();
  if (!league) return json({ ok: false, error: 'league not found' }, 404);

  // The commissioner: league.commissioner_team_id -> team.membership_id -> membership.profile_id.
  let commissionerProfileId: string | null = null;
  if (league.commissioner_team_id) {
    const { data: team } = await supabase.from('teams').select('membership_id').eq('id', league.commissioner_team_id).maybeSingle();
    if (team?.membership_id) {
      const { data: m } = await supabase.from('league_memberships').select('profile_id').eq('id', team.membership_id).maybeSingle();
      commissionerProfileId = (m?.profile_id as string | undefined) ?? null;
    }
  }
  if (commissionerProfileId !== callerId) return json({ ok: false, error: 'only the commissioner' }, 403);

  const raw = (league.settings && typeof league.settings === 'object' ? league.settings : {}) as Record<string, any>;
  const settings: PoolSettingsSlice = {
    buyInEnabled: raw.buyInEnabled === true,
    buyInAmount: Number(raw.buyInAmount ?? 0),
    weeklyCredits: Number(raw.weeklyCredits ?? 100),
    aiTeamsAffectPool: raw.aiTeamsAffectPool !== false,
    poolMultipliers: { enabled: false, basis: 'rank', spread: 0, ...raw.poolMultipliers },
    poolTrackFromWeek: asWeek(raw.poolTrackFromWeek),
    poolMultipliersBackfill: raw.poolMultipliersBackfill !== false,
    poolMultipliersSince: asWeek(raw.poolMultipliersSince),
  };
  const fieldSize = ([2, 4, 6, 8, 16].includes(Number(raw.playoffTeams)) ? Number(raw.playoffTeams) : 4) as PlayoffFieldSize;
  const plan = seasonPlan(league.season_start_week, asWeek(raw.championshipWeek) ?? 'CONF', fieldSize, raw.eliminationType === 'double' ? 'double' : 'single');

  // Weeks that have closed: everything before the current week, or the whole season once it is over.
  const currentIdx = calendarIndex(league.current_week);
  const closedIdx = league.season_phase === 'complete' ? currentIdx : currentIdx - 1;
  if (closedIdx < 0) return json({ ok: true, pool: league.prize_pool ?? null, note: 'no week has closed yet' });
  const closedWeek = String(SEASON_CALENDAR[closedIdx]);

  const { data: teams } = await supabase.from('teams').select('id, is_simulated').eq('league_id', leagueId);
  const { data: rosterRows } = await supabase
    .from('weekly_rosters')
    .select('team_id, week, wagers(status, settled_profit), teams!inner(league_id)')
    .eq('teams.league_id', leagueId);
  const { data: matchups } = await supabase
    .from('matchups')
    .select('week, team_a_id, team_b_id, team_a_score, team_b_score, winner_id, is_tie')
    .eq('league_id', leagueId);

  const pool = buildLeaguePool({
    prior: (league.prize_pool as PrizePool | null) ?? null,
    settings,
    teams: teams ?? [],
    rosterRows: (rosterRows ?? []) as any[],
    matchups: (matchups ?? []) as any[],
    bracket: (league.bracket as PlayoffBracket | null) ?? null,
    plan,
    seasonStartWeek: league.season_start_week,
    closedWeek,
    lock: league.season_phase === 'complete',
  });
  const { error } = await supabase.from('leagues').update({ prize_pool: pool }).eq('id', leagueId);
  if (error) return json({ ok: false, error: error.message }, 500);
  return json({ ok: true, pool });
});
