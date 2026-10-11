import type { LeagueSettings, MarketRule } from '../types';
import { MARKET_LABELS } from '../data/propsGenerator';
import { multiplierRangeForSpread } from './prizePool';

// League news for settings changes (1.2.11): one short line per save, only for changes that matter to
// the whole league (money, limits, roster shape, blocked markets, playoff format). Small tweaks such as
// the contested pick order or bet precision are left out.

const money = (n: number | null | undefined) => (n == null ? 'No max' : `$${Number.isInteger(n) ? n : n.toFixed(2)}`);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const week = (w: unknown) => (w === 'WC' ? 'NFL Wild Card' : w === 'DIV' ? 'NFL Divisional' : w === 'CONF' ? 'NFL Conf Championship' : `Week ${String(w)}`);
const BASIS: Record<string, string> = { rank: 'standings', record: 'win-loss', seasonPL: 'season P/L' };

function range(spread: number): string {
  const { top, bottom } = multiplierRangeForSpread(spread);
  return `${top.toFixed(2)}x/${bottom.toFixed(2)}x`;
}

function ruleText(r: MarketRule): string {
  const market = `${MARKET_LABELS[r.market] ?? r.market}${r.side ? ` ${r.side}` : ''}`;
  if (r.maxStake == null && r.maxSlots == null) return `${market} blocked`;
  const parts = [r.maxStake != null ? `max ${money(r.maxStake)}` : null, r.maxSlots != null ? `${r.maxSlots} slots` : null].filter(Boolean);
  return `${market} ${parts.join(', ')}`;
}

function payoutText(splits: number[], topPL: number): string {
  return `${splits.join('/')}${topPL > 0 ? ` + ${topPL}% top P/L` : ''}`;
}

/** The major changes from `before` to `after`, each a few words ("Max prop bet No max → $25"). */
export function majorSettingsChanges(before: LeagueSettings, after: LeagueSettings): string[] {
  const out: string[] = [];
  const b = before;
  const a = after;
  if (a.weeklyCredits !== b.weeklyCredits) out.push(`Weekly credits ${money(b.weeklyCredits)} → ${money(a.weeklyCredits)}`);
  if (!same(a.lineupSlots, b.lineupSlots)) {
    const nb = Object.values(b.lineupSlots).reduce((x, y) => x + y, 0);
    const na = Object.values(a.lineupSlots).reduce((x, y) => x + y, 0);
    out.push(nb === na ? 'Lineup slots changed' : `Lineup ${nb} → ${na} slots`);
  }
  if (a.minBetPerSlot !== b.minBetPerSlot) out.push(`Min bet ${money(b.minBetPerSlot)} → ${money(a.minBetPerSlot)}`);
  if (a.maxMLBet !== b.maxMLBet) out.push(`Max ML/spread bet ${money(b.maxMLBet)} → ${money(a.maxMLBet)}`);
  if (a.maxPropBet !== b.maxPropBet) out.push(`Max prop bet ${money(b.maxPropBet)} → ${money(a.maxPropBet)}`);
  if (a.singleBetCapPct !== b.singleBetCapPct) out.push(`Max on one pick ${Math.round(b.singleBetCapPct * 100)}% → ${Math.round(a.singleBetCapPct * 100)}%`);
  if (a.hidePicks !== b.hidePicks) out.push(a.hidePicks ? 'Picks hidden until kickoff' : 'Picks visible to everyone');

  // Market rules: only blocks and caps that came, went or changed.
  const rulesOf = (s: LeagueSettings) => (s.marketRulesEnabled ? (s.marketRules ?? []) : []);
  const key = (r: MarketRule) => `${r.market}|${r.side ?? ''}`;
  const beforeRules = new Map(rulesOf(b).map((r) => [key(r), r]));
  const afterRules = new Map(rulesOf(a).map((r) => [key(r), r]));
  for (const [k, r] of afterRules) {
    const old = beforeRules.get(k);
    if (!old || !same({ s: old.maxStake, n: old.maxSlots ?? null }, { s: r.maxStake, n: r.maxSlots ?? null })) out.push(ruleText(r));
  }
  for (const [k, r] of beforeRules) if (!afterRules.has(k)) out.push(`${MARKET_LABELS[r.market] ?? r.market}${r.side ? ` ${r.side}` : ''} allowed again`);

  if (a.correlationBlockEnabled !== b.correlationBlockEnabled) out.push(a.correlationBlockEnabled ? 'Correlated picks blocked' : 'Correlated picks allowed');
  if ((a.minGamesPerRoster ?? 2) !== (b.minGamesPerRoster ?? 2)) out.push(`Min games per lineup ${b.minGamesPerRoster ?? 2} → ${a.minGamesPerRoster ?? 2}`);
  if (a.emptySlotFloor !== b.emptySlotFloor) out.push(a.emptySlotFloor == null ? 'Empty slot penalty off' : `Empty slot penalty ${money(a.emptySlotFloor)}`);
  if (a.invalidRosterPenaltyEnabled !== b.invalidRosterPenaltyEnabled || (a.invalidRosterPenaltyEnabled && a.invalidRosterFee !== b.invalidRosterFee)) {
    out.push(a.invalidRosterPenaltyEnabled ? `Invalid roster fee ${money(a.invalidRosterFee)}` : 'Invalid roster fee off');
  }

  // Prize pool.
  if (a.buyInEnabled !== b.buyInEnabled) out.push(a.buyInEnabled ? `Buy-ins on (${money(a.buyInAmount)})` : 'Buy-ins off');
  else if (a.buyInEnabled && a.buyInAmount !== b.buyInAmount) out.push(`Buy-in ${money(b.buyInAmount)} → ${money(a.buyInAmount)}`);
  if (a.buyInEnabled) {
    const pa = a.poolMultipliers;
    const pb = b.poolMultipliers;
    if (pa.enabled !== pb.enabled) out.push(pa.enabled ? `Standing multipliers on (${range(pa.spread)})` : 'Standing multipliers off');
    else if (pa.enabled) {
      if (Math.abs(pa.spread - pb.spread) > 0.0001) out.push(`Multipliers ${range(pb.spread)} → ${range(pa.spread)}`);
      if (pa.basis !== pb.basis) out.push(`Multipliers rank by ${BASIS[pa.basis] ?? pa.basis}`);
    }
    if (a.aiTeamsAffectPool !== b.aiTeamsAffectPool) out.push(a.aiTeamsAffectPool ? 'AI teams count toward the pool' : 'AI teams left out of the pool');
    if (!same(a.payoutSplits, b.payoutSplits) || (a.payoutTopPLPct ?? 0) !== (b.payoutTopPLPct ?? 0)) {
      out.push(`Payouts ${payoutText(b.payoutSplits, b.payoutTopPLPct ?? 0)} → ${payoutText(a.payoutSplits, a.payoutTopPLPct ?? 0)}`);
    }
    if (!same(a.poolTrackFromWeek, b.poolTrackFromWeek) && a.poolTrackFromWeek != null) out.push(`Pool tracked from ${week(a.poolTrackFromWeek)}`);
  }

  // Playoffs.
  if (a.playoffTeams !== b.playoffTeams) out.push(`Playoffs ${b.playoffTeams} → ${a.playoffTeams} teams`);
  if (a.eliminationType !== b.eliminationType) out.push(`${a.eliminationType === 'double' ? 'Double' : 'Single'} elimination`);
  if (String(a.championshipWeek) !== String(b.championshipWeek)) out.push(`Championship week ${week(a.championshipWeek)}`);
  return out;
}

/** The post, e.g. "⚙️ Commissioner update: Buy-in $20 → $50. From Week 6: Anytime TD blocked." */
export function settingsNewsMessage(now: string[], later: string[], laterLabel: string): string | null {
  const parts: string[] = [];
  if (now.length > 0) parts.push(`${now.join('; ')}.`);
  if (later.length > 0) parts.push(`From ${laterLabel}: ${later.join('; ')}.`);
  return parts.length > 0 ? `⚙️ Commissioner update: ${parts.join(' ')}` : null;
}
