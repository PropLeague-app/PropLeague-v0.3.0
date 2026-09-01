import { useEffect, useMemo } from 'react';
import { useAppStore } from '../store/useAppStore';
import { buildEmptyRoster, rosterKey } from '../engine/rosterSlots';
import { validateLineup } from '../engine/validation';
import { activeMultipliers } from '../engine/prizePool';
import { getGame } from '../services/oddsService';
import { RosterSlotCard } from '../components/roster/RosterSlotCard';
import { BudgetBar } from '../components/common/BudgetBar';
import { BOTTOM_TAB_BAR_HEIGHT } from '../components/layout/BottomTabBar';
import { weekLabel } from '../types';

export function Lineup() {
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const updateWagerStake = useAppStore((s) => s.updateWagerStake);
  const clearSlot = useAppStore((s) => s.clearSlot);
  const submitLineup = useAppStore((s) => s.submitLineup);
  const syncVoidedPicks = useAppStore((s) => s.syncVoidedPicks);
  const loadWeekRosters = useAppStore((s) => s.loadWeekRosters);

  const userTeam = league?.teams.find((t) => t.isUser);

  useEffect(() => {
    if (league && userTeam) syncVoidedPicks(league.id, league.currentWeek);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league?.id, league?.currentWeek]);

  // Refreshes rosters/wagers from Supabase — the source of truth for who's claimed
  // what, since another real teammate could have placed picks from their own device.
  useEffect(() => {
    if (league) loadWeekRosters(league.id, league.currentWeek);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league?.id, league?.currentWeek]);

  const roster = useMemo(() => {
    if (!league || !userTeam) return undefined;
    return (
      league.rostersByTeamWeek[rosterKey(userTeam.id, league.currentWeek)] ??
      buildEmptyRoster(userTeam.id, league.currentWeek, league.settings.lineupSlots)
    );
  }, [league, userTeam]);

  if (!league || !userTeam || !roster) {
    return (
      <div className="p-4 text-center text-text-muted text-sm">Join or create a league to build a lineup.</div>
    );
  }

  const validation = validateLineup(roster, league.settings);
  const multiplier = activeMultipliers(league)[userTeam.id] ?? 1;

  return (
    <div className="flex flex-col">
      <div className="p-4 pb-2 sticky top-0 bg-bg z-10">
        <h1 className="text-xl font-bold">{weekLabel(league.currentWeek)} Lineup</h1>
        <div className="mt-3">
          <BudgetBar allocated={validation.totalAllocated} total={league.settings.weeklyCredits} />
        </div>
      </div>

      <div className="flex flex-col gap-2.5 px-4 pb-32">
        {roster.slots.map((slot) => {
          const game = slot.wager
            ? getGame(slot.wager.gameId, league.currentWeek, league.settings.lineMovementEnabled, league.manualGameOverrides)
            : undefined;
          const locked = !!game && game.status !== 'upcoming';
          const slotValidation = validation.slotResults.find((r) => r.slotId === slot.slotId);
          return (
            <RosterSlotCard
              key={slot.slotId}
              slot={slot}
              game={game}
              validation={slotValidation}
              locked={locked}
              settings={league.settings}
              pool={league.prizePool}
              teamCount={league.teams.length}
              multiplier={multiplier}
              currentWeek={league.currentWeek}
              onStakeChange={(stake) => updateWagerStake(league.id, userTeam.id, league.currentWeek, slot.slotId, stake)}
              onRemove={() => clearSlot(league.id, userTeam.id, league.currentWeek, slot.slotId)}
            />
          );
        })}
      </div>

      <div
        className="fixed w-full max-w-md bg-bg-raised border-t border-border p-3 space-y-2"
        style={{ bottom: BOTTOM_TAB_BAR_HEIGHT }}
      >
        {validation.overallReasons.length === 1 && (
          <p className="text-loss text-xs text-center">{validation.overallReasons[0]}</p>
        )}
        {validation.overallReasons.length > 1 && (
          <p className="text-loss text-xs text-center font-medium">
            {validation.overallReasons.length} issues — see marked slots
          </p>
        )}
        <div className="flex items-center justify-between text-xs text-text-muted px-1">
          <span>Remaining: ${Math.max(0, validation.remaining).toFixed(2)}</span>
          <span>{validation.distinctGames} game(s) used</span>
        </div>
        <button
          disabled={!validation.valid}
          onClick={() => submitLineup(league.id, userTeam.id, league.currentWeek)}
          className="w-full bg-primary text-white font-semibold py-3 rounded-xl disabled:opacity-40"
        >
          {roster.submitted && validation.valid ? 'Lineup Saved ✓' : 'Save Lineup'}
        </button>
      </div>
    </div>
  );
}