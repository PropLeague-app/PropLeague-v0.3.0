import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CalendarClock, ChevronDown, ChevronUp, EyeOff } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { calendarIndex } from '../engine/playoffs';
import { weekOrder, type League, type WeekId } from '../types';
import { BackHeader, BACK_HEADER_HEIGHT } from '../components/layout/BackHeader';
import { headerTapToTop } from '../components/layout/shellNav';
import { MatchupCard } from '../components/home/MatchupCard';
import { UpcomingMatchupCard } from '../components/matchups/UpcomingMatchupCard';
import { MatchupWeekScroller } from '../components/matchups/MatchupWeekScroller';
import { BracketView } from '../components/playoffs/BracketView';
import { EmptyState } from '../components/common/EmptyState';
import { TeamLogo } from '../components/common/TeamLogo';
import { useEnsureSettledWeekRosters } from '../components/common/useEnsureWeekRosters';
import {
  leagueBracketModel,
  leagueSeasonPlan,
  leagueWeekMatchups,
  nflWeekName,
  weekRoundLong,
  weekRoundShort,
  weekStatus,
  type BracketModel,
} from '../engine/bracketModel';

function parseWeek(raw: string | null): WeekId | null {
  if (!raw) return null;
  if (raw === 'WC' || raw === 'DIV' || raw === 'CONF') return raw;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 18 ? n : null;
}

function recordOf(league: League, teamId: string): string {
  const s = league.standings.find((x) => x.teamId === teamId);
  if (!s) return '0-0';
  return s.ties > 0 ? `${s.wins}-${s.losses}-${s.ties}` : `${s.wins}-${s.losses}`;
}

/** Your matchup first, then the rest in their usual order. */
function userFirst<T>(items: T[], involvesUser: (item: T) => boolean): T[] {
  return [...items.filter(involvesUser), ...items.filter((i) => !involvesUser(i))];
}

/**
 * Every week of the league's season on one scroller (1.2.11), from its start week to its championship
 * week. Regular-season weeks list the matchups, yours first: finished and current weeks as full matchup
 * cards, later weeks as light "upcoming" cards. Playoff weeks show the bracket on that week's round, each
 * game a small matchup card to tap, plus who is out. Before the playoffs the bracket is projected from the
 * current standings (unless the commissioner hides it). Called Bracket in Profile during the playoffs.
 */
export function LeagueMatchups() {
  const navigate = useNavigate();
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const loadLeagueResults = useAppStore((s) => s.loadLeagueResults);
  const [params, setParams] = useSearchParams();
  useEnsureSettledWeekRosters(league);

  // Covers reaching this screen directly (a deep link) without passing through League Home first.
  useEffect(() => {
    if (currentLeagueId) loadLeagueResults(currentLeagueId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLeagueId]);

  const model = useMemo(() => (league ? leagueBracketModel(league) : null), [league]);
  if (!league) return null;

  const plan = leagueSeasonPlan(league);
  const allWeeks = [...plan.regularWeeks, ...plan.playoffWeeks].map(String);
  const asked = parseWeek(params.get('week')) ?? league.currentWeek;
  const week = allWeeks.includes(String(asked)) ? asked : (plan.regularWeeks[0] ?? plan.playoffWeeks[0] ?? asked);
  const setWeek = (w: WeekId) => setParams({ week: String(w) }, { replace: true });
  const isPlayoff = plan.playoffWeeks.some((w) => String(w) === String(week));
  const userTeamId = league.teams.find((t) => t.isUser)?.id;
  const title = league.seasonPhase === 'playoffs' ? 'Bracket' : 'Matchups';

  return (
    <div className="flex flex-col">
      <BackHeader title={title} fallback="/home" />
      <div className="sticky z-10 bg-bg-raised/95 backdrop-blur border-b border-border px-4 pt-2 pb-1" style={{ top: BACK_HEADER_HEIGHT }} onClick={headerTapToTop}>
        <MatchupWeekScroller
          regularWeeks={plan.regularWeeks}
          playoffWeeks={plan.playoffWeeks}
          roundOf={(w) => (model ? weekRoundShort(model, w) : '')}
          currentWeek={league.currentWeek}
          value={week}
          onChange={setWeek}
          startNote={league.seasonStartWeek != null && calendarIndex(league.seasonStartWeek) > 0 ? nflWeekName(league.seasonStartWeek) : undefined}
        />
      </div>
      <div className="p-4 space-y-3">
        {isPlayoff ? (
          <PlayoffWeek league={league} model={model} week={week} lastRegular={plan.regularWeeks[plan.regularWeeks.length - 1]} onWeek={setWeek} />
        ) : (
          <RegularWeek league={league} week={week} userTeamId={userTeamId} onOpen={(id) => navigate(`/matchup/${id}`)} />
        )}
      </div>
    </div>
  );
}

/** Our round on top, the real NFL week under it, so a long name like NFL Conference Championship is
 * never cut off. */
function WeekHeading({ title, sub, tag }: { title: string; sub?: string; tag?: string }) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex-1 min-w-0">
        <h2 className="text-sm font-bold">{title}</h2>
        {sub && <p className="text-[11px] text-text-muted">{sub}</p>}
      </div>
      {tag && <span className="shrink-0 mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-muted">{tag}</span>}
    </div>
  );
}

function RegularWeek({ league, week, userTeamId, onOpen }: { league: League; week: WeekId; userTeamId?: string; onOpen: (id: string) => void }) {
  const rows = userFirst(leagueWeekMatchups(league, week), (m) => m.teamAId === userTeamId || m.teamBId === userTeamId);
  const order = weekOrder(week) - weekOrder(league.currentWeek);
  const started = league.seasonStartWeek != null;
  const upcoming = !started || order > 0;
  const tag = !started ? 'Not started' : order < 0 ? 'Final' : order === 0 ? 'This week' : 'Upcoming';
  const team = (id: string) => league.teams.find((t) => t.id === id);

  return (
    <>
      <WeekHeading title={nflWeekName(week)} tag={tag} />
      {rows.length === 0 ? (
        <EmptyState icon={<CalendarClock size={32} strokeWidth={1.5} />} title="No matchups this week" subtitle="The schedule is set when the season starts." />
      ) : (
        <div className="space-y-2.5">
          {rows.map((m) =>
            upcoming ? (
              <UpcomingMatchupCard
                key={m.id}
                a={{ team: team(m.teamAId), sub: recordOf(league, m.teamAId) }}
                b={{ team: team(m.teamBId), sub: recordOf(league, m.teamBId) }}
                userTeamId={userTeamId}
                onClick={started ? () => onOpen(m.id) : undefined}
              />
            ) : (
              <MatchupCard key={m.id} league={league} matchup={m} highlightTeamId={userTeamId} />
            ),
          )}
        </div>
      )}
    </>
  );
}

function PlayoffWeek({
  league,
  model,
  week,
  lastRegular,
  onWeek,
}: {
  league: League;
  model: BracketModel | null;
  week: WeekId;
  lastRegular: WeekId | undefined;
  onWeek: (w: WeekId) => void;
}) {
  if (!model) {
    return <EmptyState icon={<CalendarClock size={32} strokeWidth={1.5} />} title="No bracket yet" subtitle="The playoff field needs a full league." />;
  }
  if (model.projected && league.settings.showProjectedBracket === false) {
    return (
      <EmptyState
        icon={<EyeOff size={32} strokeWidth={1.5} />}
        title="Bracket set after the regular season"
        subtitle={lastRegular != null ? `Seeded once ${nflWeekName(lastRegular)} is final.` : undefined}
      />
    );
  }
  const status = weekStatus(model, league, week);
  return (
    <>
      <WeekHeading title={weekRoundLong(model, week) || nflWeekName(week)} sub={nflWeekName(week)} tag={model.projected ? 'Projected' : undefined} />
      <BracketView league={league} model={model} selectedWeek={week} onScrollToWeek={onWeek} />
      <OutRow league={league} out={status.out} />
    </>
  );
}

/** Teams already out this week, as a row of dimmed logos; tap to see who and why. */
function OutRow({ league, out }: { league: League; out: { teamId: string; reason: string }[] }) {
  const [open, setOpen] = useState(false);
  if (out.length === 0) return null;
  const teams = out.map((o) => ({ ...o, team: league.teams.find((t) => t.id === o.teamId) })).filter((o) => o.team);
  return (
    <div className="rounded-xl border border-border bg-bg-card/60">
      <button type="button" onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 px-2.5 py-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-loss shrink-0">Out</span>
        <div className="flex -space-x-1.5 min-w-0 flex-1 overflow-hidden opacity-60 grayscale-[40%]">
          {teams.map((o) => (
            <TeamLogo key={o.teamId} team={o.team!} size="sm" />
          ))}
        </div>
        <span className="text-[11px] text-text-muted shrink-0 tabular-nums">{teams.length}</span>
        {open ? <ChevronUp size={14} className="text-text-muted shrink-0" /> : <ChevronDown size={14} className="text-text-muted shrink-0" />}
      </button>
      {open && (
        <ul className="px-2.5 pb-2 space-y-1">
          {teams.map((o) => (
            <li key={o.teamId} className="flex items-center gap-2 min-w-0 opacity-75">
              <TeamLogo team={o.team!} size="xs" />
              <span className="text-xs truncate flex-1 min-w-0">{o.team!.teamName}</span>
              <span className="text-[10px] text-text-muted shrink-0">{o.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
