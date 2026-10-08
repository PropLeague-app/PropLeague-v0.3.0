// The feed post for a skunked week (written by settle-week, drawn as its own muted card by the
// activity feed). Same shape as the perfect-week post: a readable sentence first, then a short tag
// with the details the card needs, so an older app build still shows something sensible. The
// sentence pokes fun at the week, never at the person.
//   🦨 **Team** got skunked in **Week 5**. 0-6, -$100.00::sk::Week 5|Team|0-6|-$100.00|<teamId>
export const SKUNKED_TAG = '::sk::';

export interface SkunkedWeekPost {
  weekLabel: string;
  teamName: string;
  /** Wins-losses, e.g. "0-6". A skunked week never has a win. */
  record: string;
  /** Signed dollars, e.g. "-$100.00". */
  pl: string;
  teamId: string;
}

const clean = (s: string) => s.replace(/[*|]/g, '').replace(/::(?:sk|pw)::/g, '');

export function encodeSkunkedWeek(p: SkunkedWeekPost): string {
  const name = clean(p.teamName);
  return `🦨 **${name}** got skunked in **${clean(p.weekLabel)}**. ${p.record}, ${p.pl}${SKUNKED_TAG}${clean(p.weekLabel)}|${name}|${p.record}|${p.pl}|${p.teamId}`;
}

export function parseSkunkedWeek(message: string): SkunkedWeekPost | null {
  const i = message.indexOf(SKUNKED_TAG);
  if (i < 0) return null;
  const [weekLabel, teamName, record, pl, teamId] = message.slice(i + SKUNKED_TAG.length).split('|');
  if (!weekLabel || !teamName || !record || !pl || !teamId) return null;
  return { weekLabel, teamName, record, pl, teamId };
}
