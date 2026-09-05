import { useState } from 'react';
import { Trophy, ChevronUp, ChevronDown } from 'lucide-react';
import type { BracketMatch, League, MatchSource, PlayoffBracket } from '../../types';
import { formatCents } from '../../engine/oddsMath';
import { weekLabel } from '../../types';
import { TeamLogo } from '../common/TeamLogo';

function MatchCard({ league, bracket, match }: { league: League; bracket: PlayoffBracket; match: BracketMatch }) {
  const teamA = league.teams.find((t) => t.id === match.teamAId);
  const teamB = league.teams.find((t) => t.id === match.teamBId);
  const seedA = match.teamAId ? bracket.seeds.indexOf(match.teamAId) + 1 : 0;
  const seedB = match.teamBId ? bracket.seeds.indexOf(match.teamBId) + 1 : 0;

  return (
    <div className="bg-bg-card border border-border rounded-xl p-3 space-y-2 w-full">
      <Row team={teamA} seed={seedA} score={match.teamAScore} winner={!!match.winnerId && match.winnerId === match.teamAId} />
      <div className="border-t border-border" />
      <Row team={teamB} seed={seedB} score={match.teamBScore} winner={!!match.winnerId && match.winnerId === match.teamBId} />
      {match.weekId != null && !match.winnerId && (
        <p className="text-[10px] text-text-muted pt-1 border-t border-border">{weekLabel(match.weekId)}</p>
      )}
    </div>
  );
}

/** A resting team's row for a round it has a bye in (manual v0.03 §2 #1) — same visual
 * weight as a MatchCard so it reads as "this team's status this round", not a footnote. */
function ByeCard({ league, bracket, seed, advancesToLabel }: { league: League; bracket: PlayoffBracket; seed: number; advancesToLabel: string | undefined }) {
  const teamId = bracket.seeds[seed - 1];
  const team = league.teams.find((t) => t.id === teamId);
  if (!team) return null;
  return (
    <div className="bg-bg-card border border-dashed border-border rounded-xl p-3 flex items-center gap-2.5 w-full">
      <span className="text-[11px] text-text-muted w-4">#{seed}</span>
      <TeamLogo team={team} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-sm truncate">{team.teamName}</p>
        <p className="text-[10px] text-text-muted">Bye{advancesToLabel ? ` — advances to ${advancesToLabel}` : ''}</p>
      </div>
    </div>
  );
}

function Row({
  team,
  seed,
  score,
  winner,
}: {
  team: League['teams'][number] | undefined;
  seed: number;
  score: number | null;
  winner: boolean;
}) {
  return (
    <div className={`flex items-center justify-between ${winner ? 'text-primary font-semibold' : ''}`}>
      <div className="flex items-center gap-2 min-w-0">
        {seed > 0 && <span className="text-[11px] text-text-muted w-4">#{seed}</span>}
        {team && <TeamLogo team={team} size="sm" />}
        <span className="text-sm truncate">{team?.teamName ?? 'TBD'}</span>
      </div>
      <span className="text-sm">{score != null ? formatCents(score) : '—'}</span>
    </div>
  );
}

interface MatchGroup {
  label: string;
  matches: BracketMatch[];
}

function groupByLabel(matches: BracketMatch[]): MatchGroup[] {
  const groups: MatchGroup[] = [];
  for (const m of matches) {
    const existing = groups.find((g) => g.label === m.label);
    if (existing) existing.matches.push(m);
    else groups.push({ label: m.label, matches: [m] });
  }
  return groups;
}

function isSeedSource(source: MatchSource): source is { type: 'seed'; seed: number } {
  return source.type === 'seed';
}

/** Byes only ever occur in a bracket's very first winners round (the 6-team field's
 * top 2 seeds skip straight to the semifinal) — detected generically as "seeds that
 * never appear as a direct seed-source in this round's matches", not hardcoded to
 * fieldSize 6, so it stays correct if another bye-shaped bracket is added later. */
function byeSeedsForFirstGroup(bracket: PlayoffBracket): number[] {
  const firstGroup = groupByLabel(bracket.matches.filter((m) => m.side === 'W'))[0];
  if (!firstGroup) return [];
  const playingSeeds = new Set<number>();
  for (const m of firstGroup.matches) {
    if (isSeedSource(m.sourceA)) playingSeeds.add(m.sourceA.seed);
    if (isSeedSource(m.sourceB)) playingSeeds.add(m.sourceB.seed);
  }
  const byes: number[] = [];
  for (let seedNum = 1; seedNum <= bracket.seeds.length; seedNum++) {
    if (!playingSeeds.has(seedNum)) byes.push(seedNum);
  }
  return byes;
}

function advancesToLabelForSeed(bracket: PlayoffBracket, seedNum: number): string | undefined {
  const match = bracket.matches.find((m) => {
    const aMatches = isSeedSource(m.sourceA) && m.sourceA.seed === seedNum;
    const bMatches = isSeedSource(m.sourceB) && m.sourceB.seed === seedNum;
    return aMatches || bMatches;
  });
  return match?.label;
}

/** Rounds render most-recent-first (current/latest round on top, manual v0.03 §2 #2),
 * each independently collapsible but expanded by default. */
function RoundGroups({ league, bracket, groups, byes }: { league: League; bracket: PlayoffBracket; groups: MatchGroup[]; byes?: Map<string, number[]> }) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const reversed = [...groups].reverse();
  return (
    <div className="space-y-4">
      {reversed.map((group) => {
        const isOpen = !collapsed[group.label];
        const byeSeeds = byes?.get(group.label) ?? [];
        return (
          <div key={group.label}>
            <button
              onClick={() => setCollapsed((c) => ({ ...c, [group.label]: !c[group.label] }))}
              className="w-full flex items-center justify-between mb-2"
            >
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wide">{group.label}</p>
              <span className="text-text-muted">{isOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
            </button>
            {isOpen && (
              <div className="space-y-2">
                {group.matches.map((m) => (
                  <MatchCard key={m.id} league={league} bracket={bracket} match={m} />
                ))}
                {byeSeeds.map((seed) => (
                  <ByeCard key={`bye-${seed}`} league={league} bracket={bracket} seed={seed} advancesToLabel={advancesToLabelForSeed(bracket, seed)} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function BracketView({ league, bracket }: { league: League; bracket: PlayoffBracket }) {
  const champion = bracket.championId ? league.teams.find((t) => t.id === bracket.championId) : undefined;
  const scheduledOrDone = bracket.matches.filter((m) => m.teamAId && m.teamBId);
  const winnersMatches = scheduledOrDone.filter((m) => m.side === 'W' || m.side === 'F');
  const losersMatches = scheduledOrDone.filter((m) => m.side === 'L');
  const decidingMatches = scheduledOrDone.filter((m) => m.id === 'TRUE-FINAL' || m.id === 'RESET');

  const winnersGroups = groupByLabel(winnersMatches);
  const byeSeeds = byeSeedsForFirstGroup(bracket);
  const byesByGroup = new Map<string, number[]>();
  if (byeSeeds.length > 0 && winnersGroups.length > 0) byesByGroup.set(winnersGroups[0].label, byeSeeds);

  return (
    <div className="space-y-5">
      {champion && (
        <div className="bg-gradient-to-br from-primary/20 to-accent/20 border border-primary rounded-xl p-4 text-center space-y-1">
          <Trophy size={32} className="mx-auto" />
          <p className="font-bold">{champion.teamName}</p>
          <p className="text-xs text-text-muted">PropLeague Champions</p>
        </div>
      )}

      <p className="text-[11px] text-text-muted">
        {bracket.fieldSize}-team {bracket.eliminationType === 'double' ? 'double' : 'single'}-elimination bracket
      </p>

      {decidingMatches.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-accent uppercase tracking-wide mb-2">
            {decidingMatches.length > 1 ? 'True Final + Bracket Reset' : 'True Final'}
          </p>
          <div className="space-y-2">
            {[...decidingMatches].reverse().map((m) => (
              <MatchCard key={m.id} league={league} bracket={bracket} match={m} />
            ))}
          </div>
        </div>
      )}

      <RoundGroups league={league} bracket={bracket} groups={winnersGroups} byes={byesByGroup} />

      {losersMatches.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-loss uppercase tracking-wide mb-2">Losers Bracket</p>
          <RoundGroups league={league} bracket={bracket} groups={groupByLabel(losersMatches)} />
        </div>
      )}
    </div>
  );
}