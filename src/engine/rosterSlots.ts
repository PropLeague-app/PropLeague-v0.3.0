import type { Position, RosterSlotState, SlotPosition, WeeklyRoster, WeekId } from '../types';

const SLOT_ORDER: SlotPosition[] = ['QB', 'RB', 'WR', 'TE', 'K', 'ML'];

export function buildEmptySlots(lineupSlots: Record<Position | 'ML', number>): RosterSlotState[] {
  const slots: RosterSlotState[] = [];
  for (const position of SLOT_ORDER) {
    const count = lineupSlots[position] ?? 0;
    for (let i = 0; i < count; i++) {
      slots.push({ slotId: `${position}-${i + 1}`, position, wager: null });
    }
  }
  return slots;
}

export function buildEmptyRoster(
  teamId: string,
  week: WeekId,
  lineupSlots: Record<Position | 'ML', number>,
): WeeklyRoster {
  return { week, teamId, slots: buildEmptySlots(lineupSlots), submitted: false };
}

export function rosterKey(teamId: string, week: WeekId): string {
  return `${teamId}:${week}`;
}
