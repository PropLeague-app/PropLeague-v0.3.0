import type { League, PoolWeekEntry, PrizePool } from '../../types';
import { weekLabel } from '../../types';
import { formatCents } from '../../engine/oddsMath';
import { poolTeamCount } from '../../engine/prizePool';
import type { PoolImpactRow } from '../../engine/poolView';
import { C, SHARE_BODY_H, tint } from '../palette';
import { useTone } from '../useTone';
import { ShareFrame } from './ShareFrame';
import { ShareLogo } from './ShareLogo';

const signed = (n: number) => `${n >= 0 ? '+' : ''}${formatCents(n)}`;

/** The pool's line over the season, drawn the same way as on screen: filled area, a dashed line at the
 * starting pool, and a marker on the week being shared. */
function Line({ pool, week }: { pool: PrizePool; week: PoolWeekEntry | null }) {
  const W = 968;
  const H = 230;
  const PAD = 10;
  const points = [{ week: null as unknown, value: pool.initial }, ...pool.history.map((h) => ({ week: h.week, value: h.poolAfter }))];
  const values = points.map((p) => p.value);
  const hi = Math.max(...values, pool.initial);
  const lo = Math.min(...values, pool.initial);
  const span = Math.max(hi - lo, 1);
  const x = (i: number) => (points.length > 1 ? PAD + (i * (W - PAD * 2)) / (points.length - 1) : W / 2);
  const y = (v: number) => PAD + (1 - (v - lo) / span) * (H - PAD * 2);
  const line = points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ');
  const up = pool.current >= pool.initial;
  const stroke = up ? C.profit : C.loss;
  const markIdx = week ? points.findIndex((p) => String(p.week) === String(week.week)) : -1;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
      <defs>
        <linearGradient id="poolShareFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.3" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`${PAD},${H} ${line} ${x(points.length - 1)},${H}`} fill="url(#poolShareFill)" />
      <line x1={PAD} y1={y(pool.initial)} x2={W - PAD} y2={y(pool.initial)} stroke={C.border} strokeWidth="3" strokeDasharray="10 10" />
      <polyline points={line} fill="none" stroke={stroke} strokeWidth="6" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={x(i)} cy={y(p.value)} r={i === markIdx ? 14 : 7} fill={i === markIdx ? C.primary : stroke} />
      ))}
    </svg>
  );
}

/**
 * The prize pool as a picture: where the pool stands, its line over the season, who has moved it (or who
 * moved it in one week), and the payout split. Shares the week being looked at when one is picked.
 */
export function PoolShareCard({
  league,
  pool,
  week,
  rows,
  payoutChips,
}: {
  league: League;
  pool: PrizePool;
  /** The week being shared, or null for the whole season. */
  week: PoolWeekEntry | null;
  rows: PoolImpactRow[];
  payoutChips: string[];
}) {
  const tone = useTone();
  const delta = week ? week.netRealPL : pool.current - pool.initial;
  const headline = week ? week.poolAfter : pool.current;
  const ref = Math.max(1, pool.initial);
  const impactRef = Math.max(1, ...rows.map((r) => Math.abs(r.impact)));
  const subtitle = [
    week ? weekLabel(week.week) : 'Season to date',
    `${poolTeamCount(league)} × ${formatCents(league.settings.buyInAmount)} buy-in`,
    ...payoutChips,
  ].join(' · ');

  return (
    <ShareFrame leagueName={league.name} title="Prize Pool" subtitle={subtitle} bodyHeight={SHARE_BODY_H}>
      <div style={{ height: SHARE_BODY_H, display: 'flex', flexDirection: 'column', gap: 26 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 24,
            padding: '26px 32px',
            borderRadius: 28,
            background: C.card,
            border: `2px solid ${C.border}`,
          }}
        >
          <div>
            <div style={{ fontSize: 24, color: C.muted }}>{week ? `After ${weekLabel(week.week)}` : 'Current pool'}</div>
            <div style={{ fontSize: 86, fontWeight: 800, lineHeight: 1.05 }}>{formatCents(headline)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 52, fontWeight: 800, color: tone(delta, ref) }}>{signed(delta)}</div>
            <div style={{ fontSize: 22, color: C.muted }}>{week ? 'that week' : `from ${formatCents(pool.initial)}`}</div>
          </div>
        </div>

        <div style={{ borderRadius: 28, background: C.card, border: `2px solid ${C.border}`, padding: 20 }}>
          <Line pool={pool} week={week} />
        </div>

        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 26, fontWeight: 700, color: C.muted }}>{week ? `Who moved it in ${weekLabel(week.week)}` : 'Who has moved it'}</div>
          {rows.map((r) => {
            const team = league.teams.find((t) => t.id === r.teamId);
            if (!team) return null;
            return (
              <div
                key={r.teamId}
                style={{
                  height: 64,
                  flexShrink: 0,
                  boxSizing: 'border-box',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: '0 22px',
                  borderRadius: 18,
                  background: team.isUser ? tint(C.primary, 12) : C.card,
                  border: `2px solid ${team.isUser ? tint(C.primary, 55) : C.border}`,
                }}
              >
                <ShareLogo identity={team} initials={team.abbrev} size={40} />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 28,
                    fontWeight: 700,
                    color: team.isUser ? C.primary : C.text,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {team.teamName}
                </span>
                {Math.abs(r.multiplier - 1) > 0.004 && (
                  <span style={{ fontSize: 22, fontWeight: 700, color: C.muted, flexShrink: 0 }}>{r.multiplier.toFixed(2)}x</span>
                )}
                <span style={{ fontSize: 30, fontWeight: 800, color: tone(r.impact, impactRef), flexShrink: 0 }}>{signed(r.impact)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </ShareFrame>
  );
}
