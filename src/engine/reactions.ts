// Reaction groups for the activity feed: who reacted with what, and how many fit in a row.

/** The four one-tap reactions shown on every card. */
export const QUICK_REACTIONS = ['🔥', '😂', '💀', '👏'];

/** The picker's first tab: the quick four, then sports and trash-talk staples. The other tabs are the
 * full categorized emoji set (src/data/emojiPicker.ts), the same one used for team logos. */
export const REACTION_PICKER: string[] = [
  ...QUICK_REACTIONS,
  '🐐', '🤡', '🥶', '💰', '😭', '🤝', '📉', '📈', '🚀',
  '🎯', '🍀', '😎', '🤯', '😬', '🫡', '🙏', '💪', '👀',
  '🤑', '😤', '🥱', '🤮', '🧊', '☠️', '🏆', '🏈', '💸',
  '🫠', '😈', '🙌', '👎', '❤️',
];

export interface ReactionGroup {
  emoji: string;
  /** Teams that picked this emoji, earliest first. Empty when only a count is known. */
  teamIds: string[];
  count: number;
}

/** Groups an item's reactions, most-used first (ties keep who got there first). `reactors` is emoji to
 * team ids and is the source of truth whenever it is known (even empty). `counts` is the older aggregate
 * cache, used only when `reactors` is missing entirely: that cache can drift from the real rows, and
 * trusting it next to the rows is what produced a phantom second reaction. */
export function reactionGroups(reactors?: Record<string, string[]>, counts?: Record<string, number>): ReactionGroup[] {
  const groups: ReactionGroup[] = [];
  if (reactors) {
    for (const [emoji, teamIds] of Object.entries(reactors)) {
      if (teamIds.length > 0) groups.push({ emoji, teamIds, count: teamIds.length });
    }
  } else {
    for (const [emoji, count] of Object.entries(counts ?? {})) {
      if (count > 0) groups.push({ emoji, teamIds: [], count });
    }
  }
  return groups.sort((a, b) => b.count - a.count);
}

// Layout estimates (px) for the chips, used to decide how many fit before the rest collapse into a stack.
const CHIP_PAD = 10;
const CHIP_EMOJI = 14;
const CHIP_GAP = 3;
const LOGO = 16;
const LOGO_STEP = 10; // logos overlap
const MORE_TEXT = 16;
const COUNT_TEXT = 12;
export const CHIP_ROW_GAP = 4;
export const STACK_WIDTH = 64;
/** Logos shown on one chip before "+n". */
export const CHIP_LOGOS = 2;

export function chipWidth(group: ReactionGroup): number {
  const n = group.teamIds.length;
  if (n === 0) return CHIP_PAD + CHIP_EMOJI + CHIP_GAP + COUNT_TEXT;
  const shown = Math.min(n, CHIP_LOGOS);
  return CHIP_PAD + CHIP_EMOJI + CHIP_GAP + LOGO + LOGO_STEP * (shown - 1) + (n > CHIP_LOGOS ? MORE_TEXT : 0);
}

/** Splits the groups into the chips that fit in `available` px and the rest, which collapse into one stack. */
export function fitChips(groups: ReactionGroup[], available: number): { shown: ReactionGroup[]; overflow: ReactionGroup[] } {
  const total = groups.reduce((sum, g, i) => sum + chipWidth(g) + (i > 0 ? CHIP_ROW_GAP : 0), 0);
  if (total <= available) return { shown: groups, overflow: [] };
  const shown: ReactionGroup[] = [];
  let used = STACK_WIDTH;
  for (const g of groups) {
    const next = used + CHIP_ROW_GAP + chipWidth(g);
    if (next > available) break;
    used = next;
    shown.push(g);
  }
  return { shown, overflow: groups.slice(shown.length) };
}

/** Moves one team's reaction: off whatever it had, onto `emoji` (or just off, when it is the same emoji). */
export function moveReactor(reactors: Record<string, string[]> | undefined, teamId: string, emoji: string): Record<string, string[]> {
  const next: Record<string, string[]> = {};
  let previous: string | undefined;
  for (const [e, ids] of Object.entries(reactors ?? {})) {
    if (ids.includes(teamId)) previous = e;
    const rest = ids.filter((id) => id !== teamId);
    if (rest.length > 0) next[e] = rest;
  }
  if (previous !== emoji) next[emoji] = [...(next[emoji] ?? []), teamId];
  return next;
}

/** Every category in the picker uses the same number of columns, so the grid looks the same on each tab. */
export const PICKER_COLUMNS = 9;

/**
 * The emojis to lay out in the picker grid. If the last row would hold a single emoji, that one is
 * left off the end of the list, so a category never ends on a lonely orphan.
 */
export function gridEmojis<T>(emojis: T[], cols: number = PICKER_COLUMNS): T[] {
  return emojis.length > cols && emojis.length % cols === 1 ? emojis.slice(0, -1) : emojis;
}
