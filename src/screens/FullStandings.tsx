import { useMemo, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { formatCents } from '../engine/oddsMath';
import { computeTeamStreak, totalWageredByTeam } from '../engine/stats';
import { sortStandings } from '../engine/standings';
import { activeMultipliers } from '../engine/prizePool';
import { BackHeader, BACK_HEADER_HEIGHT } from '../components/layout/BackHeader';
import { TeamLogo } from '../components/common/TeamLogo';
import { LeagueLogo } from '../components/common/LeagueLogo';
import type { League, TeamStanding } from '../types';

type SortKey = 'default' | 'pl' | 'bets' | 'best';
type ViewMode = 'overall' | 'conference';

/** manual v0.3.0 §6: record + P/L are the only columns that matter at a glance —
 * ROI/streak/bet record/best-week are all secondary, and collapse behind a single
 * page-level "Advanced" toggle on narrow screens instead of cramming a 5+ column grid.
 * Both the primary and advanced grids are shared constants so the header row and every
 * data row (overall or per-conference) are always pixel-aligned to each other. */
const PRIMARY_GRID = 'grid-cols-[1.8fr_0.8fr_1fr]';
const ADVANCED_GRID = 'grid-cols-[1fr_1fr_1.1fr_0.9fr]';
const ADVANCED_GRID_WITH_MULT = 'grid-cols-[0.9fr_0.9fr_1fr_0.8fr_0.8fr]';

function StandingsHeaderRow({
  sortKey,
  onSort,
  advancedOpen,
  showMultiplier,
}: {
  sortKey: SortKey;
  onSort?: (k: SortKey) => void;
  advancedOpen: boolean;
  showMultiplier: boolean;
}) {
  function headerButton(key: SortKey, label: string) {
    if (!onSort) return <span>{label}</span>;
    return (
      <button onClick={() => onSort(key)} className={`text-[11px] font-semibold ${sortKey === key ? 'text-primary' : 'text-text-muted'}`}>
        {label}
      </button>
    );
  }
  return (
    <div className="sticky z-10 bg-bg pb-1.5" style={{ top: BACK_HEADER_HEIGHT }}>
      <div className={`grid ${PRIMARY_GRID} gap-1 px-2 pt-2 text-[11px] text-text-muted font-semibold`}>
        <span>Team</span>
        <span className="text-center">{headerButton('default', 'W-L')}</span>
        <span className="text-right">{headerButton('pl', 'P/L')}</span>
      </div>
      {advancedOpen && (
        <div
          className={`grid ${showMultiplier ? ADVANCED_GRID_WITH_MULT : ADVANCED_GRID} gap-1 px-2 pt-1 text-[10px] text-text-muted font-semibold border-t border-border/60 mt-1.5 pt-1.5`}
        >
          <span className="text-center">ROI</span>
          <span className="text-center">Streak</span>
          <span className="text-center">{headerButton('bets', 'Bets')}</span>
          <span className="text-right">{headerButton('best', 'Best Wk')}</span>
          {showMultiplier && <span className="text-right">Mult</span>}
        </div>
      )}
    </div>
  );
}

function StandingsRows({
  league,
  rows,
  playoffCutoff,
  advancedOpen,
  showMultiplier,
}: {
  league: League;
  rows: TeamStanding[];
  playoffCutoff: number;
  advancedOpen: boolean;
  showMultiplier: boolean;
}) {
  const multipliers = showMultiplier ? activeMultipliers(league) : null;
  return (
    <div className="space-y-1.5">
      {rows.map((s, i) => {
        const team = league.teams.find((t) => t.id === s.teamId);
        if (!team) return null;
        const streak = computeTeamStreak(league, s.teamId);
        const wagered = totalWageredByTeam(league, s.teamId);
        const roi = wagered > 0 ? s.totalPL / wagered : 0;
        const multiplier = multipliers?.[s.teamId] ?? 1;
        return (
          <div key={s.teamId}>
            <div className={`rounded-lg text-xs ${team.isUser ? 'bg-primary/10' : 'bg-bg-card'}`}>
              <div className={`grid ${PRIMARY_GRID} gap-1 items-center px-2 py-2`}>
                <span className="truncate font-medium flex items-center gap-1.5 min-w-0">
                  <span className="shrink-0 text-text-muted">{i + 1}.</span>
                  <TeamLogo team={team} size="sm" />
                  <span className="truncate">{team.teamName}</span>
                </span>
                <span className="text-center tabular-nums">
                  {s.wins}-{s.losses}
                  {s.ties ? `-${s.ties}` : ''}
                </span>
                <span className={`text-right font-semibold tabular-nums ${s.totalPL >= 0 ? 'text-profit' : 'text-loss'}`}>{formatCents(s.totalPL)}</span>
              </div>
              {advancedOpen && (
                <div
                  className={`grid ${showMultiplier ? ADVANCED_GRID_WITH_MULT : ADVANCED_GRID} gap-1 items-center px-2 pb-2 text-[11px] text-text-muted border-t border-border/60 pt-1.5`}
                >
                  <span className={`text-center tabular-nums ${roi >= 0 ? 'text-profit' : 'text-loss'}`}>{(roi * 100).toFixed(1)}%</span>
                  <span className="text-center tabular-nums">{streak.type ? `${streak.type}${streak.count}` : '—'}</span>
                  <span className="text-center tabular-nums">
                    {s.betsWon}-{s.betsLost}-{s.betsPushed}
                  </span>
                  <span className="text-right tabular-nums">{formatCents(s.bestWeekPL)}</span>
                  {showMultiplier && (
                    <span className={`text-right tabular-nums font-semibold ${multiplier >= 1 ? 'text-profit' : 'text-loss'}`}>{multiplier.toFixed(2)}x</span>
                  )}
                </div>
              )}
            </div>
            {i === playoffCutoff - 1 && i !== rows.length - 1 && (
              <div className="flex items-center gap-2 my-1.5 px-2">
                <div className="flex-1 border-t border-dashed border-primary/50" />
                <span className="text-[10px] text-primary font-semibold">PLAYOFF LINE</span>
                <div className="flex-1 border-t border-dashed border-primary/50" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function FullStandings() {
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const [sortKey, setSortKey] = useState<SortKey>('default');
  // manual v0.3.0 §6: advanced columns (ROI/streak/bet record/best week) default
  // collapsed on this mobile-first layout — one toggle for the whole page rather than
  // a horizontal-scrolling wide table.
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const hasConferences = !!league?.settings.conferencesEnabled && league.teams.some((t) => t.conferenceId);
  const [view, setView] = useState<ViewMode>(hasConferences ? 'conference' : 'overall');

  const sorted = useMemo(() => {
    if (!league) return [];
    const rows = [...league.standings];
    if (sortKey === 'pl') rows.sort((a, b) => b.totalPL - a.totalPL);
    else if (sortKey === 'bets') rows.sort((a, b) => b.betsWon - b.betsLost - (a.betsWon - a.betsLost));
    else if (sortKey === 'best') rows.sort((a, b) => b.bestWeekPL - a.bestWeekPL);
    return rows;
  }, [league, sortKey]);

  if (!league) return null;
  const playoffCutoff = league.settings.playoffTeams;
  const showMultiplier = league.settings.poolMultipliers.enabled;

  return (
    <div className="flex flex-col">
      <BackHeader title="Standings" fallback="/home" />
      <div className="px-4 pb-4 space-y-3">
        <div className="flex items-center justify-between gap-2 pt-3">
          <div className="flex items-center gap-2 min-w-0">
            <LeagueLogo league={league} size="md" />
            <p className="text-sm font-semibold truncate">{league.name}</p>
          </div>
          <button
            onClick={() => setAdvancedOpen((v) => !v)}
            className={`shrink-0 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border ${
              advancedOpen ? 'border-primary text-primary bg-primary/10' : 'border-border text-text-muted'
            }`}
          >
            {advancedOpen ? 'Hide advanced' : 'Show advanced'}
          </button>
        </div>
        {hasConferences && (
          <div className="flex bg-bg-card rounded-lg overflow-hidden w-fit">
            {(['conference', 'overall'] as const).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 text-xs font-semibold capitalize ${view === v ? 'bg-primary text-white' : 'text-text-muted'}`}
              >
                {v === 'conference' ? 'By conference' : 'Overall'}
              </button>
            ))}
          </div>
        )}

        {view === 'conference' && hasConferences ? (
          <div className="space-y-5">
            {league.settings.conferences.map((conf) => {
              const confTeamIds = new Set(league.teams.filter((t) => t.conferenceId === conf.id).map((t) => t.id));
              const confStandings = sortStandings(
                league.standings.filter((s) => confTeamIds.has(s.teamId)),
                league.matchupsByWeek,
              );
              return (
                <div key={conf.id}>
                  <p className="text-sm font-bold mb-1.5 flex items-center gap-1.5">
                    <span className="w-1.5 h-4 rounded-full bg-primary inline-block" />
                    {conf.name}
                  </p>
                  <StandingsHeaderRow sortKey="default" advancedOpen={advancedOpen} showMultiplier={showMultiplier} />
                  <div className="mt-1.5">
                    <StandingsRows
                      league={league}
                      rows={confStandings}
                      playoffCutoff={Math.floor(playoffCutoff / 2)}
                      advancedOpen={advancedOpen}
                      showMultiplier={showMultiplier}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <>
            <StandingsHeaderRow sortKey={sortKey} onSort={setSortKey} advancedOpen={advancedOpen} showMultiplier={showMultiplier} />
            <StandingsRows league={league} rows={sorted} playoffCutoff={playoffCutoff} advancedOpen={advancedOpen} showMultiplier={showMultiplier} />
          </>
        )}
      </div>
    </div>
  );
}
