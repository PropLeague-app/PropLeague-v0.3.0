// The feed post for a perfect week. A port of src/engine/perfectAnnouncement.ts (the app parses
// it and draws the gold card); duplicated rather than imported so `supabase functions deploy`
// does not reach across directories. Keep the two in step.
export const PERFECT_TAG = '::pw::';

const clean = (s: string) => s.replace(/[*|]/g, '').replace(/::pw::/g, '');

export function encodePerfectWeek(p: { weekLabel: string; teamName: string; record: string; pl: string; teamId: string }): string {
  const name = clean(p.teamName);
  return `🔥 **${name}** had a perfect week in **${clean(p.weekLabel)}**. ${p.record}, ${p.pl}${PERFECT_TAG}${clean(p.weekLabel)}|${name}|${p.record}|${p.pl}|${p.teamId}`;
}

/** "+$42.30" / "-$3.10" */
export function signedMoney(n: number): string {
  const v = Math.round(Math.abs(n) * 100) / 100;
  return `${n < 0 ? '-' : '+'}$${v.toFixed(2)}`;
}
