import { describe, it, expect } from 'vitest';
import * as client from '../../dayWindows';
import * as srv from '../../../../supabase/functions/_shared/dayWindows';

// The window names are hand copied into the edge functions' shared folder; same inputs, same names.
describe('day window names (app and server copies)', () => {
  it('agree on order, long and short names', () => {
    expect(srv.DAY_SLOT_ORDER).toEqual(client.DAY_SLOT_ORDER);
    expect(srv.DAY_SLOT_LONG).toEqual(client.DAY_SLOT_LONG);
    expect(srv.DAY_SLOT_SHORT).toEqual(client.DAY_SLOT_SHORT);
    for (const slot of [...client.DAY_SLOT_ORDER, 'XYZ']) {
      expect(srv.daySlotLong(slot)).toBe(client.daySlotLong(slot));
      expect(srv.daySlotShort(slot)).toBe(client.daySlotShort(slot));
    }
  });
  it('names every window, with the short forms agreed on', () => {
    expect(client.DAY_SLOT_ORDER.map(client.daySlotShort)).toEqual(['Wed', 'TNF', 'Sat', 'Sun Early', 'Sun Late', 'SNF', 'MNF']);
    expect(client.daySlotLong('SUN_EARLY')).toBe('Sunday Early');
    expect(client.daySlotLong('XYZ')).toBe('XYZ');
  });
  it('the Sunday card covers both Sunday afternoon windows', () => {
    expect(srv.WINDOW_OF_SLOT.SUN_EARLY).toBe('SUN');
    expect(srv.WINDOW_OF_SLOT.SUN_LATE).toBe('SUN');
    expect(srv.WINDOW_LONG.SUN).toBe('Sunday');
    for (const slot of client.DAY_SLOT_ORDER) expect(srv.WINDOW_LONG[srv.WINDOW_OF_SLOT[slot]]).toBeTruthy();
  });
});
