import { useState, type ReactNode } from 'react';
import { Car, Flag, Flame, Hand, Hash, Lightbulb, PawPrint, Smile, Trophy, Utensils } from 'lucide-react';
import { EMOJI_CATEGORIES } from '../../data/emojiPicker';
import { PICKER_COLUMNS, REACTION_PICKER, gridEmojis } from '../../engine/reactions';

interface Tab {
  id: string;
  label: string;
  /** The line icon on the tab button (never an emoji, so the tabs read as controls, not content). */
  icon: ReactNode;
  emojis: string[];
}

// First tab is the curated short list; the rest are the full emoji categories, the same set team logos use.
const ICON_SIZE = 16;
const ICONS: Record<string, ReactNode> = {
  popular: <Flame size={ICON_SIZE} />,
  sports: <Trophy size={ICON_SIZE} />,
  animals: <PawPrint size={ICON_SIZE} />,
  faces: <Smile size={ICON_SIZE} />,
  people: <Hand size={ICON_SIZE} />,
  food: <Utensils size={ICON_SIZE} />,
  travel: <Car size={ICON_SIZE} />,
  objects: <Lightbulb size={ICON_SIZE} />,
  symbols: <Hash size={ICON_SIZE} />,
  flags: <Flag size={ICON_SIZE} />,
};

const TABS: Tab[] = [
  { id: 'popular', label: 'Popular', icon: ICONS.popular, emojis: REACTION_PICKER },
  ...EMOJI_CATEGORIES.map((c) => ({ id: c.id, label: c.label, icon: ICONS[c.id] ?? <Hash size={ICON_SIZE} />, emojis: c.emojis.map((e) => e.char) })),
];

/** The "+" reaction picker: a row of tiny category buttons over a scrolling emoji grid. */
export function ReactionPicker({ current, onPick }: { current?: string; onPick: (emoji: string) => void }) {
  const [tabId, setTabId] = useState('popular');
  const tab = TABS.find((t) => t.id === tabId) ?? TABS[0];
  const emojis = gridEmojis(tab.emojis);
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5 px-0.5" role="tablist" aria-label="Emoji categories">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tabId}
            aria-label={t.label}
            title={t.label}
            onClick={() => setTabId(t.id)}
            className={`w-7 h-7 shrink-0 rounded-lg flex items-center justify-center ${
              t.id === tabId ? 'seg-active' : 'text-text-muted active:text-text'
            }`}
          >
            {t.icon}
          </button>
        ))}
      </div>
      <div
        className="grid gap-0.5 max-h-52 overflow-y-auto overscroll-contain"
        style={{ gridTemplateColumns: `repeat(${PICKER_COLUMNS}, minmax(0, 1fr))` }}
        key={tab.id}
      >
        {emojis.map((emoji, i) => (
          <button
            key={`${emoji}${i}`}
            type="button"
            onClick={() => onPick(emoji)}
            aria-label={emoji}
            aria-pressed={emoji === current}
            className={`h-[34px] rounded-lg text-xl leading-none flex items-center justify-center ${emoji === current ? 'seg-active' : 'active:bg-bg-card'}`}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
