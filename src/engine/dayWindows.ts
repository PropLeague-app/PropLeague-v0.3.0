// Names for the NFL kickoff windows (day slots), in one place (1.2.10). The server keeps an exact
// copy in supabase/functions/_shared/dayWindows.ts (Deno deploy cannot import from src/), kept in
// step by src/engine/__tests__/server/sharedModules.test.ts.
//   long  : pushes, the Live Activity, NFL Slate headings ("Sunday Early")
//   short : tight spots like My Stats rows ("Sun Early", "TNF")
import type { DaySlot } from '../types';

export const DAY_SLOT_ORDER: DaySlot[] = ['WED', 'TNF', 'SAT', 'SUN_EARLY', 'SUN_LATE', 'SNF', 'MNF'];

export const DAY_SLOT_LONG: Record<DaySlot, string> = {
  WED: 'Wednesday',
  TNF: 'Thursday Night',
  SAT: 'Saturday',
  SUN_EARLY: 'Sunday Early',
  SUN_LATE: 'Sunday Late',
  SNF: 'Sunday Night',
  MNF: 'Monday Night',
};

export const DAY_SLOT_SHORT: Record<DaySlot, string> = {
  WED: 'Wed',
  TNF: 'TNF',
  SAT: 'Sat',
  SUN_EARLY: 'Sun Early',
  SUN_LATE: 'Sun Late',
  SNF: 'SNF',
  MNF: 'MNF',
};

/** Long name for a slot code, falling back to the code itself for anything unknown. */
export function daySlotLong(slot: string): string {
  return (DAY_SLOT_LONG as Record<string, string>)[slot] ?? slot;
}

/** Short name for a slot code, falling back to the code itself for anything unknown. */
export function daySlotShort(slot: string): string {
  return (DAY_SLOT_SHORT as Record<string, string>)[slot] ?? slot;
}
