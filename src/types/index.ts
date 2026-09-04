// Core domain types for PropLeague.
// Odds/market shapes intentionally mirror The Odds API's event/bookmaker/market/outcome
// structure so services/oddsService.ts can be swapped for a real fetch later.

/** User-visible app version (semantic versioning as of v0.1.1 — the prior "Beta v0.03"
 * build is v0.1.0). Shown in the dev panel; keep in sync with package.json. */
export const APP_VERSION = '0.3.0';

export type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K';
export type SlotPosition = Position | 'ML';

export type DaySlot = 'TNF' | 'SUN_EARLY' | 'SUN_LATE' | 'SNF' | 'MNF';
export type GameStatus = 'upcoming' | 'live' | 'final';

/** 1-18 for the regular season, then the three PropLeague playoff rounds. */
export type WeekId = number | 'WC' | 'DIV' | 'CONF';

export const REGULAR_SEASON_WEEKS = 18;
export const PLAYOFF_WEEKS: WeekId[] = ['WC', 'DIV', 'CONF'];

/** Total chronological ordering across regular season + playoff weeks. */
export function weekOrder(week: WeekId): number {
  if (typeof week === 'number') return week;
  return REGULAR_SEASON_WEEKS + 1 + PLAYOFF_WEEKS.indexOf(week);
}

export function weekLabel(week: WeekId): string {
  return typeof week === 'number' ? `Week ${week}` : week;
}

export interface NFLTeam {
  id: string;
  city: string;
  name: string;
  abbrev: string;
  conference: 'AFC' | 'NFC';
  division: 'East' | 'North' | 'South' | 'West';
  primaryColor: string;
  secondaryColor: string;
}

export type InjuryTag = 'Q' | 'D' | 'O' | null;

export interface Player {
  id: string;
  name: string;
  position: Position;
  nflTeamId: string;
  injury: InjuryTag;
}

/** Odds-API-shaped outcome (one side of a market). */
export interface OddsOutcome {
  name: string; // 'Over' | 'Under' | 'Yes' | team name
  price: number; // American odds
  point?: number; // line, e.g. 84.5
  playerId?: string;
}

/** Odds-API-shaped market. `key` mirrors The Odds API's market key naming. */
export type MarketKey =
  | 'h2h'
  | 'spreads'
  | 'totals'
  | 'player_pass_yds'
  | 'player_pass_tds'
  | 'player_pass_interceptions'
  | 'player_rush_yds'
  | 'player_rush_attempts'
  | 'player_anytime_td'
  | 'player_reception_yds'
  | 'player_receptions'
  | 'player_kicking_points'
  | 'player_field_goals';

export interface AltLine {
  point: number;
  outcomes: OddsOutcome[];
}

export interface OddsMarket {
  key: MarketKey;
  playerId?: string; // absent for game-level markets (h2h/spreads)
  /** Carried directly on real markets (see supabaseOdds.ts) so getPlayerPropGroups
   * doesn't have to re-derive them via the static roster lookup, which can't find
   * a real player who isn't in that curated, hand-maintained list (or who's since
   * been traded to a different team than it says) -- that gap is exactly what
   * caused a real crash. Left undefined for simulated markets, which still use
   * the static playerById() lookup as before. */
  playerName?: string;
  playerPosition?: Position;
  playerTeamId?: string;
  outcomes: OddsOutcome[];
  /** One lower and one higher alternate line, each with its own shifted odds (manual
   * §6). Only present on player over/under markets with a numeric point. */
  altLines?: [AltLine, AltLine];
}

export interface OddsBookmaker {
  key: string;
  title: string;
  markets: OddsMarket[];
}

/** UI-friendly grouping of a single player's markets for one game, with a derived injury tag. */
export interface PlayerPropGroup {
  playerId: string;
  playerName: string;
  position: Position;
  teamId: string;
  injury: InjuryTag;
  markets: OddsMarket[];
}

export interface NFLGame {
  id: string;
  week: WeekId;
  daySlot: DaySlot;
  kickoff: string; // ISO timestamp
  homeTeamId: string;
  awayTeamId: string;
  homeRecord: string;
  awayRecord: string;
  status: GameStatus;
  homeScore: number | null;
  awayScore: number | null;
  bookmakers: OddsBookmaker[];
}

// --- League configuration -------------------------------------------------

export interface BetLimitOverride {
  min?: number;
  max?: number | null;
  minOdds?: number | null;
  maxOdds?: number | null;
}

export interface Conference {
  id: string;
  name: string;
}

// --- Duplicate-pick system (manual v0.1.1 §5) ------------------------------

/** The "direction" of a wager that counts as correlated. `FavoredTeam` is the h2h/
 * spreads equivalent of Over/Under — there's no line to clear, just a team sided
 * with. */
export type CorrelationSide = 'Over' | 'Under' | 'Yes' | 'FavoredTeam';

/** manual v0.2.0 §3 #5: which CorrelationSide values are actually meaningful for a
 * given market — yardage/count markets only ever settle Over/Under, anytime TD is a
 * yes/no proposition (no line to clear), and h2h/spreads are sided with a team. Single
 * source of truth for every side-selector in the app (currently just
 * CorrelationRulesEditor, but anywhere else a market+side pair is picked should read
 * from here instead of hardcoding a fixed option list). */
export const MARKET_ALLOWED_SIDES: Record<MarketKey, CorrelationSide[]> = {
  h2h: ['FavoredTeam'],
  spreads: ['FavoredTeam'],
  totals: ['Over', 'Under'],
  player_pass_yds: ['Over', 'Under'],
  player_pass_tds: ['Over', 'Under'],
  player_pass_interceptions: ['Over', 'Under'],
  player_rush_yds: ['Over', 'Under'],
  player_rush_attempts: ['Over', 'Under'],
  player_anytime_td: ['Yes'],
  player_reception_yds: ['Over', 'Under'],
  player_receptions: ['Over', 'Under'],
  player_kicking_points: ['Over', 'Under'],
  player_field_goals: ['Over', 'Under'],
};

/** One entry in the correlated-picks blocklist (manual v0.1.1 §5 B) — a market-pair +
 * scope condition, not code, so the commissioner can add/remove/reset pairs from the
 * settings UI without touching the engine. `scope: 'same-team'` requires both legs be
 * tied to the same NFL team (a player's team, or the literal team for h2h/spreads);
 * `'same-game'` only requires both legs be in the same NFL game (either team). */
export interface CorrelationRule {
  id: string;
  label: string;
  marketA: MarketKey;
  sideA: CorrelationSide;
  marketB: MarketKey;
  sideB: CorrelationSide;
  scope: 'same-team' | 'same-game';
}

// --- Prize pool impact multipliers (manual v0.3.0 §8) ----------------------

/** What determines a team's rank for multiplier purposes. 'rank' uses the league's
 * full standings order (the same tiebreaker chain shown everywhere else); 'record'
 * and 'seasonPL' re-rank by just that one metric, ignoring the rest of the
 * tiebreaker chain. */
export type MultiplierBasis = 'rank' | 'record' | 'seasonPL';

export interface PoolMultiplierSettings {
  /** Default OFF — every team wagers at a flat 1.0x until a commissioner opts in. */
  enabled: boolean;
  basis: MultiplierBasis;
  /** 0 = flat (every team 1.0x) to 1 = max spread (1.2x top, 0.8x bottom) before the
   * 0.5x-1.5x hard cap and mean-1.0 normalization are applied. */
  spread: number;
}

export const DEFAULT_POOL_MULTIPLIER_SETTINGS: PoolMultiplierSettings = {
  enabled: false,
  basis: 'rank',
  spread: 0,
};

export const DEFAULT_CORRELATION_RULES: CorrelationRule[] = [
  {
    id: 'qb-pass-yds-teammate-rec-yds',
    label: "QB passing yards Over + a teammate's receiving yards Over",
    marketA: 'player_pass_yds',
    sideA: 'Over',
    marketB: 'player_reception_yds',
    sideB: 'Over',
    scope: 'same-team',
  },
  {
    id: 'qb-pass-tds-teammate-anytime-td',
    label: "QB passing TDs Over + a teammate's anytime TD",
    marketA: 'player_pass_tds',
    sideA: 'Over',
    marketB: 'player_anytime_td',
    sideB: 'Yes',
    scope: 'same-team',
  },
  {
    id: 'rb-rush-yds-team-ml',
    label: "RB rushing yards Over + that team's moneyline",
    marketA: 'player_rush_yds',
    sideA: 'Over',
    marketB: 'h2h',
    sideB: 'FavoredTeam',
    scope: 'same-team',
  },
];

// --- Weekly Moments v2 (manual v0.03 §4) -----------------------------------

export type MomentCategory =
  | 'biggestWinner'
  | 'biggestLoser'
  | 'worstBeat'
  | 'boldestBet'
  | 'bestBet'
  | 'hottestBettor'
  | 'coldestBettor'
  | 'biggestSwing';

export const MOMENT_CATEGORIES: MomentCategory[] = [
  'biggestWinner',
  'biggestLoser',
  'worstBeat',
  'boldestBet',
  'bestBet',
  'hottestBettor',
  'coldestBettor',
  'biggestSwing',
];

/** Fixed, plain, never-editable — states exactly what each category measures. */
export const MOMENT_CATEGORY_LABELS: Record<MomentCategory, string> = {
  biggestWinner: 'Best weekly P/L',
  biggestLoser: 'Worst weekly P/L',
  worstBeat: 'Bet lost by the smallest margin',
  boldestBet: 'Longest-odds bet won',
  bestBet: 'Most profit from a single bet',
  hottestBettor: 'Longest active matchup win streak',
  coldestBettor: 'Longest active matchup loss streak',
  biggestSwing: 'Largest week-over-week turnaround',
};

export const DEFAULT_MOMENT_DISPLAY_NAMES: Record<MomentCategory, string> = {
  biggestWinner: 'King of the Slip',
  biggestLoser: 'Bagel Watch',
  worstBeat: 'Heartbreaker',
  boldestBet: 'Against All Odds',
  bestBet: 'Cash Cow',
  hottestBettor: 'The Hot Hand',
  coldestBettor: 'The Ice Box',
  biggestSwing: 'The Roller Coaster',
};

export interface MomentCategoryConfig {
  displayName: string;
  enabled: boolean;
}

export type MomentSettings = Record<MomentCategory, MomentCategoryConfig>;

export const DEFAULT_MOMENT_SETTINGS: MomentSettings = MOMENT_CATEGORIES.reduce((acc, cat) => {
  acc[cat] = { displayName: DEFAULT_MOMENT_DISPLAY_NAMES[cat], enabled: true };
  return acc;
}, {} as MomentSettings);

export interface LeagueSettings {
  leagueName: string;
  isPublic: boolean;
  weeklyCredits: number;
  lineupSlots: Record<Position | 'ML', number>;
  minBetPerSlot: number;
  maxMLBet: number;
  maxPropBet: number | null;
  minOdds: number | null;
  singleBetCapPct: number; // e.g. 0.8 = 80%
  wagerPrecision: number; // e.g. 0.01
  hidePicks: boolean;
  allowLiveBets: boolean; // stub, non-functional in v0.01
  // Duplicate-pick system (manual v0.1.1 §5) — three independent controls, all
  // default OFF, replacing the old single "allowDuplicatePicks" toggle.
  /** A: null = OFF (duplicates fully allowed); a number caps how many teams may hold
   * the same prop leg in a week — 1 matches the old toggle's exclusive behavior.
   * Selectable range in the UI is 1..floor(teamCount/2). */
  maxDuplicatePicks: number | null;
  waiverMode: 'fcfs' | 'waiver_order'; // only relevant when maxDuplicatePicks is set
  /** B: OFF by default — when on, `correlationRules` is enforced in lineup validation. */
  correlationBlockEnabled: boolean;
  /** Commissioner-editable market-pair blocklist (add/remove/reset-to-default) — kept
   * populated with the defaults even while `correlationBlockEnabled` is off, same
   * pattern as `moments` below. */
  correlationRules: CorrelationRule[];
  /** C: null = OFF (the manual's baseline minimum of 2 distinct games still applies);
   * a number raises that floor, up to the roster's total slot count. */
  minGamesPerRoster: number | null;
  altLinesEnabled: boolean;
  lineMovementEnabled: boolean;
  conferencesEnabled: boolean;
  conferences: Conference[]; // locked once the league is filled/started
  playoffTeams: number;
  eliminationType: 'single' | 'double'; // 'double' stub, non-functional in v0.01
  buyInEnabled: boolean;
  buyInAmount: number;
  /** Ordered by finish place — index 0 is 1st place's cut, index 1 is 2nd, etc.
   * Length is how many places get paid (1..settings.playoffTeams). Must sum to
   * exactly 100 and every entry must be > 0 — enforced by
   * engine/prizePool.ts's validatePayoutSplit, not just the settings UI (manual
   * v0.3.0 §4, replacing the old fixed champion/runner-up split). */
  payoutSplits: number[];
  showRealDollarStakes: boolean; // per-wager "real $ at stake" line on bet slip/roster cards
  /** manual v0.3.0 §8: scales how much each team's wagers move the shared prize pool,
   * based on standing — a genuinely new game mechanic, not just a display setting
   * (see engine/prizePool.ts's computeStandingMultipliers for the conservation math). */
  poolMultipliers: PoolMultiplierSettings;
  moments: MomentSettings;
  propBetOverride: BetLimitOverride | null;
  mlBetOverride: BetLimitOverride | null;
  /** Dev-panel-only (manual v0.03 §5 #10): when jumping ahead multiple weeks via
   * "Simulate to Week N", auto-fill the user's own lineup for skipped weeks the same
   * way simulated members already are, instead of scoring them as missed. Only applies
   * to that multi-week dev jump — a single Advance Week click during normal play still
   * penalizes a missed lineup as usual. */
  autoFillUserLineupsWhenSimulating: boolean;
}

export const DEFAULT_LINEUP_SLOTS: Record<Position | 'ML', number> = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  K: 1,
  ML: 1,
};

export const DEFAULT_LEAGUE_SETTINGS: LeagueSettings = {
  leagueName: "New League",
  isPublic: false,
  weeklyCredits: 100,
  lineupSlots: { ...DEFAULT_LINEUP_SLOTS },
  minBetPerSlot: 1,
  maxMLBet: 15,
  maxPropBet: null,
  minOdds: null,
  singleBetCapPct: 0.8,
  wagerPrecision: 0.01,
  // v0.03 §3 #5: hiding picks before kickoff now defaults OFF. Existing leagues keep
  // their persisted value (see store/migrations.ts) — this default only applies to
  // leagues created from here forward.
  hidePicks: false,
  allowLiveBets: false,
  maxDuplicatePicks: null,
  waiverMode: 'waiver_order',
  correlationBlockEnabled: false,
  correlationRules: DEFAULT_CORRELATION_RULES,
  minGamesPerRoster: null,
  altLinesEnabled: true,
  lineMovementEnabled: true,
  conferencesEnabled: false,
  conferences: [
    { id: 'A', name: 'East' },
    { id: 'B', name: 'West' },
  ],
  playoffTeams: 4,
  eliminationType: 'single',
  buyInEnabled: false,
  buyInAmount: 0,
  payoutSplits: [100],
  showRealDollarStakes: false,
  poolMultipliers: DEFAULT_POOL_MULTIPLIER_SETTINGS,
  moments: DEFAULT_MOMENT_SETTINGS,
  propBetOverride: null,
  mlBetOverride: null,
  autoFillUserLineupsWhenSimulating: true,
};

// --- League / teams / rosters ---------------------------------------------

/** Unified team identity (manual v0.03 §3 #6, modes renamed manual v0.1.1 §2 #2) — a
 * team's badge is exactly one of these three modes at a time, picked from a single
 * "Team Logo" section rather than separate logo/avatar concepts. TeamLogo.tsx is the
 * one place that renders whichever mode is active. `'initials'` was called `'color'`
 * before v0.1.1 — see store/migrations.ts for the persisted-value rename. */
export type TeamLogoMode = 'emoji' | 'initials' | 'image';

/** Small default set used for auto-assigning simulated teams a distinct emoji — the
 * full categorized/searchable picker set lives in data/emojiPicker.ts (manual v0.1.1
 * §2 #1). */
export const TEAM_LOGO_EMOJIS = ['🦅', '🐻', '🐺', '🦁', '🐯', '🦈', '🐉', '🦂', '🐢', '🦍', '🦊', '🐗'] as const;

/** Shared shape for anything with a unified logo identity (a team, or the league
 * itself as of manual v0.1.1 §2 #3) — lets TeamLogo.tsx and the identity picker work
 * against either without duplicating the mode-dispatch logic. */
export interface LogoIdentity {
  logoMode: TeamLogoMode;
  logoEmoji: string; // used when logoMode === 'emoji'
  logoColor: string; // background color for 'initials' mode and behind 'emoji' mode
  logoDataUrl: string | null; // base64 data-URL, ~150KB cap; used when logoMode === 'image'
}

export interface LeagueTeam extends LogoIdentity {
  id: string;
  ownerName: string;
  teamName: string;
  abbrev: string;
  isUser: boolean;
  isSimulated: boolean;
  conferenceId: string | null;
}

export type WagerStatus = 'pending' | 'won' | 'lost' | 'push' | 'voided';

export interface Wager {
  id: string;
  slotId: string;
  gameId: string;
  marketKey: MarketKey;
  playerId?: string;
  playerName?: string;
  side: string; // 'Over' | 'Under' | 'Yes' | team name
  point?: number;
  oddsAtPlacement: number;
  stake: number;
  placedAt: string;
  status: WagerStatus;
  settledProfit: number | null;
}

export interface RosterSlotState {
  slotId: string;
  position: SlotPosition;
  wager: Wager | null;
}

export interface WeeklyRoster {
  week: WeekId;
  teamId: string;
  slots: RosterSlotState[];
  submitted: boolean;
}

export interface Matchup {
  id: string;
  week: WeekId;
  teamAId: string;
  teamBId: string;
  teamAScore: number | null;
  teamBScore: number | null;
  winnerId: string | null;
  isTie: boolean;
}

export interface TeamStanding {
  teamId: string;
  wins: number;
  losses: number;
  ties: number;
  totalPL: number;
  betsWon: number;
  betsLost: number;
  betsPushed: number;
  bestWeekPL: number;
  weeklyScores: Record<string, number>;
}

export type PlayoffFieldSize = 2 | 4 | 6 | 8 | 16;

/** Which side of the bracket a match belongs to. 'W'/'L' only exist in double-elim
 * brackets; single-elim brackets are 'W'-only plus a 'F' final. 'RESET' is the
 * bracket-reset rematch, only created if the losers-bracket finalist wins the final. */
export type BracketSide = 'W' | 'L' | 'F' | 'RESET';

/** Where a match's team comes from: a fixed initial seed, or the winner/loser of an
 * earlier match. This is what lets the bracket-advancement engine figure out which
 * matches are "ready to schedule" purely from what's already been settled, instead of
 * needing hand-planned per-field-size week tables. */
export type MatchSource = { type: 'seed'; seed: number } | { type: 'winner' | 'loser'; matchId: string };

export interface BracketMatch {
  id: string;
  side: BracketSide;
  label: string;
  sourceA: MatchSource;
  sourceB: MatchSource;
  teamAId: string | null;
  teamBId: string | null;
  teamAScore: number | null;
  teamBScore: number | null;
  winnerId: string | null;
  weekId: WeekId | null; // assigned once both sources resolve
}

export interface PlayoffBracket {
  fieldSize: PlayoffFieldSize;
  eliminationType: 'single' | 'double';
  seeds: string[]; // teamIds ranked 1..fieldSize, index 0 = #1 seed
  matches: BracketMatch[];
  championId: string | null;
}

export interface PoolWeekEntry {
  week: WeekId;
  poolBefore: number;
  poolAfter: number;
  netRealPL: number;
}

export interface PrizePool {
  initial: number;
  current: number;
  locked: boolean;
  history: PoolWeekEntry[];
}

export interface ActivityItem {
  id: string;
  ts: string;
  type: 'announcement' | 'reminder' | 'settled' | 'moment';
  message: string;
  pinned?: boolean;
  reactions?: Record<string, number>; // emoji -> local-only count
  /** Only set when type === 'moment' (manual v0.03 §4) — structured fields so the
   * feed's Moments tab can render a proper award card (category subtitle, team logo,
   * per-category extras) instead of just replaying `message`. */
  momentCategory?: MomentCategory;
  momentDisplayName?: string;
  momentWeek?: WeekId;
  momentTeamId?: string;
  momentExtra?: string;
  /** The prop's roster-slot position, when this moment centers on a single wager
   * (worstBeat/boldestBet/bestBet) — lets the card show a position-colored badge
   * (manual v0.1.1 §4 #8). Absent for whole-lineup or streak-based categories. */
  momentPosition?: SlotPosition;
}

export type SeasonPhase = 'regular' | 'playoffs' | 'complete';

export interface League {
  id: string;
  name: string;
  inviteCode: string;
  commissionerTeamId: string;
  settings: LeagueSettings;
  targetTeamCount: number;
  /** League-level identity (manual v0.03 §3 #7, gained the emoji mode manual v0.1.1
   * §2 #3) — same three-mode shape as a team's identity, rendered by the same
   * IdentityPicker/LeagueLogo components. */
  logoMode: TeamLogoMode;
  logoEmoji: string;
  logoDataUrl: string | null;
  logoColor: string;
  teams: LeagueTeam[];
  currentWeek: WeekId;
  seasonPhase: SeasonPhase;
  matchupsByWeek: Record<string, Matchup[]>;
  rostersByTeamWeek: Record<string, WeeklyRoster>;
  standings: TeamStanding[];
  bracket: PlayoffBracket | null;
  activity: ActivityItem[];
  prizePool: PrizePool | null;
  /** Dev-panel game-by-game stepper (manual §6): lets a single game (or a whole day
   * slot) be pushed to 'live' or 'final' ahead of the full weekly settlement, purely
   * for demo purposes — wager settlement still only happens on Advance Week. Cleared
   * each time a new week starts. */
  manualGameOverrides: Record<string, 'live' | 'final'>;
}

// --- Profile ---------------------------------------------------------------

export type OddsFormat = 'american' | 'decimal';

export interface UserProfile {
  username: string;
  avatarEmoji: string;
  oddsFormat: OddsFormat;
}

// --- Validation --------------------------------------------------------------

export interface SlotValidation {
  slotId: string;
  valid: boolean;
  reasons: string[];
}

export interface LineupValidationResult {
  valid: boolean;
  totalAllocated: number;
  remaining: number;
  distinctGames: number;
  slotResults: SlotValidation[];
  overallReasons: string[];
}
