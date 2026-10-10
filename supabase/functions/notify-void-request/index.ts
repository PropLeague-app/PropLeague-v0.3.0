// Supabase Edge Function: notify-void-request (Build 7)
//
// Push for the void request flow (see migration 0032). The app calls it right after:
//   event 'new'      a member filed a request     -> push to the commissioner
//   event 'resolved' the commissioner answered it -> push to the member who asked
//
// The caller is checked against the request, and each push is claimed once through
// notification_dedup, so a replayed call sends nothing. Pushes are a courtesy: the app's own
// list and badge are the source of truth, and the app ignores any failure here.
//
// Deploy: supabase functions deploy notify-void-request
// Secrets needed: APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_AUTH_KEY (same as the others).

import { createClient } from 'npm:@supabase/supabase-js@2';
import { sendPushToProfile, claimNotification } from '../_shared/pushNotifications.ts';
import { getSupabaseAdminKey } from '../_shared/supabaseAdminKey.ts';
import { profileMutedLeague, profileNotifAllowed } from '../_shared/leaguePrefs.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  let requestId = '';
  let event = '';
  try {
    const body = await req.json();
    requestId = String(body?.requestId ?? '');
    event = String(body?.event ?? '');
  } catch {
    return json({ ok: false, error: 'bad body' }, 400);
  }
  if (!requestId || (event !== 'new' && event !== 'resolved')) return json({ ok: false, error: 'bad request' }, 400);

  // Who is calling.
  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!anonKey || !authHeader) return json({ ok: false, error: 'unauthorized' }, 401);
  const asUser = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await asUser.auth.getUser();
  const callerId = userData?.user?.id;
  if (!callerId) return json({ ok: false, error: 'unauthorized' }, 401);

  const supabase = createClient(url, getSupabaseAdminKey());

  const { data: reqRow } = await supabase
    .from('void_requests')
    .select('id, league_id, week, player_name, status, requested_by')
    .eq('id', requestId)
    .maybeSingle();
  if (!reqRow) return json({ ok: false, error: 'not found' }, 404);

  const { data: league } = await supabase
    .from('leagues')
    .select('name, commissioner_team_id')
    .eq('id', reqRow.league_id)
    .maybeSingle();
  if (!league) return json({ ok: false, error: 'league not found' }, 404);

  // The commissioner's profile: league.commissioner_team_id -> team.membership_id -> membership.profile_id.
  let commissionerProfileId: string | null = null;
  if (league.commissioner_team_id) {
    const { data: team } = await supabase.from('teams').select('membership_id').eq('id', league.commissioner_team_id).maybeSingle();
    if (team?.membership_id) {
      const { data: m } = await supabase.from('league_memberships').select('profile_id').eq('id', team.membership_id).maybeSingle();
      commissionerProfileId = (m?.profile_id as string | undefined) ?? null;
    }
  }

  const leagueName = (league.name as string | null) ?? 'your league';
  const weekLabel = /^[0-9]+$/.test(reqRow.week as string) ? `Week ${reqRow.week}` : String(reqRow.week);
  const player = String(reqRow.player_name);

  if (event === 'new') {
    if (callerId !== reqRow.requested_by || reqRow.status !== 'pending') return json({ ok: false, error: 'forbidden' }, 403);
    if (!commissionerProfileId || commissionerProfileId === callerId) return json({ ok: true, sent: 0 });
    // A league muted from the switcher, or with Void requests turned off in its League notifications,
    // stays quiet. The request still waits in the app's own list.
    if (!(await profileNotifAllowed(supabase, commissionerProfileId, reqRow.league_id as string, 'voidRequests'))) return json({ ok: true, sent: 0 });
    if (!(await claimNotification(supabase, `void-req:${requestId}:new`))) return json({ ok: true, sent: 0 });
    const r = await sendPushToProfile(supabase, commissionerProfileId, {
      title: 'Void request',
      subtitle: leagueName,
      body: `Void ${player}'s picks for ${weekLabel}? Review in Settings.`,
      threadId: reqRow.league_id as string,
      data: { screen: 'void-requests', leagueId: reqRow.league_id as string },
    });
    return json({ ok: true, sent: r.sent });
  }

  // 'resolved': only the commissioner may trigger it, and only once the request is answered.
  if (callerId !== commissionerProfileId || reqRow.status === 'pending') return json({ ok: false, error: 'forbidden' }, 403);
  if (reqRow.requested_by === callerId) return json({ ok: true, sent: 0 });
  if (await profileMutedLeague(supabase, reqRow.requested_by as string, reqRow.league_id as string)) return json({ ok: true, sent: 0 });
  if (!(await claimNotification(supabase, `void-req:${requestId}:resolved`))) return json({ ok: true, sent: 0 });
  const approved = reqRow.status === 'approved';
  const r = await sendPushToProfile(supabase, reqRow.requested_by as string, {
    title: `Void request ${approved ? 'approved' : 'denied'}`,
    subtitle: leagueName,
    body: approved
      ? `${player}'s missed Over and Anytime TD picks (${weekLabel}) are being voided.`
      : `Your void request for ${player} (${weekLabel}) was denied.`,
    threadId: reqRow.league_id as string,
    data: { screen: 'void-requests', leagueId: reqRow.league_id as string },
  });
  return json({ ok: true, sent: r.sent });
});
