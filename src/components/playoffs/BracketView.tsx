import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Trophy } from 'lucide-react';
import type { BracketMatch, League, LeagueTeam, Matchup, WeekId } from '../../types';
import {
  BOX_H,
  COL_GAP,
  eliminations,
  leagueClinchStatuses,
  layoutBracket,
  leagueWeekMatchups,
  seedOf,
  slotTeam,
  sourceText,
  weekIndex,
  type BracketModel,
  type LayoutNode,
} from '../../engine/bracketModel';
import { TeamLogo } from '../common/TeamLogo';
import { ClinchIcon } from '../common/ClinchIcon';
import type { ClinchStatus } from '../../engine/clinch';
import { AnimatedNumber } from '../common/AnimatedNumber';
import { useMatchupView } from '../home/MatchupCard';
import logoMark from '../../assets/logo-mono-muted.png';

const HEADER_H = 4;
/** How much of the next round shows at the right edge, so it is clear there is more to swipe to. */
const PEEK = 56;
/** The page's side gutter (the scroller bleeds to the screen edges with matching padding). */
const GUTTER = 16;

/**
 * A classic bracket, one playoff week per column, each game halfway between the two that feed it, with
 * lines carrying the winner forward (in the accent once decided). One round fills the screen with the next
 * one peeking in; a swipe moves exactly one round and selects that week, and picking a week elsewhere
 * slides the bracket to it. Every game is a small matchup card: tap it to open the matchup.
 */
export function BracketView({
  league,
  model,
  selectedWeek,
  onScrollToWeek,
}: {
  league: League;
  model: BracketModel;
  selectedWeek: WeekId;
  onScrollToWeek: (week: WeekId) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewW, setViewW] = useState(390);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setViewW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const boxW = Math.max(200, viewW - 2 * GUTTER - PEEK);
  const colStep = boxW + COL_GAP;

  const layout = useMemo(() => layoutBracket(model, boxW, BOX_H), [model, boxW]);
  const out = useMemo(() => eliminations(model.bracket), [model]);
  // Before the playoffs the seeds carry their clinch markers (in, bye, #1 seed).
  const clinch = useMemo(() => (model.projected ? leagueClinchStatuses(league) : new Map<string, ClinchStatus>()), [model, league]);
  const teamById = useMemo(() => new Map(league.teams.map((t) => [t.id, t])), [league.teams]);
  const userTeamId = league.teams.find((t) => t.isUser)?.id ?? null;
  const champion = model.bracket.championId ? teamById.get(model.bracket.championId) : undefined;
  const selIdx = Math.max(0, weekIndex(model, selectedWeek));

  // ---- Paging, synced with the week scroller ----
  const fromSwipe = useRef(false);
  const settleTimer = useRef<number | undefined>(undefined);
  const firstScroll = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (fromSwipe.current) {
      fromSwipe.current = false;
      return;
    }
    const target = selIdx * colStep;
    if (Math.abs(el.scrollLeft - target) < 2) return;
    el.scrollTo({ left: target, behavior: firstScroll.current ? 'auto' : 'smooth' });
    firstScroll.current = false;
  }, [selIdx, colStep]);
  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  function onScroll() {
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const el = scrollRef.current;
      if (!el) return;
      const idx = Math.max(0, Math.min(model.weeks.length - 1, Math.round(el.scrollLeft / colStep)));
      if (idx !== selIdx) {
        fromSwipe.current = true;
        onScrollToWeek(model.weeks[idx]);
      }
    }, 120);
  }

  const weekRows = (week: WeekId | undefined): Matchup[] => (week != null && !model.projected ? leagueWeekMatchups(league, week) : []);
  const rowFor = (m: BracketMatch): Matchup | undefined => {
    if (!m.teamAId || !m.teamBId) return undefined;
    return weekRows(model.weekOf.get(m.id)).find(
      (r) => (r.teamAId === m.teamAId && r.teamBId === m.teamBId) || (r.teamAId === m.teamBId && r.teamBId === m.teamAId),
    );
  };
  const nodeById = new Map(layout.nodes.map((n) => [n.id, n]));

  return (
    <div className="space-y-2.5">
      {champion && (
        <div className="flex items-center gap-2.5 rounded-xl border border-primary/50 bg-primary/10 px-3 py-2">
          <Trophy size={20} className="text-primary shrink-0" />
          <TeamLogo team={champion} size="sm" />
          <p className="min-w-0 flex-1 text-sm font-bold truncate">{champion.teamName}</p>
          <p className="shrink-0 text-[10px] text-text-muted flex items-center gap-1">
            <img src={logoMark} alt="" className="w-3 h-3 object-contain" />
            Champions
          </p>
        </div>
      )}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="-mx-4 px-4 overflow-x-auto overflow-y-hidden overscroll-x-contain snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="relative" style={{ width: layout.width + PEEK, height: layout.height + HEADER_H }}>
          {model.weeks.map((w, i) => (
            <div
              key={String(w)}
              className="absolute top-0 snap-start [scroll-snap-stop:always]"
              style={{ left: i * colStep - 6, width: boxW + 12, height: layout.height + HEADER_H, scrollMarginLeft: GUTTER - 6 }}
            >
              <div className={`absolute inset-0 rounded-xl transition-colors ${i === selIdx ? 'bg-primary/[0.06]' : ''}`} />
            </div>
          ))}
          <svg className="absolute left-0 pointer-events-none" style={{ top: HEADER_H }} width={layout.width} height={layout.height} aria-hidden>
            {layout.edges.map((e) => {
              const a = nodeById.get(e.from);
              const b = nodeById.get(e.to);
              if (!a || !b) return null;
              const x1 = a.x + boxW;
              const y1 = a.y + BOX_H / 2;
              const x2 = b.x;
              const y2 = b.y + BOX_H / 2;
              const xm = x2 - COL_GAP / 2;
              const lit = e.advanced && !model.projected;
              return (
                <path
                  key={`${e.from}-${e.to}`}
                  d={`M ${x1} ${y1} H ${xm} V ${y2} H ${x2}`}
                  fill="none"
                  strokeWidth={lit ? 2 : 1.5}
                  strokeLinejoin="round"
                  style={{ stroke: lit ? 'var(--color-primary)' : 'var(--color-border)' }}
                />
              );
            })}
          </svg>
          {layout.losersTop != null && (
            <p className="absolute left-0 text-[9px] font-semibold uppercase tracking-wide text-text-muted" style={{ top: HEADER_H + layout.losersTop - 18 }}>
              Losers bracket
            </p>
          )}
          {layout.nodes.map((n) => {
            const row = n.kind === 'match' ? rowFor(n.match) : undefined;
            return (
              <div key={n.id} className="absolute" style={{ left: n.x, top: HEADER_H + n.y, width: boxW, height: BOX_H }}>
                {n.kind === 'bye' ? (
                  <ByeBox node={n} team={n.teamId ? teamById.get(n.teamId) : undefined} isUser={n.teamId === userTeamId} />
                ) : row ? (
                  <LiveGame league={league} model={model} match={n.match} matchup={row} userTeamId={userTeamId} outHere={(id) => out.get(id)?.id === n.match.id} />
                ) : (
                  <PendingGame model={model} match={n.match} teamById={teamById} userTeamId={userTeamId} clinch={clinch} outHere={(id) => out.get(id)?.id === n.match.id} />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** A game with a real matchup: live scores, the win-chance bar, tap to open the matchup. */
function LiveGame({
  league,
  model,
  match,
  matchup,
  userTeamId,
  outHere,
}: {
  league: League;
  model: BracketModel;
  match: BracketMatch;
  matchup: Matchup;
  userTeamId: string | null;
  outHere: (teamId: string) => boolean;
}) {
  const navigate = useNavigate();
  const view = useMatchupView(league, matchup);
  if (!view) return null;
  const { teamA, teamB, isFinal, scoreA, scoreB, scoreHiddenA, scoreHiddenB, prob, scaleRef, perfectA, perfectB, leaderId } = view;
  const row = (team: LeagueTeam, score: number, hidden: boolean, perfect: boolean) => (
    <GameRow
      team={team}
      seed={seedOf(model.bracket, team.id)}
      isUser={team.id === userTeamId}
      won={isFinal && matchup.winnerId === team.id}
      lost={isFinal && matchup.winnerId != null && matchup.winnerId !== team.id}
      leading={!isFinal && leaderId === team.id}
      out={isFinal && outHere(team.id)}
      score={hidden ? <span className="text-text-muted">$–</span> : <AnimatedNumber value={score} scaleRef={scaleRef} perfect={perfect} />}
    />
  );
  return (
    <button
      type="button"
      onClick={() => navigate(`/matchup/${matchup.id}`)}
      aria-label={`${match.label}: ${teamA.teamName} vs ${teamB.teamName}`}
      className="h-full w-full text-left rounded-xl border border-border bg-bg-card px-2.5 pt-1.5 pb-2 flex flex-col justify-between active:opacity-80"
    >
      {row(teamA, scoreA, scoreHiddenA, perfectA)}
      {row(teamB, scoreB, scoreHiddenB, perfectB)}
      <div className="flex h-[3px] rounded-full overflow-hidden bg-bg-raised" aria-hidden>
        <span style={{ width: `${prob * 100}%`, backgroundColor: teamA.logoColor, opacity: prob < 0.5 ? 0.45 : 1 }} />
        <span style={{ width: `${(1 - prob) * 100}%`, backgroundColor: teamB.logoColor, opacity: prob > 0.5 ? 0.45 : 1 }} />
      </div>
    </button>
  );
}

/** A game not played yet (or a projected one): who is in it, or which game feeds each slot. */
function PendingGame({
  model,
  match,
  teamById,
  userTeamId,
  clinch,
  outHere,
}: {
  model: BracketModel;
  match: BracketMatch;
  teamById: Map<string, LeagueTeam>;
  userTeamId: string | null;
  clinch: Map<string, ClinchStatus>;
  outHere: (teamId: string) => boolean;
}) {
  const slot = (slotId: string | null, source: BracketMatch['sourceA']) => {
    const id = slotTeam(model.bracket, slotId, source);
    const team = id ? teamById.get(id) : undefined;
    if (!team) {
      return (
        <div className="flex items-center gap-2 h-6 min-w-0">
          <span className="w-6 h-6 shrink-0 rounded-full border border-dashed border-border" />
          <span className="text-[11px] italic text-text-muted truncate">{sourceText(model.bracket, source)}</span>
        </div>
      );
    }
    const decided = !!match.winnerId;
    return (
      <GameRow
        team={team}
        seed={seedOf(model.bracket, team.id)}
        isUser={team.id === userTeamId}
        won={decided && match.winnerId === team.id}
        lost={decided && match.winnerId !== team.id}
        leading={false}
        out={decided && outHere(team.id)}
        score={null}
        status={clinch.get(team.id)}
      />
    );
  };
  return (
    <div className={`h-full rounded-xl bg-bg-card px-2.5 py-1.5 flex flex-col justify-center gap-1.5 border ${model.projected ? 'border-dashed border-border' : 'border-border'}`}>
      {slot(match.teamAId, match.sourceA)}
      {slot(match.teamBId, match.sourceB)}
    </div>
  );
}

function GameRow({
  team,
  seed,
  isUser,
  won,
  lost,
  leading,
  out,
  score,
  status,
}: {
  status?: ClinchStatus;
  team: LeagueTeam;
  seed: number;
  isUser: boolean;
  won: boolean;
  lost: boolean;
  leading: boolean;
  out: boolean;
  score: React.ReactNode;
}) {
  return (
    <div className={`flex items-center gap-2 h-6 min-w-0 ${lost ? 'opacity-55' : ''}`}>
      <span className="w-3 shrink-0 text-right text-[9px] tabular-nums text-text-muted">{seed > 0 ? seed : ''}</span>
      <TeamLogo team={team} size="sm" />
      <span className={`min-w-0 truncate text-xs ${won || leading ? 'font-semibold' : ''} ${isUser ? 'text-primary' : ''}`}>{team.teamName}</span>
      <ClinchIcon status={status} />
      <span className="flex-1" />
      {out && <span className="shrink-0 rounded px-1 text-[8px] font-bold leading-[13px] bg-loss/15 text-loss">OUT</span>}
      {score != null && <span className="shrink-0 text-sm font-bold tabular-nums">{score}</span>}
    </div>
  );
}

/** A top seed resting through the first round: dashed, with a BYE tag, carried into the next round. */
function ByeBox({ node, team, isUser }: { node: Extract<LayoutNode, { kind: 'bye' }>; team: LeagueTeam | undefined; isUser: boolean }) {
  return (
    <div className="h-full rounded-xl border border-dashed border-primary/40 flex items-center gap-2 px-2.5">
      <span className="w-3 shrink-0 text-right text-[9px] tabular-nums text-text-muted">{node.seed}</span>
      {team && <TeamLogo team={team} size="sm" />}
      <span className={`min-w-0 flex-1 truncate text-xs ${isUser ? 'text-primary' : ''}`}>{team?.teamName ?? `#${node.seed} seed`}</span>
      <span className="shrink-0 rounded px-1.5 text-[9px] font-bold leading-4 bg-primary/15 text-primary">BYE</span>
    </div>
  );
}
