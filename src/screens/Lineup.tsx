import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { buildEmptyRoster, rosterKey } from '../engine/rosterSlots';
import { lineupStatus, validateLineup } from '../engine/validation';
import { rosterPenalties } from '../engine/penalties';
import { computeIncompleteLineupPenalty, lineupUpside } from '../engine/scoring';
import { activeMultipliers } from '../engine/prizePool';
import { getGame } from '../services/oddsService';
import { RosterSlotCard } from '../components/roster/RosterSlotCard';
import { StakeEditSheet } from '../components/roster/StakeEditSheet';
import { activeMarketRules, marketMaxStake } from '../engine/marketRules';
import type { StakeContext } from '../engine/stakeRules';
import { ConfirmSheet } from '../components/common/ConfirmSheet';
import { BudgetBar } from '../components/common/BudgetBar';
import { BOTTOM_TAB_BAR_HEIGHT } from '../components/layout/BottomTabBar';
import { weekLabel } from '../types';

/** The state mark wears the app's own soft button treatment (faint fill, hairline border, bright
 *  tinted glyph) rather than a solid dot, so it reads as part of the same kit as every other action
 *  on screen. The bar around it stays neutral: one tinted element says the state clearly, a whole
 *  glowing bar just shouts (see chat, Oct 2026). */
const MARK_TONE = {
  incomplete: 'btn-soft-warning',
  blocked: 'btn-soft-loss',
  ready: 'btn-soft-profit',
} as const;

/** One figure in the status bar: the number first, its name under it, the way the budget strip at
 *  the top of this screen already stacks them. */
function StatCell({ value, label, tone = '' }: { value: string; label: string; tone?: string }) {
  return (
    <div className="flex-1 min-w-0 text-center">
      <p className={`text-base font-bold tabular-nums leading-none tracking-tight ${tone}`}>{value}</p>
      <p className="text-[9px] font-semibold uppercase tracking-wider text-text-muted mt-1">{label}</p>
    </div>
  );
}

export function Lineup() {
  const [infoOpen, setInfoOpen] = useState(false);
  const [pendingClearSlotId, setPendingClearSlotId] = useState<string | null>(null);
  // The slot whose stake keypad is open.
  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  // Why the server refused a stake edit, per slot; cleared by the next accepted edit.
  const [stakeErrors, setStakeErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Bumped by the Retry affordance, which is the only way a failed auto-mark is tried again.
  const [retryCount, setRetryCount] = useState(0);
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

  // Reaching ✓ is what marks the lineup complete. The screen used to ask for a tap, which made
  // waiving the unspent-credits penalty into something you had to remember: a full, legal, in-budget
  // lineup could carry the penalty into kickoff purely because nobody pressed the button (see chat,
  // Oct 2026). Every edit clears `submitted` on the device and on the server (migrations 0022/0041),
  // so this re-marks on the way back to ✓ rather than only once a week.
  //
  // Keyed on the lineup's own contents, not on a boolean: a failed save must not retry on a loop as
  // the store churns, but the same lineup edited and brought back to ✓ has to be tried again.
  const markedSigRef = useRef<string | null>(null);
  useEffect(() => {
    if (!league || !userTeam || !roster) return;
    if (!validateLineup(roster, league.settings).valid || roster.submitted) return;
    const sig = roster.slots.map((s) => `${s.slotId}:${s.wager?.id ?? ''}:${s.wager?.stake ?? ''}`).join('|');
    if (markedSigRef.current === sig) return;
    markedSigRef.current = sig;
    let cancelled = false;
    setSubmitting(true);
    setSubmitError(null);
    void (async () => {
      const ok = await submitLineup(league.id, userTeam.id, league.currentWeek);
      if (cancelled) return;
      setSubmitting(false);
      if (!ok) setSubmitError('Could not save your lineup as complete. Check your connection.');
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league, userTeam, roster, retryCount]);

  if (!league || !userTeam || !roster) {
    return (
      <div className="p-4 text-center text-text-muted text-sm">Join or create a league to build a lineup.</div>
    );
  }

  const validation = validateLineup(roster, league.settings);
  const multiplier = activeMultipliers(league)[userTeam.id] ?? 1;
  // Keypad editing: the same stake rules as the bet slip, for a pick that is already placed.
  const editingSlot = editingSlotId ? roster.slots.find((sl) => sl.slotId === editingSlotId) : undefined;
  const editStakeCtx: StakeContext = {
    settings: league.settings,
    isMLSlot: editingSlot?.position === 'ML',
    marketMax: editingSlot?.wager
      ? marketMaxStake(activeMarketRules(league.settings), editingSlot.wager.marketKey, editingSlot.wager.side)
      : null,
    otherStakes: roster.slots.reduce((sum, sl) => (sl.slotId === editingSlotId ? sum : sum + (sl.wager?.stake ?? 0)), 0),
    emptyOtherSlots: 0,
    replacing: true,
  };
  // Penalty preview: only shown when a commissioner penalty setting would actually bite, and then
  // it lists everything the week would cost if it locked as is (including the usual unspent credits).
  const penalties = rosterPenalties(roster, league.settings);
  const incompleteLoss = -computeIncompleteLineupPenalty(roster, league.settings);
  const penaltyTotal = incompleteLoss + penalties.invalidStakeLost + penalties.fee;
  const showPenaltyPreview = penalties.floorExtra > 0 || penalties.invalidStakeLost > 0 || penalties.fee > 0;
  // The top icon doubles as the lineup-issue indicator: red "!" (and the reasons
  // tucked behind it) when something's blocking submission, blue "i" otherwise
  // (see chat: "some of these lineup warnings can also get dropped in a '!' or
  // the 'i' at the top") -- same reveal-on-tap pattern as RosterSlotCard's own
  // "!" badge, just promoted to the header since these are lineup-wide, not
  // per-slot.
  const hasIssues = validation.overallReasons.length > 0;
  const status = lineupStatus(roster, league.settings, validation);
  const filledSlots = roster.slots.filter((s) => s.wager).length;
  // The one figure this screen never showed: what the week pays if it all lands. Settled picks count
  // at what they actually returned, so it stays honest as results come in (see engine/scoring.ts).
  const upside = lineupUpside(roster);

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
        <div className="mt-2">
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
              Picks save instantly and the bar at the bottom tracks where the week stands. It marks
              itself complete once the lineup is full, in budget and legal -- left incomplete at
              kickoff, any unused credits count as a loss.
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5 px-4 pt-2.5" style={{ paddingBottom: footerHeight + 16 }}>
        {roster.slots.map((slot) => {
          const game = slot.wager
            ? (realGamesById[slot.wager.gameId] ??
              getGame(slot.wager.gameId, league.currentWeek, league.settings.lineMovementEnabled))
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
              stakeError={stakeErrors[slot.slotId] ?? null}
              onEditStake={() => setEditingSlotId(slot.slotId)}
              editingStake={editingSlotId === slot.slotId}
              onRemove={() => setPendingClearSlotId(slot.slotId)}
            />
          );
        })}
      </div>

      <div
        ref={footerRef}
        className="fixed w-full max-w-md bg-bg-raised border-t border-border p-3 space-y-2"
        style={{ bottom: `calc(${BOTTOM_TAB_BAR_HEIGHT}px + env(safe-area-inset-bottom))` }}
      >
        {showPenaltyPreview && (
          <div className="rounded-lg border border-warning/40 bg-warning/10 px-2.5 py-1.5 space-y-0.5">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span>If it locked now</span>
              <span className="text-loss tabular-nums">-${penaltyTotal.toFixed(2)}</span>
            </div>
            {incompleteLoss > 0 && (
              <p className="text-[11px] text-text-muted">
                Incomplete lineup: -${incompleteLoss.toFixed(2)}
                {penalties.floorExtra > 0 ? ` (includes the $${penalties.floorExtra.toFixed(2)} empty slot minimum)` : ''}
              </p>
            )}
            {penalties.invalidStakeLost > 0 && (
              <p className="text-[11px] text-text-muted">Voided pick{penalties.invalidSlotIds.size > 1 ? 's' : ''}: -${penalties.invalidStakeLost.toFixed(2)} stake</p>
            )}
            {penalties.fee > 0 && <p className="text-[11px] text-text-muted">Roster fee: -${penalties.fee.toFixed(2)}</p>}
            {penalties.reasons.filter((r) => !/empty slot/.test(r)).map((r) => (
              <p key={r} className="text-[11px] text-warning">{r}</p>
            ))}
          </div>
        )}
        {/* Was a "Mark Lineup Complete" button, then a sentence of explanation, which is the one
            thing a footer on a screen of numbers should not be. What belongs here is the week's own
            figures: how much of the lineup is built, how it is spread, and what it stands to win,
            which is the number nothing else on the screen reports. The state itself is a mark, and
            the only prose is the one line saying what is wrong, when something is (see chat, Oct
            2026). The money already lives in the budget strip at the top, so it is not repeated. */}
        <div className="w-full rounded-xl border border-border bg-bg-card px-3 py-2.5">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className={`mark-chip w-10 h-10 rounded-full shrink-0 flex items-center justify-center text-lg leading-none ${MARK_TONE[status.state]}`}
            >
              {status.mark}
            </span>
            <StatCell value={`${filledSlots}/${roster.slots.length}`} label="slots" />
            <div className="w-px self-stretch bg-border" />
            <StatCell value={`${validation.distinctGames}`} label="games" />
            <div className="w-px self-stretch bg-border" />
            <StatCell
              value={`${upside < 0 ? '-' : ''}$${Math.abs(upside).toFixed(2)}`}
              label="to win"
              tone={upside > 0 ? 'text-profit' : upside < 0 ? 'text-loss' : ''}
            />
          </div>
          {(status.note || submitError || submitting) && (
            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-border">
              <p className={`flex-1 min-w-0 text-[11px] leading-snug ${submitError ? 'text-loss' : 'text-text-muted'}`}>
                {submitError ?? (submitting ? 'Saving…' : status.note)}
              </p>
              {submitError && (
                <button
                  onClick={() => {
                    setSubmitError(null);
                    markedSigRef.current = null;
                    setRetryCount((n) => n + 1);
                  }}
                  className="shrink-0 text-xs font-semibold text-primary border border-primary/50 rounded-full px-3 py-1 active:opacity-80"
                >
                  Retry
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {editingSlot?.wager && (
        <StakeEditSheet
          key={editingSlot.slotId}
          wager={editingSlot.wager}
          title={editingSlot.wager.playerName ?? editingSlot.wager.side}
          settings={league.settings}
          stakeCtx={editStakeCtx}
          onClose={() => setEditingSlotId(null)}
          onDone={async (stake) => {
            const slotId = editingSlot.slotId;
            const res = await updateWagerStake(league.id, userTeam.id, league.currentWeek, slotId, stake);
            setStakeErrors((prev) => {
              const next = { ...prev };
              if (res.ok) delete next[slotId];
              else next[slotId] = res.error ?? 'Could not update that stake.';
              return next;
            });
          }}
        />
      )}

      {pendingClearSlotId && (
        <ConfirmSheet
          title="Remove this pick?"
          description="This removes your pick and its locked-in odds from this slot -- you'll need to pick it again at whatever line is live then."
          confirmLabel="Remove Pick"
          confirmingLabel="Removing…"
          onConfirm={() => clearSlot(league.id, userTeam.id, league.currentWeek, pendingClearSlotId)}
          onClose={() => setPendingClearSlotId(null)}
        />
      )}
    </div>
  );
}