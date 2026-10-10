// Push text for the two alerts settle-week sends (1.2.10):
//   Settled-bet alerts : one push per team per settle-week run, covering the picks that settled in
//                        that run, with where the matchup stands now.
//   Week results       : one push per team when its week is final.
// Pure functions so they can be tested from vitest (src/engine/__tests__/server/settleAlerts.test.ts).
// A lock screen shows about four lines, so the text stays short: the title is the event, the
// subtitle (set by the caller) is the league, the body the details, most important first.

export interface SettledPick {
  market_key: string;
  side: string;
  point: number | null;
  player_name: string | null;
  status: string; // won | lost | push | voided
  settled_profit: number | null;
}

/** "+$59.63", "-$20.00", "$0.00" */
export function money(n: number): string {
  const v = Math.round(Math.abs(n) * 100) / 100;
  if (v === 0) return '$0.00';
  return `${n < 0 ? '-' : '+'}$${v.toFixed(2)}`;
}

const MARKET_SHORT: Record<string, string> = {
  player_pass_yds: 'pass yds',
  player_pass_tds: 'pass TDs',
  player_pass_interceptions: 'INTs',
  player_rush_yds: 'rush yds',
  player_rush_attempts: 'rush att',
  player_pass_rush_yds: 'pass+rush yds',
  player_reception_yds: 'rec yds',
  player_receptions: 'receptions',
  player_rush_reception_yds: 'rush+rec yds',
  player_kicking_points: 'kicking pts',
  player_field_goals: 'FGs made',
  player_pass_attempts: 'pass att',
  player_pass_completions: 'completions',
  player_rush_longest: 'longest rush',
  player_reception_longest: 'longest rec',
  player_pats: 'XPs made',
  totals: 'total pts',
};

const lastWord = (s: string) => s.trim().split(/\s+/).pop() ?? s;

/** "Strange O16.5 longest rec", "Kelce anytime TD", "Bucs -3.5" style, "Eagles ML", "Over 44.5 total pts". */
export function shortPick(p: SettledPick): string {
  const key = p.market_key;
  const point = p.point != null ? `${key === 'spreads' && p.point > 0 ? '+' : ''}${p.point}` : '';
  if (key === 'h2h') return `${lastWord(p.side)} ML`;
  if (key === 'spreads') return `${lastWord(p.side)} ${point}`.trim();
  if (key === 'totals') return `${p.side} ${point} total pts`.replace(/\s+/g, ' ').trim();
  const who = p.player_name ? lastWord(p.player_name) : '';
  if (key === 'player_anytime_td') return `${who} anytime TD`.trim();
  const side = p.side === 'Over' ? 'O' : p.side === 'Under' ? 'U' : p.side;
  const label = MARKET_SHORT[key] ?? key.replace(/^player_/, '').replace(/_/g, ' ');
  return `${who} ${side}${point} ${label}`.replace(/\s+/g, ' ').trim();
}

const STATUS_WORD: Record<string, string> = { won: 'Won', lost: 'Lost', push: 'Push', voided: 'Voided' };

/** "Up $12.40 on FLK." / "Down $8.10 to FLK." / "Even with FLK." */
export function matchupLine(mine: number, theirs: number, oppName: string): string {
  const diff = Math.round((mine - theirs) * 100) / 100;
  if (diff === 0) return `Even with ${oppName}.`;
  return diff > 0 ? `Up $${diff.toFixed(2)} on ${oppName}.` : `Down $${Math.abs(diff).toFixed(2)} to ${oppName}.`;
}

/**
 * The settled-bet push. Up to three picks are listed one by one; more than that are summed up as
 * a record and net, so the body never runs off the lock screen.
 */
export function buildSettledAlert(picks: SettledPick[], matchup: { mine: number; theirs: number; oppName: string } | null): { title: string; body: string } {
  const won = picks.filter((p) => p.status === 'won').length;
  const lost = picks.filter((p) => p.status === 'lost').length;
  const even = picks.length - won - lost; // pushes and voids
  const net = picks.reduce((s, p) => s + (p.settled_profit ?? 0), 0);

  let title: string;
  if (picks.length === 1) {
    const s = picks[0].status;
    title = s === 'won' ? 'Bet won' : s === 'lost' ? 'Bet lost' : s === 'voided' ? 'Bet voided' : 'Bet pushed';
  } else {
    title = `${picks.length} bets settled`;
  }

  const parts: string[] = [];
  if (picks.length <= 3) {
    for (const p of picks) {
      const word = STATUS_WORD[p.status] ?? p.status;
      const pl = p.status === 'won' || p.status === 'lost' ? ` ${money(p.settled_profit ?? 0)}` : '';
      parts.push(`${word}: ${shortPick(p)}${pl}.`);
    }
  } else {
    const record = [`${won} won`, `${lost} lost`, ...(even > 0 ? [`${even} push or void`] : [])].join(', ');
    parts.push(`${record}. Net ${money(net)}.`);
  }
  if (matchup) parts.push(matchupLine(matchup.mine, matchup.theirs, matchup.oppName));
  return { title, body: parts.join(' ') };
}

const ORDINAL = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** The week-results push. `standing` is left out in the playoffs (the bracket is the story there). */
export function buildWeekResult(p: {
  weekLabel: string;
  mine: number;
  theirs: number;
  oppName: string;
  standing: { wins: number; losses: number; ties: number; rank: number; teamCount: number } | null;
  perfect?: boolean;
  skunked?: boolean;
}): { title: string; body: string } {
  const a = p.mine.toFixed(2);
  const b = p.theirs.toFixed(2);
  const diff = Math.round((p.mine - p.theirs) * 100) / 100;
  const verdict = diff === 0 ? `You tied ${p.oppName}` : diff > 0 ? `You beat ${p.oppName}` : `You lost to ${p.oppName}`;
  const parts = [`${verdict}, ${a} to ${b}.`];
  if (p.standing) {
    const { wins, losses, ties, rank, teamCount } = p.standing;
    parts.push(`Now ${wins}-${losses}${ties > 0 ? `-${ties}` : ''}, ${ORDINAL(rank)} of ${teamCount}.`);
  }
  if (p.perfect) parts.push('Perfect week!');
  else if (p.skunked) parts.push('Skunked this week.');
  return { title: `${p.weekLabel} final`, body: parts.join(' ') };
}
