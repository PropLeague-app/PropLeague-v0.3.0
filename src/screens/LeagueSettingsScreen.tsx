import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { useUIStore } from '../store/useUIStore';
import { BackHeader, goBack } from '../components/layout/BackHeader';
import { HowItWorksSheet } from '../components/common/HowItWorksSheet';
import { ConfirmSheet } from '../components/common/ConfirmSheet';
import { LeagueSettingsPanel } from '../components/settings/LeagueSettingsPanel';
import { HelpContext } from '../components/settings/SettingsPrimitives';

/** Every league-wide setting on its own page (opened from the League section of Profile & Settings).
 * The commissioner edits; everyone else reads. Leaving with an unsaved league logo asks first. */
export function LeagueSettingsScreen() {
  const navigate = useNavigate();
  const profile = useAppStore((s) => s.profile);
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const refreshLeagueSettings = useAppStore((s) => s.refreshLeagueSettings);
  const setHasUnsavedChanges = useUIStore((s) => s.setHasUnsavedChanges);
  const [identityDirty, setIdentityDirty] = useState(false);
  const [helpFocus, setHelpFocus] = useState<{ category: string; topic: string } | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  const userTeam = league?.teams.find((t) => t.isUser);
  const isCommissioner = !!league && !!userTeam && userTeam.id === league.commissionerTeamId;

  // Members read the commissioner's settings and the commissioner needs the current lock and
  // scheduled-changes state, so refetch both when the page opens (same as Profile & Settings does).
  const leagueId = league?.id;
  useEffect(() => {
    if (!leagueId) return;
    void refreshLeagueSettings(leagueId);
  }, [leagueId, refreshLeagueSettings]);

  // Drives the bottom tab bar's discard confirm, and is reset on leave as a safety net.
  useEffect(() => {
    setHasUnsavedChanges(identityDirty);
  }, [identityDirty, setHasUnsavedChanges]);
  useEffect(() => () => setHasUnsavedChanges(false), [setHasUnsavedChanges]);

  function back() {
    if (identityDirty) {
      setConfirmLeave(true);
      return;
    }
    goBack(navigate, '/settings');
  }

  return (
    <HelpContext.Provider value={(category, topic) => setHelpFocus({ category, topic })}>
      <BackHeader title="League Settings" fallback="/settings" onBack={back} />
      <div className="px-4 pt-3 pb-5">
        {league ? (
          <LeagueSettingsPanel
            league={league}
            isCommissioner={isCommissioner}
            defaultLeagueName={`${profile?.username ?? 'Commissioner'}'s League`}
            onIdentityDirtyChange={setIdentityDirty}
            showHeader={false}
          />
        ) : (
          <p className="text-sm text-text-muted">Join or create a league to see its settings.</p>
        )}
      </div>
      {helpFocus && league && <HowItWorksSheet settings={league.settings} focus={helpFocus} onClose={() => setHelpFocus(null)} />}
      {confirmLeave && (
        <ConfirmSheet
          title="Discard unsaved changes?"
          description="You have changes that have not been saved. Leaving this screen will discard them."
          confirmLabel="Discard"
          onConfirm={async () => {
            setHasUnsavedChanges(false);
            goBack(navigate, '/settings');
          }}
          onClose={() => setConfirmLeave(false)}
        />
      )}
    </HelpContext.Provider>
  );
}
