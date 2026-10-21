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
  const minGames = settings.minGamesPerRoster ?? 1;
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

export type LineupState = 'incomplete' | 'blocked' | 'ready';

export interface LineupStatus {
  state: LineupState;
  /** The glyph the status bar shows for this state. */
  mark: '!' | '✕' | '✓';
  /** One short line naming what is wrong, or '' when nothing is. The counts live in the status bar's
   *  own figures, so this says only what those figures cannot. */
  note: string;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** What the lineup footer says, as three states rather than a button.
 *
 * The old footer was a "Mark Lineup Complete" button, which made waiving the unspent-credits
 * penalty into something you had to remember to tap. Hole In Won carried eight picks from one game
 * into settlement partly because nothing on the screen ever said the lineup was wrong, it just
 * offered a button that did nothing (see chat, Oct 2026).
 *
 * The three states are deliberately not "valid / invalid". They separate unfinished from stuck:
 *
 *  - `!` incomplete. Nothing is wrong, there is simply more to do. Slots still open with credits
 *    still to spend.
 *  - `✕` blocked. One axis is finished and the other is not, so you cannot get to a legal lineup by
 *    carrying on. Every slot filled with credits left over, or every credit spent with slots still
 *    empty, means something already placed has to change. A broken rule (a stake under the minimum,
 *    a duplicate player, too few games) reads the same way.
 *  - `✓` ready. Full, in budget, every rule met.
 *
 * Reaching `✓` is what marks the lineup complete, so the state is the whole interaction and there is
 * nothing left to press.
 */
export function lineupStatus(
  roster: WeeklyRoster,
  settings: LeagueSettings,
  validation: LineupValidationResult,
): LineupStatus {
  const total = roster.slots.length;
  const filled = roster.slots.filter((s) => s.wager).length;
  const empty = total - filled;
  const over = validation.remaining < -0.001;
  const left = validation.remaining > 0.001;
  const credits = `$${settings.weeklyCredits.toFixed(2)}`;
  const minGames = settings.minGamesPerRoster ?? 1;
  // An empty slot's only complaint is that it is empty, which is unfinished work rather than a
  // broken rule. Reading the slot reasons rather than a fixed list of rule names means a rule added
  // later lands here on its own.
  const ruleReason = validation.slotResults
    .find((r) => !r.valid && r.reasons.some((x) => x !== 'Empty slot'))
    ?.reasons.find((x) => x !== 'Empty slot');

  if (validation.valid) return { state: 'ready', mark: '✓', note: '' };
  if (ruleReason) return { state: 'blocked', mark: '✕', note: ruleReason };
  if (filled > 0 && validation.distinctGames < minGames) {
    return { state: 'blocked', mark: '✕', note: `Needs picks from ${minGames}+ different games` };
  }
  if (over) {
    return { state: 'blocked', mark: '✕', note: `$${Math.abs(validation.remaining).toFixed(2)} over budget` };
  }
  if (empty === 0 && left) {
    return { state: 'blocked', mark: '✕', note: `Every slot filled, $${validation.remaining.toFixed(2)} unspent` };
  }
  if (empty > 0 && !left) {
    return {
      state: 'blocked',
      mark: '✕',
      note: `All ${credits} allocated, ${empty} ${plural(empty, 'slot', 'slots')} still empty`,
    };
  }
  return { state: 'incomplete', mark: '!', note: '' };
}

/** Would putting this pick in this slot leave a lineup that can never meet the game-diversity rule?
 *
 * The rule is a property of the finished lineup, so it can only be judged at the moment the last
 * empty slot is filled: up to then another game could still arrive. That is exactly when this
 * fires, and it is why the check reads "after this pick, how many slots are still open" rather than
 * counting games as you go.
 *
 * Returns the reason to refuse, or null to allow. Refusing at placement is deliberate: the rule
 * used to be checked only when a lineup was submitted, so anyone who never tapped the button could
 * carry an illegal lineup into settlement untouched (see chat, Oct 2026). A rule that cannot be
 * broken needs no penalty attached to it.
 *
 * `supabase/migrations/0041_place_wager_game_diversity.sql` is the same rule inside place_wager,
 * which is what actually enforces it. This copy is here so the bet slip can grey the button out and
 * say why, instead of letting someone tap it and bounce off the server.
 */
export function gameDiversityBlock(
  roster: WeeklyRoster,
  settings: LeagueSettings,
  slotId: string,
  gameId: string,
): string | null {
  const minGames = settings.minGamesPerRoster ?? 1;
  if (minGames <= 1) return null;

  const games = new Set<string>();
  let openAfter = 0;
  for (const slot of roster.slots) {
    if (slot.slotId === slotId) {
      games.add(gameId);
      continue;
    }
    if (slot.wager) games.add(slot.wager.gameId);
    else openAfter += 1;
  }
  // Every remaining open slot could still bring a new game, so there is only a problem when even
  // the best case falls short.
  if (games.size + openAfter >= minGames) return null;
  return `Your lineup would be left on ${games.size} game${games.size === 1 ? '' : 's'}. This league needs picks from at least ${minGames} different games.`;
}
