// Client side of the Apple Live Activities feature (lock screen banner + Dynamic Island).
//
// Two jobs, both native-only (every export silently no-ops in a browser):
//   1. Tell the server how to reach this device: the push-to-start token (so the server can
//      start an activity while the app is closed, iOS 17.2+) and each running activity's own
//      push token (so the server can update it).
//   2. Ask the server what should be showing right now (supabase/functions/live-activities in
//      plan mode) and hand that to the native plugin, which starts, updates or ends activities
//      locally. This is what covers iOS 16.2 to 17.0 and anything the server could not push.
//
// The server decides everything (which slate, which matchup, when to end). This file only
// relays, so there is no scheduling logic to keep in sync here.
import { Capacitor, registerPlugin } from '@capacitor/core';
import { supabase } from '../lib/supabaseClient';

interface LiveActivityStatus {
  supported: boolean;
  enabled: boolean;
  startToken?: string;
}

interface NativeSyncItem {
  kind: string;
  ending: boolean;
  staleDate?: number;
  attributesJson: string;
  stateJson: string;
}

interface ActivityTokenEvent {
  activityId: string;
  pushToken: string;
  leagueId: string;
  teamId: string;
  week: string;
  kind: string;
  windowKey: string;
}

interface LiveActivityPlugin {
  getStatus(): Promise<LiveActivityStatus>;
  configure(options: { supabaseUrl: string; anonKey: string }): Promise<void>;
  sync(options: { items: NativeSyncItem[] }): Promise<void>;
  addListener(event: 'startToken', handler: (data: { token: string }) => void): Promise<{ remove: () => Promise<void> }>;
  addListener(event: 'activityToken', handler: (data: ActivityTokenEvent) => void): Promise<{ remove: () => Promise<void> }>;
}

interface PlanItem {
  kind: string;
  ending: boolean;
  staleDate?: number | null;
  attributes: unknown;
  state: unknown;
}

const LiveActivity = registerPlugin<LiveActivityPlugin>('LiveActivity');

const REFRESH_MS = 5 * 60 * 1000;
const MIN_GAP_MS = 20 * 1000;

let started = false;
let lastSyncAt = 0;
let syncing = false;
let registeredStartToken: string | null = null;

async function registerStartToken(token: string): Promise<void> {
  if (!token || token === registeredStartToken) return;
  const { error } = await supabase.rpc('register_live_activity_start_token', { p_token: token });
  if (error) {
    console.error('[live-activity] failed to save start token:', error.message);
    return;
  }
  registeredStartToken = token;
}

async function registerActivityToken(event: ActivityTokenEvent): Promise<void> {
  const { error } = await supabase.rpc('register_live_activity', {
    p_activity_id: event.activityId,
    p_push_token: event.pushToken,
    p_league_id: event.leagueId,
    p_team_id: event.teamId,
    p_week: event.week,
    p_kind: event.kind,
    p_window_key: event.windowKey,
  });
  if (error) console.error('[live-activity] failed to save activity token:', error.message);
}

/** Pulls the server's plan and applies it on the device. Safe to call often (it throttles). */
export async function syncLiveActivities(force = false): Promise<void> {
  if (!Capacitor.isNativePlatform() || syncing) return;
  const now = Date.now();
  if (!force && now - lastSyncAt < MIN_GAP_MS) return;
  syncing = true;
  lastSyncAt = now;
  try {
    const status = await LiveActivity.getStatus();
    if (!status.supported || !status.enabled) return; // older iOS or switched off: regular pushes still cover it
    if (status.startToken) await registerStartToken(status.startToken);

    const { data, error } = await supabase.functions.invoke('live-activities', { method: 'POST', body: { mode: 'plan' } });
    if (error) {
      console.error('[live-activity] plan request failed:', error.message);
      return;
    }
    const items: PlanItem[] = Array.isArray(data?.items) ? data.items : [];
    await LiveActivity.sync({
      items: items.map((item) => ({
        kind: item.kind,
        ending: item.ending,
        ...(typeof item.staleDate === 'number' ? { staleDate: item.staleDate } : {}),
        attributesJson: JSON.stringify(item.attributes),
        stateJson: JSON.stringify(item.state),
      })),
    });
  } catch (err) {
    console.error('[live-activity] sync failed:', err instanceof Error ? err.message : err);
  } finally {
    syncing = false;
  }
}

/**
 * Call once per app launch after a real, onboarded session exists (see App.tsx). Wires the token
 * listeners, tells the native side where Supabase lives, then syncs now and whenever the app
 * comes back to the foreground or sits open for a few minutes.
 */
export async function startLiveActivities(): Promise<void> {
  if (!Capacitor.isNativePlatform() || started) return;
  started = true;
  try {
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;
    if (url && key) await LiveActivity.configure({ supabaseUrl: url, anonKey: key });

    await LiveActivity.addListener('startToken', (data) => void registerStartToken(data.token));
    await LiveActivity.addListener('activityToken', (data) => void registerActivityToken(data));

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void syncLiveActivities();
    });
    window.setInterval(() => {
      if (document.visibilityState === 'visible') void syncLiveActivities();
    }, REFRESH_MS);
  } catch (err) {
    console.error('[live-activity] setup failed:', err instanceof Error ? err.message : err);
  }
  await syncLiveActivities(true);
}

/** Signed out: end everything on the device. */
export async function stopLiveActivities(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  registeredStartToken = null;
  try {
    await LiveActivity.sync({ items: [] });
  } catch {
    // plugin not available (older build): nothing to end
  }
}
