import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Info } from 'lucide-react';
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
  const [infoOpen, setInfoOpen] = useState(false);
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const updateWagerStake = useAppStore((s) => s.updateWagerStake);
  const clearSlot = useAppStore((s) => s.clearSlot);
  const submitLineup = useAppStore((s) => s.submitLineup);
  const syncVoidedPicks = useAppStore((s) => s.syncVoidedPicks);
  const loadWeekRosters = useAppStore((s) => s.loadWeekRosters);
  const loadRealGame = useAppStore((s) => s.loadRealGame);
  const realGamesById = useAppStore((s) => s.realGamesById);

  const userTeam = league?.teams.find((t) => t.isUser);

  // The bottom footer's height is NOT fixed -- validation.overallReasons can
  // render anywhere from zero lines up to one per distinct issue (budget,
  // min-games, correlation, duplicate player x N, empty slots), each adding a
  // line of text and growing the fixed-position footer. The scrollable slot
  // list below used to reserve a single guessed-at padding value (pb-32) for
  // it, which was only ever right for the zero/one-line case -- with several
  // reasons stacked, the footer grew taller than that guess and covered the
  // last slot(s) in the list (ML is always last, see SLOT_ORDER in
  // rosterSlots.ts), with no amount of scrolling able to clear a `fixed`
  // element. Measuring the footer's real height and using that as the
  // scroll container's padding-bottom fixes it for any number of reasons,
  // not just today's cases.
  const footerRef = useRef<HTMLDivElement>(null);
  const [footerHeight, setFooterHeight] = useState(0);
  useLayoutEffect(() => {
    const el = footerRef.current;
    if (!el) return;
    const measure = () => setFooterHeight(el.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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

  // A wager placed against a real game has a real Odds-API event id, which the
  // local simulated dataset has never heard of — without this, a real wager's
  // game details would silently fail to show at all. Fetches only whichever
  // wagered games aren't already cached from an earlier MarketBrowser visit.
  useEffect(() => {
    if (!roster) return;
    for (const slot of roster.slots) {
      if (slot.wager && !realGamesById[slot.wager.gameId]) loadRealGame(slot.wager.gameId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster]);

  if (!league || !userTeam || !roster) {
    return (
      <div className="p-4 text-center text-text-muted text-sm">Join or create a league to build a lineup.</div>
    );
  }

  const validation = validateLineup(roster, league.settings);
  const multiplier = activeMultipliers(league)[userTeam.id] ?? 1;
  // The top icon doubles as the lineup-issue indicator: red "!" (and the reasons
  // tucked behind it) when something's blocking submission, blue "i" otherwise
  // (see chat: "some of these lineup warnings can also get dropped in a '!' or
  // the 'i' at the top") -- same reveal-on-tap pattern as RosterSlotCard's own
  // "!" badge, just promoted to the header since these are lineup-wide, not
  // per-slot.
  const hasIssues = validation.overallReasons.length > 0;

  return (
    <div className="flex flex-col">
      <div className="px-4 pt-2 pb-2 sticky top-0 bg-bg-raised z-10">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">{weekLabel(league.currentWeek)} Lineup</h1>
          {/* Was two always-visible paragraphs of explainer text (here and in the
              footer below) -- condensed into this single icon + reveal-on-tap panel
              (same "hidden behind a badge until tapped" pattern RosterSlotCard.tsx
              already uses for slot validation reasons) so the screen reads mostly as
              picks + numbers, not prose (see chat). */}
          <button
            onClick={() => setInfoOpen((v) => !v)}
            aria-label={hasIssues ? 'Lineup issues' : 'How this screen works'}
            className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
              hasIssues ? 'bg-loss text-white text-xs font-bold' : 'bg-bg-card border border-border text-primary'
            }`}
          >
            {hasIssues ? '!' : <Info size={13} />}
          </button>
        </div>
        <div className="mt-3">
          <BudgetBar allocated={validation.totalAllocated} total={league.settings.weeklyCredits} />
        </div>
        {infoOpen && (
          <div className="mt-1.5 space-y-1">
            {hasIssues && (
              <div className="space-y-0.5">
                {validation.overallReasons.map((reason) => (
                  <p key={reason} className="text-loss text-[11px]">
                    {reason}
                  </p>
                ))}
              </div>
            )}
            <p className="text-[11px] text-text-muted">
              Picks save instantly, no need to submit. Marking complete just confirms it's full and in
              budget -- left incomplete at kickoff, any unused credits count as a loss.
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2.5 px-4" style={{ paddingBottom: footerHeight + 16 }}>
        {roster.slots.map((slot) => {
          const game = slot.wager
            ? (realGamesById[slot.wager.gameId] ??
              getGame(slot.wager.gameId, league.currentWeek, league.settings.lineMovementEnabled, league.manualGameOverrides))
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
        ref={footerRef}
        className="fixed w-full max-w-md bg-bg-raised border-t border-border p-3 space-y-2"
        style={{ bottom: `calc(${BOTTOM_TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))` }}
      >
        <div className="flex items-center justify-between text-xs text-text-muted px-1">
          <span>Remaining: ${Math.max(0, validation.remaining).toFixed(2)}</span>
          <span>{validation.distinctGames} game(s) used</span>
        </div>
        <button
          disabled={!validation.valid}
          onClick={() => submitLineup(league.id, userTeam.id, league.currentWeek)}
          className="w-full bg-primary text-white font-semibold py-3 rounded-xl disabled:opacity-40"
        >
          {roster.submitted && validation.valid ? 'Lineup Complete ✓' : 'Mark Lineup Complete'}
        </button>
      </div>
    </div>
  );
}