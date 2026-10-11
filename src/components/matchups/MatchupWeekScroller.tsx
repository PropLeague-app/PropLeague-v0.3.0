import { useEffect, useRef } from 'react';
import type { WeekId } from '../../types';
import { nflWeekName } from '../../engine/bracketModel';

/**
 * The Matchups screen's week picker, sideways only. Regular-season weeks are plain chips (an NFL playoff
 * week the league plays as a regular-season week reads WC or DIV). The playoff weeks sit under a
 * bracket-shaped "Playoffs" line, each chip naming our round with the real NFL week under it ("Semis",
 * "NFL Div"). The current week has a dot; the selected chip is kept in view.
 */
export function MatchupWeekScroller({
  regularWeeks,
  playoffWeeks,
  roundOf,
  currentWeek,
  value,
  onChange,
  startNote,
}: {
  /** "Week 2" when the league started after Week 1: shown at the start as "Season started Week 2". */
  startNote?: string;
  regularWeeks: WeekId[];
  playoffWeeks: WeekId[];
  roundOf: (week: WeekId) => string;
  currentWeek: WeekId;
  value: WeekId;
  onChange: (week: WeekId) => void;
}) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [value]);

  const chip = (week: WeekId, playoff: boolean) => {
    const selected = String(week) === String(value);
    const isCurrent = String(week) === String(currentWeek);
    const round = playoff ? roundOf(week) : '';
    return (
      <button
        key={String(week)}
        ref={selected ? selectedRef : undefined}
        type="button"
        onClick={() => onChange(week)}
        aria-pressed={selected}
        className={`relative shrink-0 h-10 rounded-xl border flex flex-col items-center justify-center leading-none ${
          playoff ? 'px-2.5 min-w-[58px]' : 'min-w-[38px] px-2'
        } ${selected ? 'sel-pill' : 'bg-bg-card border-border text-text-muted'}`}
      >
        <span className="text-xs font-semibold">{playoff ? round || nflWeekName(week, true) : String(week)}</span>
        {playoff && round && <span className="mt-1 text-[9px] font-medium opacity-75">{nflWeekName(week, true)}</span>}
        {isCurrent && <span className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${selected ? 'bg-on-primary' : 'bg-primary'}`} />}
      </button>
    );
  };

  return (
    <div className="flex items-start gap-1.5 overflow-x-auto overflow-y-hidden overscroll-x-contain -mx-4 px-4 pt-0.5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {startNote && (
        <div className="shrink-0 h-10 px-2 rounded-xl border border-dashed border-border flex flex-col items-center justify-center leading-tight text-text-muted">
          <span className="text-[9px] font-medium">Season started</span>
          <span className="text-[10px] font-semibold">{startNote}</span>
        </div>
      )}
      {regularWeeks.map((w) => chip(w, false))}
      {playoffWeeks.length > 0 && (
        <div className="shrink-0 flex flex-col items-stretch ml-1.5">
          <div className="flex gap-1.5">{playoffWeeks.map((w) => chip(w, true))}</div>
          {/* The bracket line: ticks up at both ends, "Playoffs" on it. */}
          <div className="relative mt-1.5 mb-1 h-2 mx-1 border-x border-b border-primary/50 rounded-b-md">
            <span className="absolute left-1/2 top-full -translate-x-1/2 -translate-y-1/2 px-1 bg-bg-raised text-[8px] font-bold uppercase tracking-wider text-primary leading-none">
              Playoffs
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
