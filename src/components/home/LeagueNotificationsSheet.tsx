import type { ReactNode } from 'react';
import { BellOff, BellRing, CalendarCheck, CircleCheck, Radio, UserX, X } from 'lucide-react';
import type { League } from '../../types';
import { LeagueLogo } from '../common/LeagueLogo';
import { ToggleRow } from '../common/Toggle';
import { SOFT_PRIMARY_BTN } from '../common/buttonStyles';
import {
  GLOBAL_NOTIF_TYPES,
  leagueHasOverrides,
  notificationAllowed,
  type GlobalNotifType,
  type LeagueNotifType,
  type NotificationPrefs,
} from '../../services/notificationPrefs';

const ROWS: { type: GlobalNotifType; label: string; icon: ReactNode }[] = [
  { type: 'lineupReminders', label: 'Lineup reminders', icon: <BellRing size={15} /> },
  { type: 'wagerSettled', label: 'Settled-bet alerts', icon: <CircleCheck size={15} /> },
  { type: 'weekResults', label: 'Week results', icon: <CalendarCheck size={15} /> },
  { type: 'liveActivities', label: 'Live scores on lock screen', icon: <Radio size={15} /> },
];

/**
 * One league's notification choices, opened from the sliders button on its row in the league
 * switcher. Every switch shows what this league actually gets. A league follows the Notifications
 * switches in Profile & Settings until one is changed here, and only the differences are saved.
 * Void requests are always per league and only shown to that league's commissioner.
 */
export function LeagueNotificationsSheet({
  league,
  prefs,
  isCommissioner,
  onMute,
  onSet,
  onApplyToAll,
  onClose,
}: {
  league: League;
  prefs: NotificationPrefs;
  isCommissioner: boolean;
  onMute: (muted: boolean) => void;
  onSet: (type: LeagueNotifType, value: boolean) => void;
  onApplyToAll: () => void;
  onClose: () => void;
}) {
  const muted = prefs.mutedLeagueIds.includes(league.id);
  const custom = leagueHasOverrides(prefs, league.id);
  const differsFromDefault = (type: GlobalNotifType) => {
    const own = prefs.leagueOverrides[league.id]?.[type];
    return typeof own === 'boolean' && own !== (prefs[type] !== false);
  };
  // "Use for all" only means something when this league has a choice the others do not.
  const canApplyToAll = !muted && GLOBAL_NOTIF_TYPES.some((t) => differsFromDefault(t));

  return (
    // Opens on top of the league switcher, so a tap outside closes only this sheet, not both.
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="w-full max-w-md bg-bg-raised border-t border-border rounded-t-2xl p-4 space-y-3 max-h-[85vh] overflow-y-auto"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <LeagueLogo league={league} size="md" />
            <div className="min-w-0">
              <h2 className="text-base font-bold leading-tight">League notifications</h2>
              <p className="text-[11px] text-text-muted truncate">{league.name}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-text-muted -mr-1 p-1 shrink-0">
            <X size={20} />
          </button>
        </div>

        <div className="bg-bg-card border border-border rounded-xl p-3">
          <ToggleRow
            icon={<BellOff size={15} />}
            label="Mute this league"
            note="No pushes and no live scores from this league."
            value={muted}
            onChange={onMute}
          />
        </div>

        <div className={`bg-bg-card border border-border rounded-xl p-3 space-y-3 transition-opacity ${muted ? 'opacity-50' : ''}`}>
          {ROWS.map((row) => (
            <ToggleRow
              key={row.type}
              icon={row.icon}
              label={row.label}
              note={differsFromDefault(row.type) ? 'Only this league' : undefined}
              value={notificationAllowed(prefs, league.id, row.type)}
              disabled={muted}
              onChange={(v) => onSet(row.type, v)}
            />
          ))}
          {isCommissioner && (
            <ToggleRow
              icon={<UserX size={15} />}
              label="Void requests"
              note="When a member asks you to void a player. Commissioner only."
              value={notificationAllowed(prefs, league.id, 'voidRequests')}
              disabled={muted}
              onChange={(v) => onSet('voidRequests', v)}
            />
          )}
        </div>

        <button
          type="button"
          disabled={!canApplyToAll}
          onClick={onApplyToAll}
          className={`w-full h-11 rounded-xl text-sm font-semibold ${SOFT_PRIMARY_BTN}`}
        >
          Use these for all my leagues
        </button>
        <p className="text-[11px] text-text-muted">
          {custom
            ? 'Switches marked "Only this league" differ from your defaults in Profile & Settings. Use these for all my leagues makes them your defaults everywhere. Void requests stay per league.'
            : 'This league follows your Notifications defaults in Profile & Settings. Change a switch here to set it for this league only.'}
        </p>
      </div>
    </div>
  );
}
