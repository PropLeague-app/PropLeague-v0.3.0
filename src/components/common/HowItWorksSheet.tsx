import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ClipboardList, ChartColumn, ListChecks, SlidersHorizontal } from 'lucide-react';
import type { LeagueSettings, Position } from '../../types';
import logoMark from '../../assets/logo-mono-muted.png';

/** The in-app help: four collapsible categories, each a short run of titled topics in small text.
 * Used as the onboarding route (settings = null, generic defaults) and as the overlay behind the
 * "?" button on Profile & Settings (settings = this league's, so real numbers are stated as fact).
 * Condensed from the full manual to what a player or commissioner actually needs. */

interface Topic {
  title: string;
  body: string[];
}

interface Category {
  id: string;
  icon: ReactNode;
  title: string;
  blurb: string;
  topics: Topic[];
}

const POSITION_LABELS: Record<Position | 'ML', string> = {
  QB: 'QB',
  RB: 'RB',
  WR: 'WR',
  TE: 'TE',
  K: 'K',
  ML: 'ML',
};

function slotBreakdown(settings: LeagueSettings): string {
  const order: (Position | 'ML')[] = ['QB', 'RB', 'WR', 'TE', 'K', 'ML'];
  return order
    .filter((pos) => settings.lineupSlots[pos] > 0)
    .map((pos) => `${settings.lineupSlots[pos]} ${POSITION_LABELS[pos]}`)
    .join(', ');
}

const money = (n: number) => `$${n.toFixed(2)}`;

function buildCategories(settings: LeagueSettings | null): Category[] {
  const credits = settings?.weeklyCredits ?? 100;
  const slotTotal = settings ? Object.values(settings.lineupSlots).reduce((a, b) => a + b, 0) : 8;
  const slots = settings ? slotBreakdown(settings) : '1 QB, 2 RB, 2 WR, 1 TE, 1 K, 1 ML';
  const minBet = settings?.minBetPerSlot ?? 1;
  const minGames = Math.max(2, settings?.minGamesPerRoster ?? 2);
  const playoffTeams = settings?.playoffTeams ?? 4;
  const generic = !settings;

  const lineup: Topic[] = [
    {
      title: 'What PropLeague is',
      body: [
        'Fantasy football built on real prop bets. Instead of drafting players, you build a weekly lineup of bets and play one opponent each week. The higher profit wins the matchup. PropLeague is free and played with virtual credits only. No real money can be deposited, withdrawn or cashed out.',
      ],
    },
    {
      title: 'Weekly credits',
      body: [
        `You get ${money(credits)} each week${generic ? ' by default (your commissioner can change it)' : ''} to spread across your slots. Nothing carries over. Spend all of it: credits you leave unspent count as a loss. Credits are virtual and have no cash value.`,
      ],
    },
    {
      title: 'Lineup slots',
      body: [
        `${slotTotal} slots${generic ? ' by default' : ''}: ${slots}. Each slot holds one bet. Player slots take a prop (yards, receptions, anytime TD and more). The ML slot is a pick on a game result.`,
      ],
    },
    {
      title: 'Stakes and games',
      body: [
        `Every pick needs at least ${money(minBet)}. Picks must come from at least ${minGames} different games. Your commissioner may also cap prop or moneyline stakes, and no single bet can use up the whole budget. The bet slip shows the limits.`,
      ],
    },
    {
      title: 'Locks',
      body: [
        'A slot locks when its game kicks off, and the server enforces it. Change picks freely until then. If Hide Picks is on, other teams cannot see your lineup until kickoff, and (unless your commissioner turns that off) your empty slots read Hidden too until the last game of the week starts.',
      ],
    },
    {
      title: 'Duplicate and correlated picks',
      body: [
        'A commissioner can limit how many teams may hold the same prop, and can block related props from sharing a roster (for example a QB over and his WR over). The Lineup screen flags a rule break before you submit.',
      ],
    },
    {
      title: 'Blocked and limited markets',
      body: [
        'A commissioner can block a market (or just its Over or Under side), or cap how much one pick on it can stake. Blocked markets cannot be picked and a capped market shows its max on the bet slip. Bots skip blocked markets but ignore caps.',
      ],
    },
    {
      title: 'Penalties',
      body: [
        settings?.emptySlotFloor != null
          ? `An incomplete lineup loses its unspent credits, and each empty slot costs at least ${money(settings.emptySlotFloor)} (never more than your credits split across the slots).`
          : 'An incomplete lineup loses its unspent credits. A commissioner can also set a minimum loss per empty slot.',
        settings?.invalidRosterPenaltyEnabled
          ? `A pick that breaks a roster rule is voided and its whole stake is lost, even if it wins${settings.invalidRosterFee > 0 ? `, plus a ${money(settings.invalidRosterFee)} fee` : ''}.`
          : 'If the invalid roster penalty is on, a pick that breaks a roster rule is voided and its stake is lost, plus an optional flat fee.',
        'The Lineup screen previews what your lineup would cost if it locked as is. Penalties only apply to weeks played after they are turned on.',
      ],
    },
  ];

  const scoring: Topic[] = [
    {
      title: 'Weekly score',
      body: ['Your score is the total profit or loss of every pick, plus any penalties. Higher score wins the matchup, and matchups drive the win-loss standings.'],
    },
    {
      title: 'Results',
      body: [
        'Win and loss are what you expect. A push returns the stake with no effect. A void takes the pick out of play with no profit or loss, and its stake does not come back to your spendable credits.',
        'A pick is voided when its player has no stats (inactive or did not play) once the game has been final for 3 hours. A commissioner can also flag an early exit (injury or ejection), which voids that player\'s Over and Anytime TD picks that did not hit.',
      ],
    },
    {
      title: 'Void requests',
      body: [
        'If a player left a game early, open Settings, then Void Requests, find him, choose a reason and add a note. Your commissioner approves or denies it, and you get a notification either way. Only Over and Anytime TD picks that did not hit are voided, for everyone.',
        'You can have 3 requests waiting at once, and a player the commissioner denied cannot be requested again that week.',
      ],
    },
    {
      title: 'Settlement',
      body: ['Picks are graded automatically from real stats. A week closes Tuesday morning Eastern, after Monday night, and then scores, matchups, standings and playoffs update on their own.'],
    },
    {
      title: 'Perfect weeks',
      body: [
        'A week with no lost bet: every slot filled, all credits placed, enough different games, and at least one win. Pushes and voids are fine, and a roster hit by the invalid roster penalty never counts. Perfect weeks get a gold treatment with flames, and the league feed announces them (the commissioner can turn that off).',
      ],
    },
    {
      title: 'Standings',
      body: ['Ranked by win percentage. Ties break by total profit, then bet record, then head-to-head, then best single week.'],
    },
    {
      title: 'Playoffs',
      body: [
        `The top ${playoffTeams} teams${generic ? ' by default' : ''} make the playoffs, seeded by standings, timed so the final lands around Conference Championship week. Format can be single or double elimination, and commissioners can split the league into two conferences.`,
      ],
    },
  ];

  if (!settings || settings.buyInEnabled) {
    const body = [
      'If buy-ins are on, every team adds a virtual buy-in to a shared prize pool. Each week the pool moves by the league\'s combined virtual profit or loss on bets that were actually placed, scaled by how much of your weekly budget you used. Penalties for unspent credits or an empty lineup hurt a team\'s score and standings, but no bet was placed, so they never move the pool. It locks at the end of the regular season and is split among the top finishers. The prize pool is always virtual: no real money is ever deposited, held or paid out, and nothing can be cashed out.',
    ];
    if (settings?.poolMultipliers.enabled) {
      body.push('Standing multipliers are on here: a team ranked higher moves the pool a bit more and a lower one a bit less. Total exposure never changes, only whose picks count more.');
    }
    scoring.push({ title: 'Prize pool', body });
  }

  const stats: Topic[] = [
    {
      title: 'Bets',
      body: [
        'Every pick as a compact ticket: player, market, line, odds, stake, result. Filter by week, open or settled, result, position and market, search by player, and sort by newest, biggest win or loss, stake or odds. Other teams\' picks stay hidden until kickoff when Hide Picks is on.',
      ],
    },
    {
      title: 'Sharing',
      body: [
        'Tap the share icon at the top of Bets, My Stats or any Matchup (current or past), or the small one on a leaderboard, to make a picture to send. It is a clean card built from the numbers on screen, not a screenshot. It follows your theme (light or dark, and scaled P/L colors), and a perfect week gets its flames behind the team logo. Bets shares whatever your filters show: a few picks fill a standard 4:5 picture, and a long list makes it taller, like a long parlay slip (up to 30 picks, then "+N more"). Tap the small icon on one ticket to share just that bet. My Stats shares the tab you are on (Overview, Markets, Trends or Matchups). Picks that are hidden until kickoff stay hidden in the picture.',
      ],
    },
    {
      title: 'My Stats',
      body: [
        'Pick any team, or the whole league, at the top. Overview has ROI, P/L, record and breakdowns by position, odds range and stake size. Markets splits results by prop type. Trends shows weekly P/L and your best and worst players. Matchups (single team) shows your head-to-head history.',
        'Tap most rows to open the bets behind them. Pushes and voids stay in those lists so every pick the lineup held is counted.',
      ],
    },
    {
      title: 'Hit rate vs. the odds',
      body: ['Your actual win rate against the win rate the odds implied. Above the line means your picks are beating the odds. Wins and losses only. Break-even rate is what you need to hit given your average win and average loss.'],
    },
    {
      title: 'Leaderboards',
      body: [
        'Four tabs. Overall: ROI, total profit, best week, bets won, perfect weeks. Skills: beating the odds, win streaks, biggest win, position and market specialists. This week: the scoreboard with a week picker. Players: most picked, most and least profitable.',
        'Ties share a rank, the top three get gold, silver and bronze, and tapping a row opens that team\'s stats.',
      ],
    },
    {
      title: 'Colors',
      body: ['Green is profit and red is loss. Each person can switch Loss colors to Scaled in Profile & Team, which tints a loss from yellow to red against the worst loss in view. Odds format and theme are personal too and never change for anyone else.'],
    },
  ];

  const commissioner: Topic[] = [
    {
      title: 'Who can change what',
      body: ['Only the commissioner edits league settings. Everyone else sees the same screen read-only, with a banner naming the commissioner.'],
    },
    {
      title: 'Changing settings mid-week',
      body: [
        'Rules that change how a week is played lock once any pick exists for the current week: lineup slots, weekly credits, bet limits, pick visibility, duplicate, correlation, market and minimum-game rules, buy-in, multipliers and penalties.',
        'You can still edit them. The change is saved as scheduled, shows an "Applies Week N" pill, and takes effect after Tuesday\'s settlement. You can discard scheduled changes in one tap.',
        'Everything else applies immediately: league name and visibility, Weekly Moments, perfect week announcements, alt lines, line movement, playoff format, payout splits and conference names.',
      ],
    },
    {
      title: 'Settings groups',
      body: [
        'League Basics: name, logo, visibility, members and invite code.',
        'Roster & Picks: slots, minimum games, duplicate, correlation and market rules, pick visibility.',
        'Penalties: empty slot minimum loss, invalid roster rule and fee.',
        'Betting & Buy-In: stake limits, buy-in, payout split, standing multipliers.',
        'Lines & Markets: alt lines and live line movement.',
        'Playoffs & Conferences: field size, elimination type, conferences.',
        'Weekly Moments: weekly awards, custom names, perfect week announcement.',
      ],
    },
    {
      title: 'Void Requests',
      body: [
        'Any member can request a void from Settings, then Void Requests: find the player, pick a reason and add a short note. You get a push and a pending badge. Check to approve, X to deny. Approving voids every Over and Anytime TD pick on him that did not hit on the next settlement. Unders, moneylines and spreads are never touched.',
        'Your own requests skip the queue. Un-flagging restores the picks, and approving or flagging posts a short League Update.',
      ],
    },
  ];

  return [
    { id: 'lineup', icon: <ClipboardList size={16} />, title: 'Basics & Lineup', blurb: 'Credits, slots, locks, penalties', topics: lineup },
    { id: 'scoring', icon: <ListChecks size={16} />, title: 'Scoring, Matchups & Playoffs', blurb: 'Results, voids, perfect weeks, standings', topics: scoring },
    { id: 'stats', icon: <ChartColumn size={16} />, title: 'Bets, Stats & Leaderboards', blurb: 'Reading your numbers', topics: stats },
    { id: 'commissioner', icon: <SlidersHorizontal size={16} />, title: 'Settings Guide', blurb: 'For commissioners', topics: commissioner },
  ];
}

/** Full-screen help. Rendered through a portal onto <body> so a position:fixed sheet is laid out
 * against the real viewport: WKWebView (the iOS runtime here) places fixed descendants of a scrolling
 * container relative to that container, which showed up as the sheet starting below the safe-area
 * strip with a sliver of the page peeking out above it. h-dvh plus min-h-0 keep the scroll inside the
 * panel rather than the document. */
export function HowItWorksSheet({
  settings,
  onClose,
  focus,
}: {
  settings: LeagueSettings | null;
  onClose: () => void;
  /** Open straight to one topic (used by the help icons on each settings group): category id + topic title. */
  focus?: { category: string; topic: string };
}) {
  const categories = buildCategories(settings);
  const [openId, setOpenId] = useState<string | null>(focus?.category ?? null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focus) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-topic="${focus.category}:${focus.topic}"]`);
    el?.scrollIntoView({ block: 'start' });
  }, [focus]);

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-bg flex justify-center">
      <div className="w-full max-w-md h-dvh flex flex-col border-x border-border">
        <div
          className="flex justify-between items-center px-4 py-2.5 sticky top-0 bg-bg-raised z-10 border-b border-border"
          style={{ paddingTop: 'calc(0.5rem + env(safe-area-inset-top))' }}
        >
          <h1 className="text-sm font-bold flex items-center gap-1.5">
            <img src={logoMark} alt="" className="w-4 h-4 object-contain" />
            How PropLeague Works
          </h1>
          <button onClick={onClose} className="text-text-muted text-sm">
            Close
          </button>
        </div>
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-2"
          
        >
          {categories.map((cat) => {
            const open = openId === cat.id;
            return (
              <div key={cat.id} className="bg-bg-card border border-border rounded-xl overflow-hidden">
                <button
                  onClick={() => setOpenId(open ? null : cat.id)}
                  aria-expanded={open}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
                >
                  <span className="text-primary shrink-0">{cat.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{cat.title}</span>
                    {!open && <span className="block text-[11px] text-text-muted truncate">{cat.blurb}</span>}
                  </span>
                  <ChevronDown size={16} className={`text-text-muted shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
                </button>
                {open && (
                  <div className="px-3 pb-3 pt-2.5 space-y-3 border-t border-border">
                    {cat.topics.map((topic) => (
                      <div
                        key={topic.title}
                        data-topic={`${cat.id}:${topic.title}`}
                        className={focus?.category === cat.id && focus.topic === topic.title ? 'rounded-lg bg-primary/10 -mx-1.5 px-1.5 py-1' : undefined}
                      >
                        <h2 className="text-xs font-bold">{topic.title}</h2>
                        {topic.body.map((paragraph, i) => (
                          <p key={i} className="text-[12px] leading-snug text-text-muted mt-1">
                            {paragraph}
                          </p>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="px-4 py-3 border-t border-border" style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}>
          <button onClick={onClose} className="w-full bg-primary text-white text-sm font-semibold py-2.5 rounded-xl">
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
