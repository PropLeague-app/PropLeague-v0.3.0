import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { rosterKey, buildEmptyRoster } from '../engine/rosterSlots';
import { getGame } from '../services/oddsService';
import { resultForGame } from '../data/seed';
import { displayWeeklyScore, type DecidedGameLookup } from '../engine/scoring';
import { PositionBadge } from '../components/common/PositionBadge';
import { StatusPill } from '../components/common/StatusPill';
import { WagerProfitPill } from '../components/common/WagerProfitPill';
import { TeamLogo } from '../components/common/TeamLogo';
import { describeWagerResult, type RealPlayerStatLine } from '../engine/realGameResult';
import { BackHeader, BACK_HEADER_HEIGHT } from '../components/layout/BackHeader';
import { formatCents } from '../engine/oddsMath';
import { wagerLineDescription, wagerCompactLineShort } from '../data/propsGenerator';
import { pickProgress, formatProgressLine, buildMatchupView, WinProbBar } from '../components/home/MatchupCard';
import { isWagerVisibleToViewer, rosterHasHiddenPicks, emptySlotsHidden, weekAllGamesStarted, computeTeamStreak } from '../engine/stats';
import { isPerfectWeek } from '../engine/perfectWeek';
import { FireAura } from '../components/common/FireAura';
import { StinkAura } from '../components/common/StinkAura';
import { isSkunkedWeek } from '../engine/skunkedWeek';
import { weekScaleRef } from '../engine/plColor';
import { usePlStyle } from '../components/common/usePlStyle';
import type { League, LeagueTeam, Matchup, RosterSlotState, WagerStatus } from '../types';
import { weekLabel } from '../types';
import { ShareButton } from '../share/ShareButton';
import { MatchupShareCard, type MatchupCell, type MatchupSide } from '../share/cards/MatchupShareCard';
import type { ShareStatus } from '../share/palette';
import { leagueWeekMatchups } from '../engine/bracketModel';

// A faint edge plus a soft drop shadow lifts the logos off the matchup switcher pills.
const LOGO_RING = { boxShadow: '0 0 0 1px color-mix(in oklab, var(--color-text) 16%, transparent), 0 1px 4px rgba(0,0,0,0.35)' } as const;

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
  // Tapping a pick opens or closes that slot on BOTH sides, on top of the Simple/Advanced setting:
  // the two cells share a row, so opening one and leaving the other simple left the closed side
  // rattling around in a tall box. Keyed by slot alone. Never saved: it clears when you leave the
  // screen, swipe to another matchup, or press the Advanced button (which then means "all" again).
  const [slotOverrides, setSlotOverrides] = useState<Record<string, boolean>>({});
  useEffect(() => {
    setSlotOverrides({});
  }, [matchupId, matchupDetailMode]);
  function toggleSlot(key: string) {
    setSlotOverrides((prev) => ({ ...prev, [key]: !(prev[key] ?? advanced) }));
  }

  const matchup = league ? Object.values(league.matchupsByWeek).flat().find((m) => m.id === matchupId) : undefined;

  // Lets this screen swipe between every matchup in the week instead of only
  // ever showing the one you tapped into from Home -- see chat, Sept 2026:
  // "scroll between the matchups once you click on one... a scroll bar at
  // the top when you are looking at a matchup." Same ordering LeagueHome
  // uses for its own matchup card + "View other matchups" list: the
  // viewer's own matchup first, then the rest in schedule order.
  const navigate = useNavigate();
  const weekMatchups = league && matchup ? leagueWeekMatchups(league, matchup.week) : [];
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
        getGame(gameId, league.currentWeek, league.settings.lineMovementEnabled))?.status !== 'upcoming',
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
  // matchup.teamAScore now updates live all week as picks settle (settle-week writes
  // scores progressively but only sets winnerId/isTie once the whole week is actually
  // complete -- see chat), so "has a score" no longer means "is final". Same fix as
  // MatchupCard.tsx.
  const isFinal = matchup.winnerId != null || matchup.isTie;
  const weekLocked = weekAllGamesStarted(Object.values(realGamesById), matchup.week);
  // The unspent-credits penalty only counts once nothing more can be filled (last kickoff, or any
  // week already past). Before that the live score is settled P/L from $0.
  const penaltyLive = weekLocked || isFinal || matchup.week < league.currentWeek;
  const scoreA = displayWeeklyScore({ serverScore: matchup.teamAScore, roster: rosterA, settings: league.settings, decided, isSlotHidden: buildSlotHider(teamA), penaltyLive, isFinal });
  const scoreB = displayWeeklyScore({ serverScore: matchup.teamBScore, roster: rosterB, settings: league.settings, decided, isSlotHidden: buildSlotHider(teamB), penaltyLive, isFinal });
  // An opponent with a still-hidden pick has no safe score preview or pick count: the unspent-credits
  // penalty and the pick tally both depend on the hidden stakes. The score reads "$-" and only the
  // settled record shows until the picks go live. A score the server already wrote (graded picks only) is safe to show.
  const hideCtx = {
    hidePicks,
    hideEmptySlots: league.settings.hideEmptySlots,
    week: matchup.week,
    currentWeek: league.currentWeek,
    weekLocked,
    isGameStarted: decided.isDecided,
  };
  // An opponent's empty slots read "Hidden" too (unless the league opted out), so a filled slot cannot
  // be told from an empty one by elimination.
  const hideEmptyFor = (team: LeagueTeam) =>
    !team.isUser &&
    emptySlotsHidden({ hidePicks, hideEmptySlots: league.settings.hideEmptySlots, week: matchup.week, currentWeek: league.currentWeek, weekLocked });
  const hideEmptyA = hideEmptyFor(teamA);
  const hideEmptyB = hideEmptyFor(teamB);
  const hiddenA = rosterHasHiddenPicks(rosterA, { ...hideCtx, isOwnTeam: teamA.isUser });
  const hiddenB = rosterHasHiddenPicks(rosterB, { ...hideCtx, isOwnTeam: teamB.isUser });
  const scoreHiddenA = hiddenA && matchup.teamAScore == null;
  const scoreHiddenB = hiddenB && matchup.teamBScore == null;
  const scaleRef = weekScaleRef(league, matchup.week, [scoreHiddenA ? 0 : scoreA, scoreHiddenB ? 0 : scoreB]);
  const perfectA = isPerfectWeek(rosterA, league.settings, isFinal);
  const perfectB = isPerfectWeek(rosterB, league.settings, isFinal);
  // Skunked weeks always show here, whether or not the commissioner posts them to the feed.
  const skunkedA = isSkunkedWeek(rosterA, isFinal);
  const skunkedB = isSkunkedWeek(rosterB, isFinal);

  // Same weekly-record line Home's matchup bubble shows (see pickProgress's own doc
  // comment) -- now doing double duty here in place of the old "Live"/"Final" text
  // that used to sit directly under each team's name+P/L (see chat, Sept 2026: that
  // moved up to sit with the Week pill instead, see below).
  const totalSlots = Object.values(league.settings.lineupSlots).reduce((a, b) => a + b, 0);
  const progressA = pickProgress(rosterA, totalSlots);
  const progressB = pickProgress(rosterB, totalSlots);

  // Season record and current streak, the identity-level fact about each team, now shown under the
  // dollar figure. Read off the same standings every other screen uses rather than recounted here.
  const recordOf = (teamId: string) => {
    const s = league.standings.find((x) => x.teamId === teamId);
    return s ? `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ''}` : null;
  };
  const recordA = recordOf(teamA.id);
  const recordB = recordOf(teamB.id);
  const streakA = computeTeamStreak(league, teamA.id);
  const streakB = computeTeamStreak(league, teamB.id);

  // Win probability comes from the same model the home card uses, built here rather than
  // recomputed, so the two screens can never disagree about who is favored.
  const probView = buildMatchupView(league, matchup, realGamesById);
  const prob = probView?.prob ?? 0.5;
  const probHidden = probView?.probHidden ?? false;
  const giveWidthPx = probView?.giveWidthPx ?? 2;

  // Center badge should read "Upcoming" until at least one pick has actually
  // gone live -- previously this showed "Live" the instant the matchup wasn't
  // final, even early in the week when every slot on both rosters was still
  // Empty/pending (see chat, Sept 2026 Week 3 screenshots: a red pulsing
  // "Live" badge over two fully-empty rosters).
  const isSlotLive = (s: RosterSlotState) => {
    if (!s.wager) return false;
    if (s.wager.status !== 'pending') return true;
    const g = realGamesById[s.wager.gameId] ?? getGame(s.wager.gameId, league.currentWeek, league.settings.lineMovementEnabled);
    return !!g && g.status !== 'upcoming';
  };
  const anyPickLive = rosterA.slots.some(isSlotLive) || rosterB.slots.some(isSlotLive);

  // Share: what this screen shows, as one fixed-size picture. A pick the viewer cannot see yet
  // (hide-picks, before kickoff) is "Hidden" here too, exactly as on screen.
  const shareCell = (slot: RosterSlotState, isUser: boolean, hideEmpty: boolean): MatchupCell => {
    const w = slot.wager;
    if (!w) return { kind: hideEmpty ? 'hidden' : 'empty' };
    const g = realGamesById[w.gameId] ?? getGame(w.gameId, league.currentWeek, league.settings.lineMovementEnabled);
    const started = !!g && g.status !== 'upcoming';
    if (!isUser && hidePicks && !started) return { kind: 'hidden' };
    return {
      kind: 'pick',
      name: w.playerName ?? w.side,
      line: wagerLineDescription(w),
      status: w.status !== 'pending' ? (w.status as ShareStatus) : started ? 'live' : 'pending',
      profit: w.settledProfit ?? null,
    };
  };
  const shareSide = (
    team: LeagueTeam,
    score: number,
    progress: ReturnType<typeof pickProgress>,
    perfect: boolean,
    skunked: boolean,
    hidden: boolean,
    scoreHidden: boolean,
  ): MatchupSide => ({
    name: team.teamName,
    initials: team.abbrev,
    identity: team,
    score,
    scoreHidden,
    progress: formatProgressLine(progress, hidden),
    perfect,
    skunked,
  });
  const shareCard = (
    <MatchupShareCard
      leagueName={league.name}
      weekText={weekLabel(matchup.week)}
      statusText={isFinal ? 'Final' : anyPickLive ? 'Live' : 'Upcoming'}
      a={shareSide(teamA, scoreA, progressA, perfectA, skunkedA, hiddenA, scoreHiddenA)}
      b={shareSide(teamB, scoreB, progressB, perfectB, skunkedB, hiddenB, scoreHiddenB)}
      winner={isFinal ? (matchup.isTie ? 'tie' : matchup.winnerId === teamA.id ? 'a' : 'b') : null}
      plRef={scaleRef}
      rows={rosterA.slots.map((slotA, idx) => ({
        position: slotA.position,
        a: shareCell(slotA, teamA.isUser, hideEmptyA),
        b: shareCell(rosterB.slots[idx], teamB.isUser, hideEmptyB),
      }))}
    />
  );

  return (
    <div className="flex flex-col">
      <BackHeader
        title="Matchup"
        fallback="/home"
        right={
          <div className="flex items-center gap-2">
            <ShareButton title={`${teamA.teamName} vs ${teamB.teamName}`} label="Share this matchup" renderCard={() => shareCard} />
            <button
              onClick={() => setMatchupDetailMode(advanced ? 'simple' : 'advanced')}
              className={`shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
                advanced ? 'sel-pill' : 'bg-bg-card border-border text-text-muted'
              }`}
            >
              Advanced
            </button>
          </div>
        }
      />
      {orderedWeekMatchups.length > 1 && (
        <MatchupTabs league={league} matchups={orderedWeekMatchups} currentMatchupId={matchup.id} onSelect={(id) => navigate(`/matchup/${id}`, { replace: true })} />
      )}
      <div className={`p-4 space-y-4 ${perfectA || perfectB || skunkedA || skunkedB ? 'pl-slip pl-slip-fade' : ''} ${perfectA ? 'pl-slip-l' : ''} ${perfectB ? 'pl-slip-r' : ''} ${skunkedA ? 'pl-skunk-l' : ''} ${skunkedB ? 'pl-skunk-r' : ''}`}>
        {/* The header and the picks bar are one block, held together at a tighter spacing than the
            page's own space-y-4. At that spacing the bar floated in the middle of nowhere, reading
            as unrelated to the teams it describes (see chat, Oct 2026); the full gap stays below it,
            where it separates the header from the lineup. */}
        <div className="space-y-1.5">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] gap-2 items-center">
          <TeamHeader team={teamA} score={scoreA} record={recordA} streak={streakA} scaleRef={scaleRef} perfect={perfectA} skunked={skunkedA} scoreHidden={scoreHiddenA} />
          {/* pt-6 drops this stack clear of the team names either side of it. The grid centers its
              columns, and with the score now much larger the team block grew taller, which left
              these two pills sitting right on top of the names (see chat, Oct 2026). Pushing them
              down lines them up with the score instead, where they have room. */}
          <div className="flex flex-col items-center gap-1 pt-5">
            {/* Moved up from under each team's name+P/L (see chat, Sept 2026) --
                reuses StatusPill's own live/final styling (red pulsing dot vs.
                muted "Final") rather than a bespoke badge, so this stays in sync
                with that pill's look everywhere else it's used. */}
            <StatusPill status={isFinal ? 'final' : anyPickLive ? 'live' : 'upcoming'} />
            <span className="inline-flex items-center justify-center whitespace-nowrap text-[11px] font-semibold px-2 py-0.5 rounded-full bg-bg-raised text-text-muted">
              {weekLabel(matchup.week)}
            </span>
          </div>
          <TeamHeader team={teamB} score={scoreB} record={recordB} streak={streakB} scaleRef={scaleRef} perfect={perfectB} skunked={skunkedB} scoreHidden={scoreHiddenB} reverse />
        </div>

        {/* The week's pick records used to sit under each team's dollar figure, directly beneath the
            season record that now lives there -- two different records stacked on each other, which
            is exactly the ambiguity that made them hard to read (see chat, Oct 2026). They move to
            the ends of this row, which was empty space on both sides, so the two are separated by
            position as well as by label: season under the team, picks on the picks bar.
            The bar itself is dropped once the matchup is decided. A probability on a finished game
            is noise, and this is prime space; the records stay, since they still describe the week. */}
        {isFinal ? (
          <div className="flex items-center justify-between text-[10px] text-text-muted">
            <span>{formatProgressLine(progressA, hiddenA)}</span>
            <span className="text-right">{formatProgressLine(progressB, hiddenB, 'right')}</span>
          </div>
        ) : (
          // One line instead of three. The bar used to run the full width with the percentages on
          // their own row and the pick records on a third, which left the whole block floating in
          // dead space above the picks (see chat, Oct 2026). Shrunk to a short centered bar with its
          // percentages either side of it and the pick records on the outside, it says the same
          // things in a third of the height. The "X leads" caption is gone: with both percentages
          // sitting right there it was saying what the bar already shows.
          <div className="flex items-center justify-between gap-2 text-[10px] text-text-muted">
            {/* flex-1 on both ends, not content width: the two records are different lengths ("8
                active · 0-0-0 settled" against "4-4-0 settled") and with justify-between alone that
                difference pushed the bar off-centre, so it sat somewhere different on every matchup
                (see chat, Oct 2026). Equal shares either side pin it to the middle of the row
                whatever the records say. */}
            <span className="flex-1 min-w-0 truncate">{formatProgressLine(progressA, hiddenA)}</span>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="tabular-nums">{probHidden ? '–%' : `${Math.round(prob * 100)}%`}</span>
              <div className="w-20">
                <WinProbBar prob={prob} giveWidthPx={giveWidthPx} colorA={teamA.logoColor} colorB={teamB.logoColor} thin />
              </div>
              <span className="tabular-nums">{probHidden ? '–%' : `${Math.round((1 - prob) * 100)}%`}</span>
            </div>
            <span className="flex-1 min-w-0 truncate text-right">{formatProgressLine(progressB, hiddenB, 'right')}</span>
          </div>
        )}
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
                  hideEmpty={hideEmptyA}
                  realGamesById={realGamesById}
                  realPlayerStats={realPlayerStatsByWeek[String(matchup.week)]}
                  advanced={slotOverrides[slotA.slotId] ?? advanced}
                  onToggle={() => toggleSlot(slotA.slotId)}
                />
                <div className="flex items-center justify-center px-1">
                  <PositionBadge position={slotA.position} />
                </div>
                <SlotMini
                  slot={slotB}
                  league={league}
                  isUser={teamB.isUser}
                  hidePicks={hidePicks}
                  hideEmpty={hideEmptyB}
                  realGamesById={realGamesById}
                  realPlayerStats={realPlayerStatsByWeek[String(matchup.week)]}
                  advanced={slotOverrides[slotA.slotId] ?? advanced}
                  onToggle={() => toggleSlot(slotA.slotId)}
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
  const realGamesById = useAppStore((s) => s.realGamesById);

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
          // Scores ride on the OTHER pills only. The one you are sitting on has both figures in
          // large type two inches below, so repeating them here is noise -- while the neighbours
          // carry the one thing this strip could say and did not, which is how the rest of the
          // league is doing (see chat, Oct 2026, against ESPN's matchup switcher). The leader's
          // figure is tinted and the trailer's stays muted, so it scans without being read.
          // Built for every pill, selected one included, so the figures can stay mounted and
          // animate out rather than disappearing (see PillScore).
          const view = buildMatchupView(league, m, realGamesById);
          return (
            <button
              key={m.id}
              ref={isActive ? activeRef : undefined}
              onClick={() => onSelect(m.id)}
              // No gap on the row itself: a collapsed figure would still hold its two gaps open and
              // the pill would never fully shrink. The spacing lives on the figures (which collapse
              // with them) and on the logo group (which does not move).
              className={`shrink-0 flex items-center rounded-full border px-2.5 py-1.5 text-xs font-semibold transition-all duration-200 ease-out ${
                isActive ? 'sel-pill' : 'bg-bg-card border-border text-text-muted'
              }`}
            >
              {view && <PillScore score={view.scoreA} hidden={view.scoreHiddenA} leading={view.leaderId === m.teamAId} collapsed={isActive} side="left" />}
              <span className="flex items-center gap-1.5">
                {teamA && <span className="rounded-full" style={LOGO_RING}><TeamLogo team={teamA} size="sm" /></span>}
                <span className={isActive ? 'opacity-70' : ''}>vs</span>
                {teamB && <span className="rounded-full" style={LOGO_RING}><TeamLogo team={teamB} size="sm" /></span>}
              </span>
              {view && <PillScore score={view.scoreB} hidden={view.scoreHiddenB} leading={view.leaderId === m.teamBId} collapsed={isActive} side="right" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** One side's figure on a switcher pill. Deliberately whole dollars: the pills sit in a horizontal
 * strip where width is the scarce thing, and "$38" against "$1" tells you what you came for just as
 * well as the cents would. A side whose picks are still hidden shows a dash rather than a number.
 *
 * Always rendered, never conditionally mounted. The selected pill drops its figures, and unmounting
 * them made the pill snap between its two widths with nothing in between (see chat, Oct 2026).
 * Collapsing max-width and opacity instead gives the browser something to animate, so the pill
 * visibly grows as you swipe off it and shrinks as you land on it. */
function PillScore({
  score,
  hidden,
  leading,
  collapsed,
  side,
}: {
  score: number;
  hidden: boolean;
  leading: boolean;
  collapsed: boolean;
  /** Which end of the pill this sits on, so its spacing collapses on the correct side. */
  side: 'left' | 'right';
}) {
  const rounded = Math.round(score);
  const spacing = collapsed ? 'max-w-0 opacity-0 mr-0 ml-0' : side === 'left' ? 'max-w-[56px] opacity-100 mr-1.5' : 'max-w-[56px] opacity-100 ml-1.5';
  return (
    <span
      aria-hidden={collapsed}
      className={`tabular-nums overflow-hidden whitespace-nowrap transition-all duration-200 ease-out ${spacing} ${
        hidden ? 'opacity-50' : leading ? 'text-text' : 'opacity-60'
      }`}
    >
      {hidden ? '$–' : `${rounded < 0 ? '-' : ''}$${Math.abs(rounded)}`}
    </span>
  );
}

function TeamHeader({
  team,
  score,
  record,
  streak,
  reverse,
  scaleRef,
  perfect = false,
  skunked = false,
  scoreHidden = false,
}: {
  team: League['teams'][number];
  score: number;
  /** No safe score to show yet. */
  scoreHidden?: boolean;
  /** Season record, "4-0" or "3-1-1". Null before any week has been decided. */
  record: string | null;
  /** Current run of results, shown beside the record as "W4". */
  streak: { type: 'W' | 'L' | 'T' | null; count: number };
  reverse?: boolean;
  scaleRef: number;
  /** A perfect week: the headline number is drawn as fire. */
  perfect?: boolean;
  /** A skunked week: stink lines and flies around the logo, a muted name and a small label. */
  skunked?: boolean;
}) {
  const plStyle = usePlStyle();
  // Name used to share its row with the logo, truncating hard into the leftover
  // space next to it ("Wilhelm's Wild Wagers" -> "Wilhelm's Wild ...") even though
  // the $ line right below -- which doesn't compete with the logo for width --
  // had plenty of room (see chat, Sept 2026). The name now gets the column's full
  // width on its own line instead of only what's left beside the logo, so most
  // names fit without truncating at all -- but it stays single-line (plain
  // truncate, not line-clamp-2): Hunter's explicit call was that a name should
  // never wrap to a second line, truncating with an ellipsis if it still doesn't
  // fit. mt-1 below just keeps a beat of space between the name and the logo row.
  return (
    <div className={`min-w-0 ${reverse ? 'text-right' : ''}`}>
      <p className={`text-xs font-medium truncate ${perfect ? 'pl-fire-name' : skunked ? 'pl-skunk-name' : ''}`}>{team.teamName}</p>
      <div className={`flex items-center gap-1.5 mt-1 ${reverse ? 'flex-row-reverse' : ''}`}>
        <FireAura active={perfect}>
          <StinkAura active={skunked}>
            <TeamLogo team={team} size="md" />
          </StinkAura>
        </FireAura>
        <div className="min-w-0">
          {/* The headline number carries this screen, so it is sized like one. It could not grow
              while the week's pick record sat directly under it; with that moved down to the
              probability bar this block is a line shorter and the figure takes the room (see chat,
              Oct 2026). */}
          {scoreHidden ? (
            <p className="text-xl font-bold text-text-muted leading-tight">$–</p>
          ) : (
            <p
              className={`text-xl font-bold leading-tight ${perfect ? 'pl-fire-hero' : Math.round(score * 100) > 0 ? 'text-profit' : Math.round(score * 100) < 0 ? 'text-loss' : 'text-text'}`}
              style={perfect ? undefined : plStyle(score, scaleRef)}
            >
              {formatCents(score)}
            </p>
          )}
          {record && (
            <p className={`text-[10px] truncate ${perfect ? 'text-text' : 'text-text-muted'}`}>
              {record}
              {streak.type && streak.count > 0 ? ` · ${streak.type}${streak.count}` : ''}
            </p>
          )}
          {perfect && <p className="text-[8px] font-bold uppercase tracking-wider pl-gold-text mt-0.5">Perfect week</p>}
          {skunked && <p className="text-[8px] font-bold uppercase tracking-wider pl-skunk-name mt-0.5">Skunked</p>}
        </div>
      </div>
    </div>
  );
}

function SlotMini({
  slot,
  league,
  isUser,
  hidePicks,
  hideEmpty,
  realGamesById,
  realPlayerStats,
  advanced,
  onToggle,
  reverse,
}: {
  slot: RosterSlotState;
  league: League;
  isUser: boolean;
  hidePicks: boolean;
  /** An opponent's empty slot reads Hidden (see emptySlotsHidden). */
  hideEmpty: boolean;
  realGamesById: Record<string, ReturnType<typeof getGame>>;
  realPlayerStats?: Record<string, RealPlayerStatLine>;
  /** Whether this cell shows the detailed layout: the Advanced setting, unless this one was tapped. */
  advanced: boolean;
  /** Tap on a visible pick: open or close just this cell. */
  onToggle: () => void;
  reverse?: boolean;
}) {
  if (!slot.wager) {
    if (hideEmpty) {
      return (
        <div className={`bg-bg-card border border-border rounded-lg p-2 text-[11px] text-text-muted flex items-center justify-center gap-1 ${reverse ? 'flex-row-reverse' : ''}`}>
          <Lock size={12} /> Hidden
        </div>
      );
    }
    return <div className="bg-bg-card border border-border rounded-lg p-2 text-[11px] text-text-muted flex items-center justify-center">Empty</div>;
  }
  // Real wagers carry a real Odds-API event id that the local simulated dataset
  // has never heard of -- getGame() alone would return undefined for those,
  // which `!game` below then misread as "already started" (see chat: this is
  // why every real, genuinely-upcoming pick showed a "Live" pill, and also let
  // hidePicks leak an opponent's real pick before kickoff, since `shouldHide`
  // depends on the same `gameStarted` flag).
  const game = realGamesById[slot.wager.gameId] ?? getGame(slot.wager.gameId, league.currentWeek, league.settings.lineMovementEnabled);
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
  // A visible pick is a button: tapping opens or closes just this cell.
  const tap = {
    role: 'button' as const,
    tabIndex: 0,
    'aria-expanded': advanced,
    onClick: onToggle,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggle();
      }
    },
  };
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
      <div {...tap} className={`border border-border rounded-lg px-2 py-1.5 cursor-pointer active:bg-bg-raised ${settled ? 'bg-bg-card/60' : 'bg-bg-card'} ${reverse ? 'text-right' : ''}`}>
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
    <div {...tap} className={`border border-border rounded-lg p-2 cursor-pointer active:bg-bg-raised ${settled ? 'bg-bg-card/60' : 'bg-bg-card'} ${reverse ? 'text-right' : ''}`}>
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
