// Reads/writes profiles.notification_prefs (see migration 0008 and chat,
// Sept 2026). Deliberately its own tiny service rather than folded into
// useAuthStore.updateProfile -- that method's AuthProfile shape (username/
// avatarEmoji/oddsFormat/onboarded) is the identity a user presents to their
// league, while notification prefs are pure device/app behavior with no
// equivalent anywhere else in the app, so a separate read/write pair here
// keeps AuthProfile from growing a field unrelated to what it's actually for.
import { supabase } from '../lib/supabaseClient';

/** How often the pre-slate push fires (send-roster-reminders). Additive key: a missing
 * value means 'needs_work', the original behavior. */
export type SlateUpdates = 'needs_work' | 'trailing' | 'every_slate';

export interface NotificationPrefs {
  lineupReminders: boolean;
  slateUpdates: SlateUpdates;
  wagerSettled: boolean;
  weekResults: boolean;
  /** Lock screen and Dynamic Island live updates (iOS 16.2+). Missing means on. */
  liveActivities: boolean;
}

// Mirrors the server-side default in send-roster-reminders/settle-week's
// notifPrefsAllow: null/missing prefs (every existing user, until they touch
// this screen) means every notification type is on.
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  lineupReminders: true,
  slateUpdates: 'needs_work',
  wagerSettled: true,
  weekResults: true,
  liveActivities: true,
};

export async function fetchNotificationPrefs(profileId: string): Promise<NotificationPrefs> {
  const { data, error } = await supabase.from('profiles').select('notification_prefs').eq('id', profileId).single();
  if (error || !data?.notification_prefs || typeof data.notification_prefs !== 'object') return DEFAULT_NOTIFICATION_PREFS;
  return { ...DEFAULT_NOTIFICATION_PREFS, ...(data.notification_prefs as Partial<NotificationPrefs>) };
}

export async function updateNotificationPrefs(profileId: string, partial: Partial<NotificationPrefs>): Promise<{ ok: boolean; error?: string }> {
  const current = await fetchNotificationPrefs(profileId);
  const next = { ...current, ...partial };
  const { error } = await supabase.from('profiles').update({ notification_prefs: next }).eq('id', profileId);
  return error ? { ok: false, error: error.message } : { ok: true };
}
