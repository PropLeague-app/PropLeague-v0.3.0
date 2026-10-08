// The feed post for a skunked week. A port of src/engine/skunkedAnnouncement.ts (the app parses
// it and draws the muted card); duplicated rather than imported so `supabase functions deploy`
// does not reach across directories. Keep the two in step.
export const SKUNKED_TAG = '::sk::';

/** The fewest losing picks that can make a week a skunk (src/engine/skunkedWeek.ts). */
export const SKUNKED_MIN_LOSSES = 3;

const clean = (s: string) => s.replace(/[*|]/g, '').replace(/::(?:sk|pw)::/g, '');

export function encodeSkunkedWeek(p: { weekLabel: string; teamName: string; record: string; pl: string; teamId: string }): string {
  const name = clean(p.teamName);
  return `🦨 **${name}** got skunked in **${clean(p.weekLabel)}**. ${p.record}, ${p.pl}${SKUNKED_TAG}${clean(p.weekLabel)}|${name}|${p.record}|${p.pl}|${p.teamId}`;
}

/** The server-side twin of isSkunkedWeek: a full lineup, nothing pending, no win or push, enough losses (voids ignored). */
export function isSkunkedWagers(wagers: { status: string }[], totalSlots: number): boolean {
  if (wagers.length === 0 || wagers.length < totalSlots) return false;
  let losses = 0;
  for (const w of wagers) {
    if (w.status === 'pending' || w.status === 'won' || w.status === 'push') return false;
    if (w.status === 'lost') losses++;
  }
  return losses >= SKUNKED_MIN_LOSSES;
}
