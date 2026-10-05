/**
 * Tiny inline markup for announcement text. Announcements are plain strings in the
 * database, so a notice can highlight a name or de-emphasize a note without a
 * schema change:
 *
 *   **text**  -> highlighted (bold); **text|KC** tints it in that NFL team's color
 *   *text*    -> italic
 *
 * Anything that does not form a complete pair stays as literal text, so a stray
 * asterisk in a commissioner's message never breaks the line.
 */
export type RichSegment = { text: string; style: 'plain' | 'highlight' | 'italic'; /** NFL team code from a **Name|KC** highlight. */ team?: string };

export function parseRichText(input: string): RichSegment[] {
  const out: RichSegment[] = [];
  const re = /\*\*([^*]+?)\*\*|\*([^*]+?)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    if (m.index > last) out.push({ text: input.slice(last, m.index), style: 'plain' });
    if (m[1] !== undefined) {
      // **Name|KC** carries an NFL team so the highlight can wear that team's color.
      const tagged = /^(.*?)\|([A-Z]{2,3})$/.exec(m[1]);
      out.push(tagged ? { text: tagged[1], style: 'highlight', team: tagged[2] } : { text: m[1], style: 'highlight' });
    }
    else out.push({ text: m[2], style: 'italic' });
    last = m.index + m[0].length;
  }
  if (last < input.length) out.push({ text: input.slice(last), style: 'plain' });
  return out.length > 0 ? out : [{ text: input, style: 'plain' }];
}

/** Max pinned announcements per league at one time (enforced server-side too). */
export const MAX_PINNED_ANNOUNCEMENTS = 3;

export function pinnedAnnouncementCount(items: { type: string; pinned?: boolean }[]): number {
  return items.filter((i) => i.type === 'announcement' && i.pinned).length;
}
