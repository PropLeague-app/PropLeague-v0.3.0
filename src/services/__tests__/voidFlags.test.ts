import { describe, it, expect, vi } from 'vitest';

vi.mock('../../lib/supabaseClient', () => ({ supabase: {} }));

import { groupVoidCandidates, searchVoidPlayers, voidReasonLabel, type VoidCandidateRow } from '../voidFlags';

const row = (over: Partial<VoidCandidateRow>): VoidCandidateRow => ({
  player_name: 'A Player',
  game_id: 'g1',
  flag_id: null,
  flag_reason: null,
  flag_note: null,
  team_id: 't1',
  team_name: 'Team One',
  wager_id: 'w1',
  market_key: 'player_reception_yds',
  side: 'Over',
  point: 60.5,
  stake: 10,
  status: 'lost',
  ...over,
});

describe('groupVoidCandidates', () => {
  it('groups picks by player, A to Z, and carries the flag details', () => {
    const groups = groupVoidCandidates([
      row({ player_name: 'Zed', wager_id: 'a' }),
      row({ player_name: 'Amy', wager_id: 'b' }),
      row({ player_name: 'Zed', wager_id: 'c', flag_id: 'f1', flag_reason: 'injury', flag_note: 'knee', status: 'voided' }),
    ]);
    expect(groups.map((g) => g.playerName)).toEqual(['Amy', 'Zed']);
    expect(groups[1].flagId).toBe('f1');
    expect(groups[1].flagReason).toBe('injury');
    expect(groups[1].picks).toHaveLength(2);
    expect(groups[0].flagId).toBeNull();
  });
});

describe('searchVoidPlayers', () => {
  const groups = groupVoidCandidates([
    row({ player_name: 'Rashee Rice', wager_id: 'a' }),
    row({ player_name: "Ja'Marr Chase", wager_id: 'b', flag_id: 'f1' }),
    row({ player_name: 'Jahmyr Gibbs', wager_id: 'c' }),
  ]);

  it('matches case and punctuation insensitively', () => {
    expect(searchVoidPlayers(groups, 'rashee').map((g) => g.playerName)).toEqual(['Rashee Rice']);
    expect(searchVoidPlayers(groups, 'GIBBS').map((g) => g.playerName)).toEqual(['Jahmyr Gibbs']);
  });
  it('skips already flagged players and empty queries', () => {
    expect(searchVoidPlayers(groups, 'marr')).toEqual([]);
    expect(searchVoidPlayers(groups, '  ')).toEqual([]);
  });
});

describe('voidReasonLabel', () => {
  it('labels known reasons and falls back for older flags', () => {
    expect(voidReasonLabel('injury')).toBe('Early exit: injury');
    expect(voidReasonLabel('0 snaps in the 2nd half')).toBe('Early exit');
    expect(voidReasonLabel(null)).toBe('Early exit');
  });
});
