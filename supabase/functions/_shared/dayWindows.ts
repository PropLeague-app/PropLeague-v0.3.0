// Server copy of src/engine/dayWindows.ts (Deno deploy cannot reach across directories). Keep the
// two in step; src/engine/__tests__/server/sharedModules.test.ts compares them.
//   long  : pushes, the Live Activity, NFL Slate headings ("Sunday Early")
//   short : tight spots like My Stats rows ("Sun Early", "TNF")
export type DaySlot = 'WED' | 'TNF' | 'SAT' | 'SUN_EARLY' | 'SUN_LATE' | 'SNF' | 'MNF';

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

/** The Live Activity's score window for each slot: Sunday early and late share one card. */
export const WINDOW_OF_SLOT: Record<string, string> = { WED: 'WED', TNF: 'TNF', SAT: 'SAT', SUN_EARLY: 'SUN', SUN_LATE: 'SUN', SNF: 'SNF', MNF: 'MNF' };

/** Long names for those windows (the shared Sunday card is just "Sunday"). */
export const WINDOW_LONG: Record<string, string> = { WED: 'Wednesday', TNF: 'Thursday Night', SAT: 'Saturday', SUN: 'Sunday', SNF: 'Sunday Night', MNF: 'Monday Night' };
