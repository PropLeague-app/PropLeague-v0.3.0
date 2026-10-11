import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import type { League, LeagueSettings } from '../../types';
import { useAppStore } from '../../store/useAppStore';
import { applyNowImpact } from '../../engine/applyNow';
import { APPLY_NOW_KEYS, describePendingKeys } from '../../engine/settingsRules';
import { TeamLogo } from '../common/TeamLogo';
import { SOFT_PRIMARY_BTN } from '../common/buttonStyles';

/**
 * "Apply now" for scheduled changes that only affect new picks (1.2.11). Lists the current week's picks
 * that would be outside the new rules (names when picks are visible, counts when they are hidden); those
 * picks stay as they are, the new rules apply to new picks and edits.
 */
export function ApplyNowSheet({
  league,
  pending,
  onClose,
}: {
  league: League;
  pending: Partial<LeagueSettings>;
  onClose: () => void;
}) {
  const apply = useAppStore((s) => s.applyPendingSettingsNow);
  const loadWeekRosters = useAppStore((s) => s.loadWeekRosters);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void loadWeekRosters(league.id, league.currentWeek);
  }, [league.id, league.currentWeek, loadWeekRosters]);

  const keys = APPLY_NOW_KEYS.filter((k) => k in pending);
  const later = Object.keys(pending).filter((k) => !(APPLY_NOW_KEYS as readonly string[]).includes(k));
  const next = { ...league.settings, ...Object.fromEntries(keys.map((k) => [k, pending[k]])) } as LeagueSettings;
  const viewer = league.teams.find((t) => t.isUser)?.id ?? null;
  const impact = useMemo(() => applyNowImpact(league, next, viewer), [league, next, viewer]);
  const byTeam = new Map<string, typeof impact>();
  for (const row of impact) byTeam.set(row.teamId, [...(byTeam.get(row.teamId) ?? []), row]);

  async function go() {
    setSaving(true);
    setError(null);
    const res = await apply(league.id, keys);
    setSaving(false);
    if (res.ok) onClose();
    else setError(res.error ?? 'Could not apply these changes.');
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-md max-h-[85dvh] overflow-y-auto bg-bg-raised border-t border-border rounded-t-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 space-y-3" style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}>
          <div className="flex justify-between items-start gap-3">
            <div className="min-w-0">
              <p className="font-bold leading-tight">Apply now</p>
              <p className="text-xs text-text-muted mt-0.5">{describePendingKeys(keys)}</p>
            </div>
            <button onClick={onClose} aria-label="Close" className="text-text-muted -mr-1 p-1 shrink-0">
              <X size={20} />
            </button>
          </div>
          <p className="text-xs text-text-muted">
            Picks already made stay as they are. The new rules apply to new picks and edits.
            {later.length > 0 && ` ${describePendingKeys(later as never)} still start next week.`}
          </p>
          {impact.length === 0 ? (
            <p className="text-xs text-text">No current picks are affected.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-text">Picks now outside the new rules</p>
              {[...byTeam].map(([teamId, rows]) => {
                const team = league.teams.find((t) => t.id === teamId);
                if (!team) return null;
                const hidden = rows.filter((r) => r.pick == null).length;
                return (
                  <div key={teamId} className="rounded-lg bg-bg-card border border-border px-2.5 py-2 space-y-1">
                    <p className="flex items-center gap-1.5 text-xs font-semibold">
                      <TeamLogo team={team} size="xs" /> {team.teamName}
                    </p>
                    {rows
                      .filter((r) => r.pick != null)
                      .map((r, i) => (
                        <p key={i} className="text-[11px] text-text-muted">
                          {r.pick}: <span className="text-loss">{r.reason}</span>
                        </p>
                      ))}
                    {hidden > 0 && <p className="text-[11px] text-text-muted">{hidden} hidden pick{hidden === 1 ? '' : 's'} affected</p>}
                  </div>
                );
              })}
            </div>
          )}
          {error && <p className="text-xs text-loss">{error}</p>}
          <button type="button" disabled={saving || keys.length === 0} onClick={() => void go()} className={`w-full h-12 rounded-xl text-base font-semibold ${SOFT_PRIMARY_BTN}`}>
            {saving ? 'Applying…' : 'Apply now'}
          </button>
        </div>
      </div>
    </div>
  );
}
