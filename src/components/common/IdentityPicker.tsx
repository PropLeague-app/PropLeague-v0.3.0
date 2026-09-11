import { useEffect, useRef, useState } from 'react';
import type { LogoIdentity, TeamLogoMode } from '../../types';
import { EMOJI_CATEGORIES, searchEmojis } from '../../data/emojiPicker';
import { processLogoFile, LOGO_MAX_BYTES } from '../../engine/imageUpload';
import { IdentityBadge, type LogoSize } from './TeamLogo';
import { ColorPicker } from './ColorPicker';

const MODES: TeamLogoMode[] = ['emoji', 'initials', 'image'];
const MODE_LABELS: Record<TeamLogoMode, string> = { emoji: 'Emoji', initials: 'Initials', image: 'Image' };

/** Curated 12-color subset of TEAM_LOGO_COLORS (which stays the full 28 -- still used
 * as-is for auto-assigning simulated teams distinct colors) for the quick-pick row
 * under the color-wheel picker (see chat: "limit the dot options ... to just 1 row of
 * some of the main colors"). One evenly-spaced stop around the hue wheel plus a
 * neutral, rather than several near-duplicate shades of the same hue. */
const TEAM_LOGO_COLOR_PRESETS = [
  '#EF4444',
  '#F97316',
  '#EAB308',
  '#84CC16',
  '#22C55E',
  '#14B8A6',
  '#06B6D4',
  '#3B82F6',
  '#6366F1',
  '#A855F7',
  '#EC4899',
  '#64748B',
] as const;

function sameIdentity(a: LogoIdentity, b: LogoIdentity): boolean {
  return a.logoMode === b.logoMode && a.logoEmoji === b.logoEmoji && a.logoColor === b.logoColor && a.logoDataUrl === b.logoDataUrl;
}

/** manual v0.2.1 §2 #1: `value` is typed as `LogoIdentity` but callers actually pass a
 * much bigger object (the whole League or LeagueTeam) — TypeScript's structural typing
 * doesn't strip the extra fields at runtime, so without this explicit pick, `draft`
 * silently captured the entire stale object at mount and `onSave(draft)` wrote all of
 * it back, clobbering settings/name/teamName with whatever they were when this editor
 * happened to mount. Picking only the 4 real fields here is what makes `onSave` a true
 * partial patch. */
export function pickIdentity(value: LogoIdentity): LogoIdentity {
  return { logoMode: value.logoMode, logoEmoji: value.logoEmoji, logoColor: value.logoColor, logoDataUrl: value.logoDataUrl };
}

/** Shared three-mode identity editor (manual v0.1.1 §2) — used for both team identity
 * and the league logo (§2 #3: "reuse the same picker component"). Renamed modes
 * ("Emoji / Initials / Image", §2 #2), a big categorized+searchable emoji set with the
 * same color-picker interaction as initials mode (§2 #1/#2), and an explicit Save
 * Changes flow with an unsaved-changes indicator (§2 #4) — nothing commits until Save
 * is tapped, unlike every other setting in this app which saves on every interaction.
 */
export function IdentityPicker({
  title,
  value,
  initials,
  previewSize = 'lg',
  colorLabel = 'Background color',
  onSave,
  onDirtyChange,
}: {
  title: string;
  value: LogoIdentity;
  initials: string;
  previewSize?: LogoSize;
  /** Label over the color section below — "Background color" everywhere by default
   * (it sits behind the emoji/initials badge), but the team-identity caller passes
   * "Team color" instead, since for a team this same value now also colors that
   * team's side of the win-probability bar on the matchup board (see chat) —
   * true regardless of which of the three logo modes is active, Image included. */
  colorLabel?: string;
  /** `file` is the raw image file staged this session (null unless the user just
   * picked a new image and hasn't saved yet) — the caller uploads it to Storage on
   * save; this component only handles the local compressed-preview side. */
  onSave: (next: LogoIdentity, file: File | null) => void;
  /** Reported on every draft change so a parent can drive a global "leaving with
   * unsaved changes" confirm (manual v0.1.1 §2 #4) — this component only handles the
   * in-page Save Changes button itself. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [draft, setDraft] = useState<LogoIdentity>(() => pickIdentity(value));
  const [emojiCategory, setEmojiCategory] = useState(EMOJI_CATEGORIES[0].id);
  const [emojiSearch, setEmojiSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const baseline = pickIdentity(value);
  const dirty = !sameIdentity(draft, baseline);
  useEffect(() => {
    onDirtyChange?.(dirty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  function update(partial: Partial<LogoIdentity>) {
    setDraft((d) => ({ ...d, ...partial }));
  }

  async function handleFile(file: File) {
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.');
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await processLogoFile(file);
      if (dataUrl.length > LOGO_MAX_BYTES * 1.37) {
        setError(`That image is still over ~${Math.round(LOGO_MAX_BYTES / 1024)}KB after compression — try a simpler image.`);
        return;
      }
      update({ logoDataUrl: dataUrl, logoMode: 'image' });
      setPendingFile(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not process that image.');
    } finally {
      setBusy(false);
    }
  }

  const emojiResults = emojiSearch.trim() ? searchEmojis(emojiSearch) : EMOJI_CATEGORIES.find((c) => c.id === emojiCategory)!.emojis;

  return (
    <div className="bg-bg-card border border-border rounded-xl p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-text-muted">{title}</p>
        {dirty && <span className="text-[10px] text-accent font-semibold">Unsaved changes</span>}
      </div>

      <div className="flex items-center gap-3">
        <IdentityBadge identity={draft} initials={initials} size={previewSize} />
        <div className="flex bg-bg-raised rounded-lg overflow-hidden flex-1">
          {MODES.map((mode) => (
            <button
              key={mode}
              onClick={() => update({ logoMode: mode })}
              className={`flex-1 py-1.5 text-xs font-semibold ${draft.logoMode === mode ? 'bg-primary text-white' : 'text-text-muted'}`}
            >
              {MODE_LABELS[mode]}
            </button>
          ))}
        </div>
      </div>

      {draft.logoMode === 'emoji' && (
        <div className="space-y-2">
          <input
            value={emojiSearch}
            onChange={(e) => setEmojiSearch(e.target.value)}
            placeholder="Search emoji…"
            className="w-full bg-bg-raised border border-border rounded-lg px-3 py-1.5 text-sm"
          />
          {!emojiSearch.trim() && (
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {EMOJI_CATEGORIES.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setEmojiCategory(cat.id)}
                  className={`shrink-0 px-2.5 py-1 rounded-lg text-xs font-medium border ${
                    emojiCategory === cat.id ? 'border-primary text-primary bg-primary/10' : 'border-border text-text-muted'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          )}
          {/* No per-cell box/border anymore -- with the full emoji set (see chat:
              "add most/all of the emoji options ... more compact") a bordered tile
              per glyph made the grid feel heavy and wasted space that could go to
              more columns. Selection is now just a filled rounded highlight behind
              the glyph, and the grid runs 8-wide instead of 6 with a taller scroll
              area, since there's a lot more to browse per category now. */}
          <div className="grid grid-cols-8 gap-1 max-h-64 overflow-y-auto">
            {emojiResults.length === 0 && <p className="col-span-8 text-xs text-text-muted text-center py-3">No matches.</p>}
            {emojiResults.map(({ char }) => (
              <button
                key={char}
                onClick={() => update({ logoEmoji: char })}
                className={`text-xl aspect-square rounded-md flex items-center justify-center ${
                  draft.logoEmoji === char ? 'bg-primary/20' : ''
                }`}
              >
                {char}
              </button>
            ))}
          </div>
        </div>
      )}

      {draft.logoMode === 'image' && (
        <div>
          <div className="flex items-center gap-3">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) handleFile(file);
              }}
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 border border-dashed border-border rounded-lg px-3 py-2.5 text-xs text-text-muted cursor-pointer text-center"
            >
              {busy ? 'Processing…' : 'Tap or drag an image here'}
            </div>
            {draft.logoDataUrl && (
              <button
                onClick={() => {
                  update({ logoDataUrl: null });
                  setPendingFile(null);
                }}
                className="text-xs text-text-muted"
              >
                Remove
              </button>
            )}
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = '';
            }}
          />
          {error && <p className="text-[11px] text-loss mt-1">{error}</p>}
          <p className="text-[11px] text-text-muted mt-1">Cropped to a 256×256 square, capped around 150KB.</p>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-[11px] text-text-muted">{colorLabel}</p>
        <ColorPicker value={draft.logoColor} onChange={(color) => update({ logoColor: color })} />
        {/* A grid (not the old flex-wrap row) so all 12 presets stretch to fill the
            full width evenly — flex-wrap left the last row short and noticeably
            off-center (see chat). */}
        <div className="grid grid-cols-12 gap-1.5 pt-0.5">
          {TEAM_LOGO_COLOR_PRESETS.map((color) => (
            <button
              key={color}
              onClick={() => update({ logoColor: color })}
              className={`aspect-square w-full rounded-full border-2 ${draft.logoColor === color ? 'border-white' : 'border-transparent'}`}
              style={{ backgroundColor: color }}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1 border-t border-border">
        <button
          disabled={!dirty}
          onClick={() => {
            onSave(draft, pendingFile);
            setPendingFile(null);
          }}
          className="flex-1 bg-primary text-white font-semibold py-2 rounded-lg text-sm disabled:opacity-40"
        >
          Save Changes
        </button>
        {dirty && (
          <button
            onClick={() => {
              setDraft(baseline);
              setPendingFile(null);
            }}
            className="text-xs text-text-muted px-2"
          >
            Discard
          </button>
        )}
      </div>
    </div>
  );
}