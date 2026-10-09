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
  /** The league that leads the Dynamic Island and lock screen by default. Null means no favorite. */
  favoriteLeagueId: string | null;
  /** Leagues muted from the league switcher: no pushes and no Live Activities for them. */
  mutedLeagueIds: string[];
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
  favoriteLeagueId: null,
  mutedLeagueIds: [],
};

/** Keeps the two league fields well formed, whatever an older or odd saved blob holds. */
function normalize(raw: Partial<NotificationPrefs>): NotificationPrefs {
  const merged = { ...DEFAULT_NOTIFICATION_PREFS, ...raw };
  return {
    ...merged,
    favoriteLeagueId: typeof merged.favoriteLeagueId === 'string' && merged.favoriteLeagueId !== '' ? merged.favoriteLeagueId : null,
    mutedLeagueIds: Array.isArray(merged.mutedLeagueIds) ? merged.mutedLeagueIds.filter((id) => typeof id === 'string') : [],
  };
}

export interface LeaguePrefChange {
  favorite?: boolean;
  muted?: boolean;
}

/**
 * Applies one favorite or mute change for a league. A league is never both: favoriting a muted
 * league unmutes it, muting the favorite clears the favorite. Only one league is the favorite.
 */
export function applyLeaguePrefChange(prefs: NotificationPrefs, leagueId: string, change: LeaguePrefChange): NotificationPrefs {
  let favoriteLeagueId = prefs.favoriteLeagueId;
  let muted = prefs.mutedLeagueIds.filter((id) => id !== leagueId);
  const wasMuted = prefs.mutedLeagueIds.includes(leagueId);
  if (change.favorite === true) {
    favoriteLeagueId = leagueId;
  } else if (change.favorite === false && favoriteLeagueId === leagueId) {
    favoriteLeagueId = null;
  }
  const nowMuted = change.muted ?? (change.favorite === true ? false : wasMuted);
  if (nowMuted) {
    muted = [...muted, leagueId];
    if (favoriteLeagueId === leagueId) favoriteLeagueId = null;
  }
  return { ...prefs, favoriteLeagueId, mutedLeagueIds: muted };
}

// Last known prefs per profile, in memory and mirrored to localStorage. The Settings screen starts
// from this so toggles a user turned off do not flash to the all-on default while the real values
// load (it used to show the defaults for a split second on every visit). Browser storage can be
// missing or throw, so every access is guarded and the screen still works without it.
const CACHE_KEY = (profileId: string) => `pl.notifPrefs.${profileId}`;
const memoryCache = new Map<string, NotificationPrefs>();

function remember(profileId: string, prefs: NotificationPrefs) {
  memoryCache.set(profileId, prefs);
  try {
    localStorage.setItem(CACHE_KEY(profileId), JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
}

/** The last prefs seen for this profile, or null if this device has never loaded them. */
export function getCachedNotificationPrefs(profileId: string | null | undefined): NotificationPrefs | null {
  if (!profileId) return null;
  const hit = memoryCache.get(profileId);
  if (hit) return hit;
  try {
    const raw = localStorage.getItem(CACHE_KEY(profileId));
    if (raw) {
      const prefs = normalize(JSON.parse(raw) as Partial<NotificationPrefs>);
      memoryCache.set(profileId, prefs);
      return prefs;
    }
  } catch {
    /* storage unavailable or corrupt */
  }
  return null;
}

export async function fetchNotificationPrefs(profileId: string): Promise<NotificationPrefs> {
  const { data, error } = await supabase.from('profiles').select('notification_prefs').eq('id', profileId).single();
  if (error) return getCachedNotificationPrefs(profileId) ?? DEFAULT_NOTIFICATION_PREFS;
  const prefs =
    !data?.notification_prefs || typeof data.notification_prefs !== 'object'
      ? DEFAULT_NOTIFICATION_PREFS
      : normalize(data.notification_prefs as Partial<NotificationPrefs>);
  remember(profileId, prefs);
  return prefs;
}

export async function updateNotificationPrefs(profileId: string, partial: Partial<NotificationPrefs>): Promise<{ ok: boolean; error?: string }> {
  const current = await fetchNotificationPrefs(profileId);
  const next = { ...current, ...partial };
  const { error } = await supabase.from('profiles').update({ notification_prefs: next }).eq('id', profileId);
  if (!error) remember(profileId, next);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/**
 * Saves a favorite or mute change for one league. It starts from the saved prefs on the server, not
 * the caller's copy, so a change made on another device is not overwritten. Returns the prefs as
 * saved so the caller can show them.
 */
export async function updateLeaguePref(
  profileId: string,
  leagueId: string,
  change: LeaguePrefChange,
): Promise<{ ok: true; prefs: NotificationPrefs } | { ok: false; error: string }> {
  const current = await fetchNotificationPrefs(profileId);
  const next = applyLeaguePrefChange(current, leagueId, change);
  const { error } = await supabase.from('profiles').update({ notification_prefs: next }).eq('id', profileId);
  if (error) return { ok: false, error: error.message };
  remember(profileId, next);
  return { ok: true, prefs: next };
}
