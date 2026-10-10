import { useEffect, useState } from 'react';
import { Bell, BellOff, SlidersHorizontal, Star, X } from 'lucide-react';
import type { League } from '../../types';
import { weekLabel } from '../../types';
import { LeagueLogo } from '../common/LeagueLogo';
import { buildEmptyRoster, rosterKey } from '../../engine/rosterSlots';
import { validateLineup } from '../../engine/validation';
import { useAuthStore } from '../../store/useAuthStore';
import { LeagueNotificationsSheet } from './LeagueNotificationsSheet';
import {
  DEFAULT_NOTIFICATION_PREFS,
  applyLeagueChoicesToAll,
  applyLeagueOverride,
  applyLeaguePrefChange,
  leagueHasOverrides,
  updatePrefsWith,
  type LeagueNotifType,
  fetchNotificationPrefs,
  getCachedNotificationPrefs,
  updateLeaguePref,
  type LeaguePrefChange,
  type NotificationPrefs,
} from '../../services/notificationPrefs';
import { syncLiveActivities } from '../../services/liveActivities';

/** Standard fantasy-app pattern: tap the league name/logo in the home header to swap
 * `currentLeagueId` (manual v0.2.0 §6 #13). Only lists leagues the user is still
 * actually a member of — a league they've left (manual §6 #12) keeps existing for its
 * remaining (now all-simulated) teams, but stops showing up here since `isUser` no
 * longer matches any team in it. Each row's attention badge reuses the same
 * validateLineup the Lineup screen itself runs, so "needs a lineup" always means the
 * same thing everywhere.
 *
 * Each row also carries per-league notification controls, saved in the person's notification
 * prefs: a star (the favorite leads the Dynamic Island and lock screen), a bell (muted leagues send
 * no pushes and no Live Activities) and sliders, which open League notifications to set each kind
 * of alert for that league alone (see LeagueNotificationsSheet). */
export function LeagueSwitcherSheet({
  leagues,
  currentLeagueId,
  onSwitch,
  onClose,
}: {
  leagues: League[];
  currentLeagueId: string | null;
  onSwitch: (leagueId: string) => void;
  onClose: () => void;
}) {
  const profileId = useAuthStore((s) => s.profile?.id);
  const [prefs, setPrefs] = useState<NotificationPrefs>(() => getCachedNotificationPrefs(profileId) ?? DEFAULT_NOTIFICATION_PREFS);
  const [error, setError] = useState<string | null>(null);
  const [notifLeagueId, setNotifLeagueId] = useState<string | null>(null);

  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    void fetchNotificationPrefs(profileId).then((p) => {
      if (!cancelled) setPrefs(p);
    });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  function changeLeaguePref(leagueId: string, change: LeaguePrefChange) {
    if (!profileId) return;
    const previous = prefs;
    setError(null);
    setPrefs(applyLeaguePrefChange(prefs, leagueId, change)); // optimistic, reverted below if the save fails
    void updateLeaguePref(profileId, leagueId, change).then((result) => {
      if (!result.ok) {
        console.error('[league-switcher] failed to save league preference:', result.error);
        setPrefs(previous);
        setError('Could not save that. Try again.');
        return;
      }
      setPrefs(result.prefs);
      void syncLiveActivities(true); // move the island's front league right away
    });
  }

  /** Saves a League notifications change: optimistic, reverted if the save fails. */
  function changePrefsWith(change: (p: NotificationPrefs) => NotificationPrefs) {
    if (!profileId) return;
    const previous = prefs;
    setError(null);
    setPrefs(change(prefs));
    void updatePrefsWith(profileId, change).then((result) => {
      if (!result.ok) {
        console.error('[league-switcher] failed to save league notifications:', result.error);
        setPrefs(previous);
        setError('Could not save that. Try again.');
        return;
      }
      setPrefs(result.prefs);
      void syncLiveActivities(true); // start or end this league's live scores right away
    });
  }

  const notifLeague = notifLeagueId ? leagues.find((l) => l.id === notifLeagueId) : undefined;
  const notifUserTeam = notifLeague?.teams.find((t) => t.isUser);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-md bg-bg-raised border-t border-border rounded-t-2xl p-4 space-y-3 max-h-[80vh] overflow-y-auto"
        style={{ paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-bold">Your Leagues</h2>
          <button onClick={onClose} aria-label="Close" className="text-text-muted -mr-1 p-1">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-2">
          {leagues.map((league) => {
            const userTeam = league.teams.find((t) => t.isUser);
            const isCurrent = league.id === currentLeagueId;
            const isFavorite = prefs.favoriteLeagueId === league.id;
            const isMuted = prefs.mutedLeagueIds.includes(league.id);
            let needsLineup = false;
            if (userTeam && league.seasonPhase !== 'complete') {
              const roster =
                league.rostersByTeamWeek[rosterKey(userTeam.id, league.currentWeek)] ??
                buildEmptyRoster(userTeam.id, league.currentWeek, league.settings.lineupSlots);
              needsLineup = !validateLineup(roster, league.settings).valid;
            }
            return (
              <div
                key={league.id}
                className={`w-full flex items-center rounded-xl border ${
                  isCurrent ? 'border-primary bg-primary/10' : 'border-border bg-bg-card'
                }`}
              >
                <button
                  onClick={() => onSwitch(league.id)}
                  className={`min-w-0 flex-1 flex items-center gap-3 pl-3 py-2.5 text-left ${isMuted ? 'opacity-60' : ''}`}
                >
                  <LeagueLogo league={league} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{league.name}</p>
                    <p className="text-[11px] text-text-muted">
                      {weekLabel(league.currentWeek)} · {league.teams.length} teams
                      {league.seasonPhase === 'complete' ? ' · Season complete' : ''}
                    </p>
                    {/* Always the same height, so a row does not change size when its pills come and go. */}
                    <div className="flex items-center gap-1.5 mt-1 min-h-[20px]">
                      {isCurrent && <span className="text-[10px] text-primary font-semibold">CURRENT</span>}
                      {!isCurrent && needsLineup && (
                        <span className="text-[10px] text-loss font-semibold bg-loss/10 border border-loss/40 rounded-full px-2 py-0.5">
                          Lineup needed
                        </span>
                      )}
                      {isMuted && (
                        <span className="text-[10px] text-text-muted font-semibold border border-border rounded-full px-2 py-0.5">
                          Muted
                        </span>
                      )}
                      {!isMuted && leagueHasOverrides(prefs, league.id) && (
                        <span className="text-[10px] text-text-muted font-semibold border border-border rounded-full px-2 py-0.5">
                          Custom alerts
                        </span>
                      )}
                    </div>
                  </div>
                </button>
                <div className="flex items-center shrink-0 pr-1">
                  <button
                    onClick={() => changeLeaguePref(league.id, { favorite: !isFavorite })}
                    aria-label={isFavorite ? `Unfavorite ${league.name}` : `Favorite ${league.name}`}
                    aria-pressed={isFavorite}
                    className={`py-2 pl-2 pr-1 ${isFavorite ? 'text-gold' : 'text-text-muted'}`}
                  >
                    <Star size={15} fill={isFavorite ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    onClick={() => changeLeaguePref(league.id, { muted: !isMuted })}
                    aria-label={isMuted ? `Unmute ${league.name}` : `Mute ${league.name}`}
                    aria-pressed={isMuted}
                    className={`py-2 px-1 ${isMuted ? 'text-loss' : 'text-text-muted'}`}
                  >
                    {isMuted ? <BellOff size={15} /> : <Bell size={15} />}
                  </button>
                  <button
                    onClick={() => setNotifLeagueId(league.id)}
                    aria-label={`Notifications for ${league.name}`}
                    className="py-2 pl-1 pr-2 text-text-muted"
                  >
                    <SlidersHorizontal size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-text-muted">
          Star a league to show it first on your lock screen and Dynamic Island. Mute one to stop all of its notifications and live scores. Tap the sliders to pick which alerts a league sends.
        </p>
        {error && <p className="text-[11px] text-loss">{error}</p>}
      </div>
      {notifLeague && (
        <LeagueNotificationsSheet
          league={notifLeague}
          prefs={prefs}
          isCommissioner={!!notifUserTeam && notifUserTeam.id === notifLeague.commissionerTeamId}
          onMute={(muted) => changeLeaguePref(notifLeague.id, { muted })}
          onSet={(type: LeagueNotifType, value: boolean) => changePrefsWith((p) => applyLeagueOverride(p, notifLeague.id, type, value))}
          onApplyToAll={() => changePrefsWith((p) => applyLeagueChoicesToAll(p, notifLeague.id))}
          onClose={() => setNotifLeagueId(null)}
        />
      )}
    </div>
  );
}
