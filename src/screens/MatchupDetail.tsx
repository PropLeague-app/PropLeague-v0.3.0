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
import { WagerResultTicker } from '../components/common/WagerResultTicker';
import { TeamLogo } from '../components/common/TeamLogo';
import type { RealPlayerStatLine } from '../engine/realGameResult';
import { BackHeader, BACK_HEADER_HEIGHT } from '../components/layout/BackHeader';
import { formatCents } from '../engine/oddsMath';
import { wagerLineDescription } from '../data/propsGenerator';
import type { League, Matchup, RosterSlotState } from '../types';
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
  const scoreA = matchup.teamAScore ?? expectedWeeklyScore(rosterA, league.settings, decided);
  const scoreB = matchup.teamBScore ?? expectedWeeklyScore(rosterB, league.settings, decided);
  // matchup.teamAScore now updates live all week as picks settle (settle-week writes
  // scores progressively but only sets winnerId/isTie once the whole week is actually
  // complete -- see chat), so "has a score" no longer means "is final". Same fix as
  // MatchupCard.tsx.
  const isFinal = matchup.winnerId != null || matchup.isTie;

  return (
    <div className="flex flex-col">
      <BackHeader title="Matchup" fallback="/home" />
      {orderedWeekMatchups.length > 1 && (
        <MatchupTabs league={league} matchups={orderedWeekMatchups} currentMatchupId={matchup.id} onSelect={(id) => navigate(`/matchup/${id}`, { replace: true })} />
      )}
      <div className="p-4 space-y-4">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 items-center">
          <TeamHeader team={teamA} score={scoreA} isFinal={isFinal} />
          <span className="inline-flex items-center justify-center whitespace-nowrap text-[11px] font-semibold px-2 py-0.5 rounded-full bg-bg-raised text-text-muted">
            {weekLabel(matchup.week)}
          </span>
          <TeamHeader team={teamB} score={scoreB} isFinal={isFinal} reverse />
        </div>

        <div className="space-y-2">
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
  isFinal,
  reverse,
}: {
  team: League['teams'][number];
  score: number;
  isFinal: boolean;
  reverse?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 min-w-0 ${reverse ? 'flex-row-reverse text-right' : ''}`}>
      <TeamLogo team={team} size="sm" />
      <div className="min-w-0">
        <p className="text-xs font-medium truncate">{team.teamName}</p>
        <p className={`text-sm font-bold ${score >= 0 ? 'text-profit' : 'text-loss'}`}>{formatCents(score)}</p>
        <p className="text-[10px] text-text-muted">{isFinal ? 'Final' : 'Live'}</p>
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
  reverse,
}: {
  slot: RosterSlotState;
  league: League;
  isUser: boolean;
  hidePicks: boolean;
  realGamesById: Record<string, ReturnType<typeof getGame>>;
  realPlayerStats?: Record<string, RealPlayerStatLine>;
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
  // Settled cards also get a touch of background muting on top of the text
  // opacity above (see chat: "maybe we want to also mute the cell color just
  // a bit too") -- bg-bg-card/60 lets the page background show through
  // slightly rather than a flat opacity on the whole card, which would also
  // wash out the border. The status pill's own won/lost colors are untouched.
  return (
    <div className={`border border-border rounded-lg p-2 ${settled ? 'bg-bg-card/60' : 'bg-bg-card'} ${reverse ? 'text-right' : ''}`}>
      <div className={settled ? 'opacity-60' : ''}>
        <p className="text-[11px] font-semibold truncate">{wager.playerName ?? wager.side}</p>
        <p className="text-[10px] text-text-muted truncate">
          {wagerLineDescription(wager)} · ${wager.stake.toFixed(2)}
        </p>
      </div>
      <div className={`mt-1 flex items-center gap-1.5 ${reverse ? 'justify-end' : 'justify-start'}`}>
        {/* JSX order (not flex-row-reverse) decides left-vs-right reading order here --
            flex-row-reverse + justify-end fights itself (row-reverse flips which edge
            "end" even means), which is what pushed the right column's pill/ticker pair
            to the left edge instead of mirroring the left column (see chat). */}
        {reverse ? (
          <>
            <WagerResultTicker
              marketKey={wager.marketKey}
              status={wager.status}
              stat={wager.playerName ? realPlayerStats?.[wager.playerName.trim().toLowerCase()] : undefined}
              game={game ? { homeScore: game.homeScore, awayScore: game.awayScore } : undefined}
            />
            <StatusPill status={wager.status === 'pending' ? (gameStarted ? 'live' : 'pending') : wager.status} />
          </>
        ) : (
          <>
            <StatusPill status={wager.status === 'pending' ? (gameStarted ? 'live' : 'pending') : wager.status} />
            <WagerResultTicker
              marketKey={wager.marketKey}
              status={wager.status}
              stat={wager.playerName ? realPlayerStats?.[wager.playerName.trim().toLowerCase()] : undefined}
              game={game ? { homeScore: game.homeScore, awayScore: game.awayScore } : undefined}
            />
          </>
        )}
      </div>
    </div>
  );
}