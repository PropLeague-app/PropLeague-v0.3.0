import { useAppStore } from '../store/useAppStore';
import { formatCents } from '../engine/oddsMath';
import { computePayouts, championAndRunnerUp, activeMultipliers } from '../engine/prizePool';
import { weekLabel } from '../types';
import { BackHeader } from '../components/layout/BackHeader';
import { Card } from '../components/common/Card';
import { EmptyState } from '../components/common/EmptyState';
import { TeamLogo } from '../components/common/TeamLogo';

const MULTIPLIER_BASIS_LABELS = { rank: 'standings', record: 'win-loss record', seasonPL: 'season P/L' } as const;

/** manual v0.3.0 §4: places 1-3 get the familiar medal treatment; everything past that
 * is always a plain "Nth Place" in this app (the playoff field caps at 16 teams, so
 * the 11th/12th/13th "th" exceptions never collide with a 1st/2nd/3rd digit). */
function placeLabel(place: number): string {
  if (place === 1) return '🏆 Champion';
  if (place === 2) return '🥈 Runner-up';
  if (place === 3) return '🥉 3rd Place';
  return `${place}th Place`;
}

function placeLabelPlain(place: number): string {
  if (place === 1) return 'Champion';
  if (place === 2) return 'Runner-up';
  if (place === 3) return '3rd Place';
  return `${place}th Place`;
}

function PoolChart({ history, initial }: { history: { week: unknown; poolAfter: number }[]; initial: number }) {
  const points = [{ poolAfter: initial }, ...history];
  const max = Math.max(...points.map((p) => p.poolAfter), 1);
  const width = 320;
  const height = 100;
  const stepX = points.length > 1 ? width / (points.length - 1) : width;
  const coords = points.map((p, i) => {
    const x = i * stepX;
    const y = height - (p.poolAfter / max) * (height - 10) - 5;
    return `${x},${y}`;
  });
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-24">
      <polyline points={coords.join(' ')} fill="none" stroke="var(--color-primary)" strokeWidth="2" />
      {coords.map((c, i) => {
        const [x, y] = c.split(',');
        return <circle key={i} cx={x} cy={y} r="2.5" fill="var(--color-primary)" />;
      })}
    </svg>
  );
}

export function PrizePool() {
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));

  if (!league) return null;
  const pool = league.prizePool;

  if (!league.settings.buyInEnabled || !pool) {
    return (
      <div className="flex flex-col">
        <BackHeader title="Prize Pool" fallback="/home" />
        <div className="p-4">
          <EmptyState
            icon="💰"
            title="Buy-ins are off"
            subtitle="Turn on Buy-in & Prize Pool in League Settings to start tracking a virtual pool."
          />
        </div>
      </div>
    );
  }

  const payouts = league.seasonPhase === 'complete' ? computePayouts(pool, league.bracket, league.settings) : [];
  const { championId } = championAndRunnerUp(league.bracket);
  const multipliers = activeMultipliers(league);

  return (
    <div className="flex flex-col">
      <BackHeader title="Prize Pool" fallback="/home" />
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Card className="py-3">
            <p className="text-sm font-bold">{formatCents(pool.initial)}</p>
            <p className="text-[10px] text-text-muted">Starting pool</p>
          </Card>
          <Card className="py-3">
            <p className={`text-sm font-bold ${pool.current >= pool.initial ? 'text-profit' : 'text-loss'}`}>
              {formatCents(pool.current)}
            </p>
            <p className="text-[10px] text-text-muted">Current pool</p>
          </Card>
          <Card className="py-3">
            <p className="text-sm font-bold">{pool.locked ? 'Locked' : 'Active'}</p>
            <p className="text-[10px] text-text-muted">Status</p>
          </Card>
        </div>

        <Card>
          <p className="text-xs text-text-muted mb-2">Pool history</p>
          {pool.history.length === 0 ? (
            <p className="text-xs text-text-muted py-6 text-center">No weeks settled yet.</p>
          ) : (
            <>
              <PoolChart history={pool.history} initial={pool.initial} />
              <div className="space-y-1 mt-2">
                {pool.history.map((entry) => (
                  <div key={String(entry.week)} className="flex justify-between text-xs">
                    <span className="text-text-muted">{weekLabel(entry.week)}</span>
                    <span className={entry.netRealPL >= 0 ? 'text-profit' : 'text-loss'}>
                      {entry.netRealPL >= 0 ? '+' : ''}
                      {formatCents(entry.netRealPL)}
                    </span>
                    <span className="font-medium">{formatCents(entry.poolAfter)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        {league.settings.poolMultipliers.enabled && (
          <Card>
            <p className="text-xs text-text-muted mb-1">Prize pool impact multipliers</p>
            <p className="text-[11px] text-text-muted mb-2">
              Ranked by {MULTIPLIER_BASIS_LABELS[league.settings.poolMultipliers.basis]}, each team's wagers move the pool a bit more or less than
              usual — one team's boost always comes out of the others' shares, so the pool's total exposure never changes, just whose picks move it
              more. Turns off automatically once the playoffs start.
            </p>
            <div className="space-y-1">
              {league.teams.map((team) => {
                const multiplier = multipliers[team.id] ?? 1;
                return (
                  <div key={team.id} className="flex items-center justify-between">
                    <span className="text-xs flex items-center gap-1.5 min-w-0 truncate">
                      <TeamLogo team={team} size="sm" /> <span className="truncate">{team.teamName}</span>
                    </span>
                    <span className={`text-xs font-semibold shrink-0 ${multiplier >= 1 ? 'text-profit' : 'text-loss'}`}>{multiplier.toFixed(2)}x</span>
                  </div>
                );
              })}
            </div>
            {league.seasonPhase !== 'regular' && <p className="text-[11px] text-text-muted mt-1.5">Every team is at a flat 1.0x during the playoffs.</p>}
          </Card>
        )}

        {league.seasonPhase === 'complete' && payouts.length > 0 && (
          <Card>
            <p className="text-xs text-text-muted mb-2">Season-end payout report</p>
            <div className="space-y-2">
              {payouts.map((p) => {
                const team = league.teams.find((t) => t.id === p.teamId);
                return (
                  <div key={p.teamId} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {team && <TeamLogo team={team} size="sm" />}
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">{team?.teamName ?? 'Unknown'}</p>
                        <p className="text-[11px] text-text-muted">{placeLabel(p.place)} · {p.pct}%</p>
                      </div>
                    </div>
                    <p className="text-sm font-bold text-profit shrink-0">{formatCents(p.amount)}</p>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {!championId && (
          <p className="text-[11px] text-text-muted text-center">
            Payout split: {league.settings.payoutSplits.map((pct, i) => `${pct}% ${placeLabelPlain(i + 1)}`).join(' / ')} once the season finishes.
          </p>
        )}
      </div>
    </div>
  );
}
