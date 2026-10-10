// Per-league notification choices, stored inside profiles.notification_prefs (no table of their
// own, so there is nothing extra to migrate):
//   mutedLeagueIds   : leagues the person muted. Nothing about them is pushed: no lineup reminders,
//                      no void request alerts, no Live Activities.
//   favoriteLeagueId : the league that leads the Dynamic Island and lock screen by default.
// The app writes these from the league switcher (src/services/notificationPrefs.ts).

const asRecord = (raw: unknown): Record<string, unknown> =>
  raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

export function leagueMuted(raw: unknown, leagueId: string): boolean {
  const muted = asRecord(raw).mutedLeagueIds;
  return Array.isArray(muted) && muted.includes(leagueId);
}

export function favoriteLeagueId(raw: unknown): string | null {
  const fav = asRecord(raw).favoriteLeagueId;
  return typeof fav === 'string' && fav !== '' ? fav : null;
}

/** For a function that only has a profile id: has that person muted this league? */
// deno-lint-ignore no-explicit-any
export async function profileMutedLeague(supabase: any, profileId: string, leagueId: string): Promise<boolean> {
  const { data } = await supabase.from('profiles').select('notification_prefs').eq('id', profileId).maybeSingle();
  return leagueMuted(data?.notification_prefs, leagueId);
}

// ---------------------------------------------------------------------------
// Per-league overrides by type (1.2.10). Also inside notification_prefs:
//   leagueOverrides : { [leagueId]: { lineupReminders?, wagerSettled?, weekResults?,
//                     liveActivities?, voidRequests? } }
// Only differences from the global switches are stored, so a league with no entry simply follows
// the global switches. voidRequests has no global switch: it is always per league (commissioners
// only), on unless that league turned it off. The client mirror is src/services/notificationPrefs.ts
// (notificationAllowed), kept in step by src/services/__tests__/leaguePrefs.test.ts.
// ---------------------------------------------------------------------------

export type NotifType = 'lineupReminders' | 'wagerSettled' | 'weekResults' | 'liveActivities' | 'voidRequests';

/** May this person get this kind of notification for this league? Mute wins, then the league's own
 * choice, then the global switch. Missing prefs mean everything is on. */
export function notifAllowed(raw: unknown, leagueId: string, type: NotifType): boolean {
  if (leagueMuted(raw, leagueId)) return false;
  const prefs = asRecord(raw);
  const override = asRecord(asRecord(prefs.leagueOverrides)[leagueId])[type];
  if (typeof override === 'boolean') return override;
  if (type === 'voidRequests') return true;
  return prefs[type] !== false;
}

/** For a function that only has a profile id. */
// deno-lint-ignore no-explicit-any
export async function profileNotifAllowed(supabase: any, profileId: string, leagueId: string, type: NotifType): Promise<boolean> {
  const { data } = await supabase.from('profiles').select('notification_prefs').eq('id', profileId).maybeSingle();
  return notifAllowed(data?.notification_prefs, leagueId, type);
}
