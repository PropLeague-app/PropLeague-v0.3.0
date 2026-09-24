import { useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { rosterKey, buildEmptyRoster } from '../engine/rosterSlots';
import { getGame } from '../services/oddsService';
import { resultForGame } from '../data/seed';
import { expectedWeeklyScore, type DecidedGameLookup } from '../engine/scoring';
import { PositionBadge } from '../components/common/PositionBadge';
import { StatusPill } from '../components/common/StatusPill';
import { WagerProfitPill } from '../components/common/WagerProfitPill';
import { TeamLogo } from '../components/common/TeamLogo';
import { describeWagerResult, type RealPlayerStatLine } from '../engine/realGameResult';
import { BackHeader, BACK_HEADER_HEIGHT } from '../components/layout/BackHeader';
import { formatCents } from '../engine/oddsMath';
import { wagerLineDescription, wagerCompactLineShort } from '../data/propsGenerator';
import { pickProgress, formatProgressLine } from '../components/home/MatchupCard';
import { isWagerVisibleToViewer } from '../engine/stats';
import type { League, LeagueTeam, Matchup, RosterSlotState, WagerStatus } from '../types';
import { weekLabel } from '../types';

export function MatchupDetail() {
  const { matchupId } = useParams<{ matchupId: string }>();
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const loadWeekRosters = useAppStore((s) => s.loadWeekRosters);
  const loadRealGamesForWeek = useAppStore((s) => s.loadRealGamesForWeek);
  const loadRealPlayerStatsForWeek = useAppStore((s) => s.loadRealPlayerStatsForWeek);
  const realGamesById = useAppStore((s) => s.realGamesById);
  const realPlayerStatsByWeek = useAppStore((s) => s.realPlayerStatsByWeek);
  // Persisted per-device, same tier as odds format/theme (see MatchupDetailMode's
  // doc comment) -- Hunter's explicit call was that some people will want to keep
  // Advanced, so this is remembered across visits rather than resetting to Simple
  // every time like the Live/Final badge or anything else purely presentational.
  const matchupDetailMode = useAppStore((s) => s.profile?.matchupDetailMode ?? 'simple');
  const setMatchupDetailMode = useAppStore((s) => s.setMatchupDetailMode);
  const advanced = matchupDetailMode === 'advanced';

  const matchup = league ? Object.values(league.matchupsByWeek).flat().find((m) => m.id === matchupId) : undefined;

  // Lets this screen swipe between every matchup in the week instead of only
  // ever showing the one you tapped into from Home -- see chat, Sept 2026:
  // "scroll between the matchups once you click on one... a scroll bar at
  // the top when you are looking at a matchup." Same ordering LeagueHome
  // uses for its own matchup card + "View other matchups" list: the
  // viewer's own matchup first, then the rest in schedule order.
  const navigate = useNavigate();
  const weekMatchups = league && matchup ? league.matchupsByWeek[String(matchup.week)] ?? [] : [];
  const userTeamId = league?.teams.find((t) => t.isUser)?.id;
  const userWeekMatchup = weekMatchups.find((m) => m.teamAId === userTeamId || m.teamBId === userTeamId);
  const orderedWeekMatchups: Matchup[] = userWeekMatchup
    ? [userWeekMatchup, ...weekMatchups.filter((m) => m.id !== userWeekMatchup.id)]
    : weekMatchups;

  // Rosters for this matchup's week aren't guaranteed to already be in local state --
  // previously this screen only ever read whatever Lineup.tsx happened to have loaded
  // as a side effect of a completely separate visit, so a viewer who never opened the
  // Lineup tab this session (the commissioner checking in on someone else's matchup,
  // say) would see every slot on both sides as "Empty" and a fully-penalized score,
  // even though the real picks were sitting in Supabase the whole time (see chat).
  useEffect(() => {
    if (league && matchup) loadWeekRosters(league.id, matchup.week);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league?.id, matchup?.week]);

  // Powers the result ticker next to each settled pick's Won/Lost pill (see
  // WagerResultTicker) -- only ever has rows for games balldontlie has already
  // marked final, so this is a plain "load once the matchup's week is known"
  // effect, same shape as the rosters one above, not a poll.
  useEffect(() => {
    if (matchup) loadRealPlayerStatsForWeek(matchup.week);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchup?.week]);

  if (!league) return null;
  if (!matchup) return <div className="p-4 text-text-muted text-sm">Matchup not found.</div>;

  const teamA = league.teams.find((t) => t.id === matchup.teamAId);
  const teamB = league.teams.find((t) => t.id === matchup.teamBId);
  if (!teamA || !teamB) return null;

  const rosterA =
    league.rostersByTeamWeek[rosterKey(teamA.id, matchup.week)] ??
    buildEmptyRoster(teamA.id, matchup.week, league.settings.lineupSlots);
  const rosterB =
    league.rostersByTeamWeek[rosterKey(teamB.id, matchup.week)] ??
    buildEmptyRoster(teamB.id, matchup.week, league.settings.lineupSlots);

  const hidePicks = league.settings.hidePicks;

  // Was: fetch a game's real score/status only if this client had never seen
  // that game id before (!realGamesById[gameId]). That guard meant once a game
  // got cached here -- even while it was still genuinely live -- this screen
  // NEVER refreshed it again, no matter how many times the game actually went
  // final or how many times the user refreshed elsewhere in the app (see
  // chat: Vikings/Packers, Cardinals/Chargers sitting stuck on "Live" for
  // hours after the backend already had them correctly marked final). Match
  // LeagueHome/NFLSlate's pattern instead: unconditionally re-pull the whole
  // week's real games every time this screen is shown, so it can never get
  // stuck on a stale cached status again.
  useEffect(() => {
    if (matchup) loadRealGamesForWeek(matchup.week);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchup?.week]);

  // manual v0.2.1 §5 #8: before any real score exists at all, fall back to the same
  // expectedWeeklyScore/DecidedGameLookup pattern MatchupCard.tsx already uses on the
  // home matchup card, so this screen shows a consistent current P/L for live weeks too.
  const decided: DecidedGameLookup = {
    isDecided: (gameId) =>
      (realGamesById[gameId] ??
        getGame(gameId, league.currentWeek, league.settings.lineMovementEnabled, league.manualGameOverrides))?.status !== 'upcoming',
    resultFor: (gameId) => resultForGame(gameId),
  };
  // hide-picks: a not-yet-live opponent pick must not leak its stake into the
  // team-level score either, matching what its own roster card already shows
  // (see engine/scoring.ts's isSlotHidden param doc). Only ever built for a
  // non-owner's roster -- the viewer's own team's score is always the real one.
  const buildSlotHider = (team: LeagueTeam) => {
    if (team.isUser || !hidePicks) return undefined;
    return (s: RosterSlotState) =>
      !!s.wager &&
      !isWagerVisibleToViewer({
        isOwnTeam: false,
        hidePicks,
        wagerWeek: matchup.week,
        currentWeek: league.currentWeek,
        wagerStatus: s.wager.status,
        gameStarted: decided.isDecided(s.wager.gameId),
      });
  };
  const scoreA = matchup.teamAScore ?? expectedWeeklyScore(rosterA, league.settings, decided, buildSlotHider(teamA));
  const scoreB = matchup.teamBScore ?? expectedWeeklyScore(rosterB, league.settings, decided, buildSlotHider(teamB));
  // matchup.teamAScore now updates live all week as picks settle (settle-week writes
  // scores progressively but only sets winnerId/isTie once the whole week is actually
  // complete -- see chat), so "has a score" no longer means "is final". Same fix as
  // MatchupCard.tsx.
  const isFinal = matchup.winnerId != null || matchup.isTie;

  // Same weekly-record line Home's matchup bubble shows (see pickProgress's own doc
  // comment) -- now doing double duty here in place of the old "Live"/"Final" text
  // that used to sit directly under each team's name+P/L (see chat, Sept 2026: that
  // moved up to sit with the Week pill instead, see below).
  const totalSlots = Object.values(league.settings.lineupSlots).reduce((a, b) => a + b, 0);
  const progressA = pickProgress(rosterA, totalSlots);
  const progressB = pickProgress(rosterB, totalSlots);

  // Center badge should read "Upcoming" until at least one pick has actually
  // gone live -- previously this showed "Live" the instant the matchup wasn't
  // final, even early in the week when every slot on both rosters was still
  // Empty/pending (see chat, Sept 2026 Week 3 screenshots: a red pulsing
  // "Live" badge over two fully-empty rosters).
  const isSlotLive = (s: RosterSlotState) => {
    if (!s.wager) return false;
    if (s.wager.status !== 'pending') return true;
    const g = realGamesById[s.wager.gameId] ?? getGame(s.wager.gameId, league.currentWeek, league.settings.lineMovementEnabled, league.manualGameOverrides);
    return !!g && g.status !== 'upcoming';
  };
  const anyPickLive = rosterA.slots.some(isSlotLive) || rosterB.slots.some(isSlotLive);

  return (
    <div className="flex flex-col">
      <BackHeader
        title="Matchup"
        fallback="/home"
        right={
          <button
            onClick={() => setMatchupDetailMode(advanced ? 'simple' : 'advanced')}
            className={`shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
              advanced ? 'bg-primary text-white border-primary' : 'bg-bg-card border-border text-text-muted'
            }`}
          >
            Advanced
          </button>
        }
      />
      {orderedWeekMatchups.length > 1 && (
        <MatchupTabs league={league} matchups={orderedWeekMatchups} currentMatchupId={matchup.id} onSelect={(id) => navigate(`/matchup/${id}`, { replace: true })} />
      )}
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 items-center">
          <TeamHeader team={teamA} score={scoreA} progress={progressA} />
          <div className="flex flex-col items-center gap-1">
            {/* Moved up from under each team's name+P/L (see chat, Sept 2026) --
                reuses StatusPill's own live/final styling (red pulsing dot vs.
                muted "Final") rather than a bespoke badge, so this stays in sync
                with that pill's look everywhere else it's used. */}
            <StatusPill status={isFinal ? 'final' : anyPickLive ? 'live' : 'upcoming'} />
            <span className="inline-flex items-center justify-center whitespace-nowrap text-[11px] font-semibold px-2 py-0.5 rounded-full bg-bg-raised text-text-muted">
              {weekLabel(matchup.week)}
            </span>
          </div>
          <TeamHeader team={teamB} score={scoreB} progress={progressB} reverse />
        </div>

        <div className="space-y-1.5">
          {rosterA.slots.map((slotA, idx) => {
            const slotB = rosterB.slots[idx];
            return (
              <div key={slotA.slotId} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 items-stretch">
                <SlotMini
                  slot={slotA}
                  league={league}
                  isUser={teamA.isUser}
                  hidePicks={hidePicks}
                  realGamesById={realGamesById}
                  realPlayerStats={realPlayerStatsByWeek[String(matchup.week)]}
                  advanced={advanced}
                />
                <div className="flex items-center justify-center px-1">
                  <PositionBadge position={slotA.position} />
                </div>
                <SlotMini
                  slot={slotB}
                  league={league}
                  isUser={teamB.isUser}
                  hidePicks={hidePicks}
                  realGamesById={realGamesById}
                  realPlayerStats={realPlayerStatsByWeek[String(matchup.week)]}
                  advanced={advanced}
                  reverse
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MatchupTabs({
  league,
  matchups,
  currentMatchupId,
  onSelect,
}: {
  league: League;
  matchups: Matchup[];
  currentMatchupId: string;
  onSelect: (matchupId: string) => void;
}) {
  const activeRef = useRef<HTMLButtonElement>(null);

  // Keeps the active pill in view as you swipe further down the list --
  // without this, tapping the last matchup in a long week can leave the
  // strip scrolled to wherever it happened to be, hiding the very pill
  // that's supposed to show what's selected.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [currentMatchupId]);

  return (
    <div className="sticky z-10 bg-bg-raised/95 backdrop-blur border-b border-border" style={{ top: BACK_HEADER_HEIGHT }}>
      <div className="flex gap-1.5 overflow-x-auto px-4 py-2">
        {matchups.map((m) => {
          const teamA = league.teams.find((t) => t.id === m.teamAId);
          const teamB = league.teams.find((t) => t.id === m.teamBId);
          const isActive = m.id === currentMatchupId;
          return (
            <button
              key={m.id}
              ref={isActive ? activeRef : undefined}
              onClick={() => onSelect(m.id)}
              className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-xs font-semibold ${
                isActive ? 'bg-primary text-white border-primary' : 'bg-bg-card border-border text-text-muted'
              }`}
            >
              {teamA && <TeamLogo team={teamA} size="sm" />}
              <span className={isActive ? 'text-white/70' : ''}>vs</span>
              {teamB && <TeamLogo team={teamB} size="sm" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TeamHeader({
  team,
  score,
  progress,
  reverse,
}: {
  team: League['teams'][number];
  score: number;
  progress: { active: number; won: number; lost: number; pushed: number; open: number };
  reverse?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 min-w-0 ${reverse ? 'flex-row-reverse text-right' : ''}`}>
      <TeamLogo team={team} size="sm" />
      <div className="min-w-0">
        <p className="text-xs font-medium truncate">{team.teamName}</p>
        <p className={`text-sm font-bold ${score >= 0 ? 'text-profit' : 'text-loss'}`}>{formatCents(score)}</p>
        {/* Same line MatchupCard shows on the Home matchup bubble (see chat, Sept
            2026) -- now living where the old bare "Live"/"Final" text used to sit,
            since that moved up next to the Week pill above. */}
        <p className="text-[9px] text-text-muted truncate">{formatProgressLine(progress)}</p>
      </div>
    </div>
  );
}

function SlotMini({
  slot,
  league,
  isUser,
  hidePicks,
  realGamesById,
  realPlayerStats,
  advanced,
  reverse,
}: {
  slot: RosterSlotState;
  league: League;
  isUser: boolean;
  hidePicks: boolean;
  realGamesById: Record<string, ReturnType<typeof getGame>>;
  realPlayerStats?: Record<string, RealPlayerStatLine>;
  advanced: boolean;
  reverse?: boolean;
}) {
  if (!slot.wager) {
    return <div className="bg-bg-card border border-border rounded-lg p-2 text-[11px] text-text-muted flex items-center justify-center">Empty</div>;
  }
  // Real wagers carry a real Odds-API event id that the local simulated dataset
  // has never heard of -- getGame() alone would return undefined for those,
  // which `!game` below then misread as "already started" (see chat: this is
  // why every real, genuinely-upcoming pick showed a "Live" pill, and also let
  // hidePicks leak an opponent's real pick before kickoff, since `shouldHide`
  // depends on the same `gameStarted` flag).
  const game = realGamesById[slot.wager.gameId] ?? getGame(slot.wager.gameId, league.currentWeek, league.settings.lineMovementEnabled, league.manualGameOverrides);
  const gameStarted = !!game && game.status !== 'upcoming';
  const shouldHide = !isUser && hidePicks && !gameStarted;

  if (shouldHide) {
    return (
      <div className={`bg-bg-card border border-border rounded-lg p-2 text-[11px] text-text-muted flex items-center justify-center gap-1 ${reverse ? 'flex-row-reverse' : ''}`}>
        <Lock size={12} /> Hidden
      </div>
    );
  }

  const wager = slot.wager;
  // Once a pick is settled (won/lost/push/voided), it's history -- dim the name/line
  // text a bit so a still-pending or live pick reads as the thing to actually pay
  // attention to. The status pill itself is deliberately left at full color/opacity
  // either way (see chat: Won/Lost should stay exactly as vivid as they are now).
  const settled = wager.status !== 'pending';
  const pendingOrLiveStatus = gameStarted ? 'live' : 'pending';

  // Simple mode (default -- see chat, Sept 2026 "pill/slot visual cleanup"): a
  // heavily reduced two-line cell -- name, then an abbreviated prop line sharing
  // its row with a one-letter result badge -- sized to fit a whole roster on one
  // screen. No stake, no dollar amount, no raw-stat ticker; Advanced restores all
  // three (see the branch below).
  if (!advanced) {
    // The status pill (and, below, its label text) stay at full opacity even
    // once settled -- only the player name dims. Previously the whole row,
    // pill included, sat inside the opacity-60 wrapper, which is what made a
    // settled W/L/V pill here look "slightly see-through" next to Advanced
    // mode's pill (that one was always a sibling of the dimmed text, never
    // inside it) (see chat, Sept 2026).
    return (
      <div className={`border border-border rounded-lg px-2 py-1.5 ${settled ? 'bg-bg-card/60' : 'bg-bg-card'} ${reverse ? 'text-right' : ''}`}>
        <p className={`text-[11px] font-semibold truncate ${settled ? 'opacity-60' : ''}`}>{wager.playerName ?? wager.side}</p>
        <div className={`mt-0.5 flex items-center gap-1 ${reverse ? 'flex-row-reverse' : ''}`}>
          <span className={`text-[10px] text-text-muted truncate min-w-0 flex-1 ${reverse ? 'text-right' : ''} ${settled ? 'opacity-60' : ''}`}>
            {wagerCompactLineShort(wager)}
          </span>
          <StatusPill status={settled ? wager.status : pendingOrLiveStatus} compact />
        </div>
      </div>
    );
  }

  // Advanced mode: player name (row 1), prop description alone on its own line
  // (row 2 -- no more truncation fight with the stake, see chat, the Christian
  // McCaffrey cell where neither was visible), then a bottom row (row 3) that
  // pairs the stake with the result pill on opposite corners: stake on the
  // OUTER corner (screen edge, away from the center position-badge column),
  // and the pill on the INNER corner (see chat, Sept 2026: "the red/green pill
  // needs to sit close to the inside of the cell... stake should be on the
  // outside"). The raw box-score number that produced a settled result sits
  // right next to that pill -- inside the same inner-corner group, but on the
  // side facing the middle of the row -- so it reads as "here's the number
  // behind that pill" without ever competing with the stake for the outer
  // corner. Deliberately NOT using flex-row-reverse to mirror team B's side --
  // row-reverse fighting justify-* is what caused an earlier bug where the
  // right column's pill/ticker pair ended up on the wrong edge (see git
  // history on this file) -- so the two sides below are just two explicit,
  // separately-ordered JSX blocks instead.
  const statText = describeWagerResult(
    wager.marketKey,
    wager.playerName ? realPlayerStats?.[wager.playerName.trim().toLowerCase()] : undefined,
    game ? { homeScore: game.homeScore, awayScore: game.awayScore } : undefined,
  );
  const statColorClass =
    wager.status === 'won'
      ? 'text-profit'
      : wager.status === 'lost'
        ? 'text-loss'
        : wager.status === 'push'
          ? 'text-primary'
          : wager.status === 'voided'
            ? 'text-accent'
            : 'text-text-muted'; // pending/live -- provisional, not a verdict yet
  const statSpan = statText ? (
    <span className={`text-[9px] font-normal whitespace-nowrap ${statColorClass}`}>{statText}</span>
  ) : null;
  const resultPill = settled ? (
    <WagerProfitPill status={wager.status as Exclude<WagerStatus, 'pending'>} profit={wager.settledProfit ?? 0} />
  ) : (
    <StatusPill status={pendingOrLiveStatus} />
  );
  const stakeSpan = <span className="text-[10px] text-text-muted whitespace-nowrap shrink-0">${wager.stake.toFixed(2)}</span>;

  return (
    <div className={`border border-border rounded-lg p-2 ${settled ? 'bg-bg-card/60' : 'bg-bg-card'} ${reverse ? 'text-right' : ''}`}>
      <div className={settled ? 'opacity-60' : ''}>
        <p className="text-[11px] font-semibold truncate">{wager.playerName ?? wager.side}</p>
        <p className="text-[10px] text-text-muted truncate mt-0.5">{wagerLineDescription(wager)}</p>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-1.5">
        {reverse ? (
          <>
            <div className="flex items-center gap-1.5 min-w-0">
              {resultPill}
              {statSpan}
            </div>
            {stakeSpan}
          </>
        ) : (
          <>
            {stakeSpan}
            <div className="flex items-center gap-1.5 min-w-0">
              {statSpan}
              {resultPill}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
