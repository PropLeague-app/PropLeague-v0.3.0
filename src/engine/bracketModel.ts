import type { BracketMatch, League, Matchup, MatchSource, PlayoffBracket, PlayoffFieldSize, WeekId } from '../types';
import {
  advanceBracket,
  buildBracket,
  buildConferenceBracket,
  conferenceBracketSupported,
  isPlayoffPairing,
  calendarIndex,
  countPlayoffWeeksNeeded,
  seasonPlan,
  SEASON_CALENDAR,
  type SeasonPlan,
} from './playoffs';
import { sortStandings } from './standings';
import { clinchStatuses, type ClinchStatus, type ClinchTeam } from './clinch';

// Everything the Matchups screen needs to show the playoffs: the real bracket (or a projected one before
// the playoffs), which week every game falls in, who is playing, resting or out in a given week, and a
// classic left-to-right layout whose columns are the playoff weeks.

const FIELD_SIZES: PlayoffFieldSize[] = [2, 4, 6, 8, 16];

export function leagueFieldSize(league: Pick<League, 'settings'>): PlayoffFieldSize {
  const n = league.settings.playoffTeams as PlayoffFieldSize;
  return FIELD_SIZES.includes(n) ? n : 4;
}

type PlanLeague = Pick<League, 'settings' | 'bracket' | 'seasonStartWeek'>;

/** The league's season calendar (1.2.11): regular season from its start week, then the playoff rounds
 * ending on the championship week. Once a bracket exists, its playoff weeks are the ones it was given. */
export function leagueSeasonPlan(league: PlanLeague): SeasonPlan {
  const size = league.bracket?.fieldSize ?? leagueFieldSize(league);
  const elim = league.bracket?.eliminationType ?? league.settings.eliminationType;
  const plan = seasonPlan(league.seasonStartWeek, league.settings.championshipWeek, size, elim);
  const firstReal = league.bracket ? Math.min(...league.bracket.matches.map((m) => calendarIndex(m.weekId)).filter((i) => i >= 0)) : Infinity;
  if (!Number.isFinite(firstReal) || firstReal === calendarIndex(plan.playoffWeeks[0])) return plan;
  const rounds = countPlayoffWeeksNeeded(size, elim);
  const start = Math.max(0, calendarIndex(league.seasonStartWeek));
  const playoffWeeks = SEASON_CALENDAR.slice(firstReal, firstReal + rounds);
  return { regularWeeks: SEASON_CALENDAR.slice(start, firstReal), playoffWeeks, championshipWeek: playoffWeeks[playoffWeeks.length - 1] };
}

/** Whether a playoff structure fits the calendar: the championship week must leave at least one
 * regular-season week and start the playoffs after the current week. */
export function structureFits(
  league: Pick<League, 'seasonStartWeek' | 'currentWeek'>,
  fieldSize: PlayoffFieldSize,
  elim: 'single' | 'double',
  championshipWeek: WeekId,
): boolean {
  const base = Math.max(0, calendarIndex(league.seasonStartWeek), calendarIndex(league.currentWeek));
  return calendarIndex(championshipWeek) >= base + countPlayoffWeeksNeeded(fieldSize, elim);
}

/** What a calendar week is in the real NFL season ("Week 7", "NFL Wild Card"). */
export function nflWeekName(week: WeekId | string, short = false): string {
  const w = String(week);
  if (w === 'WC') return short ? 'NFL WC' : 'NFL Wild Card';
  if (w === 'DIV') return short ? 'NFL Div' : 'NFL Divisional';
  if (w === 'CONF') return short ? 'NFL Conf' : 'NFL Conference Championship';
  return short ? `Wk ${w}` : `Week ${w}`;
}

/** The playoff weeks, in order. */
export function leaguePlayoffWeeks(league: PlanLeague): WeekId[] {
  return leagueSeasonPlan(league).playoffWeeks;
}

export function isPlayoffWeek(league: PlanLeague, week: WeekId | string): boolean {
  return leaguePlayoffWeeks(league).some((w) => String(w) === String(week));
}

/** Two conferences that the bracket splits by (only when the structure supports it, as on the server). */
export function conferencePair(league: Pick<League, 'settings' | 'teams'>): [string, string] | null {
  if (!league.settings.conferencesEnabled) return null;
  const ids = [...new Set(league.teams.map((t) => t.conferenceId).filter((c): c is string => !!c))];
  if (ids.length !== 2) return null;
  if (!conferenceBracketSupported(leagueFieldSize(league), league.settings.eliminationType, 2)) return null;
  return [ids[0], ids[1]];
}

/** The matchups that count for a week. In a playoff week only the bracket's games do (a leftover
 * regular-season pairing from before the field grew into Weeks 17 or 18 is ignored, as on the server). */
export function leagueWeekMatchups(league: League, week: WeekId | string): Matchup[] {
  const rows = league.matchupsByWeek[String(week)] ?? [];
  if (!league.bracket || league.seasonPhase === 'regular' || !isPlayoffWeek(league, week)) return rows;
  return rows.filter((m) => isPlayoffPairing(league.bracket, String(week), m.teamAId, m.teamBId));
}

/** matchupsByWeek without playoff games, for regular-season things like the head-to-head tiebreaker. */
export function regularSeasonMatchups(league: Pick<League, 'matchupsByWeek' | 'bracket'>): Record<string, Matchup[]> {
  if (!league.bracket) return league.matchupsByWeek;
  const out: Record<string, Matchup[]> = {};
  for (const [week, rows] of Object.entries(league.matchupsByWeek)) {
    out[week] = rows.filter((m) => !isPlayoffPairing(league.bracket, week, m.teamAId, m.teamBId));
  }
  return out;
}

/** Which of the playoff weeks `seq` every game of a structure is played in, found by running the real
 * engine with stand-in results (team A always wins). Match ids are the same as in the league's real
 * bracket. */
export function scheduledMatchWeeks(fieldSize: PlayoffFieldSize, elim: 'single' | 'double', conference: boolean, seq: WeekId[]): Map<string, WeekId> {
  const seeds = Array.from({ length: fieldSize }, (_, i) => `s${i + 1}`);
  let b = conference
    ? buildConferenceBracket([seeds.slice(0, fieldSize / 2), seeds.slice(fieldSize / 2)], fieldSize)
    : buildBracket(seeds, fieldSize, elim);
  b = advanceBracket(b, null, () => null, seq[0]);
  for (let i = 0; i < seq.length && !b.championId; i++) {
    const week = seq[i];
    const next = seq[i + 1] ?? week;
    const scoresFor = (teamId: string): number | null => {
      const m = b.matches.find((x) => x.weekId === week && (x.teamAId === teamId || x.teamBId === teamId));
      if (!m) return null;
      return teamId === m.teamAId ? 1 : 0;
    };
    b = advanceBracket(b, week, scoresFor, next);
  }
  const out = new Map<string, WeekId>();
  for (const m of b.matches) if (m.weekId != null) out.set(m.id, m.weekId);
  return out;
}

export interface BracketModel {
  bracket: PlayoffBracket;
  /** True before the playoffs: seeded from the current standings ("if the season ended today"). */
  projected: boolean;
  weeks: WeekId[];
  /** Every game's week: the real one once set, otherwise when it is scheduled to be played. */
  weekOf: Map<string, WeekId>;
}

/** The league's bracket, or a projected one from the current standings before the playoffs start. */
export function leagueBracketModel(league: League): BracketModel | null {
  const conf = conferencePair(league);
  if (league.bracket) {
    const b = league.bracket;
    const isConf = b.matches.some((m) => m.id.startsWith('A-'));
    const weeks = leaguePlayoffWeeks(league);
    const weekOf = scheduledMatchWeeks(b.fieldSize, b.eliminationType, isConf, weeks);
    for (const m of b.matches) if (m.weekId != null) weekOf.set(m.id, m.weekId);
    return { bracket: b, projected: false, weeks, weekOf };
  }
  const size = leagueFieldSize(league);
  const elim = league.settings.eliminationType;
  if (league.teams.length < size) return null;
  const order = sortStandings(league.standings, regularSeasonMatchups(league)).map((s) => s.teamId);
  // Teams with no standings row yet still need a place (a brand new league): append in team order.
  for (const t of league.teams) if (!order.includes(t.id)) order.push(t.id);
  const weeks = leaguePlayoffWeeks(league);
  let bracket: PlayoffBracket;
  if (conf) {
    const confOf = new Map(league.teams.map((t) => [t.id, t.conferenceId]));
    bracket = buildConferenceBracket([order.filter((id) => confOf.get(id) === conf[0]), order.filter((id) => confOf.get(id) === conf[1])], size);
  } else {
    bracket = buildBracket(order.slice(0, size), size, elim);
  }
  bracket = advanceBracket(bracket, null, () => null, weeks[0]);
  const weekOf = scheduledMatchWeeks(bracket.fieldSize, bracket.eliminationType, !!conf, weeks);
  return { bracket, projected: true, weeks, weekOf };
}

export function matchById(bracket: PlayoffBracket, id: string): BracketMatch | undefined {
  return bracket.matches.find((m) => m.id === id);
}

export function loserOf(m: BracketMatch): string | null {
  if (!m.winnerId) return null;
  return m.winnerId === m.teamAId ? m.teamBId : m.teamAId;
}

/** The game each team was knocked out in. A loss only eliminates when nothing in the bracket takes that
 * game's loser (in double elimination, a first loss drops a team to the losers bracket instead). */
export function eliminations(bracket: PlayoffBracket): Map<string, BracketMatch> {
  const out = new Map<string, BracketMatch>();
  for (const m of bracket.matches) {
    const loser = loserOf(m);
    if (!loser) continue;
    const dropsDown = bracket.matches.some((x) => [x.sourceA, x.sourceB].some((s) => s.type === 'loser' && s.matchId === m.id));
    if (!dropsDown) out.set(loser, m);
  }
  return out;
}

/** "Out in the Elite 8", "Out in the Wild Card round". */
function outIn(label: string): string {
  return label === 'Wild Card' ? 'Out in the Wild Card round' : `Out in the ${label}`;
}

export function weekIndex(model: BracketModel, week: WeekId | string): number {
  return model.weeks.findIndex((w) => String(w) === String(week));
}

export interface WeekStatus {
  /** Games in this week (set or still to be decided), in bracket order. */
  games: BracketMatch[];
  /** Teams still alive but not playing this week (they advance to a later round). */
  byes: { teamId: string; nextLabel: string | null }[];
  /** Teams already out before this week: knocked out (with the round) or never in the field. */
  out: { teamId: string; reason: string }[];
}

export function weekStatus(model: BracketModel, league: Pick<League, 'teams'>, week: WeekId | string): WeekStatus {
  const { bracket, weekOf } = model;
  const idx = weekIndex(model, week);
  const games = bracket.matches.filter((m) => String(weekOf.get(m.id)) === String(week));
  const elim = eliminations(bracket);
  const out: WeekStatus['out'] = [];
  for (const [teamId, m] of elim) {
    if (weekIndex(model, weekOf.get(m.id) ?? '') < idx) out.push({ teamId, reason: outIn(matchLabel(bracket, m)) });
  }
  for (const t of league.teams) if (!bracket.seeds.includes(t.id)) out.push({ teamId: t.id, reason: 'Missed the playoffs' });

  const byes: WeekStatus['byes'] = [];
  const allSet = games.length > 0 && games.every((m) => m.teamAId && m.teamBId);
  if (allSet && !bracket.championId) {
    const playing = new Set(games.flatMap((m) => [m.teamAId, m.teamBId]));
    const outIds = new Set(out.map((o) => o.teamId));
    for (const id of bracket.seeds) {
      if (playing.has(id) || outIds.has(id)) continue;
      // Knocked out this week or earlier in a game not yet counted above (it cannot be resting).
      const e = elim.get(id);
      if (e && weekIndex(model, weekOf.get(e.id) ?? '') <= idx) continue;
      const next = bracket.matches
        .filter((m) => weekIndex(model, weekOf.get(m.id) ?? '') > idx && (m.teamAId === id || m.teamBId === id || feedsSeed(m, bracket, id)))
        .sort((a, b) => weekIndex(model, weekOf.get(a.id) ?? '') - weekIndex(model, weekOf.get(b.id) ?? ''))[0];
      byes.push({ teamId: id, nextLabel: next ? matchLabel(bracket, next) : null });
    }
  }
  return { games, byes, out };
}

/** Whether a game's slot will hold this team: as a seed, or as the winner or loser of a game it played. */
function feedsSeed(m: BracketMatch, bracket: PlayoffBracket, teamId: string): boolean {
  return [m.sourceA, m.sourceB].some((s) => {
    if (s.type === 'seed') return bracket.seeds[s.seed - 1] === teamId;
    const from = matchById(bracket, s.matchId);
    if (!from?.winnerId) return false;
    return s.type === 'winner' ? from.winnerId === teamId : loserOf(from) === teamId;
  });
}

/** PropLeague's own round names (1.2.11), so they never read like the NFL week a round is played in. */
const ROUND_NAMES: Record<string, string> = {
  Quarterfinal: 'Elite 8',
  Semifinal: 'Final 4',
  'Losers Round 1': 'Survivor Rd 1',
  'Losers Round 2': 'Survivor Rd 2',
  'Losers Semifinal': 'Survivor Semis',
  'Losers Final': 'Survivor Final',
  'True Final': 'Prop Bowl',
  Decider: 'Prop Bowl Decider',
  'Bracket Reset': 'Reset', // brackets saved before 1.2.11
};

/** A game's round name for display: Round of 16 (16 teams) or Wild Card (6 teams) for round 1, Elite 8,
 * Final 4, and the Prop Bowl for the title game. In double elimination the winners-bracket final is
 * the Winners Final (the Prop Bowl is the True Final), and losers-bracket rounds are Survivor rounds. */
export function matchLabel(bracket: PlayoffBracket, m: BracketMatch): string {
  if (m.label === 'Round 1') return bracket.fieldSize === 16 ? 'Round of 16' : 'Wild Card';
  if (m.label === 'Championship') return bracket.eliminationType === 'double' && bracket.fieldSize !== 2 ? 'Winners Final' : 'Prop Bowl';
  return ROUND_NAMES[m.label] ?? m.label;
}

const SHORT: Record<string, string> = {
  'Round of 16': 'R16',
  'Wild Card': 'WC',
  'Elite 8': 'E8',
  'Final 4': 'F4',
  'Prop Bowl': 'Bowl',
  'Winners Final': 'WF',
  'Prop Bowl Decider': 'Decider',
  'Survivor Rd 1': 'LB1',
  'Survivor Rd 2': 'LB2',
  'Survivor Semis': 'LBS',
  'Survivor Final': 'LBF',
  Reset: 'Reset',
};

/** A week's round name, short enough for a chip ("Semis", "Final"). The winners-bracket round
 * wins when both brackets play that week. */
export function weekRoundShort(model: BracketModel, week: WeekId | string): string {
  const games = model.bracket.matches.filter((m) => String(model.weekOf.get(m.id)) === String(week));
  if (games.length === 0) return '';
  const pick = games.find((m) => m.side === 'F' || m.side === 'RESET') ?? games.find((m) => m.side === 'W') ?? games[0];
  const label = matchLabel(model.bracket, pick);
  return SHORT[label] ?? label;
}

/** Every round name played in a week, for headings ("Semifinal · Losers Round 1"). */
export function weekRoundLong(model: BracketModel, week: WeekId | string): string {
  const labels = [...new Set(model.bracket.matches.filter((m) => String(model.weekOf.get(m.id)) === String(week)).map((m) => matchLabel(model.bracket, m)))];
  if (labels.length === 0) return '';
  return labels.join(' · ');
}

/** What a still-empty slot will hold, e.g. "Winner of Semifinal 1" or "#3 seed". */
export function sourceText(bracket: PlayoffBracket, source: MatchSource): string {
  if (source.type === 'seed') return `#${source.seed} seed`;
  const m = matchById(bracket, source.matchId);
  const word = source.type === 'winner' ? 'Winner' : 'Loser';
  if (!m) return 'TBD';
  // Both teams known: name the game by its seeds ("Winner of #4 vs #5").
  const sa = seedOf(bracket, m.teamAId);
  const sb = seedOf(bracket, m.teamBId);
  if (sa > 0 && sb > 0) return `${word} of #${sa} vs #${sb}`;
  const sameLabel = bracket.matches.filter((x) => x.label === m.label);
  const n = sameLabel.length > 1 ? ` ${sameLabel.indexOf(m) + 1}` : '';
  return `${word} of ${matchLabel(bracket, m)}${n}`;
}

/** The team in a slot: known once set, and always known for a seed (a top seed with a bye is already in
 * its next game). */
export function slotTeam(bracket: PlayoffBracket, teamId: string | null, source: MatchSource): string | null {
  if (teamId) return teamId;
  return source.type === 'seed' ? (bracket.seeds[source.seed - 1] ?? null) : null;
}

export function seedOf(bracket: PlayoffBracket, teamId: string | null): number {
  return teamId ? bracket.seeds.indexOf(teamId) + 1 : 0;
}

// ---- Layout ----

/** Default sizes; the bracket screen passes its own box width so one round fills the screen. */
export const BOX_W = 168;
export const BOX_H = 74;
export const COL_GAP = 26;
export const ROW_GAP = 12;
export const SECTION_GAP = 28;

export type LayoutNode =
  | { kind: 'match'; id: string; col: number; x: number; y: number; match: BracketMatch }
  | { kind: 'bye'; id: string; col: number; x: number; y: number; seed: number; teamId: string | null };

export interface LayoutEdge {
  from: string;
  to: string;
  /** The team from `from` has moved on (the line is drawn in the accent). */
  advanced: boolean;
}

export interface BracketLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
  /** Where the losers bracket starts (for its label), when there is one. */
  losersTop: number | null;
}

/** A classic bracket: one column per playoff week, each game halfway between the two games that feed
 * it, and a resting top seed shown as a bye box in the week before it plays. */
export function layoutBracket(model: BracketModel, boxW = BOX_W, boxH = BOX_H): BracketLayout {
  const { bracket } = model;
  const col = (id: string) => Math.max(0, weekIndex(model, model.weekOf.get(id) ?? ''));
  const referenced = new Set(bracket.matches.flatMap((m) => [m.sourceA, m.sourceB]).filter((s) => s.type === 'winner').map((s) => (s as { matchId: string }).matchId));
  const roots = bracket.matches.filter((m) => !referenced.has(m.id));

  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];
  let cursor = 0;
  let lastLeafSide: string | null = null;
  let losersTop: number | null = null;

  const place = (m: BracketMatch): number => {
    const children: number[] = [];
    for (const s of [m.sourceA, m.sourceB]) {
      if (s.type === 'winner') {
        const child = matchById(bracket, s.matchId);
        if (!child) continue;
        children.push(place(child));
        edges.push({ from: child.id, to: m.id, advanced: !!child.winnerId });
      } else if (s.type === 'seed' && col(m.id) > 0) {
        const id = `bye-${s.seed}`;
        const y = leafY(m.side);
        nodes.push({ kind: 'bye', id, col: col(m.id) - 1, x: (col(m.id) - 1) * (boxW + COL_GAP), y, seed: s.seed, teamId: bracket.seeds[s.seed - 1] ?? null });
        edges.push({ from: id, to: m.id, advanced: true });
        children.push(y);
      }
    }
    const y = children.length > 0 ? children.reduce((a, b) => a + b, 0) / children.length : leafY(m.side);
    nodes.push({ kind: 'match', id: m.id, col: col(m.id), x: col(m.id) * (boxW + COL_GAP), y, match: m });
    return y;
  };

  function leafY(side: string): number {
    if (lastLeafSide !== null && side === 'L' && lastLeafSide !== 'L') {
      cursor += SECTION_GAP;
      losersTop = cursor;
    }
    lastLeafSide = side;
    const y = cursor;
    cursor += boxH + ROW_GAP;
    return y;
  }

  for (const r of roots) place(r);
  const cols = Math.max(model.weeks.length, ...nodes.map((n) => n.col + 1));
  return { nodes, edges, width: cols * boxW + (cols - 1) * COL_GAP, height: Math.max(cursor - ROW_GAP, boxH), losersTop };
}

// ---- Clinch markers (1.2.11) ----

/** Each team's clinch status: from the bracket once it exists (seeds are in, #1 seeds and byes marked,
 * everyone else out), otherwise from the standings and the regular-season games left. */
export function leagueClinchStatuses(league: League): Map<string, ClinchStatus> {
  const out = new Map<string, ClinchStatus>();
  const b = league.bracket;
  if (b) {
    const isConf = b.matches.some((m) => m.id.startsWith('A-'));
    const perConf = isConf ? b.fieldSize / 2 : b.fieldSize;
    // A 6-team field gives seeds 1 and 2 a first-round bye.
    const byeSeeds = !isConf && b.fieldSize === 6 ? 2 : 0;
    b.seeds.forEach((id, i) => out.set(id, i % perConf === 0 ? 'top' : i < byeSeeds ? 'bye' : 'playoffs'));
    for (const t of league.teams) if (!b.seeds.includes(t.id)) out.set(t.id, 'out');
    return out;
  }
  const size = leagueFieldSize(league);
  const conf = conferencePair(league);
  const plan = leagueSeasonPlan(league);
  const remaining = new Map<string, number>();
  for (const w of plan.regularWeeks) {
    for (const m of league.matchupsByWeek[String(w)] ?? []) {
      if (m.winnerId != null || m.isTie) continue;
      remaining.set(m.teamAId, (remaining.get(m.teamAId) ?? 0) + 1);
      remaining.set(m.teamBId, (remaining.get(m.teamBId) ?? 0) + 1);
    }
  }
  const teams: ClinchTeam[] = league.teams.map((t) => {
    const s = league.standings.find((x) => x.teamId === t.id);
    return { id: t.id, group: conf ? (t.conferenceId ?? 'all') : 'all', wins: s?.wins ?? 0, losses: s?.losses ?? 0, ties: s?.ties ?? 0, remaining: remaining.get(t.id) ?? 0 };
  });
  return clinchStatuses(teams, conf ? size / 2 : size, size === 6 && !conf ? 2 : 0);
}
