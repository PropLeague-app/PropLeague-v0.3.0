// Roster penalties for settle-week. A port of src/engine/penalties.ts (plus the
// findAllCorrelatedPairs helper in src/engine/duplicatePicks.ts); duplicated rather than imported
// so `supabase functions deploy` does not reach across directories. Keep the two in step.

export interface CorrelationRuleReal {
  marketA: string;
  sideA: string;
  marketB: string;
  sideB: string;
  scope: 'same-team' | 'same-game';
}

export interface PenaltyPickReal {
  slotId: string;
  gameId: string;
  marketKey: string;
  side: string;
  playerId?: string | null;
  stake: number;
  placedAt: string;
}

export interface PenaltySettingsReal {
  weeklyCredits: number;
  lineupSlots: Record<string, number>;
  emptySlotFloor: number | null;
  invalidRosterPenaltyEnabled: boolean;
  invalidRosterFee: number;
  minGamesPerRoster: number | null;
  correlationBlockEnabled: boolean;
  correlationRules: CorrelationRuleReal[];
}

/** A pick's NFL team is the first part of its player id (KC-rashee-rice). */
export function playerTeamFromId(playerId: string): string | undefined {
  const head = playerId.split('-')[0]?.toUpperCase();
  return head && /^[A-Z]{2,3}$/.test(head) ? head : undefined;
}

export function effectiveEmptyFloor(s: Pick<PenaltySettingsReal, 'weeklyCredits' | 'lineupSlots' | 'emptySlotFloor'>): number | null {
  const floor = s.emptySlotFloor;
  if (floor == null || !(floor > 0)) return null;
  const slots = Object.values(s.lineupSlots).reduce((a, b) => a + b, 0);
  if (slots <= 0) return null;
  return Math.min(floor, s.weeklyCredits / slots);
}

function sideMatches(required: string, side: string): boolean {
  if (required === 'FavoredTeam') return true;
  return side === required;
}

function teamIdForPick(p: PenaltyPickReal): string | null {
  if (p.marketKey === 'h2h' || p.marketKey === 'spreads') return p.side;
  if (p.playerId) return playerTeamFromId(p.playerId) ?? null;
  return null;
}

function findAllCorrelatedPairs(picks: PenaltyPickReal[], rules: CorrelationRuleReal[]): [string, string][] {
  const seen = new Set<string>();
  const pairs: [string, string][] = [];
  for (const rule of rules) {
    for (let i = 0; i < picks.length; i++) {
      for (let j = 0; j < picks.length; j++) {
        if (i === j) continue;
        const a = picks[i];
        const b = picks[j];
        if (a.marketKey !== rule.marketA || !sideMatches(rule.sideA, a.side)) continue;
        if (b.marketKey !== rule.marketB || !sideMatches(rule.sideB, b.side)) continue;
        if (rule.scope === 'same-game') {
          if (a.gameId !== b.gameId) continue;
        } else {
          const ta = teamIdForPick(a);
          const tb = teamIdForPick(b);
          if (!ta || !tb || ta !== tb) continue;
        }
        const key = [a.slotId, b.slotId].sort().join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        pairs.push([a.slotId, b.slotId]);
      }
    }
  }
  return pairs;
}

const byPlaced = (a: PenaltyPickReal, b: PenaltyPickReal) =>
  a.placedAt < b.placedAt ? -1 : a.placedAt > b.placedAt ? 1 : a.slotId < b.slotId ? -1 : 1;

export interface RuleCheckReal {
  invalidSlotIds: string[];
  tooFewGames: boolean;
  feeApplies: boolean;
}

export function checkRosterRules(picks: PenaltyPickReal[], s: PenaltySettingsReal): RuleCheckReal {
  const invalid = new Set<string>();
  const bySlot = new Map(picks.map((p) => [p.slotId, p]));

  const byPlayer = new Map<string, PenaltyPickReal[]>();
  for (const p of picks) if (p.playerId) byPlayer.set(p.playerId, [...(byPlayer.get(p.playerId) ?? []), p]);
  for (const group of byPlayer.values()) {
    if (group.length < 2) continue;
    for (const extra of [...group].sort(byPlaced).slice(1)) invalid.add(extra.slotId);
  }

  if (s.correlationBlockEnabled) {
    for (const [a, b] of findAllCorrelatedPairs(picks, s.correlationRules)) {
      const second = [bySlot.get(a)!, bySlot.get(b)!].sort(byPlaced)[1];
      invalid.add(second.slotId);
    }
  }

  const games = new Set(picks.map((p) => p.gameId));
  const need = s.minGamesPerRoster ?? 2;
  const tooFewGames = picks.length > 0 && games.size < need;
  return { invalidSlotIds: [...invalid], tooFewGames, feeApplies: invalid.size > 0 || tooFewGames };
}
