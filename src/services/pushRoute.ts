// Where a tapped push should land (1.2.10). Every push the server sends carries a small `data`
// payload (see supabase/functions: send-roster-reminders, settle-week, notify-void-request):
//   { screen: 'lineup', leagueId, week }                 lineup reminders
//   { screen: 'matchup', leagueId, week, teamId }        settled-bet alerts and week results
//   { screen: 'void-requests', leagueId }                void requests and their answers
// pushNotifications.ts parses the tap into a PushRoute and parks it here; PushRouter (mounted in the
// app shell) takes it once the app is ready and moves to that league and screen. Parking it means a
// tap that cold-launches the app still lands in the right place after sign-in and league loading.

export type PushRoute =
  | { screen: 'lineup'; leagueId: string }
  | { screen: 'matchup'; leagueId: string; week: string; teamId: string | null }
  | { screen: 'void-requests'; leagueId: string };

/** Reads a push's data payload. Anything unknown or malformed gives null (the app just opens). */
export function parsePushRoute(data: unknown): PushRoute | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const leagueId = typeof d.leagueId === 'string' && d.leagueId !== '' ? d.leagueId : null;
  if (!leagueId) return null;
  if (d.screen === 'lineup') return { screen: 'lineup', leagueId };
  if (d.screen === 'void-requests') return { screen: 'void-requests', leagueId };
  if (d.screen === 'matchup') {
    const week = typeof d.week === 'string' || typeof d.week === 'number' ? String(d.week) : null;
    if (!week) return null;
    return { screen: 'matchup', leagueId, week, teamId: typeof d.teamId === 'string' ? d.teamId : null };
  }
  return null;
}

let pending: PushRoute | null = null;
const listeners = new Set<() => void>();

export function setPendingPushRoute(route: PushRoute | null): void {
  pending = route;
  for (const fn of listeners) fn();
}

/** The parked route, cleared as it is read so it is only followed once. */
export function takePendingPushRoute(): PushRoute | null {
  const r = pending;
  pending = null;
  return r;
}

export function peekPendingPushRoute(): PushRoute | null {
  return pending;
}

export function subscribePushRoute(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
