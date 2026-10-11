import type { League, LeagueSettings, Wager } from '../types';
import { validateLineup } from './validation';
import { activeMarketRules, isBlockRule } from './marketRules';
import { rosterKey } from './rosterSlots';
import { MARKET_LABELS } from '../data/propsGenerator';

export interface ApplyNowImpact {
  teamId: string;
  /** The pick ("Jakobi Meyers Over 18.5"), or null when it is hidden from the commissioner. */
  pick: string | null;
  reason: string;
}

function pickLabel(w: Wager): string {
  const point = w.point == null ? '' : ` ${w.marketKey === 'spreads' && w.point > 0 ? '+' : ''}${w.point}`;
  const who = w.playerName ?? '';
  const market = MARKET_LABELS[w.marketKey] ?? w.marketKey;
  return `${who}${who ? ' ' : ''}${w.side}${point} · ${market}`.trim();
}

/**
 * The current week's picks that would be outside the rules if scheduled changes were applied now
 * (1.2.11 "Apply now"). Existing picks stay as they are; this list is so the commissioner (and the
 * league, through the news post) knows who is affected. Only problems the change itself adds are listed.
 * A pick still hidden under hide-picks is named only for its own team.
 */
export function applyNowImpact(league: League, next: LeagueSettings, viewerTeamId: string | null): ApplyNowImpact[] {
  const out: ApplyNowImpact[] = [];
  const week = league.currentWeek;
  const oldRules = activeMarketRules(league.settings);
  const newRules = activeMarketRules(next);
  const ruleProblem = (rules: typeof newRules, w: Wager): string | null => {
    const rule = rules.find((r) => r.market === w.marketKey && (r.side == null || r.side === w.side));
    if (!rule) return null;
    if (isBlockRule(rule)) return 'Market now blocked';
    if (rule.maxStake != null && w.stake > rule.maxStake + 1e-9) return `Over the $${rule.maxStake.toFixed(2)} cap for this market`;
    return null;
  };
  for (const team of league.teams) {
    const roster = league.rostersByTeamWeek[rosterKey(team.id, week)];
    if (!roster) continue;
    const before = validateLineup(roster, league.settings);
    const after = validateLineup(roster, next);
    for (const slot of roster.slots) {
      const w = slot.wager;
      if (!w) continue;
      const was = new Set(before.slotResults.find((r) => r.slotId === slot.slotId)?.reasons ?? []);
      const reasons = (after.slotResults.find((r) => r.slotId === slot.slotId)?.reasons ?? []).filter((r) => !was.has(r));
      const market = ruleProblem(newRules, w);
      if (market && market !== ruleProblem(oldRules, w)) reasons.push(market);
      if (reasons.length === 0) continue;
      const hidden = league.settings.hidePicks && team.id !== viewerTeamId && w.status === 'pending';
      for (const reason of reasons) out.push({ teamId: team.id, pick: hidden ? null : pickLabel(w), reason });
    }
  }
  return out;
}
