import { useCallback, useEffect, useMemo, useState } from 'react';
import { UserX, ExternalLink, Search, Check } from 'lucide-react';
import { ConfirmSheet } from '../common/ConfirmSheet';
import { CollapsibleSection } from './SettingsPrimitives';
import { MARKET_SHORT_LABELS } from '../../data/propsGenerator';
import { useAppStore } from '../../store/useAppStore';
import { nflTeamFromPlayerId, teamAccent } from '../../engine/teamColors';
import type { MarketKey, WeekId } from '../../types';
import type { RealPlayerStatLine } from '../../engine/realGameResult';
import {
  VOID_REASON_LABELS,
  clearVoidFlag,
  fetchVoidCandidates,
  groupVoidCandidates,
  searchVoidPlayers,
  setVoidFlag,
  voidReasonLabel,
  type VoidCandidateRow,
  type VoidPlayerGroup,
  type VoidReason,
} from '../../services/voidFlags';
import { chipClass } from './SettingsPrimitives';

function pickText(row: VoidCandidateRow): string {
  if (row.market_key === 'player_anytime_td') return 'Anytime TD';
  const label = MARKET_SHORT_LABELS[row.market_key as MarketKey] ?? row.market_key;
  return `${row.side} ${row.point ?? ''} ${label}`.replace(/\s+/g, ' ').trim();
}

/** What happens to this pick if the player is flagged. Mirrors settle-week: a pick that
 * already hit stays; one that lost is voided; one still ungraded is voided unless it hits. */
function outcomeText(status: string, flagged = false): string {
  if (status === 'won') return 'Stays won (already hit)';
  if (status === 'lost') return 'Will be voided';
  // Once flagged, a pick still showing pending is just waiting for the game to go final and its stats to
  // land; the next settlement run after that voids it (or leaves it won if it hit).
  if (status === 'pending') return flagged ? 'Waits for final stats' : 'Voided unless it hits';
  if (status === 'voided') return 'Voided';
  return 'Stays as is';
}

/** One-line box score from the stats we have, so the commissioner can sanity check an exit
 * (a player who left early usually has a thin line for a starter). */
function statSummary(line: RealPlayerStatLine | undefined): string | null {
  if (!line) return null;
  const parts: string[] = [];
  if (line.passingAttempts != null || line.passingYards != null) {
    parts.push(`${line.passingCompletions ?? '?'}/${line.passingAttempts ?? '?'} for ${line.passingYards ?? 0} pass yds, ${line.passingTds ?? 0} TD`);
  }
  if (line.rushingAttempts != null || line.rushingYards != null) {
    parts.push(`${line.rushingAttempts ?? '?'} carries, ${line.rushingYards ?? 0} rush yds`);
  }
  if (line.receptions != null || line.receivingYards != null) {
    parts.push(`${line.receptions ?? 0} rec, ${line.receivingYards ?? 0} rec yds`);
  }
  const skillTds = (line.rushingTds ?? 0) + (line.receivingTds ?? 0);
  if (skillTds > 0) parts.push(`${skillTds} rush/rec TD`);
  return parts.length > 0 ? parts.join(' · ') : 'No counting stats recorded';
}

type OutcomeTone = 'keep' | 'void' | 'maybe' | 'neutral';

function outcomeTone(status: string): OutcomeTone {
  if (status === 'won') return 'keep';
  if (status === 'lost' || status === 'voided') return 'void';
  if (status === 'pending') return 'maybe';
  return 'neutral';
}

const TONE_CLASS: Record<OutcomeTone, string> = {
  keep: 'bg-profit/15 text-profit',
  void: 'bg-loss/15 text-loss',
  maybe: 'bg-warning/15 text-warning',
  neutral: 'bg-bg-card text-text-muted',
};

function OutcomePill({ status, flagged = false }: { status: string; flagged?: boolean }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap ${TONE_CLASS[outcomeTone(status)]}`}>
      {outcomeText(status, flagged)}
    </span>
  );
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : '')).toUpperCase();
}

function Avatar({ name, playerId }: { name: string; playerId?: string | null }) {
  const mode = useAppStore((s) => s.profile?.themeMode) ?? 'dark';
  const color = teamAccent(nflTeamFromPlayerId(playerId), mode);
  return (
    <span
      className={`w-9 h-9 shrink-0 rounded-full text-xs font-bold flex items-center justify-center ${color ? '' : 'bg-primary/15 text-primary'}`}
      style={color ? { color, backgroundColor: `color-mix(in srgb, ${color} 22%, transparent)`, boxShadow: `inset 0 0 0 1.5px ${color}` } : undefined}
    >
      {initialsOf(name)}
    </span>
  );
}

/** One affected pick: whose it is and what it is on the left, the stake and what will happen to
 * it on the right. */
function PickRow({ row, flagged = false }: { row: VoidCandidateRow; flagged?: boolean }) {
  return (
    <li className="flex items-center justify-between gap-2 py-1.5">
      <div className="min-w-0">
        <p className="text-xs font-medium truncate">{row.team_name ?? 'Team'}</p>
        <p className="text-[11px] text-text-muted truncate">
          {pickText(row)} · ${row.stake}
        </p>
      </div>
      <OutcomePill status={row.status} flagged={flagged} />
    </li>
  );
}

function StepLabel({ n, children }: { n: number; children: string }) {
  return (
    <p className="flex items-center gap-2 text-xs font-semibold text-text">
      <span className="w-5 h-5 rounded-full bg-primary/15 text-primary text-[11px] flex items-center justify-center">{n}</span>
      {children}
    </p>
  );
}

const REASONS: VoidReason[] = ['injury', 'ejection', 'other'];

/** Commissioner-only card for early exits. The stats feed cannot tell who left a game, so
 * this is manual: search a player in your league this week, pick a reason, confirm. Settle-week
 * then voids that player's Over / Anytime TD picks that did not hit (Unders and picks that
 * already hit are never touched). Every flag is announced in the league feed with its reason. */
export function GameExitsCard({ leagueId, week }: { leagueId: string; week: WeekId }) {
  const weekStr = String(week);
  const statsByName = useAppStore((s) => s.realPlayerStatsByWeek[weekStr]);
  const loadStats = useAppStore((s) => s.loadRealPlayerStatsForWeek);

  const [rows, setRows] = useState<VoidCandidateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState<VoidReason | null>(null);
  const [note, setNote] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busyFlag, setBusyFlag] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetchVoidCandidates(leagueId, weekStr);
    if (res.ok) {
      setRows(res.rows);
      setError(null);
    } else {
      setError(res.error);
    }
  }, [leagueId, weekStr]);

  useEffect(() => {
    void load();
    if (!statsByName) void loadStats(week);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  const groups = useMemo(() => groupVoidCandidates(rows ?? []), [rows]);
  const flagged = groups.filter((g) => g.flagId);
  const matches = useMemo(() => searchVoidPlayers(groups, query), [groups, query]);
  const selectedGroup: VoidPlayerGroup | undefined = selected ? groups.find((g) => g.playerName === selected && !g.flagId) : undefined;
  const selectedStat = selectedGroup ? statsByName?.[selectedGroup.playerName.trim().toLowerCase()] : undefined;
  const noteOk = reason !== 'other' || note.trim().length >= 3;
  const canSubmit = !!selectedGroup && reason != null && noteOk;

  function resetSelection() {
    setSelected(null);
    setReason(null);
    setNote('');
    setQuery('');
  }

  async function removeFlag(group: VoidPlayerGroup) {
    if (!group.flagId) return;
    setBusyFlag(group.flagId);
    const res = await clearVoidFlag(group.flagId);
    if (!res.ok) setError(res.error);
    await load();
    setBusyFlag(null);
  }

  return (
    <>
      <CollapsibleSection
        title="Game Exits"
        icon={<UserX size={16} />}
        summary={flagged.length > 0 ? `${flagged.length} player${flagged.length > 1 ? 's' : ''} flagged this week` : 'Void picks when a player leaves a game early'}
      >
        <div className="rounded-lg bg-bg-raised p-3 space-y-2">
          <p className="text-xs text-text">
            When a player leaves a game early, sportsbooks void his Over and Anytime TD picks that had not already hit. Flag him here and your
            league follows the same rule.
          </p>
          <ul className="space-y-1">
            {[
              'Only Overs and Anytime TD picks are voided',
              'Unders and picks that already hit are never touched',
              'Any snap in the 2nd half means do not flag',
            ].map((rule) => (
              <li key={rule} className="flex items-start gap-1.5 text-[11px] text-text-muted">
                <Check size={12} className="shrink-0 mt-0.5 text-primary" />
                {rule}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-text-muted">Changes apply within about 15 minutes and are announced in the league feed.</p>
        </div>
        {error && <p className="text-xs text-loss">{error}</p>}

        {flagged.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Flagged this week</p>
            {flagged.map((g) => (
              <div key={g.playerName} className="rounded-xl bg-bg-raised border-l-4 border-loss p-3 space-y-1.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar name={g.playerName} playerId={g.picks[0]?.player_id} />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{g.playerName}</p>
                      <p className="text-[11px] text-text-muted truncate">
                        <span className="text-loss font-semibold">{voidReasonLabel(g.flagReason)}</span>
                        {g.flagNote ? ` · ${g.flagNote}` : ''}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void removeFlag(g)}
                    disabled={busyFlag === g.flagId}
                    className="text-xs px-2.5 py-1 rounded-lg border border-border text-text-muted shrink-0 disabled:opacity-50"
                  >
                    {busyFlag === g.flagId ? 'Removing…' : 'Remove flag'}
                  </button>
                </div>
                <ul className="divide-y divide-border">
                  {g.picks.map((p) => (
                    <PickRow key={p.wager_id} row={p} flagged />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Flag a player</p>
          {!selectedGroup && (
            <>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search a player in your league"
                  className="w-full bg-bg-raised border border-border rounded-lg pl-9 pr-3 py-2.5 text-sm"
                />
              </div>
              {query.trim() === '' && (
                <p className="text-[11px] text-text-muted">
                  Players with an Over or Anytime TD pick in your league, in a game that has started, will show up here.
                </p>
              )}
              {query.trim() !== '' && matches.length === 0 && (
                <p className="text-xs text-text-muted">
                  No match. Only players with an Over or Anytime TD pick in your league, in a game that has started, show up here.
                </p>
              )}
              {matches.length > 0 && (
                <div className="rounded-xl bg-bg-raised divide-y divide-border overflow-hidden">
                  {matches.map((g) => {
                    const teams = new Set(g.picks.map((p) => p.team_id)).size;
                    return (
                      <button
                        key={g.playerName}
                        type="button"
                        onClick={() => setSelected(g.playerName)}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left active:bg-bg-card"
                      >
                        <Avatar name={g.playerName} playerId={g.picks[0]?.player_id} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-medium truncate">{g.playerName}</span>
                          <span className="block text-[11px] text-text-muted">
                            {g.picks.length} pick{g.picks.length > 1 ? 's' : ''} · {teams} team{teams > 1 ? 's' : ''}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {selectedGroup && (
            <div className="rounded-xl bg-bg-raised border border-border p-3 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar name={selectedGroup.playerName} playerId={selectedGroup.picks[0]?.player_id} />
                  <p className="text-base font-bold truncate">{selectedGroup.playerName}</p>
                </div>
                <button type="button" onClick={resetSelection} className="text-xs text-primary shrink-0">
                  Change
                </button>
              </div>

              <div className="space-y-2">
                <StepLabel n={1}>Check the facts</StepLabel>
                <div className="rounded-lg bg-bg-card px-3 py-2 space-y-1.5">
                  <p className="text-xs text-text-muted">
                    {statSummary(selectedStat) ?? 'No stat line yet. If he never played, the app voids those picks automatically.'}
                  </p>
                  <a
                    href={`https://www.google.com/search?q=${encodeURIComponent(`${selectedGroup.playerName} injury left game`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary"
                  >
                    Search news <ExternalLink size={11} />
                  </a>
                </div>
              </div>

              <div className="space-y-2">
                <StepLabel n={2}>Picks that would be affected</StepLabel>
                <ul className="rounded-lg bg-bg-card px-3 divide-y divide-border">
                  {selectedGroup.picks.map((p) => (
                    <PickRow key={p.wager_id} row={p} />
                  ))}
                </ul>
              </div>

              <div className="space-y-2">
                <StepLabel n={3}>Why did he leave?</StepLabel>
                <div className="grid grid-cols-3 gap-1.5">
                  {REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setReason(r)}
                      className={`py-2 rounded-lg text-xs border ${chipClass(reason === r)}`}
                    >
                      {VOID_REASON_LABELS[r]}
                    </button>
                  ))}
                </div>
                {reason && (
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value.slice(0, 200))}
                    placeholder={reason === 'other' ? 'Required: what happened?' : 'Optional note (shown in the league feed)'}
                    className="w-full bg-bg-card border border-border rounded-lg px-3 py-2 text-sm"
                  />
                )}
              </div>

              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => setConfirmOpen(true)}
                className="w-full py-2.5 rounded-lg bg-loss text-white text-sm font-semibold disabled:opacity-40"
              >
                Void his picks
              </button>
            </div>
          )}
        </div>
      </CollapsibleSection>

      {confirmOpen && selectedGroup && reason && (
        <ConfirmSheet
          title={`Void ${selectedGroup.playerName}'s picks?`}
          description={`${VOID_REASON_LABELS[reason]}. His Over and Anytime TD picks that had not hit will be voided at $0 for everyone in your league, and this is announced in the feed. Unders and picks that already hit stay as they are. You can undo it with Remove flag.`}
          confirmLabel="Void picks"
          confirmingLabel="Flagging…"
          onConfirm={async () => {
            const res = await setVoidFlag(leagueId, weekStr, selectedGroup.playerName, reason, note);
            if (!res.ok) return { ok: false, error: res.error };
            resetSelection();
            await load();
          }}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </>
  );
}
