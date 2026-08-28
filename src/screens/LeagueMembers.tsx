import { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useUIStore } from '../store/useUIStore';
import { conferencesBalanced } from '../engine/conferences';
import { Card } from '../components/common/Card';
import { BackHeader } from '../components/layout/BackHeader';
import { TeamLogo } from '../components/common/TeamLogo';

/** manual v0.2.1 §4 #4: conference reassignment used to commit straight to the store
 * on every tap, with no check that the result was still balanced — nothing stopped a
 * commissioner from moving every team into one conference one click at a time. Moves
 * now buffer in a local draft; Save only commits once the whole draft is checked with
 * conferencesBalanced (engine/conferences.ts), and reassignment locks entirely once
 * the season has begun (week 1 settled) rather than staying open indefinitely. */
export function LeagueMembers() {
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const setTeamConference = useAppStore((s) => s.setTeamConference);

  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const setHasUnsavedChanges = useUIStore((s) => s.setHasUnsavedChanges);

  const conferencesOn = !!league && league.settings.conferencesEnabled && league.settings.conferences.length > 0;
  const seasonStarted = !league || typeof league.currentWeek !== 'number' || league.currentWeek > 1;

  const draftFor = (teamId: string) => draft?.[teamId] ?? league?.teams.find((t) => t.id === teamId)?.conferenceId ?? null;
  const dirty = !!league && draft != null && league.teams.some((t) => draftFor(t.id) !== t.conferenceId);

  useEffect(() => {
    setHasUnsavedChanges(dirty);
  }, [dirty, setHasUnsavedChanges]);
  useEffect(() => () => setHasUnsavedChanges(false), [setHasUnsavedChanges]);

  if (!league) return null;
  const currentLeague = league;

  function pick(teamId: string, conferenceId: string) {
    setError(null);
    setDraft((d) => ({ ...(d ?? Object.fromEntries(currentLeague.teams.map((t) => [t.id, t.conferenceId ?? '']))), [teamId]: conferenceId }));
  }

  function save() {
    if (!draft) return;
    const proposed = currentLeague.teams.map((t) => ({ conferenceId: draftFor(t.id) }));
    if (!conferencesBalanced(proposed, currentLeague.settings.conferences)) {
      const perConf = Math.floor(currentLeague.teams.length / currentLeague.settings.conferences.length);
      setError(`Conferences must stay equal size (${perConf} each) — adjust before saving.`);
      return;
    }
    for (const t of currentLeague.teams) {
      const next = draftFor(t.id);
      if (next && next !== t.conferenceId) setTeamConference(currentLeague.id, t.id, next);
    }
    setDraft(null);
    setError(null);
  }

  function discard() {
    setDraft(null);
    setError(null);
  }

  return (
    <div className="flex flex-col">
      <BackHeader title="League Members" fallback="/home" />
      <div className="p-4 space-y-3">
      <p className="text-xs text-text-muted">{league.teams.length} teams · Invite code {league.inviteCode}</p>
      {conferencesOn && seasonStarted && (
        <p className="text-[11px] text-text-muted bg-bg-card border border-border rounded-lg px-3 py-2">
          Conference assignments are locked — the season has begun.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2.5">
        {league.teams.map((team) => {
          const standing = league.standings.find((s) => s.teamId === team.id);
          return (
            <Card key={team.id} className="flex flex-col items-center text-center gap-1.5 py-4">
              <TeamLogo team={team} size="lg" />
              <p className="text-sm font-semibold truncate max-w-full">{team.teamName}</p>
              <p className="text-[11px] text-text-muted">{team.ownerName}</p>
              {standing && (
                <p className="text-xs text-text-muted">
                  {standing.wins}-{standing.losses}
                  {standing.ties ? `-${standing.ties}` : ''}
                </p>
              )}
              {team.id === league.commissionerTeamId && (
                <span className="text-[10px] text-accent font-semibold">COMMISSIONER</span>
              )}
              {conferencesOn && (
                <div className="flex gap-1 flex-wrap justify-center">
                  {league.settings.conferences.map((conf) => (
                    <button
                      key={conf.id}
                      disabled={seasonStarted}
                      onClick={() => pick(team.id, conf.id)}
                      className={`text-[10px] px-1.5 py-0.5 rounded-full border disabled:opacity-40 ${
                        draftFor(team.id) === conf.id ? 'border-primary text-primary bg-primary/10' : 'border-border text-text-muted'
                      }`}
                    >
                      {conf.name}
                    </button>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
      {conferencesOn && !seasonStarted && dirty && (
        <div className="sticky bottom-2 bg-bg-raised border border-border rounded-xl p-3 space-y-2">
          {error && <p className="text-loss text-xs">{error}</p>}
          <div className="flex gap-2">
            <button onClick={discard} className="flex-1 bg-bg-card border border-border font-semibold py-2 rounded-lg text-sm">
              Discard
            </button>
            <button onClick={save} className="flex-1 bg-primary text-white font-semibold py-2 rounded-lg text-sm">
              Save Changes
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
