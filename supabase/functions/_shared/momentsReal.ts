// Server-side (Deno edge function) real-data reimplementation of Weekly Moments
// (manual v0.03 §4). NOT a port of src/engine/moments.ts -- that file computes off
// the client's simulation-engine shapes (League/NFLGame/GameResult with RNG-derived
// simulatedValue), which settle-week has no equivalent of. This is a fresh
// implementation of the same 8 category rules/tie-breaks against the flat real
// tables settle-week already reads (weekly_rosters/wagers, matchups, standings) --
// see chat, Sept 2026: confirmed against real activity_items/teams schema and the
// real post_system_activity RPC definition before writing this (that RPC calls
// is_league_commissioner() off auth.uid(), which is null under the service-role key
// settle-week runs as -- so this writes to activity_items directly instead of
// calling that RPC).
//
// Deliberately does NOT import _shared/pushNotifications.ts (even though both files
// use the same notification_dedup idempotency table) -- settle-week getting coupled
// to the push-notification module (which needs APNS_* secrets Hunter hasn't set yet)
// is exactly what broke its last deploy. claimMomentOnce below duplicates
// claimNotification's few lines instead of importing that module, so this feature
// can never again block settle-week from deploying on its own.
//
// Known, deliberate gap: momentPosition (the slot-position badge on worstBeat/
// boldestBet/bestBet cards) is left unset here. The real `wagers` table isn't
// currently selected with a roster-slot-position column by settle-week, and this
// wasn't confirmed live, so it's simply omitted rather than guessed -- MomentCard
// already renders fine without it (conditional on item.momentPosition being set).

export type MomentCategoryReal =
  | 'biggestWinner'
  | 'biggestLoser'
  | 'worstBeat'
  | 'boldestBet'
  | 'bestBet'
  | 'hottestBettor'
  | 'coldestBettor'
  | 'biggestSwing';

export const MOMENT_CATEGORIES_REAL: MomentCategoryReal[] = [
  'biggestWinner',
  'biggestLoser',
  'worstBeat',
  'boldestBet',
  'bestBet',
  'hottestBettor',
  'coldestBettor',
  'biggestSwing',
];

// Verbatim from src/types/index.ts's DEFAULT_MOMENT_DISPLAY_NAMES -- keep in sync by
// hand (same duplicated-not-imported pattern as everything else in _shared/).
export const DEFAULT_MOMENT_DISPLAY_NAMES_REAL: Record<MomentCategoryReal, string> = {
  biggestWinner: 'King of the Slip',
  biggestLoser: 'Bagel Watch',
  worstBeat: 'Heartbreaker',
  boldestBet: 'Against All Odds',
  bestBet: 'Cash Cow',
  hottestBettor: 'The Hot Hand',
  coldestBettor: 'The Ice Box',
  biggestSwing: 'The Roller Coaster',
};

export const MOMENT_ICONS_REAL: Record<MomentCategoryReal, string> = {
  biggestWinner: '💥',
  biggestLoser: '🥯',
  worstBeat: '💔',
  boldestBet: '🎯',
  bestBet: '💰',
  hottestBettor: '🔥',
  coldestBettor: '🧊',
  biggestSwing: '🎢',
};

export interface MomentCategoryConfigReal {
  displayName: string;
  enabled: boolean;
}

export type MomentSettingsReal = Record<MomentCategoryReal, MomentCategoryConfigReal>;

export const DEFAULT_MOMENT_SETTINGS_REAL: MomentSettingsReal = MOMENT_CATEGORIES_REAL.reduce((acc, cat) => {
  acc[cat] = { displayName: DEFAULT_MOMENT_DISPLAY_NAMES_REAL[cat], enabled: true };
  return acc;
}, {} as MomentSettingsReal);

// Verbatim from src/data/propsGenerator.ts's MARKET_SHORT_LABELS.
const MARKET_SHORT_LABELS_REAL: Partial<Record<string, string>> = {
  player_pass_yds: 'pass yds',
  player_pass_tds: 'pass TDs',
  player_pass_interceptions: 'INTs',
  player_rush_yds: 'rush yds',
  player_rush_attempts: 'rush att',
  player_pass_rush_yds: 'pass+rush yds',
  player_anytime_td: 'anytime TD',
  player_reception_yds: 'rec yds',
  player_receptions: 'receptions',
  player_rush_reception_yds: 'rush+rec yds',
  player_kicking_points: 'kicking pts',
  player_field_goals: 'FGs made',
};

export interface MomentWagerInput {
  status: string;
  stake: number;
  oddsAtPlacement: number;
  settledProfit: number | null;
  playerName: string | null;
  marketKey: string;
  side: string;
  point: number | null;
  /** Only meaningful when status === 'lost'. Computed by the caller (settle-week
   * already has the real game/stat data needed) -- see lostBetDistance() there.
   * Raw distance, for DISPLAY only ("missed by 0.5") -- not comparable across
   * markets with different scales, see lostDistanceRatio for that. null means
   * "no continuous distance for this market" (player_anytime_td) or "couldn't
   * be computed" -- either way, excluded from Worst Beat. */
  lostDistance: number | null;
  /** Same null-ness as lostDistance, but normalized (distance / line, or for
   * h2h/spreads distance / combined score) so a close miss on a small-number
   * market (FG count) doesn't out-rank a proportionally-closer miss on a
   * large-number market (receiving yards). THIS is what Worst Beat ranks on,
   * lostDistance is display-only -- see chat, Sept 2026. */
  lostDistanceRatio: number | null;
}

export interface MomentTeamWeekInput {
  teamId: string;
  teamName: string;
  weeklyScore: number;
  wagers: MomentWagerInput[];
}

export interface MomentStandingInput {
  teamId: string;
  totalPL: number;
  totalWagered: number;
  /** week (string) -> that week's score, for the biggest-swing prior-week lookup. */
  weeklyScores: Record<string, number>;
}

export interface MomentMatchupInput {
  week: string;
  teamAId: string;
  teamBId: string;
  winnerId: string | null;
  isTie: boolean;
}

export interface RealMomentInput {
  week: string;
  teams: MomentTeamWeekInput[];
  standings: MomentStandingInput[];
  /** Every matchup for the league across all weeks (needed for streak history). */
  matchups: MomentMatchupInput[];
  /** Week ordering for sorting/comparison -- see weekOrderReal() below. Passed in
   * (rather than called directly) so this stays consistent with the same
   * injected-lookup pattern the client engine's moments.ts documents using. */
  weekOrderOf: (week: string) => number;
}

/** Verbatim from src/types/index.ts's weekOrder/REGULAR_SEASON_WEEKS/PLAYOFF_WEEKS
 * (confirmed live: REGULAR_SEASON_WEEKS = 18, PLAYOFF_WEEKS = ['WC','DIV','CONF'] --
 * a fixed global, NOT settings/field-size-aware, despite regularSeasonWeeksFor/
 * playoffWeekSequence in playoffLogic.ts being settings-aware for actual season
 * *progression* -- weekOrder is only ever used for sorting/comparison, where the
 * client itself uses this simpler fixed version). Matchup weeks come back as text
 * from Supabase, hence the string param instead of WeekId. */
export function weekOrderReal(week: string): number {
  if (/^-?\d+$/.test(week)) return Number(week);
  const idx = ['WC', 'DIV', 'CONF'].indexOf(week);
  return 18 + 1 + (idx >= 0 ? idx : 0);
}

export interface GeneratedMomentReal {
  category: MomentCategoryReal;
  teamId: string;
  extra: string;
}

function formatSigned(n: number): string {
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}`;
}

function formatOddsSigned(price: number): string {
  return price > 0 ? `+${price}` : `${price}`;
}

function wagerCompactLabelReal(w: MomentWagerInput): string {
  const subject = w.playerName ?? undefined;
  if (w.marketKey === 'player_anytime_td') return subject ? `${subject} anytime TD` : 'Anytime TD';
  const shortLabel = MARKET_SHORT_LABELS_REAL[w.marketKey];
  const pointText = w.point != null ? ` ${w.point}` : '';
  if (!shortLabel) return subject ? `${subject} ${w.side}${pointText}` : `${w.side}${pointText}`;
  const sideText = w.side.toLowerCase();
  return `${subject ? `${subject} ` : ''}${sideText}${pointText} ${shortLabel}`;
}

function ticketLabelReal(w: MomentWagerInput): string {
  const profitStr = w.settledProfit != null ? `, ${formatSigned(w.settledProfit)}` : '';
  return `${wagerCompactLabelReal(w)} @ ${formatOddsSigned(w.oddsAtPlacement)}, $${w.stake.toFixed(2)} stake${profitStr}`;
}

interface Candidate {
  teamId: string;
  value: number;
  extra: string;
}

/** Ties per manual §4.3: higher total stake (this week) wins; final fallback
 * alphabetical -- identical rule to engine/moments.ts's pickWinner. */
function pickWinner(teamNameOf: (id: string) => string, stakeOf: (id: string) => number, candidates: Candidate[]): Candidate | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    if (b.value !== a.value) return b.value - a.value;
    const stakeDiff = stakeOf(b.teamId) - stakeOf(a.teamId);
    if (stakeDiff !== 0) return stakeDiff;
    return teamNameOf(a.teamId).localeCompare(teamNameOf(b.teamId));
  });
  return sorted[0];
}

interface StreakResult {
  type: 'W' | 'L' | 'T' | null;
  count: number;
}

/** Identical logic to engine/stats.ts's computeTeamStreak, against real matchup rows
 * instead of League.matchupsByWeek. */
function streakFor(matchups: MomentMatchupInput[], teamId: string, weekOrderOf: (week: string) => number): StreakResult {
  const weeks = [...new Set(matchups.filter((m) => m.teamAId === teamId || m.teamBId === teamId).map((m) => m.week))].sort(
    (a, b) => weekOrderOf(a) - weekOrderOf(b),
  );
  let streak: StreakResult = { type: null, count: 0 };
  for (const w of weeks) {
    const m = matchups.find((mm) => mm.week === w && (mm.teamAId === teamId || mm.teamBId === teamId));
    if (!m || (m.winnerId == null && !m.isTie)) continue;
    const result: 'W' | 'L' | 'T' = m.isTie ? 'T' : m.winnerId === teamId ? 'W' : 'L';
    if (result === streak.type) streak.count += 1;
    else streak = { type: result, count: 1 };
  }
  return streak;
}

/** Computes every eligible weekly moment for one league/week against real settled
 * data. `input.teams` must already reflect this week's final wager statuses/profits
 * (settle-week mutates its in-memory wager rows as it grades them -- see the caller).
 * A category is entirely omitted when it has no qualifier this week, same as the
 * client engine. Per-category enabled/disabled is applied by the caller (it needs the
 * league's settings.moments either way to build the activity_items message/display
 * name), not here -- same split of responsibility as buildMomentActivity does
 * client-side. */
export function computeRealWeeklyMoments(input: RealMomentInput): GeneratedMomentReal[] {
  const { week, teams, standings, matchups, weekOrderOf } = input;
  const moments: GeneratedMomentReal[] = [];
  const teamNameOf = (id: string) => teams.find((t) => t.teamId === id)?.teamName ?? 'A team';
  const stakeOf = (id: string) => teams.find((t) => t.teamId === id)?.wagers.reduce((sum, w) => sum + (w.stake ?? 0), 0) ?? 0;
  const pick = (candidates: Candidate[]) => pickWinner(teamNameOf, stakeOf, candidates);

  // 1/2: biggest winner / biggest loser -- best/worst weekly P/L.
  const scoreCandidates: Candidate[] = teams.map((t) => ({ teamId: t.teamId, value: t.weeklyScore, extra: formatSigned(t.weeklyScore) }));
  const winner = pick(scoreCandidates);
  if (winner) moments.push({ category: 'biggestWinner', teamId: winner.teamId, extra: winner.extra });
  const loser = pick(scoreCandidates.map((c) => ({ ...c, value: -c.value })));
  if (loser) moments.push({ category: 'biggestLoser', teamId: loser.teamId, extra: loser.extra });

  // 3: worst beat -- the lost bet that came closest to winning, league-wide.
  const worstBeatCandidates: Candidate[] = [];
  for (const t of teams) {
    for (const w of t.wagers) {
      if (w.status !== 'lost' || w.lostDistanceRatio == null || w.lostDistance == null) continue;
      worstBeatCandidates.push({ teamId: t.teamId, value: -w.lostDistanceRatio, extra: `${ticketLabelReal(w)} — missed by ${w.lostDistance.toFixed(1)}` });
    }
  }
  const worstBeat = pick(worstBeatCandidates);
  if (worstBeat) moments.push({ category: 'worstBeat', teamId: worstBeat.teamId, extra: worstBeat.extra });

  // 4/5: boldest bet (longest odds won) / best bet (most profit from one bet).
  const wonBets: { teamId: string; wager: MomentWagerInput }[] = [];
  for (const t of teams) for (const w of t.wagers) if (w.status === 'won') wonBets.push({ teamId: t.teamId, wager: w });
  const boldest = pick(wonBets.map((c) => ({ teamId: c.teamId, value: c.wager.oddsAtPlacement, extra: ticketLabelReal(c.wager) })));
  if (boldest) moments.push({ category: 'boldestBet', teamId: boldest.teamId, extra: boldest.extra });
  const best = pick(wonBets.map((c) => ({ teamId: c.teamId, value: c.wager.settledProfit ?? 0, extra: ticketLabelReal(c.wager) })));
  if (best) moments.push({ category: 'bestBet', teamId: best.teamId, extra: best.extra });

  // 6/7: hottest / coldest bettor -- head-to-head MATCHUP win/loss streak. Ties break
  // by ROI (highest for hot, lowest for cold), then alphabetical.
  const standingOf = (id: string) => standings.find((s) => s.teamId === id);
  const roiOf = (id: string) => {
    const s = standingOf(id);
    return s && s.totalWagered > 0 ? s.totalPL / s.totalWagered : 0;
  };
  const streaks = teams.map((t) => ({ teamId: t.teamId, streak: streakFor(matchups, t.teamId, weekOrderOf) }));

  const hottest = streaks
    .filter((s) => s.streak.type === 'W' && s.streak.count > 0)
    .sort((a, b) => b.streak.count - a.streak.count || roiOf(b.teamId) - roiOf(a.teamId) || teamNameOf(a.teamId).localeCompare(teamNameOf(b.teamId)))[0];
  if (hottest) moments.push({ category: 'hottestBettor', teamId: hottest.teamId, extra: `W${hottest.streak.count}` });

  const coldest = streaks
    .filter((s) => s.streak.type === 'L' && s.streak.count > 0)
    .sort((a, b) => b.streak.count - a.streak.count || roiOf(a.teamId) - roiOf(b.teamId) || teamNameOf(a.teamId).localeCompare(teamNameOf(b.teamId)))[0];
  if (coldest) moments.push({ category: 'coldestBettor', teamId: coldest.teamId, extra: `L${coldest.streak.count}` });

  // 8: biggest swing -- largest week-over-week P/L reversal, either direction.
  const thisOrder = weekOrderOf(week);
  const swingCandidates: Candidate[] = [];
  for (const t of teams) {
    const s = standingOf(t.teamId);
    if (!s) continue;
    const priorWeeks = Object.keys(s.weeklyScores)
      .filter((w) => weekOrderOf(w) < thisOrder)
      .sort((a, b) => weekOrderOf(b) - weekOrderOf(a));
    if (priorWeeks.length === 0) continue;
    const prev = s.weeklyScores[priorWeeks[0]];
    if (prev == null) continue;
    swingCandidates.push({ teamId: t.teamId, value: Math.abs(t.weeklyScore - prev), extra: `${formatSigned(prev)} → ${formatSigned(t.weeklyScore)}` });
  }
  const swing = pick(swingCandidates);
  if (swing) moments.push({ category: 'biggestSwing', teamId: swing.teamId, extra: swing.extra });

  return moments;
}

/** Same claim-once pattern as _shared/pushNotifications.ts's claimNotification, kept
 * as its own small copy rather than importing that module (see file header -- keeping
 * settle-week decoupled from anything push/APNs-related is the whole point). A row
 * returned means "first claim, safe to insert the activity_items row"; a caught
 * unique-violation means another run already posted this moment. */
export async function claimMomentOnce(supabase: any, key: string): Promise<boolean> {
  const { data, error } = await supabase.from('notification_dedup').insert({ key }).select('key');
  if (error) {
    if (typeof error.message === 'string' && /duplicate key|unique constraint/i.test(error.message)) return false;
    throw new Error(`claimMomentOnce(${key}): ${error.message}`);
  }
  return !!data && data.length > 0;
}
