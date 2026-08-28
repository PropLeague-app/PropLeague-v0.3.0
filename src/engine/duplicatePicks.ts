import type { CorrelationRule, League, MarketKey, WeekId, WeeklyRoster } from '../types';

export interface PickIdentity {
  gameId: string;
  marketKey: MarketKey;
  playerId?: string;
  side: string;
  point?: number;
}

function samePick(a: PickIdentity, b: PickIdentity): boolean {
  return a.gameId === b.gameId && a.marketKey === b.marketKey && a.playerId === b.playerId && a.side === b.side && a.point === b.point;
}

function pickKey(p: PickIdentity): string {
  return `${p.gameId}|${p.marketKey}|${p.playerId ?? ''}|${p.side}|${p.point ?? ''}`;
}

/** Tracks how many times each pick has been claimed so far *within* a single
 * simulation pass (e.g. while looping over simulated members generating this week's
 * auto-lineups), seeded from whatever's already in the league's stored rosters — so
 * each subsequent team in the loop sees every earlier team's picks too, not just picks
 * from before the loop started. Manual v0.1.1 §5 A replaced the old boolean
 * allowDuplicatePicks with a numeric cap (`maxDuplicatePicks`, null = unlimited) — a
 * pick stays open until `cap` teams already hold it, not just one. */
export class ClaimTracker {
  private counts = new Map<string, number>();
  private readonly cap: number | null;

  constructor(league: League, week: WeekId) {
    this.cap = league.settings.maxDuplicatePicks;
    if (this.cap == null) return;
    for (const roster of Object.values(league.rostersByTeamWeek)) {
      if (roster.week !== week) continue;
      for (const slot of roster.slots) {
        if (!slot.wager) continue;
        const key = pickKey({ gameId: slot.wager.gameId, marketKey: slot.wager.marketKey, playerId: slot.wager.playerId, side: slot.wager.side, point: slot.wager.point });
        this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
      }
    }
  }

  isTaken(gameId: string, marketKey: MarketKey, playerId: string | undefined, side: string, point: number | undefined): boolean {
    if (this.cap == null) return false;
    const key = pickKey({ gameId, marketKey, playerId, side, point });
    return (this.counts.get(key) ?? 0) >= this.cap;
  }

  claim(gameId: string, marketKey: MarketKey, playerId: string | undefined, side: string, point: number | undefined): void {
    if (this.cap == null) return;
    const key = pickKey({ gameId, marketKey, playerId, side, point });
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  /** Registers every wager already in a freshly-generated roster — call right after
   * generateAutoLineup so the next team in the loop respects this team's picks too. */
  claimRoster(roster: WeeklyRoster): void {
    for (const slot of roster.slots) {
      if (!slot.wager) continue;
      this.claim(slot.wager.gameId, slot.wager.marketKey, slot.wager.playerId, slot.wager.side, slot.wager.point);
    }
  }
}

/** Every team that currently holds an exact pick this week, regardless of whether the
 * cap has actually been reached — the shared lookup behind both `findClaimingTeam`
 * (blocked-once-full) and the manual v0.2.0 §3 #4 "N of cap claimed" progress
 * indicator, which needs the holder list even while the pick is still pickable. */
export function claimHolders(league: League, week: WeekId, pick: PickIdentity, excludeTeamId?: string): string[] {
  const holders: string[] = [];
  for (const roster of Object.values(league.rostersByTeamWeek)) {
    if (roster.week !== week || roster.teamId === excludeTeamId) continue;
    for (const slot of roster.slots) {
      if (!slot.wager) continue;
      if (samePick({ gameId: slot.wager.gameId, marketKey: slot.wager.marketKey, playerId: slot.wager.playerId, side: slot.wager.side, point: slot.wager.point }, pick)) {
        holders.push(roster.teamId);
      }
    }
  }
  return holders;
}

/** When `maxDuplicatePicks` caps how many teams may hold a leg (manual v0.1.1 §5 A), a
 * prop claimed by `cap` teams already is off-limits to everyone else that week.
 * Strict first-come-first-served by `placedAt` among the teams that do hold it —
 * contested-pick priority (waiver order vs FCFS) only changes who *keeps* a slot when
 * it's already at capacity, not covered here since capacity is simply counted.
 * Returns one of the claiming teams' ids (for an error message), or null if the pick
 * is still open. */
export function findClaimingTeam(league: League, week: WeekId, pick: PickIdentity, excludeTeamId?: string): string | null {
  const cap = league.settings.maxDuplicatePicks;
  if (cap == null) return null;
  const holders = claimHolders(league, week, pick, excludeTeamId);
  return holders.length >= cap ? holders[0] : null;
}

/** Human-readable block reason for a pick at capacity (manual v0.1.1 §3 #7) — "Claimed
 * by [team]" when the cap is the old exclusive behavior (1), or a generic limit
 * message once more than one team can legitimately hold the same leg. */
export function claimBlockReason(league: League, claimingTeamId: string): string {
  const cap = league.settings.maxDuplicatePicks;
  if (cap === 1) {
    const team = league.teams.find((t) => t.id === claimingTeamId);
    return `Claimed by ${team?.teamName ?? 'another team'}`;
  }
  return `League duplicate limit reached (max ${cap})`;
}

// --- Correlated-picks blocklist (manual v0.1.1 §5 B) ------------------------

interface CorrelationPick {
  slotId: string;
  marketKey: MarketKey;
  side: string;
  playerId?: string;
  gameId: string;
}

function sideMatches(required: CorrelationRule['sideA'], side: string): boolean {
  if (required === 'FavoredTeam') return true; // any team abbrev counts; team-equality is checked via scope
  return side === required;
}

/** The NFL team a pick is "about", for same-team scope matching — the team literally
 * named by an h2h/spreads side (team abbrevs double as team ids in this app's data,
 * see data/nflTeams.ts), or a player prop's own team. */
function teamIdForPick(pick: CorrelationPick, playerTeamId: (playerId: string) => string | undefined): string | null {
  if (pick.marketKey === 'h2h' || pick.marketKey === 'spreads') return pick.side;
  if (pick.playerId) return playerTeamId(pick.playerId) ?? null;
  return null;
}

export interface CorrelationViolation {
  rule: CorrelationRule;
  slotIds: [string, string];
}

/** Checks a full roster's picks against the correlation blocklist, returning the first
 * violated rule plus the two offending slot ids (or null). Pure/injected-lookup like
 * the rest of engine/ — `playerTeamId` lets the caller supply data/players.ts's
 * playerById without this file importing it directly. Symmetric: a rule matches
 * regardless of which of the two picks is "A" or "B" in the roster. The slot ids let
 * callers (manual v0.2.0 §3 #6) mark both involved roster slots, not just report the
 * violation in the aggregate. */
export function findCorrelationViolation(
  picks: CorrelationPick[],
  rules: CorrelationRule[],
  playerTeamId: (playerId: string) => string | undefined,
): CorrelationViolation | null {
  function legMatches(pick: CorrelationPick, market: MarketKey, side: CorrelationRule['sideA']): boolean {
    return pick.marketKey === market && sideMatches(side, pick.side);
  }
  function scopeMatches(a: CorrelationPick, b: CorrelationPick, scope: CorrelationRule['scope']): boolean {
    if (scope === 'same-game') return a.gameId === b.gameId;
    const teamA = teamIdForPick(a, playerTeamId);
    const teamB = teamIdForPick(b, playerTeamId);
    return !!teamA && !!teamB && teamA === teamB;
  }

  for (const rule of rules) {
    for (let i = 0; i < picks.length; i++) {
      for (let j = 0; j < picks.length; j++) {
        if (i === j) continue;
        const a = picks[i];
        const b = picks[j];
        if (!legMatches(a, rule.marketA, rule.sideA)) continue;
        if (!legMatches(b, rule.marketB, rule.sideB)) continue;
        if (!scopeMatches(a, b, rule.scope)) continue;
        return { rule, slotIds: [a.slotId, b.slotId] };
      }
    }
  }
  return null;
}
