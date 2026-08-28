import type { WeekId } from '../../types';
import { weekLabel } from '../../types';

const ALL_WEEKS: WeekId[] = [...Array.from({ length: 18 }, (_, i) => i + 1), 'WC', 'DIV', 'CONF'];

export function WeekSelector({ value, onChange }: { value: WeekId; onChange: (week: WeekId) => void }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-1">
      {ALL_WEEKS.map((week) => (
        <button
          key={String(week)}
          onClick={() => onChange(week)}
          className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border ${
            week === value ? 'bg-primary text-white border-primary' : 'bg-bg-card border-border text-text-muted'
          }`}
        >
          {typeof week === 'number' ? week : weekLabel(week)}
        </button>
      ))}
    </div>
  );
}
