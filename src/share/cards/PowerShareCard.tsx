import type { League } from '../../types';
import type { PowerPoint } from '../../engine/powerRankings';
import { PowerTrajectory } from '../../components/power/PowerTrajectory';
import { C, SHARE_CHROME_H, clamp, tint } from '../palette';
import { useTone } from '../useTone';
import { ShareFrame } from './ShareFrame';
import { ShareLogo } from './ShareLogo';

export interface PowerShareRow {
  teamId: string;
  rank: number;
  score: number;
  /** Places moved since last week: positive is a climb. Nothing drawn for null or zero, as on screen. */
  movement: number | null;
}

/** Landscape, 4:3, so the chart gets the room (the only share card that is not 1080 wide). */
const CARD_W = 1440;
const CARD_H = 1080;
const BODY_W = CARD_W - 112; // minus the frame's side padding
const BASE_AREA = CARD_H - SHARE_CHROME_H;
const COL_GAP = 24;
/** About two-thirds chart, one-third table: any narrower and the table cuts most names short. */
const LIST_W = 452;
const CHART_W = BODY_W - LIST_W - COL_GAP;

const HEAD_H = 96;
const HEAD_GAP = 16;
/** The chart panel's padding (16) and border (2) on each side. */
const PANEL_INSET = 18;
/** Plot units to picture pixels. The chart is the screen's own component, drawn wider in its own
 * units and scaled by this, so lines, logos and the dashed zero line keep the screen's proportions. */
const SCALE = 1.9;
/** The week labels PowerTrajectory draws under its plot, in its own units. */
const LABELS_H = 19;
const ROW_GAP = 10;
const MIN_ROW = 56;
const MAX_ROW = 88;

const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** Power Rankings as the reader sees them (backlog C1). The chart column carries the selected team
 * and its score on top, then the trajectory as it is on screen (that team's line picked out, held
 * at the scrubbed moment). The table at that same moment runs down the right. A big league makes the
 * picture taller rather than squeezing either side. */
export function PowerShareCard({
  league,
  subtitle,
  series,
  selectedTeamId,
  scrubIndex,
  rows,
  scoreRef,
  head,
}: {
  league: League;
  subtitle?: string;
  series: Record<string, PowerPoint[]>;
  selectedTeamId: string;
  scrubIndex: number | null;
  rows: PowerShareRow[];
  scoreRef: number;
  head: { score: number; hitRate: number; impliedRate: number; edgePts: number };
}) {
  const tone = useTone();
  const n = Math.max(1, rows.length);

  // The plot can never be shorter than PowerTrajectory's own floor (one logo per team, up to 420
  // units), so a big league sets a minimum height for the chart side as well as the table side.
  const chartFloor = HEAD_H + HEAD_GAP + PANEL_INSET * 2 + (Math.max(240, Math.min(n * 30, 420)) + LABELS_H) * SCALE;
  const listMin = n * MIN_ROW + ROW_GAP * (n - 1);
  const area = Math.ceil(Math.max(BASE_AREA, chartFloor, listMin));
  const rowH = clamp((area - ROW_GAP * (n - 1)) / n, MIN_ROW, MAX_ROW);
  const listH = n * rowH + ROW_GAP * (n - 1);

  const panelH = area - HEAD_H - HEAD_GAP;
  const plotW = (CHART_W - PANEL_INSET * 2) / SCALE;
  const plotH = Math.floor((panelH - PANEL_INSET * 2) / SCALE - LABELS_H);
  const selected = league.teams.find((t) => t.id === selectedTeamId);

  const nameSize = clamp(rowH * 0.32, 22, 28);
  const valueSize = clamp(rowH * 0.36, 24, 32);
  const logo = clamp(rowH * 0.5, 30, 44);
  const smallSize = clamp(rowH * 0.26, 18, 22);

  return (
    <ShareFrame leagueName={league.name} title="Power Rankings" subtitle={subtitle} width={CARD_W} minBodyHeight={BASE_AREA} bodyHeight={area}>
      <div style={{ height: area, display: 'flex', gap: COL_GAP }}>
        <div style={{ width: CHART_W, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: HEAD_GAP }}>
          <div style={{ height: HEAD_H, display: 'flex', alignItems: 'center', gap: 20 }}>
            {selected && <ShareLogo identity={selected} initials={selected.abbrev} size={76} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 42, fontWeight: 800, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{selected?.teamName}</div>
              <div style={{ fontSize: 24, color: C.muted, marginTop: 4 }}>
                <span style={{ color: C.text, fontWeight: 700 }}>{pct(head.hitRate)}</span> hit vs{' '}
                <span style={{ color: C.text, fontWeight: 700 }}>{pct(head.impliedRate)}</span> priced
              </div>
            </div>
            <div style={{ flexShrink: 0, textAlign: 'right' }}>
              <div style={{ fontSize: 60, fontWeight: 900, lineHeight: 1, color: tone(head.score, scoreRef) }}>{signed(head.score)}</div>
              <div style={{ fontSize: 24, fontWeight: 700, marginTop: 8, color: head.edgePts >= 0 ? C.profit : C.loss }}>{signed(head.edgePts)} pts</div>
            </div>
          </div>
          <div style={{ height: panelH, overflow: 'hidden', borderRadius: 24, background: C.card, border: `2px solid ${C.border}`, boxSizing: 'border-box', padding: 16 }}>
            <div style={{ width: plotW, transform: `scale(${SCALE})`, transformOrigin: 'top left', color: C.text }}>
              <PowerTrajectory league={league} series={series} selectedTeamId={selectedTeamId} scrubIndex={scrubIndex} height={plotH} plotWidth={plotW} />
            </div>
          </div>
        </div>

        <div style={{ width: LIST_W, display: 'flex', flexDirection: 'column', gap: ROW_GAP, justifyContent: listH < area ? 'center' : 'flex-start' }}>
          {rows.map((r) => {
            const team = league.teams.find((t) => t.id === r.teamId);
            const sel = r.teamId === selectedTeamId;
            return (
              <div
                key={r.teamId}
                style={{
                  height: rowH,
                  flexShrink: 0,
                  boxSizing: 'border-box',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '0 18px 0 12px',
                  borderRadius: 20,
                  background: sel ? tint(C.primary, 12) : C.card,
                  border: `2px solid ${sel ? tint(C.primary, 55) : C.border}`,
                }}
              >
                <span style={{ width: 26, flexShrink: 0, textAlign: 'right', fontSize: smallSize, fontWeight: 800, color: C.muted }}>{r.rank}</span>
                {team && <ShareLogo identity={team} initials={team.abbrev} size={logo} />}
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: nameSize,
                    fontWeight: 800,
                    color: sel ? C.primary : C.text,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {team?.teamName ?? 'Unknown'}
                </span>
                {r.movement != null && r.movement !== 0 && (
                  <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, fontSize: smallSize, fontWeight: 800, color: r.movement > 0 ? C.profit : C.loss }}>
                    <svg width={smallSize * 0.6} height={smallSize * 0.52} viewBox="0 0 7 6" aria-hidden>
                      <path d={r.movement > 0 ? 'M3.5 0 L7 6 L0 6 Z' : 'M3.5 6 L7 0 L0 0 Z'} fill="currentColor" />
                    </svg>
                    {Math.abs(r.movement)}
                  </span>
                )}
                <span style={{ flexShrink: 0, fontSize: valueSize, fontWeight: 800, color: tone(r.score, scoreRef) }}>{signed(r.score)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </ShareFrame>
  );
}
