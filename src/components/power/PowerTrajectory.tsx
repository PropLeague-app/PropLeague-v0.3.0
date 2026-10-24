import { useMemo } from 'react';
import type { League, WeekId } from '../../types';
import { weekLabel } from '../../types';
import type { PowerPoint } from '../../engine/powerRankings';
import { TeamLogo } from '../common/TeamLogo';
import { placeLabels } from './labelPlacement';

/** Every team's power score over the season, with one line picked out.
 *
 * Plots the score rather than the rank. Rank is an integer over eight teams, so a rank chart is a
 * staircase: a team can gain real ground on a Sunday without passing anybody and the line stays
 * flat. Score moves on every settled pick, which is what makes the lines separate (see chat, Oct
 * 2026).
 *
 * Every line carries its own team's colour, and the unselected ones are dimmed rather than greyed,
 * so the chart still reads as the league rather than as one team against a crowd. Each line ends in
 * that team's logo, which is also how you switch to them.
 */
export function PowerTrajectory({
  league,
  series,
  selectedTeamId,
  onSelect,
  scrubIndex,
  onScrub,
  height = 240,
  plotWidth = 320,
}: {
  league: League;
  series: Record<string, PowerPoint[]>;
  selectedTeamId: string;
  onSelect?: (teamId: string) => void;
  /** Which week the reader is holding on, or null for "as it stands". */
  scrubIndex?: number | null;
  onScrub?: (index: number | null) => void;
  height?: number;
  /** The drawing's own width in plot units. The screen uses 320; a wide share picture passes more so
   *  the lines get room instead of the whole drawing being stretched. */
  plotWidth?: number;
}) {
  const W = plotWidth;
  const teamCount = league.teams.length;
  /** Room for one badge per team, up to a point. Past that the badges stagger into two columns so
   *  a 16-team league does not need a chart half a screen tall (see chat, Oct 2026). */
  const H = Math.max(height, Math.min(teamCount * 30, 420));
  const stagger = teamCount * 30 > 420;
  const padL = 4;
  const padR = 30; // the logos sit out here, past the end of the lines
  const padY = 16;
  /** Badge footprint in plot units, so two teams level on score do not stack on each other.
   *  TeamLogo "sm" renders at 24px; the extra 4 is breathing room. Measured rather than assumed:
   *  guessing it at 26 for a badge that was 16 spread the logos much further from their own lines
   *  than they needed to be. */
  const LOGO = 28;

  const { weeks, zeroY, paths, markers, columnOf, xAt } = useMemo(() => {
    const anyTeam = Object.values(series).find((p) => p.length > 0) ?? [];
    const ws: WeekId[] = anyTeam.map((p) => p.week);
    const all = Object.values(series).flat().map((p) => p.score);
    let min = all.length ? Math.min(...all, 0) : 0;
    let max = all.length ? Math.max(...all, 0) : 0;
    if (max - min < 1) {
      min -= 1;
      max += 1;
    }
    const x = (i: number) => padL + (ws.length <= 1 ? 0 : (i * (W - padL - padR)) / (ws.length - 1));
    const y = (v: number) => padY + ((max - v) / (max - min)) * (H - padY * 2);

    const at = scrubIndex == null ? -1 : Math.min(scrubIndex, ws.length - 1);
    const built = league.teams.map((t) => {
      const pts = series[t.id] ?? [];
      const cut = at < 0 ? pts.length - 1 : Math.min(at, pts.length - 1);
      const last = cut >= 0 ? pts[cut] : null;
      return {
        teamId: t.id,
        d: pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(' '),
        points: pts.length,
        endX: cut >= 0 ? x(cut) : 0,
        // trueY is where the line actually is; endY is where the logo ends up once overlapping
        // badges have been pushed apart. The de-overlap below mutates endY in place, and these are
        // the same objects, so the two have to be separate fields or the dots drift off the lines.
        trueY: last ? y(last.score) : 0,
        endY: last ? y(last.score) : 0,
        score: last?.score ?? 0,
      };
    });

    // Spread the endpoint logos so all eight stay readable. Only the logo moves; the line still
    // ends at its true value, which is what trueY holds.
    const placed = [...built].filter((b) => b.points > 0);
    const gap = (stagger ? 0.55 : 0.92) * LOGO;
    const spread = placeLabels(placed.map((b) => b.trueY), gap, LOGO / 2, H - LOGO / 2);
    placed.forEach((item, i) => {
      item.endY = spread[i];
    });

    // Columns are assigned by where a badge ended up vertically, not by its position in the team
    // list: alternating on array order put vertical neighbours in the same column and they
    // overlapped anyway (see chat, Oct 2026).
    const columnOf: Record<string, number> = {};
    [...placed]
      .sort((a, b) => a.endY - b.endY)
      .forEach((item, rank) => {
        columnOf[item.teamId] = stagger ? rank % 2 : 0;
      });

    return {
      weeks: ws,
      zeroY: padY + ((max - 0) / (max - min)) * (H - padY * 2),
      paths: built,
      markers: placed,
      columnOf,
      xAt: x,
    };
  }, [series, H, W, league.teams, scrubIndex, stagger, LOGO]);

  /** Nearest week to wherever the finger is. The plot is scaled to the element's width, so the
   *  mapping goes through the bounding rect rather than through the viewBox. */
  function weekAt(clientX: number, el: SVGSVGElement): number {
    const rect = el.getBoundingClientRect();
    const frac = (clientX - rect.left) / Math.max(1, rect.width);
    const usable = (W - padL - padR) / W;
    const i = Math.round(((frac - padL / W) / usable) * (weeks.length - 1));
    return Math.max(0, Math.min(weeks.length - 1, i));
  }

  if (weeks.length === 0) {
    return <p className="text-xs text-text-muted">Power rankings start once the first week settles.</p>;
  }

  return (
    <div>
      {/* The logos are positioned as a fraction of the plot, so the plot needs its own box: with
          the week labels inside the positioned ancestor the percentages stretched over their
          height too, and the bottom logo hung past the chart (see chat, Oct 2026). */}
      <div className="relative" style={{ height: H }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none"
        style={{ height: H }}
        role="img"
        aria-label="Power score by week"
        onPointerDown={(e) => {
          if (!onScrub) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          onScrub(weekAt(e.clientX, e.currentTarget));
        }}
        onPointerMove={(e) => {
          if (!onScrub || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
          onScrub(weekAt(e.clientX, e.currentTarget));
        }}
        onPointerUp={(e) => e.currentTarget.releasePointerCapture(e.pointerId)}
      >
        {zeroY > padY && zeroY < H - padY && (
          <line x1={padL} y1={zeroY} x2={W - padR} y2={zeroY} stroke="currentColor" strokeWidth="1" className="text-border" strokeDasharray="3 3" />
        )}
        {paths.map((p) => {
          if (p.points < 1) return null;
          const team = league.teams.find((t) => t.id === p.teamId);
          const sel = p.teamId === selectedTeamId;
          if (p.points === 1) {
            return <circle key={p.teamId} cx={padL} cy={zeroY} r={sel ? 3.5 : 2.5} fill={team?.logoColor ?? 'currentColor'} opacity={sel ? 1 : 0.42} />;
          }
          return (
            <path
              key={p.teamId}
              d={p.d}
              fill="none"
              stroke={team?.logoColor ?? 'currentColor'}
              strokeWidth={sel ? 3 : 1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={sel ? 1 : 0.42}
            />
          );
        })}
        {scrubIndex != null && weeks.length > 0 && (
          <>
            <line
              x1={xAt(Math.min(scrubIndex, weeks.length - 1))}
              y1={padY - 6}
              x2={xAt(Math.min(scrubIndex, weeks.length - 1))}
              y2={H - padY + 6}
              stroke="currentColor"
              strokeWidth="1"
              className="text-text-muted"
              opacity="0.5"
            />
            {paths.map((p) => {
              const team = league.teams.find((t) => t.id === p.teamId);
              if (p.points < 1) return null;
              const sel = p.teamId === selectedTeamId;
              return (
                <circle
                  key={`dot-${p.teamId}`}
                  cx={p.endX}
                  cy={p.trueY}
                  r={sel ? 4 : 2.5}
                  fill={team?.logoColor ?? 'currentColor'}
                  opacity={sel ? 1 : 0.6}
                />
              );
            })}
          </>
        )}
      </svg>

      {markers.map((m) => {
        const team = league.teams.find((t) => t.id === m.teamId);
        if (!team) return null;
        const sel = m.teamId === selectedTeamId;
        const column = columnOf[m.teamId] ?? 0;
        return (
          <button
            key={m.teamId}
            type="button"
            onClick={() => onSelect?.(m.teamId)}
            aria-label={`Show ${team.teamName}`}
            aria-pressed={sel}
            /* Explicitly square, and explicitly sized. An absolutely positioned button with no
               width is shrink-to-fit, and sitting this close to the right edge its available width
               is only a few pixels, so the box came out narrower than it was tall. The badge inside
               kept its own shape, but the ring drawn around the button did not, which is why a
               selected photo logo had an oval ring around a round picture (see chat, Oct 2026). */
            className={`absolute -translate-x-1/2 -translate-y-1/2 w-6 h-6 inline-flex items-center justify-center leading-none rounded-full transition-opacity ${
              sel ? 'opacity-100 ring-2 ring-primary' : 'opacity-55'
            }`}
            style={{ left: `${((W - padR + 14 + column * 15) / W) * 100}%`, top: `${(m.endY / H) * 100}%` }}
          >
            <TeamLogo team={team} size="sm" />
          </button>
        );
      })}
      </div>

      <div className="flex justify-between text-[10px] text-text-muted mt-1 pr-7">
        <span>{weekLabel(weeks[0])}</span>
        {weeks.length > 1 && <span>{weekLabel(weeks[weeks.length - 1])}</span>}
      </div>
    </div>
  );
}
