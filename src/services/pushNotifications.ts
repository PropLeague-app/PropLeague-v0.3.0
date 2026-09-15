// Client-side push notification registration (see chat, Sept 2026 -- part of
// the same push feature as supabase/functions/send-roster-reminders and the
// wager-settled/week-results pushes in settle-week).
//
// Native-only: PushNotifications is a Capacitor plugin backed by real APNs
// device APIs that don't exist in a browser tab, so every call in here is
// gated on Capacitor.isNativePlatform() -- calling `npm run dev` in a
// desktop browser (or previewing this app anywhere outside the actual iOS
// build) should silently no-op, not throw.
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { supabase } from '../lib/supabaseClient';

let registrationStarted = false;

/**
 * Requests notification permission (if not already granted or denied) and
 * registers this device for push, upserting the resulting APNs token to
 * device_push_tokens against the given profile. Call once per app session
 * after a real, onboarded auth session exists (see App.tsx) -- safe to call
 * more than once, it only actually runs the native registration flow once
 * per app launch (`registrationStarted` guard) since PushNotifications'
 * listeners would otherwise pile up on every re-render/re-login.
 */
export async function registerForPushNotifications(profileId: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  if (registrationStarted) return;
  registrationStarted = true;

  const upsertToken = async (token: string) => {
    // Goes through the register_push_token RPC, not a direct table upsert --
    // see migration 0008's comment on it: a plain client upsert can't
    // reassign a token row that currently belongs to a DIFFERENT profile_id
    // (RLS blocks that update), which is exactly the "same device, different
    // signed-in PropLeague account" case this needs to handle.
    const { error } = await supabase.rpc('register_push_token', { p_token: token, p_platform: 'ios' });
    if (error) console.error(`[push] failed to save device token for profile ${profileId}:`, error.message);
  };

  await PushNotifications.addListener('registration', (token) => {
    void upsertToken(token.value);
  });
  await PushNotifications.addListener('registrationError', (err) => {
    console.error('[push] registration error:', err.error);
  });

  const current = await PushNotifications.checkPermissions();
  let receive = current.receive;
  if (receive === 'prompt' || receive === 'prompt-with-rationale') {
    const requested = await PushNotifications.requestPermissions();
    receive = requested.receive;
  }
  if (receive !== 'granted') return; // user declined -- nothing more to do, no error state to show

  await PushNotifications.register();
}
