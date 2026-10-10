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

/** The kinds of notification a league can set for itself (League notifications, in the league
 * switcher). The first four follow the global switches unless a league overrides them. */
export type LeagueNotifType = 'lineupReminders' | 'wagerSettled' | 'weekResults' | 'liveActivities' | 'voidRequests';
/** The four that also have a global switch, so "Use for all my leagues" can carry them over. */
export const GLOBAL_NOTIF_TYPES = ['lineupReminders', 'wagerSettled', 'weekResults', 'liveActivities'] as const;
export type GlobalNotifType = (typeof GLOBAL_NOTIF_TYPES)[number];
export type LeagueOverride = Partial<Record<LeagueNotifType, boolean>>;

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
  /** Per-league choices that differ from the global switches (only differences are stored).
   * Void requests are always per league: on unless a league turns them off. */
  leagueOverrides: Record<string, LeagueOverride>;
}

// Mirrors the server-side default in _shared/leaguePrefs.ts's notifAllowed
// (used by every push sender): null/missing prefs (every existing user, until
// they touch this screen) means every notification type is on.
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  lineupReminders: true,
  slateUpdates: 'needs_work',
  wagerSettled: true,
  weekResults: true,
  liveActivities: true,
  favoriteLeagueId: null,
  mutedLeagueIds: [],
  leagueOverrides: {},
};

/** Keeps the two league fields well formed, whatever an older or odd saved blob holds. */
function normalize(raw: Partial<NotificationPrefs>): NotificationPrefs {
  const merged = { ...DEFAULT_NOTIFICATION_PREFS, ...raw };
  return {
    ...merged,
    favoriteLeagueId: typeof merged.favoriteLeagueId === 'string' && merged.favoriteLeagueId !== '' ? merged.favoriteLeagueId : null,
    mutedLeagueIds: Array.isArray(merged.mutedLeagueIds) ? merged.mutedLeagueIds.filter((id) => typeof id === 'string') : [],
    leagueOverrides: normalizeOverrides(merged.leagueOverrides),
  };
}

const LEAGUE_NOTIF_TYPES: LeagueNotifType[] = [...GLOBAL_NOTIF_TYPES, 'voidRequests'];

function normalizeOverrides(raw: unknown): Record<string, LeagueOverride> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, LeagueOverride> = {};
  for (const [leagueId, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue;
    const clean: LeagueOverride = {};
    for (const t of LEAGUE_NOTIF_TYPES) {
      const v = (entry as Record<string, unknown>)[t];
      if (typeof v === 'boolean') clean[t] = v;
    }
    if (Object.keys(clean).length > 0) out[leagueId] = clean;
  }
  return out;
}

/** The global default for a type (void requests have none, they default to on). */
function globalValue(prefs: NotificationPrefs, type: LeagueNotifType): boolean {
  return type === 'voidRequests' ? true : prefs[type] !== false;
}

/**
 * Does this league get this kind of notification? Mute wins, then the league's own choice, then the
 * global switch. Mirrors notifAllowed in supabase/functions/_shared/leaguePrefs.ts, which is what
 * actually decides on the server.
 */
export function notificationAllowed(prefs: NotificationPrefs, leagueId: string, type: LeagueNotifType): boolean {
  if (prefs.mutedLeagueIds.includes(leagueId)) return false;
  const override = prefs.leagueOverrides[leagueId]?.[type];
  return typeof override === 'boolean' ? override : globalValue(prefs, type);
}

/** Does this league differ from the global switches in any way (shown as "Custom" in the switcher)? */
export function leagueHasOverrides(prefs: NotificationPrefs, leagueId: string): boolean {
  const entry = prefs.leagueOverrides[leagueId] ?? {};
  return LEAGUE_NOTIF_TYPES.some((t) => typeof entry[t] === 'boolean' && entry[t] !== globalValue(prefs, t));
}

/**
 * Sets one type for one league. A value equal to the global default is stored as "no override", so
 * the league keeps following the global switch for that type.
 */
export function applyLeagueOverride(prefs: NotificationPrefs, leagueId: string, type: LeagueNotifType, value: boolean): NotificationPrefs {
  const entry: LeagueOverride = { ...prefs.leagueOverrides[leagueId] };
  if (value === globalValue(prefs, type)) delete entry[type];
  else entry[type] = value;
  const leagueOverrides = { ...prefs.leagueOverrides };
  if (Object.keys(entry).length > 0) leagueOverrides[leagueId] = entry;
  else delete leagueOverrides[leagueId];
  return { ...prefs, leagueOverrides };
}

/**
 * "Use for all my leagues": this league's choices for the four global types become the global
 * switches, and every league's overrides for those types are cleared, so every league now matches.
 * Void requests (always per league), mutes and the favorite are left as they are.
 */
export function applyLeagueChoicesToAll(prefs: NotificationPrefs, leagueId: string): NotificationPrefs {
  const next: NotificationPrefs = { ...prefs };
  for (const t of GLOBAL_NOTIF_TYPES) {
    const override = prefs.leagueOverrides[leagueId]?.[t];
    next[t] = typeof override === 'boolean' ? override : prefs[t] !== false;
  }
  const leagueOverrides: Record<string, LeagueOverride> = {};
  for (const [id, entry] of Object.entries(prefs.leagueOverrides)) {
    const kept: LeagueOverride = {};
    if (typeof entry.voidRequests === 'boolean') kept.voidRequests = entry.voidRequests;
    if (Object.keys(kept).length > 0) leagueOverrides[id] = kept;
  }
  next.leagueOverrides = leagueOverrides;
  return next;
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

/**
 * Saves a change made on League notifications (one type for one league, or "Use for all my
 * leagues"). Like updateLeaguePref, it starts from the saved prefs on the server so a change made on
 * another device is not overwritten, and returns the prefs as saved.
 */
export async function updatePrefsWith(
  profileId: string,
  change: (prefs: NotificationPrefs) => NotificationPrefs,
): Promise<{ ok: true; prefs: NotificationPrefs } | { ok: false; error: string }> {
  const current = await fetchNotificationPrefs(profileId);
  const next = change(current);
  const { error } = await supabase.from('profiles').update({ notification_prefs: next }).eq('id', profileId);
  if (error) return { ok: false, error: error.message };
  remember(profileId, next);
  return { ok: true, prefs: next };
}
