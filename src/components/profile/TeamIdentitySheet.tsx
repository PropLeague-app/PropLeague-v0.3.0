import { lazy, Suspense, useState } from 'react';
import type { League, LeagueTeam, LogoIdentity } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { uploadTeamLogo } from '../../services/supabaseLogo';

const IdentityPicker = lazy(() =>
  import('../common/IdentityPicker').then((m) => ({ default: m.IdentityPicker })),
);

/** The logo and colour half of editing your own team. The name and abbreviation are edited in place
 *  in the profile header, so this sheet holds only the parts that need room.
 *
 * Nothing about the writes is new: the logo goes through the same IdentityPicker and the same
 * uploadTeamLogo the Settings screen calls, so there is one write path and the two places cannot
 * drift apart (see chat, Oct 2026).
 *
 * The backdrop is deliberately clear at the top. A colour picker whose result is painted behind the
 * header is useless if the header is sitting under a 60% black scrim: you would be choosing a colour
 * you cannot see take effect. The scrim only deepens behind the sheet itself, where there is nothing
 * to watch. */
export function TeamIdentitySheet({
  league,
  team,
  onClose,
  onDraftChange,
}: {
  league: League;
  team: LeagueTeam;
  onClose: () => void;
  /** Reported while the picker is open so the header above can paint with the unsaved colour. */
  onDraftChange?: (draft: LogoIdentity) => void;
}) {
  const updateUserTeam = useAppStore((s) => s.updateUserTeam);
  const [uploadError, setUploadError] = useState<string | null>(null);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-gradient-to-b from-transparent via-black/15 to-black/45"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md max-h-[70vh] overflow-y-auto bg-bg-raised border-t border-border rounded-t-2xl p-4 space-y-3 shadow-2xl"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start">
          <h2 className="text-base font-bold">Logo and colour</h2>
          <button onClick={onClose} className="text-text-muted text-sm">
            Done
          </button>
        </div>

        <Suspense fallback={<p className="text-xs text-text-muted">Loading…</p>}>
          <IdentityPicker
            key={`team-${team.id}`}
            bare
            title=""
            value={team}
            initials={team.abbrev.slice(0, 2)}
            colorLabel="Team color"
            onDraftChange={onDraftChange}
            onSave={async (next, file) => {
              updateUserTeam(league.id, next);
              if (!file) return;
              setUploadError(null);
              const result = await uploadTeamLogo(team.id, file);
              if (!result.ok) {
                setUploadError(result.error);
                return;
              }
              // Swap the local base64 preview for the real, now-shared public URL.
              updateUserTeam(league.id, { logoDataUrl: result.publicUrl });
            }}
          />
        </Suspense>
        {uploadError && <p className="text-loss text-xs">{uploadError}</p>}
      </div>
    </div>
  );
}
