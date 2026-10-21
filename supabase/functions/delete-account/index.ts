// Supabase Edge Function: delete-account
//
// Deletes the calling user's account for good. Apple requires an app that creates
// accounts to offer this from inside the app (App Review 5.1.1(v)), so it is a
// submission blocker rather than a nicety.
//
// Two steps, in this order and for a reason:
//   1. public.delete_my_account() (migration 0042), run as the caller, so the RPC's
//      own auth.uid() decides whose account is being deleted and nothing here has to
//      be trusted with that. It hands over any commissioner role, turns their teams
//      into bot teams and clears teams.vacated_by_profile_id.
//   2. auth.admin.deleteUser, as the service role. profiles.id -> auth.users is
//      ON DELETE CASCADE, so this takes the profile row, league memberships, push
//      tokens and live activities with it. Without step 1 it fails outright, because
//      teams.vacated_by_profile_id -> profiles is NO ACTION.
//
// The league is deliberately left standing: past weeks, standings, settled matchups
// and the prize pool belong to everyone who played them, not just to the person
// leaving. This is the same outcome as Leave This League (migration 0012).
//
// Deploy: supabase functions deploy delete-account
// Secrets needed: none beyond the ones Supabase injects.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { getSupabaseAdminKey } from '../_shared/supabaseAdminKey.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!anonKey || !authHeader) return json({ ok: false, error: 'unauthorized' }, 401);

  const asUser = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData } = await asUser.auth.getUser();
  const callerId = userData?.user?.id;
  if (!callerId) return json({ ok: false, error: 'unauthorized' }, 401);

  // Step 1, as the caller. A failure here must stop everything: deleting the auth
  // user with memberships still attached would strand a real profile_id on rows
  // the app reads, and there is no undo once the user is gone.
  const { error: rpcError } = await asUser.rpc('delete_my_account');
  if (rpcError) {
    console.error('delete-account: league cleanup failed', callerId, rpcError.message);
    return json({ ok: false, error: rpcError.message }, 400);
  }

  // Step 2, as the service role.
  const admin = createClient(url, getSupabaseAdminKey());
  const { error: deleteError } = await admin.auth.admin.deleteUser(callerId);
  if (deleteError) {
    console.error('delete-account: auth delete failed', callerId, deleteError.message);
    return json({ ok: false, error: deleteError.message }, 500);
  }

  console.log('delete-account: deleted', callerId);
  return json({ ok: true });
});
