// The feed post for a perfect week (written by settle-week, drawn as its own gold card by the
// activity feed). It rides in an ordinary announcement: a readable sentence first, then a short tag
// with the details the card needs, so an older app build still shows something sensible.
//   🔥 **Team** had a perfect week in **Week 5**. 6-0-1, +$42.30::pw::Week 5|Team|6-0-1|+$42.30|<teamId>
export const PERFECT_TAG = '::pw::';

export interface PerfectWeekPost {
  weekLabel: string;
  teamName: string;
  /** Wins-losses-pushes (voids count as pushes). A perfect week always has 0 losses. */
  record: string;
  /** Signed dollars, e.g. "+$42.30". */
  pl: string;
  teamId: string;
}

const clean = (s: string) => s.replace(/[*|]/g, '').replace(/::pw::/g, '');

export function encodePerfectWeek(p: PerfectWeekPost): string {
  const name = clean(p.teamName);
  return `🔥 **${name}** had a perfect week in **${clean(p.weekLabel)}**. ${p.record}, ${p.pl}${PERFECT_TAG}${clean(p.weekLabel)}|${name}|${p.record}|${p.pl}|${p.teamId}`;
}

export function parsePerfectWeek(message: string): PerfectWeekPost | null {
  const i = message.indexOf(PERFECT_TAG);
  if (i < 0) return null;
  const [weekLabel, teamName, record, pl, teamId] = message.slice(i + PERFECT_TAG.length).split('|');
  if (!weekLabel || !teamName || !record || !pl || !teamId) return null;
  return { weekLabel, teamName, record, pl, teamId };
}
