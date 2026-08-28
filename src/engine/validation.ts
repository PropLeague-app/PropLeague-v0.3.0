import type { LeagueSettings, LineupValidationResult, SlotValidation, WeeklyRoster } from '../types';
import { playerById } from '../data/players';
import { findCorrelationViolation } from './duplicatePicks';

/**
 * Pure lineup validation per spec §4/§5.3. Every rule reads from LeagueSettings so
 * commissioner overrides (min/max per slot type, odds floors, cap %) apply automatically.
 */
export function validateLineup(roster: WeeklyRoster, settings: LeagueSettings): LineupValidationResult {
  const slotResults: SlotValidation[] = [];
  const overallReasons: string[] = [];
  let totalAllocated = 0;
  const gameIds = new Set<string>();
  const playerCounts = new Map<string, number>();

  for (const slot of roster.slots) {
    const reasons: string[] = [];
    const wager = slot.wager;

    if (!wager) {
      slotResults.push({ slotId: slot.slotId, valid: false, reasons: ['Empty slot'] });
      continue;
    }

    totalAllocated += wager.stake;
    gameIds.add(wager.gameId);
    if (wager.playerId) {
      playerCounts.set(wager.playerId, (playerCounts.get(wager.playerId) ?? 0) + 1);
    }

    const capAmount = settings.weeklyCredits * settings.singleBetCapPct;
    if (wager.stake < settings.minBetPerSlot) {
      reasons.push(`Below $${settings.minBetPerSlot.toFixed(2)} minimum`);
    }
    if (wager.stake > capAmount) {
      reasons.push(
        `Exceeds ${Math.round(settings.singleBetCapPct * 100)}% single-bet cap ($${capAmount.toFixed(2)})`,
      );
    }

    if (slot.position === 'ML') {
      const max = settings.mlBetOverride?.max ?? settings.maxMLBet;
      if (max != null && wager.stake > max) {
        reasons.push(`Exceeds $${max.toFixed(2)} moneyline/spread max`);
      }
      const minOdds = settings.mlBetOverride?.minOdds ?? null;
      if (minOdds != null && wager.oddsAtPlacement < minOdds) {
        reasons.push(`Below minimum odds of ${minOdds}`);
      }
    } else {
      const max = settings.propBetOverride?.max ?? settings.maxPropBet;
      if (max != null && wager.stake > max) {
        reasons.push(`Exceeds $${max.toFixed(2)} prop max`);
      }
      const minOdds = settings.propBetOverride?.minOdds ?? settings.minOdds;
      if (minOdds != null && wager.oddsAtPlacement < minOdds) {
        reasons.push(`Below minimum odds of ${minOdds}`);
      }
    }

    slotResults.push({ slotId: slot.slotId, valid: reasons.length === 0, reasons });
  }

  const filledCount = roster.slots.filter((s) => s.wager).length;
  const remaining = settings.weeklyCredits - totalAllocated;

  if (filledCount > 0 && Math.abs(remaining) > 0.001) {
    overallReasons.push(
      remaining > 0
        ? `$${remaining.toFixed(2)} unallocated — must use all $${settings.weeklyCredits.toFixed(2)}`
        : `Over budget by $${Math.abs(remaining).toFixed(2)}`,
    );
  }
  // manual v0.1.1 §5 C: commissioner-configurable floor, defaulting to the baseline of 2.
  const minGames = settings.minGamesPerRoster ?? 2;
  if (filledCount > 0 && gameIds.size < minGames) {
    overallReasons.push(`Roster must include props from at least ${minGames} different games`);
  }
  // manual v0.2.0 §3 #6: roster-level violations attributable to specific slots (unlike
  // budget/game-diversity, which are properties of the whole roster) also get pushed
  // into those slots' own `reasons` — this is what lets the Lineup screen mark the
  // offending slot card(s) directly instead of only reporting the issue in aggregate.
  const slotIssues = new Map<string, string[]>();
  function markSlot(slotId: string, reason: string) {
    slotIssues.set(slotId, [...(slotIssues.get(slotId) ?? []), reason]);
  }

  // manual v0.1.1 §5 B: correlated same-team prop stacking, only when the commissioner
  // has turned it on — future-weeks-only like every other setting (this only runs
  // against the roster as currently edited, never retroactively against past weeks).
  if (settings.correlationBlockEnabled) {
    const picks = roster.slots
      .filter((s): s is typeof s & { wager: NonNullable<typeof s.wager> } => !!s.wager)
      .map((s) => ({ slotId: s.slotId, marketKey: s.wager.marketKey, side: s.wager.side, playerId: s.wager.playerId, gameId: s.wager.gameId }));
    const violation = findCorrelationViolation(picks, settings.correlationRules, (id) => {
      try {
        return playerById(id).nflTeamId;
      } catch {
        return undefined;
      }
    });
    if (violation) {
      overallReasons.push(`Correlated picks not allowed: ${violation.rule.label}`);
      for (const slotId of violation.slotIds) markSlot(slotId, `Correlated with another slot: ${violation.rule.label}`);
    }
  }
  for (const [playerId, count] of playerCounts) {
    if (count > 1) {
      const name = (() => {
        try {
          return playerById(playerId).name;
        } catch {
          return playerId;
        }
      })();
      overallReasons.push(`${name} can only be used in one slot per week`);
      for (const slot of roster.slots) {
        if (slot.wager?.playerId === playerId) markSlot(slot.slotId, `${name} is used in another slot this week`);
      }
    }
  }
  if (filledCount < roster.slots.length) {
    overallReasons.push(`${roster.slots.length - filledCount} slot(s) still empty`);
  }

  for (const result of slotResults) {
    const extra = slotIssues.get(result.slotId);
    if (!extra) continue;
    result.reasons.push(...extra);
    result.valid = false;
  }

  const valid =
    filledCount === roster.slots.length &&
    overallReasons.length === 0 &&
    slotResults.every((s) => s.valid);

  return { valid, totalAllocated, remaining, distinctGames: gameIds.size, slotResults, overallReasons };
}
