import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import * as leagueService from '../../services/leagueService';
import { createRealLeague } from '../../services/supabaseLeague';
import { TEAM_LOGO_COLORS, abbrevFromName } from '../../data/simulatedTeamNames';
import { Toggle } from '../../components/common/Toggle';
import { NumberInput } from '../../components/common/NumberInput';
import { doubleEliminationAvailable, fieldSizeOptionsForTeamCount } from '../../engine/playoffs';
import { conferencesEligible, defaultConferences } from '../../engine/conferences';
import { goBack } from '../../components/layout/BackHeader';
import type { PlayoffFieldSize } from '../../types';

export function CreateLeague() {
  const navigate = useNavigate();
  const profile = useAppStore((s) => s.profile);
  const addLeague = useAppStore((s) => s.addLeague);

  const defaultName = `${profile?.username ?? 'Your'}'s League`;
  const [name, setName] = useState(defaultName);
  const [teamCount, setTeamCount] = useState(10);
  const [isPublic, setIsPublic] = useState(false);
  const [weeklyCredits, setWeeklyCredits] = useState(100);
  const [playoffTeams, setPlayoffTeams] = useState<PlayoffFieldSize>(4);
  const [elimination, setElimination] = useState<'single' | 'double'>('single');
  const [conferencesEnabled, setConferencesEnabled] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [fieldSizeNotice, setFieldSizeNotice] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fieldSizeOptions = fieldSizeOptionsForTeamCount(teamCount);

  // manual v0.2.0 §2 #3: react dynamically as the team-count slider moves — a shrunk
  // league can invalidate the currently-selected playoff field, so fall back to the
  // nearest still-valid option with a brief notice instead of leaving an invalid
  // selection in place.
  useEffect(() => {
    if (fieldSizeOptions.includes(playoffTeams)) return;
    const fallback = fieldSizeOptions[fieldSizeOptions.length - 1];
    setPlayoffTeams(fallback);
    if (!doubleEliminationAvailable(fallback)) setElimination('single');
    setFieldSizeNotice(`Playoff field reduced to ${fallback} teams to fit your league size.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamCount]);

  useEffect(() => {
    if (!conferencesEligible(teamCount)) setConferencesEnabled(false);
  }, [teamCount]);

  async function submit() {
    if (name.trim() === '') {
      setNameError('League name is required.');
      return;
    }
    setSubmitError(null);
    setSubmitting(true);

    const teamName = `${profile?.username ?? 'My'}'s Team`;
    const teamAbbrev = abbrevFromName(teamName);
    const userLogoColor = TEAM_LOGO_COLORS[0];
    const useConferences = conferencesEnabled && conferencesEligible(teamCount);

    const result = await createRealLeague({
      name: name.trim(),
      targetTeamCount: teamCount,
      isPublic,
      userTeamName: teamName,
      userTeamAbbrev: teamAbbrev,
      userLogoColor,
    });
    setSubmitting(false);
    if (!result.ok) {
      setSubmitError(result.error);
      return;
    }

    const league = leagueService.createLeague({
      id: result.leagueId,
      inviteCode: result.inviteCode,
      userTeamId: result.teamId,
      name: name.trim(),
      teamCount,
      isPublic,
      settingsOverrides: {
        weeklyCredits,
        playoffTeams,
        eliminationType: elimination,
        conferencesEnabled: useConferences,
        ...(useConferences ? { conferences: defaultConferences(2) } : {}),
      },
      userTeamName: teamName,
      userTeamAbbrev: teamAbbrev,
      userLogoColor,
    });
    addLeague(league);
    navigate(`/create-league/invite/${result.leagueId}`);
  }

  return (
    <div className="min-h-screen bg-bg flex justify-center">
      <div className="w-full max-w-md min-h-screen flex flex-col px-6 py-8 gap-5 border-x border-border">
        {profile && (
          <button
            onClick={() => goBack(navigate, '/settings')}
            className="text-text-muted flex items-center gap-0.5 -ml-1 -mb-2 self-start"
          >
            <span className="text-xl leading-none">‹</span>
            <span className="text-sm">Back</span>
          </button>
        )}
        <h1 className="text-2xl font-bold">Create a League</h1>

        <div>
          <label className="text-sm text-text-muted mb-1 block">League name</label>
          <input
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (nameError) setNameError(null);
            }}
            className={`w-full bg-bg-card border rounded-lg px-3 py-2.5 ${nameError ? 'border-loss' : 'border-border'}`}
          />
          {nameError && <p className="text-loss text-xs mt-1">{nameError}</p>}
        </div>

        <div>
          <label className="text-sm text-text-muted mb-1 block">Team count: {teamCount}</label>
          <input
            type="range"
            min={4}
            max={32}
            value={teamCount}
            onChange={(e) => setTeamCount(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-xs text-text-muted">
            <span>4</span>
            <span>32</span>
          </div>
        </div>

        <div className="flex items-center justify-between bg-bg-card border border-border rounded-lg px-3 py-3">
          <div>
            <p className="font-medium text-sm">Private league</p>
            <p className="text-xs text-text-muted">Public leagues are cosmetic-only — there's no league directory in this demo</p>
          </div>
          <Toggle value={!isPublic} onChange={(v) => setIsPublic(!v)} />
        </div>

        <div className="flex items-center justify-between bg-bg-card border border-border rounded-lg px-3 py-3">
          <div>
            <p className="font-medium text-sm">Conferences</p>
            <p className="text-xs text-text-muted">
              {conferencesEligible(teamCount)
                ? 'Splits the league into East/West for standings and seeding.'
                : 'Needs an even team count — adjust the slider above to enable.'}
            </p>
          </div>
          <Toggle value={conferencesEnabled} onChange={setConferencesEnabled} disabled={!conferencesEligible(teamCount)} />
        </div>

        <div className="bg-bg-card border border-border rounded-lg p-3 space-y-4">
          <p className="font-semibold text-sm">Commissioner basics</p>
          <div>
            <label className="text-xs text-text-muted mb-1 block">Weekly credit allocation</label>
            <NumberInput
              value={weeklyCredits}
              onChange={setWeeklyCredits}
              min={1}
              className="w-full bg-bg-raised border border-border rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-text-muted mb-1 block">Playoff teams</label>
            <div className="flex gap-1.5">
              {fieldSizeOptions.map((n) => (
                <button
                  key={n}
                  onClick={() => {
                    setPlayoffTeams(n);
                    if (!doubleEliminationAvailable(n)) setElimination('single');
                    setFieldSizeNotice(null);
                  }}
                  className={`flex-1 py-2 rounded-lg text-sm border ${
                    playoffTeams === n ? 'border-primary text-primary bg-primary/10' : 'border-border'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            {playoffTeams === 16 && (
              <p className="text-[11px] text-text-muted mt-1">16-team playoffs start Round 1 during NFL Week 18.</p>
            )}
            {fieldSizeNotice && <p className="text-[11px] text-accent mt-1">{fieldSizeNotice}</p>}
          </div>
          <div>
            <label className="text-xs text-text-muted mb-1 block">Elimination structure</label>
            <div className="flex gap-2">
              {(['single', 'double'] as const).map((type) => {
                const disabled = type === 'double' && !doubleEliminationAvailable(playoffTeams);
                return (
                  <button
                    key={type}
                    onClick={() => setElimination(type)}
                    disabled={disabled}
                    className={`flex-1 py-2 rounded-lg text-sm border capitalize disabled:opacity-30 ${
                      elimination === type ? 'border-primary text-primary bg-primary/10' : 'border-border'
                    }`}
                  >
                    {type}
                  </button>
                );
              })}
            </div>
            {elimination === 'double' && (
              <p className="text-[11px] text-text-muted mt-1">
                Double-elim uses extra weeks before WC/DIV/CONF — the regular season shortens to fit.
              </p>
            )}
          </div>
        </div>

        {submitError && <p className="text-loss text-sm">{submitError}</p>}
        <button
          onClick={submit}
          disabled={submitting}
          className="w-full bg-primary text-white font-semibold py-3.5 rounded-xl mt-2 disabled:opacity-40"
        >
          {submitting ? 'Creating…' : 'Continue'}
        </button>
      </div>
    </div>
  );
}
