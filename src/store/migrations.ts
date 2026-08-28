import type { League, LeagueSettings, LeagueTeam, LogoIdentity, MomentSettings } from '../types';
import { DEFAULT_LEAGUE_SETTINGS, DEFAULT_MOMENT_SETTINGS, MOMENT_CATEGORIES } from '../types';

/** v0.03 §3 #6 unified "team logo" into one identity with an explicit mode instead of
 * separate logo/avatar concepts; v0.1.1 §2 #2 then renamed the `'color'` mode to
 * `'initials'` for clarity (it always meant the abbreviation-on-background-color
 * treatment, never a literal "color" thing). This single helper covers both: a
 * pre-v0.03 identity had no mode at all (inferred from whether an image was set), and
 * a v0.03-v0.1.0 identity may carry the old `'color'` string that needs renaming. */
function migrateLogoMode(rawMode: unknown, hasImage: boolean): LogoIdentity['logoMode'] {
  if (rawMode === 'color') return 'initials';
  if (rawMode === 'emoji' || rawMode === 'initials' || rawMode === 'image') return rawMode;
  return hasImage ? 'image' : 'initials';
}

function migrateTeam(raw: Record<string, unknown>): LeagueTeam {
  const logoDataUrl = (raw.logoDataUrl as string | null | undefined) ?? null;
  return {
    ...raw,
    conferenceId: (raw.conferenceId as string | null | undefined) ?? null,
    logoDataUrl,
    logoMode: migrateLogoMode(raw.logoMode, !!logoDataUrl),
    logoEmoji: (raw.logoEmoji as string | undefined) ?? '🏈',
  } as LeagueTeam;
}

/** v0.03 §4 replaced the 4-category momentLabels shape with an 8-category
 * moments block (fixed label + editable display name + per-category enabled flag).
 * There's no sensible way to carry a v0.02 commissioner's 4 custom names over onto the
 * new categories (the categories themselves changed), so this just backfills the full
 * v0.03 default set — matches the "revert to a sensible default" spirit of §3 #8 for a
 * shape that fundamentally changed rather than merely gained fields. */
function migrateMoments(raw: unknown): MomentSettings {
  if (raw && typeof raw === 'object' && MOMENT_CATEGORIES.every((c) => c in (raw as object))) {
    return raw as MomentSettings;
  }
  return DEFAULT_MOMENT_SETTINGS;
}

/** Bump whenever the persisted shape of AppState changes in a way that requires
 * backfilling — bug fixes / additive-only changes to existing fields don't need a bump.
 * Kept mostly for documentation/forward-compat: the real safety net is `normalizeLeagues`,
 * called unconditionally from the persist `merge` option below (see its comment for why). */
export const STORE_VERSION = 4;

/** Settings defaults are spread first so any setting introduced after a league was
 * persisted (e.g. a v0.01 league missing every v0.02 field) picks up its default
 * automatically — this needs no further edits as new settings fields are added, as
 * long as they're also added to DEFAULT_LEAGUE_SETTINGS. */
/** v0.1.1 §5 replaced the single boolean `allowDuplicatePicks` toggle with a numeric
 * cap (`maxDuplicatePicks`, null = unlimited) plus two new independent rules
 * (correlation blocking, min-games floor). A league that had duplicates OFF is
 * equivalent to the new cap of exactly 1 (fully exclusive) — the commissioner's
 * waiver/FCFS choice for contested picks carries over unchanged since `waiverMode`
 * didn't move. A league that had duplicates ON (the old default) needs no migration:
 * DEFAULT_LEAGUE_SETTINGS.maxDuplicatePicks is already null/unlimited. */
function migrateDuplicatePicksSetting(raw: Record<string, unknown>, merged: LeagueSettings): void {
  if ('allowDuplicatePicks' in raw && raw.allowDuplicatePicks === false && !('maxDuplicatePicks' in raw)) {
    merged.maxDuplicatePicks = 1;
  }
}

/** v0.3.0 §4 replaced the fixed `payoutSplitChampionPct`/`payoutSplitRunnerUpPct` pair
 * with the fully-custom `payoutSplits` array. A pre-v0.3.0 league always kept those two
 * fields summing to 100 by construction (the settings UI was a single champion-pct
 * slider with runner-up computed as the remainder), so the old pair converts losslessly:
 * a nonzero runner-up cut becomes a two-place split, otherwise it's winner-take-all. */
function migratePayoutSplits(raw: Record<string, unknown>, merged: LeagueSettings): void {
  if ('payoutSplits' in raw) return;
  const championPct = typeof raw.payoutSplitChampionPct === 'number' ? raw.payoutSplitChampionPct : 100;
  const runnerUpPct = typeof raw.payoutSplitRunnerUpPct === 'number' ? raw.payoutSplitRunnerUpPct : 0;
  merged.payoutSplits = runnerUpPct > 0 ? [championPct, runnerUpPct] : [100];
}

function migrateSettings(raw: unknown): LeagueSettings {
  const rawObj = (raw as Record<string, unknown>) ?? {};
  const merged = { ...DEFAULT_LEAGUE_SETTINGS, ...(raw as Partial<LeagueSettings>) };
  merged.moments = migrateMoments((raw as { moments?: unknown } | undefined)?.moments);
  migrateDuplicatePicksSetting(rawObj, merged);
  migratePayoutSplits(rawObj, merged);
  return merged;
}

/** Backfills League-level fields introduced after a league was persisted. Unlike
 * settings there's no single defaults object to spread (every league is unique), so
 * each new top-level field needs an explicit line here as it's introduced. Always
 * additive — existing user data (teams, rosters, standings, activity, bracket) is
 * never rewritten or dropped. Idempotent, so re-running it on already-current data
 * (which happens on every load, see normalizeLeagues) is a no-op. */
/** The playoff bracket's shape changed (div/conf round arrays -> a flat `matches` list
 * that supports variable field sizes and double-elimination). A bracket persisted
 * under the old shape can't be reinterpreted, so it's dropped — safe because a
 * missing bracket just means playoff seeding re-runs next Advance Week, and any
 * league not yet in the old-shaped bracket's rounds is unaffected. */
function migrateBracket(raw: unknown): { bracket: League['bracket']; invalidated: boolean } {
  if (!raw || typeof raw !== 'object') return { bracket: null, invalidated: false };
  if ('matches' in raw) return { bracket: raw as League['bracket'], invalidated: false };
  return { bracket: null, invalidated: true };
}

export function migrateLeague(raw: Record<string, unknown>): League {
  const teams = ((raw.teams as Record<string, unknown>[] | undefined) ?? []).map(migrateTeam);
  const { bracket, invalidated } = migrateBracket(raw.bracket);
  const seasonPhase = invalidated ? 'regular' : ((raw.seasonPhase as League['seasonPhase'] | undefined) ?? 'regular');
  const currentWeek = invalidated ? 18 : ((raw.currentWeek as League['currentWeek'] | undefined) ?? 1);
  return {
    ...raw,
    targetTeamCount: (raw.targetTeamCount as number | undefined) ?? teams.length ?? 10,
    settings: migrateSettings(raw.settings),
    // v0.03 §3 #7: league-level logo, additive — falls back to the same initials/color
    // treatment a team gets when it has no uploaded image. Gained the emoji mode in
    // v0.1.1 §2 #3, hence the same migrateLogoMode helper teams use.
    logoDataUrl: (raw.logoDataUrl as string | null | undefined) ?? null,
    logoColor: (raw.logoColor as string | undefined) ?? '#4C8DF5',
    logoMode: migrateLogoMode(raw.logoMode, !!raw.logoDataUrl),
    logoEmoji: (raw.logoEmoji as string | undefined) ?? '🏆',
    prizePool: (raw.prizePool as League['prizePool'] | undefined) ?? null,
    manualGameOverrides: (raw.manualGameOverrides as League['manualGameOverrides'] | undefined) ?? {},
    teams,
    bracket,
    seasonPhase,
    currentWeek,
  } as League;
}

/** Backfills every league in a persisted (or freshly-migrated) `leagues` map.
 *
 * This is called from the persist `merge` option rather than only from `migrate`,
 * because zustand's persist middleware only invokes `migrate` when the stored blob
 * has a *numeric* `version` key that differs from the configured one (see
 * node_modules/zustand/esm/middleware.mjs) — real v0.01 output has no `version` key
 * at all, so `migrate` would silently never run for it. `merge` runs on every load
 * regardless, so backfilling there is what actually protects old data. Safe to run
 * on already-current leagues too since migrateLeague is idempotent. */
export function normalizeLeagues(leagues: Record<string, unknown> | undefined): Record<string, League> {
  const out: Record<string, League> = {};
  for (const [id, league] of Object.entries(leagues ?? {})) {
    out[id] = migrateLeague(league as Record<string, unknown>);
  }
  return out;
}

/** zustand/middleware `persist` `migrate` hook — only reached when the stored blob
 * does carry a numeric version different from STORE_VERSION. Delegates to the same
 * normalization `merge` always applies, so this is really just belt-and-suspenders
 * for the case where storage adapters preserve `version` correctly. */
export function migratePersistedState(persisted: unknown, _version: number): unknown {
  const state = (persisted ?? {}) as { profile?: unknown; leagues?: Record<string, unknown>; currentLeagueId?: unknown };
  return { ...state, leagues: normalizeLeagues(state.leagues) };
}
