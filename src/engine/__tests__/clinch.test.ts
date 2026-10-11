import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { clinchStatuses, type ClinchTeam } from '../clinch';
import * as server from '../../../supabase/functions/_shared/clinch';

const t = (id: string, wins: number, losses: number, remaining: number, group = 'all'): ClinchTeam => ({ id, group, wins, losses, ties: 0, remaining });

describe('clinch markers', () => {
  it('marks spots and eliminations, counting a possible tie against the team', () => {
    // 4 teams, 2 spots, 2 games left each. b can still reach a's 8 wins, so a is in but not yet #1.
    const s = clinchStatuses([t('a', 8, 0, 2), t('b', 6, 2, 2), t('c', 1, 7, 2), t('d', 0, 8, 2)], 2, 0);
    expect(s.get('a')).toBe('playoffs');
    expect(s.get('b')).toBe('playoffs');
    expect(s.get('c')).toBe('out');
    expect(s.get('d')).toBe('out');
  });

  it('gives the #1 seed once nobody can reach it, and byes in a 6-team style field', () => {
    const s = clinchStatuses([t('a', 10, 0, 1), t('b', 8, 2, 1), t('c', 5, 5, 1), t('d', 1, 9, 1)], 3, 2);
    expect(s.get('a')).toBe('top');
    expect(s.get('b')).toBe('bye');
    expect(s.get('c')).toBe('playoffs'); // d can reach 2 wins at most
    expect(s.get('d')).toBe('out');
  });

  it('marks nothing when every team makes the playoffs and the top can still be caught', () => {
    expect(clinchStatuses([t('a', 1, 0, 3), t('b', 0, 1, 3)], 2, 0).size).toBe(0);
  });

  it('works per conference', () => {
    const s = clinchStatuses([t('a', 9, 0, 1, 'E'), t('b', 1, 8, 1, 'E'), t('c', 9, 0, 1, 'W'), t('d', 1, 8, 1, 'W')], 1, 0);
    expect(s.get('a')).toBe('top');
    expect(s.get('c')).toBe('top');
    expect(s.get('b')).toBe('out');
  });

  it('the server copy is the same code', () => {
    const strip = (f: string) => readFileSync(f, 'utf8').split('\n').filter((l) => !l.startsWith('//')).join('\n');
    expect(strip('supabase/functions/_shared/clinch.ts')).toBe(strip('src/engine/clinch.ts'));
    const teams = [t('a', 8, 0, 2), t('b', 6, 2, 2), t('c', 1, 7, 2), t('d', 0, 8, 2)];
    expect([...server.clinchStatuses(teams, 2, 0)]).toEqual([...clinchStatuses(teams, 2, 0)]);
  });
});
