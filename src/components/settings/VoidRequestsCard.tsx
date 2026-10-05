import { useCallback, useEffect, useMemo, useState } from 'react';
import { UserX, ExternalLink, Search, Check, X } from 'lucide-react';
import { ConfirmSheet } from '../common/ConfirmSheet';
import { CollapsibleSection } from './SettingsPrimitives';
import { MARKET_SHORT_LABELS } from '../../data/propsGenerator';
import { CompactInput } from '../common/CompactInput';
import { useAppStore } from '../../store/useAppStore';
import { nflTeamFromPlayerId, teamAccent } from '../../engine/teamColors';
import type { MarketKey, WeekId } from '../../types';
import type { RealPlayerStatLine } from '../../engine/realGameResult';
import {
  VOID_REASON_LABELS,
  clearVoidFlag,
  fetchVoidCandidates,
  fetchVoidRequests,
  fetchVoidSearch,
  groupVoidCandidates,
  requestVoid,
  resolveVoidRequest,
  searchVoidPlayers,
  setVoidFlag,
  voidReasonLabel,
  type VoidCandidateRow,
  type VoidPlayerGroup,
  type VoidReason,
  type VoidRequestRow,
  type VoidRequestStatus,
  type VoidSearchRow,
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
  // Same purple as the Voided pill everywhere else in the app.
  void: 'bg-accent/20 text-accent',
  maybe: 'bg-warning/15 text-warning',
  neutral: 'bg-bg-card text-text-muted',
};

function OutcomePill({ status, flagged = false }: { status: string; flagged?: boolean }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[9px] font-semibold whitespace-nowrap ${TONE_CLASS[outcomeTone(status)]}`}>
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
      className={`w-7 h-7 shrink-0 rounded-full text-[10px] font-bold flex items-center justify-center ${color ? '' : 'bg-primary/15 text-primary'}`}
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
    <li className="flex items-center justify-between gap-2 py-1">
      <div className="min-w-0">
        <p className="text-[11px] font-medium truncate">{row.team_name ?? 'Team'}</p>
        <p className="text-[10px] text-text-muted truncate">
          {pickText(row)} · ${row.stake}
        </p>
      </div>
      <OutcomePill status={row.status} flagged={flagged} />
    </li>
  );
}

function StepLabel({ n, children }: { n: number; children: string }) {
  return (
    <p className="flex items-center gap-2 text-[11px] font-semibold text-text">
      <span className="w-4 h-4 rounded-full bg-primary/15 text-primary text-[10px] flex items-center justify-center">{n}</span>
      {children}
    </p>
  );
}

const REASONS: VoidReason[] = ['injury', 'ejection', 'other'];

const STATUS_PILL: Record<VoidRequestStatus, string> = {
  pending: 'bg-warning/15 text-warning',
  approved: 'bg-profit/15 text-profit',
  denied: 'bg-loss/15 text-loss',
};
const STATUS_LABEL: Record<VoidRequestStatus, string> = { pending: 'Waiting', approved: 'Approved', denied: 'Denied' };

function StatusPill({ status }: { status: VoidRequestStatus }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[9px] font-semibold whitespace-nowrap ${STATUS_PILL[status]}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function pickCountText(picks: number, teams: number): string {
  return `${picks} pick${picks === 1 ? '' : 's'} · ${teams} team${teams === 1 ? '' : 's'}`;
}

/** Void requests. Any member can ask for a player who left a game early to be voided (a reason and a
 * short note are required). The commissioner answers each request with a check or an X, and can also
 * flag a player directly, which skips the queue. Approving or flagging makes the same flag settle-week
 * already reads: it voids that player's Over / Anytime TD picks that did not hit (Unders and picks that
 * already hit are never touched) and posts a League Update with the reason. */
export function VoidRequestsCard({ leagueId, week, isCommissioner }: { leagueId: string; week: WeekId; isCommissioner: boolean }) {
  const weekStr = String(week);
  const statsByName = useAppStore((s) => s.realPlayerStatsByWeek[weekStr]);
  const loadStats = useAppStore((s) => s.loadRealPlayerStatsForWeek);

  const [rows, setRows] = useState<VoidCandidateRow[] | null>(null);
  const [requests, setRequests] = useState<VoidRequestRow[]>([]);
  const [searchRows, setSearchRows] = useState<VoidSearchRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sentMsg, setSentMsg] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [reason, setReason] = useState<VoidReason | null>(null);
  const [note, setNote] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busyFlag, setBusyFlag] = useState<string | null>(null);
  const [busyReq, setBusyReq] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    const [reqRes, extraRes] = await Promise.all([
      fetchVoidRequests(leagueId, weekStr),
      isCommissioner ? fetchVoidCandidates(leagueId, weekStr) : fetchVoidSearch(leagueId, weekStr),
    ]);
    if (reqRes.ok) setRequests(reqRes.rows);
    // Until migration 0032 is run the request calls fail; keep the commissioner flow usable on its own.
    if (isCommissioner) {
      const res = extraRes as Awaited<ReturnType<typeof fetchVoidCandidates>>;
      if (res.ok) {
        setRows(res.rows);
        setError(null);
      } else {
        setError(res.error);
      }
    } else {
      const res = extraRes as Awaited<ReturnType<typeof fetchVoidSearch>>;
      if (res.ok) {
        setSearchRows(res.rows);
        setError(reqRes.ok ? null : reqRes.error);
      } else {
        setError(res.error);
      }
    }
  }, [leagueId, weekStr, isCommissioner]);

  useEffect(() => {
    void load();
    if (isCommissioner && !statsByName) void loadStats(week);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // Commissioner: flagged players and the direct "flag a player" search.
  const groups = useMemo(() => groupVoidCandidates(rows ?? []), [rows]);
  const flagged = groups.filter((g) => g.flagId);
  const matches = useMemo(() => searchVoidPlayers(groups, query), [groups, query]);
  const selectedGroup: VoidPlayerGroup | undefined = isCommissioner && selected ? groups.find((g) => g.playerName === selected && !g.flagId) : undefined;
  const selectedStat = selectedGroup ? statsByName?.[selectedGroup.playerName.trim().toLowerCase()] : undefined;

  // Member: players eligible for a request.
  const memberMatches = useMemo(() => {
    const q = normName(query);
    if (q === '') return [];
    return searchRows.filter((r) => normName(r.player_name).includes(q)).slice(0, 8);
  }, [searchRows, query]);
  const selectedMember: VoidSearchRow | undefined = !isCommissioner && selected ? searchRows.find((r) => r.player_name === selected) : undefined;

  const noteOkCommish = reason !== 'other' || note.trim().length >= 3;
  const canSubmit = !!selectedGroup && reason != null && noteOkCommish;
  const canSend = !!selectedMember && reason != null && note.trim().length >= 3;

  const pending = requests.filter((r) => r.status === 'pending');
  const answered = requests.filter((r) => r.status !== 'pending').slice(0, 5);
  const myPending = pending.filter((r) => r.mine).length;

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

  async function answer(req: VoidRequestRow, approve: boolean) {
    setBusyReq(req.id);
    setSentMsg(null);
    const res = await resolveVoidRequest(req.id, approve);
    if (!res.ok) setError(res.error);
    else setError(null);
    await load();
    setBusyReq(null);
  }

  async function sendRequest() {
    if (!selectedMember || !reason) return;
    setSending(true);
    setError(null);
    const res = await requestVoid(leagueId, weekStr, selectedMember.player_name, reason, note);
    if (!res.ok) {
      setError(res.error);
    } else {
      setSentMsg('Request sent. Your commissioner will approve or deny it.');
      resetSelection();
      await load();
    }
    setSending(false);
  }

  const summary = isCommissioner
    ? pending.length > 0
      ? `${pending.length} request${pending.length > 1 ? 's' : ''} waiting for you`
      : flagged.length > 0
        ? `${flagged.length} player${flagged.length > 1 ? 's' : ''} voided this week`
        : 'Review requests to void picks'
    : myPending > 0
      ? `${myPending} request${myPending > 1 ? 's' : ''} waiting on your commissioner`
      : 'Ask to void a player who left early';

  return (
    <>
      <CollapsibleSection
        title="Void Requests"
        icon={<UserX size={16} />}
        help={isCommissioner ? ['commissioner', 'Void Requests'] : ['scoring', 'Void requests']}
        badge={isCommissioner && pending.length > 0 ? `${pending.length} pending` : undefined}
        summary={summary}
      >
        <p className="flex items-start gap-1.5 text-[11px] text-text-muted">
          <Check size={12} className="shrink-0 mt-px text-primary" />
          {isCommissioner
            ? 'Members can request a void. Check to void his unhit Overs and Anytime TDs, X to deny. Unders and hits are safe.'
            : 'Player left a game early? Request a void with a reason. Your commissioner decides. Only unhit Overs and Anytime TDs are voided.'}
        </p>
        {error && <p className="text-[11px] text-loss">{error}</p>}
        {sentMsg && <p className="text-[11px] text-profit">{sentMsg}</p>}

        {isCommissioner && pending.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Waiting for you</p>
            {pending.map((r) => (
              <div key={r.id} className="rounded-xl bg-bg-raised border-l-4 border-warning p-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar name={r.player_name} playerId={r.player_id} />
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold truncate">{r.player_name}</p>
                      <p className="text-[10px] text-text-muted truncate">
                        {r.team_name ?? 'A member'} · {pickCountText(r.pick_count, r.team_count)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      aria-label={`Deny void request for ${r.player_name}`}
                      disabled={busyReq === r.id}
                      onClick={() => void answer(r, false)}
                      className="w-8 h-8 rounded-lg bg-loss/15 text-loss flex items-center justify-center disabled:opacity-40"
                    >
                      <X size={16} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Approve void request for ${r.player_name}`}
                      disabled={busyReq === r.id}
                      onClick={() => void answer(r, true)}
                      className="w-8 h-8 rounded-lg bg-profit/15 text-profit flex items-center justify-center disabled:opacity-40"
                    >
                      <Check size={16} />
                    </button>
                  </div>
                </div>
                <p className="text-[11px]">
                  <span className="text-loss font-semibold">{voidReasonLabel(r.reason)}</span>
                  <span className="text-text-muted">{` · ${r.note}`}</span>
                </p>
                <a
                  href={`https://www.google.com/search?q=${encodeURIComponent(`${r.player_name} injury left game`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-primary"
                >
                  Search news <ExternalLink size={11} />
                </a>
              </div>
            ))}
          </div>
        )}

        {!isCommissioner && requests.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Your requests</p>
            <ul className="rounded-xl bg-bg-raised divide-y divide-border px-3">
              {requests.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
                  <div className="min-w-0">
                    <p className="text-[12px] font-medium truncate">{r.player_name}</p>
                    <p className="text-[10px] text-text-muted truncate">
                      {voidReasonLabel(r.reason)} · {r.note}
                    </p>
                  </div>
                  <StatusPill status={r.status} />
                </li>
              ))}
            </ul>
          </div>
        )}

        {isCommissioner && flagged.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Voided this week</p>
            {flagged.map((g) => (
              <div key={g.playerName} className="rounded-xl bg-bg-raised border-l-4 border-loss p-2.5 space-y-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar name={g.playerName} playerId={g.picks[0]?.player_id} />
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold truncate">{g.playerName}</p>
                      <p className="text-[10px] text-text-muted truncate">
                        <span className="text-loss font-semibold">{voidReasonLabel(g.flagReason)}</span>
                        {g.flagNote ? ` · ${g.flagNote}` : ''}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void removeFlag(g)}
                    disabled={busyFlag === g.flagId}
                    className="text-[11px] px-2 py-0.5 rounded-lg border border-border text-text-muted shrink-0 disabled:opacity-50"
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

        {isCommissioner && (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Void a player yourself</p>
            {!selectedGroup && (
              <>
                <CompactInput tone="raised" value={query} onChange={setQuery} placeholder="Search a player in your league" icon={<Search size={16} />} />
                {query.trim() !== '' && matches.length === 0 && (
                  <p className="text-[11px] text-text-muted">No match. Only started games with an Over or Anytime TD pick count.</p>
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
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-left active:bg-bg-card"
                        >
                          <Avatar name={g.playerName} playerId={g.picks[0]?.player_id} />
                          <span className="flex-1 min-w-0">
                            <span className="block text-[13px] font-medium truncate">{g.playerName}</span>
                            <span className="block text-[10px] text-text-muted">{pickCountText(g.picks.length, teams)}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {selectedGroup && (
              <div className="rounded-xl bg-bg-raised border border-border p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar name={selectedGroup.playerName} playerId={selectedGroup.picks[0]?.player_id} />
                    <p className="text-sm font-bold truncate">{selectedGroup.playerName}</p>
                  </div>
                  <button type="button" onClick={resetSelection} className="text-[11px] text-primary shrink-0">
                    Change
                  </button>
                </div>

                <div className="space-y-2">
                  <StepLabel n={1}>Check the facts</StepLabel>
                  <div className="rounded-lg bg-bg-card px-3 py-2 space-y-1">
                    <p className="text-[11px] text-text-muted">
                      {statSummary(selectedStat) ?? 'No stat line yet. If he never played, those picks void automatically.'}
                    </p>
                    <a
                      href={`https://www.google.com/search?q=${encodeURIComponent(`${selectedGroup.playerName} injury left game`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-primary"
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
                        className={`py-1.5 rounded-lg text-[11px] border ${chipClass(reason === r)}`}
                      >
                        {VOID_REASON_LABELS[r]}
                      </button>
                    ))}
                  </div>
                  {reason && (
                    <CompactInput
                      tone="card"
                      value={note}
                      onChange={(v) => setNote(v.slice(0, 200))}
                      placeholder={reason === 'other' ? 'Required: what happened?' : 'Optional note for the feed'}
                    />
                  )}
                </div>

                <button
                  type="button"
                  disabled={!canSubmit}
                  onClick={() => setConfirmOpen(true)}
                  className="w-full py-2 rounded-lg bg-loss text-white text-[13px] font-semibold disabled:opacity-40"
                >
                  Void his picks
                </button>
              </div>
            )}
          </div>
        )}

        {!isCommissioner && (
          <div className="space-y-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Request a void</p>
            {!selectedMember && (
              <>
                <CompactInput tone="raised" value={query} onChange={setQuery} placeholder="Search a player" icon={<Search size={16} />} />
                {query.trim() !== '' && memberMatches.length === 0 && (
                  <p className="text-[11px] text-text-muted">No match. Only players with an Over or Anytime TD pick in a game that has started can be requested.</p>
                )}
                {memberMatches.length > 0 && (
                  <div className="rounded-xl bg-bg-raised divide-y divide-border overflow-hidden">
                    {memberMatches.map((r) => {
                      const blocked = r.flag_id ? 'Already voided' : r.pending_request_id ? 'Request waiting' : r.denied ? 'Denied' : null;
                      return (
                        <button
                          key={r.player_name}
                          type="button"
                          disabled={blocked != null}
                          onClick={() => setSelected(r.player_name)}
                          className="w-full flex items-center gap-2.5 px-3 py-2 text-left active:bg-bg-card disabled:opacity-60"
                        >
                          <Avatar name={r.player_name} playerId={r.player_id} />
                          <span className="flex-1 min-w-0">
                            <span className="block text-[13px] font-medium truncate">{r.player_name}</span>
                            <span className="block text-[10px] text-text-muted">{blocked ?? pickCountText(r.pick_count, r.team_count)}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </>
            )}

            {selectedMember && (
              <div className="rounded-xl bg-bg-raised border border-border p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Avatar name={selectedMember.player_name} playerId={selectedMember.player_id} />
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate">{selectedMember.player_name}</p>
                      <p className="text-[10px] text-text-muted">{pickCountText(selectedMember.pick_count, selectedMember.team_count)}</p>
                    </div>
                  </div>
                  <button type="button" onClick={resetSelection} className="text-[11px] text-primary shrink-0">
                    Change
                  </button>
                </div>

                <div className="space-y-2">
                  <StepLabel n={1}>Why should it be voided?</StepLabel>
                  <div className="grid grid-cols-3 gap-1.5">
                    {REASONS.map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setReason(r)}
                        className={`py-1.5 rounded-lg text-[11px] border ${chipClass(reason === r)}`}
                      >
                        {VOID_REASON_LABELS[r]}
                      </button>
                    ))}
                  </div>
                  {reason && (
                    <CompactInput
                      tone="card"
                      value={note}
                      onChange={(v) => setNote(v.slice(0, 200))}
                      placeholder="Required: what happened?"
                    />
                  )}
                </div>

                <button
                  type="button"
                  disabled={!canSend || sending}
                  onClick={() => void sendRequest()}
                  className="w-full py-2 rounded-lg bg-primary text-white text-[13px] font-semibold disabled:opacity-40"
                >
                  {sending ? 'Sending…' : 'Send request'}
                </button>
              </div>
            )}
          </div>
        )}

        {isCommissioner && answered.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">Recently answered</p>
            <ul className="rounded-xl bg-bg-raised divide-y divide-border px-3">
              {answered.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
                  <div className="min-w-0">
                    <p className="text-[12px] font-medium truncate">{r.player_name}</p>
                    <p className="text-[10px] text-text-muted truncate">{r.team_name ?? 'A member'} · {voidReasonLabel(r.reason)}</p>
                  </div>
                  <StatusPill status={r.status} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </CollapsibleSection>

      {confirmOpen && selectedGroup && reason && (
        <ConfirmSheet
          title={`Void ${selectedGroup.playerName}'s picks?`}
          description={`${VOID_REASON_LABELS[reason]}. His Over and Anytime TD picks that had not hit are voided at $0 for everyone and posted to the feed. Remove flag undoes it.`}
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
