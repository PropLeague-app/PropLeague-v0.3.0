import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CalendarDays, Check, ChevronRight, Medal, Pencil, Settings as SettingsIcon, Swords, UserRound, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import type { League, LogoIdentity } from '../types';
import { useAppStore } from '../store/useAppStore';
import { BackHeader } from '../components/layout/BackHeader';
import { HubHeader } from '../components/common/HubHeader';
import { TeamLogo } from '../components/common/TeamLogo';
import { EmptyState } from '../components/common/EmptyState';
import { FireAura } from '../components/common/FireAura';
import { MatchupCard } from '../components/home/MatchupCard';
import { PowerMini, SeasonShape, Strengths } from '../components/profile/ProfileMiniViews';
import { TeamIdentitySheet } from '../components/profile/TeamIdentitySheet';
import { collectTeamBets, computeIndividualStats, computeTeamStreak } from '../engine/stats';
import { isTeamOnFire } from '../engine/perfectWeek';
import { sortStandings } from '../engine/standings';
import { regularSeasonMatchups } from '../engine/bracketModel';
import { resolveGame, gameHasStarted } from '../services/oddsService';
import { formatCents } from '../engine/oddsMath';
import { usePlStyle } from '../components/common/usePlStyle';
import { useEnsureSettledWeekRosters } from '../components/common/useEnsureWeekRosters';

/** One league member: who they are, how their season is going, and the way through to everything
 * that belongs to them.
 *
 * A hub rather than a menu with a header. It used to be an identity line, six stat tiles and six
 * rows, where every tile summarised one of the screens listed directly beneath it, so the page said
 * nothing you could not get by tapping once and showed nothing about right now (see chat, Oct 2026).
 * What it shows instead is the shape League Home already uses: blocks that are live views of
 * something, each with a way through to the full thing.
 *
 * Everything here is scoped to one person. League-wide views live on the league side. */
export function Profile() {
  const { teamId } = useParams();
  const navigate = useNavigate();
  const currentLeagueId = useAppStore((s) => s.currentLeagueId);
  const league = useAppStore((s) => (currentLeagueId ? s.leagues[currentLeagueId] : undefined));
  const realGamesById = useAppStore((s) => s.realGamesById);
  const plStyle = usePlStyle();
  const [editOpen, setEditOpen] = useState(false);
  const updateUserTeam = useAppStore((s) => s.updateUserTeam);
  // The colour being dragged in the picker below, before it is saved. Painting the header with it is
  // the whole point of keeping the header unshaded while the sheet is open.
  const [draftIdentity, setDraftIdentity] = useState<LogoIdentity | null>(null);
  // Perfect weeks and settled records are read from past weeks' rosters, same as My Stats.
  useEnsureSettledWeekRosters(league);

  const userTeam = league?.teams.find((t) => t.isUser);
  // No team in the route means "me". An unknown one falls back the same way rather than erroring:
  // a stale link to a team that has since left the league should land somewhere sensible.
  const viewed = (teamId ? league?.teams.find((t) => t.id === teamId) : undefined) ?? userTeam;

  if (!league || !viewed || !userTeam) {
    return (
      <div className="flex flex-col">
        <BackHeader title="Profile" fallback="/home" />
        <div className="p-4">
          <EmptyState icon={<UserRound size={36} strokeWidth={1.5} />} title="No team to show" subtitle="This profile is not part of the league you are viewing." />
        </div>
      </div>
    );
  }

  const isOwn = viewed.id === userTeam.id;
  const standing = league.standings.find((s) => s.teamId === viewed.id);
  const streak = computeTeamStreak(league, viewed.id);
  const record = standing ? `${standing.wins}-${standing.losses}${standing.ties ? `-${standing.ties}` : ''}` : '—';
  const streakText = streak.type && streak.count > 0 ? `${streak.type.toUpperCase()}${streak.count}` : '—';
  const ranked = sortStandings(league.standings, regularSeasonMatchups(league));
  const rank = ranked.findIndex((s) => s.teamId === viewed.id) + 1;
  // The flame here is the streak, not the trophy: lit by a perfect week, out the moment they lose a
  // bet. The per-week flame on matchup cards and the schedule still means that week was clean.
  const onFire = isTeamOnFire(league, viewed.id);
  const headerColor = (isOwn && draftIdentity?.logoColor) || viewed.logoColor;
  const headerTeam = isOwn && draftIdentity ? { ...viewed, ...draftIdentity } : viewed;

  // The betting summary, computed the same way My Stats computes it, so the headline numbers here
  // and the screen behind them can never disagree.
  const gameLookup = (gameId: string) => resolveGame(gameId, realGamesById, league.currentWeek, league.settings.lineMovementEnabled);
  const bets = collectTeamBets(league, viewed.id, {
    isOwnTeam: isOwn,
    isGameStarted: (gameId: string) => gameHasStarted(gameLookup(gameId)),
  });
  const stats = computeIndividualStats(bets, gameLookup);
  const pl = stats.totalPL;
  const hasSettled = stats.settledBets > 0;

  const suffix = isOwn ? '' : `/${viewed.id}`;
  const thisWeek = (league.matchupsByWeek[league.currentWeek] ?? []).find(
    (m) => m.teamAId === viewed.id || m.teamBId === viewed.id,
  );

  return (
    <div className="flex flex-col">
      {isOwn ? (
        // Same wrapper as BackHeader, down to the border and the title size: one profile opened
        // from the tab bar and another opened from the strip were landing on headers of different
        // heights, so the whole page below them shifted (see chat, Oct 2026). tap-44 keeps the gear
        // a full-size target while drawing at the Back control's height.
        <div className="sticky top-0 z-10 bg-bg-raised/95 backdrop-blur border-b border-border px-4 py-2 flex items-center gap-2">
          <h1 className="text-xl font-bold truncate flex-1">My Profile</h1>
          <button
            onClick={() => navigate('/settings')}
            aria-label="Settings"
            className="w-7 h-7 rounded-full flex items-center justify-center text-text-muted shrink-0 active:scale-95 tap-44"
          >
            <SettingsIcon size={20} />
          </button>
        </div>
      ) : (
        <BackHeader title="Profile" fallback="/profile" onBack={() => navigate('/profile')} />
      )}

      {/* The team's own colour, washed behind the identity block and faded out into the page. Mixed
          against the theme background rather than laid on at a fixed opacity, so a pale colour on
          the light theme and a dark one on Graphite both stay readable (see chat, Oct 2026). */}
      <div
        className="px-4 pt-3 pb-4"
        style={{
          background: `linear-gradient(180deg, color-mix(in oklab, ${headerColor} 32%, var(--color-bg)) 0%, var(--color-bg) 100%)`,
        }}
      >
        <div className="flex items-center gap-3">
          <FireAura active={onFire}>
            <TeamLogo team={headerTeam} size="lg" />
          </FireAura>
          <div className="min-w-0 flex-1">
            {/* Editing happens in place rather than inside the sheet. The name is what the gradient
                and the logo sit next to, so changing it anywhere else means editing a thing you
                cannot see (see chat, Oct 2026). */}
            {editOpen && isOwn ? (
              <div className="grid grid-cols-[1fr_3.25rem] gap-1.5">
                <input
                  value={viewed.teamName}
                  onChange={(e) => updateUserTeam(league.id, { teamName: e.target.value })}
                  aria-label="Team name"
                  className="w-full bg-bg-card/80 border border-border rounded-lg px-2 py-1 text-base font-bold min-w-0"
                />
                <input
                  value={viewed.abbrev}
                  onChange={(e) => updateUserTeam(league.id, { abbrev: e.target.value.toUpperCase().slice(0, 4) })}
                  aria-label="Abbreviation"
                  className="w-full bg-bg-card/80 border border-border rounded-lg px-2 py-1 text-base font-bold uppercase text-center min-w-0"
                />
              </div>
            ) : (
              <>
                <p className="text-lg font-bold truncate">{viewed.teamName}</p>
                <p className="text-xs text-text-muted truncate">
                  {viewed.ownerName}
                  {viewed.id === league.commissionerTeamId ? ' · Commissioner' : ''}
                </p>
              </>
            )}
          </div>
          {/* Changing your own team used to mean going to Settings and finding it under Profile &
              Team. It belongs where the team is. */}
          {isOwn && (
            <button
              onClick={() => setEditOpen((v) => !v)}
              aria-label={editOpen ? 'Done editing' : 'Edit team identity'}
              aria-pressed={editOpen}
              className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 active:scale-95 tap-44 ${
                editOpen ? 'text-primary' : 'text-text-muted'
              }`}
            >
              {editOpen ? <Check size={18} /> : <Pencil size={17} />}
            </button>
          )}
        </div>

        {/* Identity, not analysis: the four figures you would say out loud about someone. The label
            goes above its number, which is what lets these be this short, and standing gets a box of
            its own rather than being bolted onto the record, where "Matchups · 6th" read as one
            thing and was neither (see chat, Oct 2026). */}
        <div className="grid grid-cols-4 gap-1.5 mt-3">
          <Summary label="Matchups" value={record} />
          <Summary label="Place" value={rank > 0 ? ordinal(rank) : '—'} />
          <Summary
            label="Season P/L"
            value={hasSettled ? formatCents(pl) : '—'}
            className={!hasSettled ? '' : pl >= 0 ? 'text-profit' : 'text-loss'}
            style={hasSettled ? plStyle(pl, Math.max(1, Math.abs(pl))) : undefined}
          />
          <Summary
            label="Streak"
            value={streakText}
            className={streak.type === 'W' ? 'text-profit' : streak.type === 'L' ? 'text-loss' : ''}
          />
        </div>
      </div>

      {/* Everyone else, one tap away. This replaces the League Members row: a list of people you
          cannot see is a dead end, and the strip costs less height than the row it stands in for. */}
      <MemberStrip league={league} viewedId={viewed.id} userTeamId={userTeam.id} />

      <div className="px-4 pb-4 space-y-3">
        {/* "This week" said when, not what. Every block on the screen names its own category now,
            the same way and with the same icon the row for it carries lower down. */}
        {thisWeek && (
          <div>
            <HubHeader icon={<Swords size={13} />} title="Current Matchup" chevron />
            <MatchupCard league={league} matchup={thisWeek} highlightTeamId={viewed.id} compact />
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 items-start">
          <Strengths stats={stats} to={`/my-stats${suffix}`} />
          <SeasonShape bets={bets} to={`/my-stats${suffix}`} />
        </div>

        <PowerMini league={league} teamId={viewed.id} to={`/power-rankings/${viewed.id}`} />

        <div className="space-y-1.5">
          <Entry icon={<CalendarDays size={17} />} label="Season Schedule" onClick={() => navigate(`/schedule${suffix}`)} />
          <Entry icon={<Medal size={17} />} label="Leaderboards" onClick={() => navigate('/leaderboards')} />
        </div>
      </div>

      {editOpen && (
        <TeamIdentitySheet
          league={league}
          team={userTeam}
          onDraftChange={setDraftIdentity}
          onClose={() => {
            setEditOpen(false);
            setDraftIdentity(null);
          }}
        />
      )}
    </div>
  );
}

const ordinal = (n: number) => {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

/** Every team in the league as a row of logos, ordered by standing and numbered, the one being
 *  looked at marked, tapping straight through to that profile. Ends with the way to the full
 *  members screen.
 *
 *  Conferences are the awkward case: a flat 1..N over two conferences is a number nobody's standings
 *  screen agrees with. So when a league has them, the strip groups by conference and numbers within
 *  it, tagging the number with the conference's initial (E1, W1). One rule, both shapes, and the
 *  number always means what that team's own standings screen says (see chat, Oct 2026).
 */
function MemberStrip({ league, viewedId, userTeamId }: { league: League; viewedId: string; userTeamId: string }) {
  const navigate = useNavigate();
  const conferences = league.settings.conferences ?? [];
  const split = conferences.length > 1 && league.teams.some((t) => t.conferenceId);
  const ranked = sortStandings(league.standings, regularSeasonMatchups(league));

  const seen = new Set<string>();
  const ordered: { id: string; mark: string }[] = [];
  const push = (id: string, mark: string) => {
    if (seen.has(id) || !league.teams.some((t) => t.id === id)) return;
    seen.add(id);
    ordered.push({ id, mark });
  };

  if (split) {
    for (const conf of conferences) {
      const initial = conf.name.trim().charAt(0).toUpperCase() || '?';
      let place = 0;
      for (const row of ranked) {
        const team = league.teams.find((t) => t.id === row.teamId);
        if (team?.conferenceId !== conf.id) continue;
        place += 1;
        push(row.teamId, `${initial}${place}`);
      }
    }
  } else {
    ranked.forEach((row, i) => push(row.teamId, String(i + 1)));
  }
  // Anyone the standings have not reached yet still belongs on the strip.
  for (const t of league.teams) push(t.id, '');

  return (
    // py-2 is not decoration: the selected ring is drawn outside the button box, and a scroll
    // container sized to the logos alone clipped the top and bottom off it.
    <div className="flex items-start gap-2 overflow-x-auto overscroll-x-contain px-4 pt-1 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {ordered.map(({ id, mark }) => {
        const team = league.teams.find((t) => t.id === id);
        if (!team) return null;
        const active = id === viewedId;
        return (
          <button
            key={id}
            onClick={() => navigate(id === userTeamId ? '/profile' : `/profile/${id}`)}
            aria-label={`${team.teamName}${mark ? `, ${mark}` : ''}`}
            aria-pressed={active}
            className="shrink-0 flex flex-col items-center gap-1"
          >
            <span className={`rounded-full p-0.5 transition-opacity ${active ? 'ring-2 ring-primary' : 'opacity-55'}`}>
              <FireAura active={isTeamOnFire(league, id)}>
                <TeamLogo team={team} size="sm" />
              </FireAura>
            </span>
            <span className={`text-[9px] font-semibold tabular-nums leading-none ${active ? 'text-primary' : 'text-text-muted'}`}>
              {mark}
            </span>
          </button>
        );
      })}
      <button
        onClick={() => navigate('/members')}
        className="shrink-0 h-7 px-2.5 mt-0.5 rounded-full border border-border bg-bg-card text-[11px] font-semibold text-text-muted flex items-center gap-1 active:opacity-80"
      >
        <Users size={12} />
        All
      </button>
    </div>
  );
}

function Summary({ value, label, className = '', style }: { value: string; label: string; className?: string; style?: React.CSSProperties }) {
  return (
    <div className="rounded-lg border border-border bg-bg-card px-1 py-1.5 text-center">
      <p className="text-[9px] font-semibold uppercase tracking-wider text-text-muted leading-none truncate">{label}</p>
      <p className={`text-[13px] font-bold tabular-nums whitespace-nowrap leading-none mt-1 ${className}`} style={style}>
        {value}
      </p>
    </div>
  );
}

function Entry({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 bg-bg-card border border-border rounded-xl px-3 py-3 text-left active:opacity-80"
    >
      <span className="text-text-muted shrink-0">{icon}</span>
      <span className="flex-1 min-w-0 truncate text-sm font-semibold">{label}</span>
      <ChevronRight size={16} className="text-text-muted shrink-0" />
    </button>
  );
}
