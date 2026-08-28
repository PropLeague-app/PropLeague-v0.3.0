import { describe, it, expect } from 'vitest';
import { migrateLeague } from '../migrations';

function rawLeague(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'league-1',
    name: 'Test League',
    teams: [],
    settings: {},
    ...overrides,
  };
}

describe('migrateSettings — duplicate picks rework (manual v0.1.1 §5 A migration)', () => {
  it('migrates a pre-v0.1.1 league with duplicates OFF to maxDuplicatePicks: 1', () => {
    const league = migrateLeague(rawLeague({ settings: { allowDuplicatePicks: false, waiverMode: 'fcfs' } }));
    expect(league.settings.maxDuplicatePicks).toBe(1);
    expect(league.settings.waiverMode).toBe('fcfs');
  });

  it('preserves the waiver/FCFS choice through the migration', () => {
    const league = migrateLeague(rawLeague({ settings: { allowDuplicatePicks: false, waiverMode: 'waiver_order' } }));
    expect(league.settings.waiverMode).toBe('waiver_order');
  });

  it('leaves a pre-v0.1.1 league with duplicates ON unlimited (unchanged default)', () => {
    const league = migrateLeague(rawLeague({ settings: { allowDuplicatePicks: true } }));
    expect(league.settings.maxDuplicatePicks).toBeNull();
  });

  it('leaves a league with no settings at all on the new unlimited default', () => {
    const league = migrateLeague(rawLeague({ settings: undefined }));
    expect(league.settings.maxDuplicatePicks).toBeNull();
    expect(league.settings.correlationBlockEnabled).toBe(false);
    expect(league.settings.minGamesPerRoster).toBeNull();
  });

  it('does not override an already-migrated maxDuplicatePicks value', () => {
    const league = migrateLeague(rawLeague({ settings: { allowDuplicatePicks: false, maxDuplicatePicks: 3 } }));
    expect(league.settings.maxDuplicatePicks).toBe(3);
  });

  it('backfills default correlation rules for a pre-v0.1.1 league', () => {
    const league = migrateLeague(rawLeague({ settings: {} }));
    expect(league.settings.correlationRules.length).toBeGreaterThan(0);
  });
});

describe('migrateSettings — payout split rework (manual v0.3.0 §4 migration)', () => {
  it('converts a pre-v0.3.0 winner-take-all league to a single-place split', () => {
    const league = migrateLeague(rawLeague({ settings: { payoutSplitChampionPct: 100, payoutSplitRunnerUpPct: 0 } }));
    expect(league.settings.payoutSplits).toEqual([100]);
  });

  it('converts a pre-v0.3.0 champion/runner-up league to a two-place split', () => {
    const league = migrateLeague(rawLeague({ settings: { payoutSplitChampionPct: 80, payoutSplitRunnerUpPct: 20 } }));
    expect(league.settings.payoutSplits).toEqual([80, 20]);
  });

  it('leaves a league with no settings at all on the new winner-take-all default', () => {
    const league = migrateLeague(rawLeague({ settings: undefined }));
    expect(league.settings.payoutSplits).toEqual([100]);
  });

  it('does not override an already-migrated payoutSplits value', () => {
    const league = migrateLeague(rawLeague({ settings: { payoutSplits: [60, 30, 10] } }));
    expect(league.settings.payoutSplits).toEqual([60, 30, 10]);
  });
});
