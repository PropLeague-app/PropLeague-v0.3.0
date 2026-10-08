import { Search, X } from 'lucide-react';

/** The search box above every emoji grid (reaction picker and logo picker share it so they look and
 * behave the same). Has a clear button once something is typed. */
export function EmojiSearchField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <div className="relative">
      <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search emoji…"
        aria-label="Search emoji"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        className="w-full bg-bg-raised border border-border rounded-lg pl-8 pr-8 py-1.5 text-sm"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Clear search"
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 text-text-muted"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
