import type { WeekId } from '../../types';
import { weekLabel } from '../../types';

const ALL_WEEKS: WeekId[] = [...Array.from({ length: 18 }, (_, i) => i + 1), 'WC', 'DIV', 'CONF'];

/** The current week carries a dot, the same marker All Matchups' week scroller uses. */
export function WeekSelector({ value, currentWeek, onChange }: { value: WeekId; currentWeek?: WeekId; onChange: (week: WeekId) => void }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {ALL_WEEKS.map((week) => {
        const selected = week === value;
        const isCurrent = currentWeek != null && String(week) === String(currentWeek);
        return (
          <button
            key={String(week)}
            onClick={() => onChange(week)}
            className={`relative shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border ${
              selected ? 'sel-pill' : 'bg-bg-card border-border text-text-muted'
            }`}
          >
            {typeof week === 'number' ? week : weekLabel(week)}
            {isCurrent && <span className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${selected ? 'bg-on-primary' : 'bg-primary'}`} />}
          </button>
        );
      })}
    </div>
  );
}
