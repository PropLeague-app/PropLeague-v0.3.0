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
