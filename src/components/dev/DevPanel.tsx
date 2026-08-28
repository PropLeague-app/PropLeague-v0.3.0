import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../../store/useAppStore';
import { APP_VERSION, weekLabel, type DaySlot } from '../../types';
import { NumberInput } from '../common/NumberInput';
import { ToggleRow } from '../common/Toggle';

const DAY_SLOTS: { value: DaySlot; label: string }[] = [
  { value: 'TNF', label: 'Thu' },
  { value: 'SUN_EARLY', label: 'Sun early' },
  { value: 'SUN_LATE', label: 'Sun late' },
  { value: 'SNF', label: 'SNF' },
  { value: 'MNF', label: 'MNF' },
];

export function DevPanel() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [targetWeek, setTargetWeek] = useState(18);
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const advanceWeek = useAppStore((s) => s.advanceWeek);
  const simulateToWeek = useAppStore((s) => s.simulateToWeek);
  const resetSeason = useAppStore((s) => s.resetSeason);
  const factoryReset = useAppStore((s) => s.factoryReset);
  const simulateDay = useAppStore((s) => s.simulateDay);
  const autoFillUserLineup = useAppStore((s) => s.autoFillUserLineup);
  const updateSettings = useAppStore((s) => s.updateSettings);

  if (!league) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-[calc(50%-14rem+0.75rem)] z-50 bg-accent text-white text-xs font-bold px-3 py-2 rounded-full shadow-lg"
        style={{ right: 'max(1rem, calc(50% - 14rem))' }}
      >
        DEV
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-md bg-bg-raised border-t border-border rounded-t-2xl p-4 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-sm">Dev / Demo Panel <span className="text-text-muted font-normal">v{APP_VERSION}</span></h3>
              <button onClick={() => setOpen(false)} className="text-text-muted text-sm">
                Close
              </button>
            </div>
            <p className="text-xs text-text-muted">
              {league.name} — currently {weekLabel(league.currentWeek)} · {league.seasonPhase}
            </p>
            {/* manual v0.2.0 §6 #14: every simulation action below only ever touches
                this one currently-viewed league (its own week/roster/activity state) —
                other leagues you belong to are completely untouched, including ones
                sitting on a different week. This is a dev-mode convenience only; real
                NFL weeks would advance every league at once. */}
            <p className="text-[11px] text-accent">Every action below affects only {league.name} — other leagues are untouched.</p>

            <button
              onClick={() => advanceWeek(league.id)}
              disabled={league.seasonPhase === 'complete'}
              className="w-full bg-primary text-white font-semibold py-2.5 rounded-lg disabled:opacity-40"
            >
              Advance Week ({league.name})
            </button>

            <button
              onClick={() => autoFillUserLineup(league.id)}
              disabled={league.seasonPhase === 'complete'}
              className="w-full bg-bg-card border border-border font-semibold py-2.5 rounded-lg disabled:opacity-40"
            >
              Auto-fill my lineup ({weekLabel(league.currentWeek)}, {league.name})
            </button>

            {league.seasonPhase !== 'complete' && (
              <div>
                <p className="text-[11px] text-text-muted mb-1.5">
                  Simulate day for {league.name} (reveals scores early — doesn't settle bets, that still needs Advance Week)
                </p>
                <div className="flex gap-1.5 flex-wrap">
                  {DAY_SLOTS.map((d) => (
                    <button
                      key={d.value}
                      onClick={() => simulateDay(league.id, d.value)}
                      className="bg-bg-card border border-border font-medium py-1.5 px-2.5 rounded-lg text-xs"
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <ToggleRow
              label="Auto-fill my lineups when simulating"
              value={league.settings.autoFillUserLineupsWhenSimulating}
              onChange={(v) => updateSettings(league.id, { autoFillUserLineupsWhenSimulating: v })}
              note="Applies to multi-week jumps below, not a single Advance Week."
            />

            <div className="flex gap-2">
              <NumberInput
                min={1}
                max={18}
                value={targetWeek}
                onChange={setTargetWeek}
                className="w-20 bg-bg-card border border-border rounded-lg px-2 py-2 text-sm"
              />
              <button
                onClick={() => simulateToWeek(league.id, targetWeek)}
                className="flex-1 bg-bg-card border border-border font-semibold py-2 rounded-lg text-sm"
              >
                Simulate {league.name} to Week {targetWeek}
              </button>
            </div>

            <div>
              <button
                onClick={() => {
                  if (confirm(`Reset ${league.name} back to Week 1?`)) resetSeason(league.id);
                }}
                className="w-full bg-loss/10 text-loss border border-loss/40 font-semibold py-2.5 rounded-lg"
              >
                Reset Season ({league.name})
              </button>
              <p className="text-[11px] text-text-muted mt-1 px-1">
                Rewinds only {league.name} to Week 1 — keeps your profile, every other league, and this league's members.
              </p>
            </div>

            <div>
              <button
                onClick={() => {
                  if (confirm('Factory reset wipes your profile, every league, and all settings, then returns you to onboarding. This cannot be undone. Continue?')) {
                    factoryReset();
                    navigate('/welcome');
                  }
                }}
                className="w-full bg-loss/10 text-loss border border-loss/40 font-semibold py-2.5 rounded-lg"
              >
                Factory Reset
              </button>
              <p className="text-[11px] text-text-muted mt-1 px-1">
                Wipes everything (profile, leagues, settings) and returns to the Welcome screen.
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
