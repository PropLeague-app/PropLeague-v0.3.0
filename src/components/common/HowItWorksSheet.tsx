import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ClipboardList, ChartColumn, ListChecks, SlidersHorizontal } from 'lucide-react';
import type { LeagueSettings, Position } from '../../types';
import logoMark from '../../assets/logo-mono-muted.png';
import { SOFT_PRIMARY_BTN } from './buttonStyles';

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
      title: 'Your leagues',
      body: [
        'Tap the league name at the top of Home to open Your Leagues and jump between them. Each row shows the week and team count, a CURRENT tag on the one you are in, and a red Lineup needed tag when that league\'s lineup is not finished.',
        'The star makes a league your favorite, which goes first on your lock screen and Dynamic Island. The bell mutes a league: no pushes of any kind and no live scores for it until you unmute it. The league still works normally in the app, and a muted league is marked Muted. A league is never both, so muting your favorite clears the star. Close the list with the X.',
        'The sliders open League notifications for that league alone: mute, Lineup reminders, Settled-bet alerts, Week results and Live scores on lock screen, plus Void requests if you are its commissioner. Every league starts out following your Notifications switches in Profile & Settings. Change a switch here and it applies to this league only, marked Only this league, and the row in Your Leagues shows Custom alerts. Use these for all my leagues makes this league\'s choices your defaults and puts every league back on them. Void requests are always set per league and stay as they are.',
      ],
    },
    {
      title: 'Red ! badges',
      body: [
        'A red ! on the Lineup tab means this week\'s lineup is not finished yet. If you are a commissioner, a red ! on the Profile tab means void requests are waiting for you. Both clear on their own once the work is done.',
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
        `Every pick needs at least ${money(minBet)}. Picks must come from at least ${minGames} different games. Your commissioner may also cap prop or moneyline stakes, cap a market per pick, or limit how many slots can use a market, and no single bet can use up the whole budget. The bet slip shows the limits. To change a stake after the pick is in, tap the stake on the Lineup screen. A keypad opens (PropLeague has its own, so the phone keyboard never covers the screen) with the same rules as the bet slip: up to two decimals, and Max fills in the most the rules allow. Each key is a single tap (holding a key does not repeat), and any message about the stake shows just above the keypad so the keys never shift while you type. The budget bar at the top turns from orange to yellow to green as more of your credits are in play.`,
      ],
    },
    {
      title: 'Swapping a pick',
      body: [
        'Tap ⇄ on a filled slot to look at other picks for that slot without losing yours. Your pick stays pinned at the top, and its box in the list carries a small tag with the odds you hold: green when the board now pays more than your odds, red when it pays less. Back leaves everything as it was.',
        'Choose a new pick and the bet slip shows what it replaces, struck through, with your old stake already filled in (the first key you press starts a new amount). Replace Pick swaps them in one step: if the new pick is refused for any reason, you keep the old one and its odds.',
        'The same pick at better odds can be re-locked: only the old odds are crossed out, with a note saying whether the new price is better or worse. At a new line, the old line and odds are crossed out. The exact pick you already hold at the same odds cannot be swapped in, so change its stake on the Lineup screen instead.',
        'When the position has more than one place to go, the bet slip shows a choice at the top: ⇄ and a name replaces that pick, + Open slot adds the new pick alongside the ones you have. It starts on the slot you came from. A pick from Game Details works the same way. Once a pick\'s game starts it is locked: no ⇄, it is left out of the choice, and the server refuses a swap.',
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
        'A commissioner can block a market (or just its Over or Under side) or put a limit on it. A limit can cap how much one pick on it can stake, how many of your lineup slots can use it (for example 2 of your 5 receiving slots), or both. Blocked markets cannot be picked. A stake cap shows its max on the bet slip and keypad, and a slot cap stops another pick on that market once the allowed slots are taken, with a message saying why. Slot caps only count the slots that could hold that market, so a cap equal to all of them would limit nothing and is not offered. Moneyline, spread and total cannot be ruled on. AI teams follow every rule: they skip blocked markets, stay inside slot caps and keep each stake at or under its cap.',
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
    {
      title: 'NFL Slate and lines',
      body: [
        'The NFL Slate tab lists the week\'s games and every market on them, with lines from The Odds API. Tap Refresh Odds to pull the latest, and a warning shows when the lines are more than 12 hours old. Your commissioner can turn alt lines and live line movement on or off.',
        'Tap a game to see its lines and player props, and tap any line to pick it from there. It goes in an open slot for that position if you have one. If not, the bet slip offers to swap it for one of your picks there, with a note such as Replacing your QB pick at the top (see Swapping a pick). Picks you already hold from that game carry the same odds tag, and any problem shows as a one-line note just under the header, wherever you are scrolled.',
      ],
    },
  ];

  const scoring: Topic[] = [
    {
      title: 'Weekly score',
      body: ['Your score is the total profit or loss of every pick, plus any penalties. Higher score wins the matchup, and matchups drive the win-loss standings. Win probability on a matchup is an estimate built from the odds on each side\'s picks and the results so far.'],
    },
    {
      title: 'Matchup screen: Simple and Advanced',
      body: [
        'Simple shows each pick as a compact cell. Advanced adds the stake and the stat line behind a result. Tap the Advanced button at the top to switch every pick at once, and your choice is remembered on this device.',
        'To look closer at just one pick, tap it: that cell opens to the Advanced view, and tapping it again closes it. This works on either team\'s visible picks, in either mode. Empty and hidden picks do not respond. Opened cells reset when you leave the screen, swipe to another matchup, or press the Advanced button.',
      ],
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
      title: 'Perfect and skunked weeks',
      body: [
        'A perfect week has no lost bet: every slot filled, all credits placed, enough different games, and at least one win. Pushes and voids are fine, and a roster hit by the invalid roster penalty never counts. Perfect weeks get a gold treatment with flames, and the league feed announces them (the commissioner can turn that off).',
        'A skunked week is the opposite: every slot filled, nothing still pending, at least three losses and no wins or pushes. Voids are ignored. Skunked weeks get a muted olive treatment with stink lines and flies on the matchup, schedule and share picture. The league feed only announces them if the commissioner turns that on, and it is off by default.',
      ],
    },
    {
      title: 'Weekly Moments',
      body: [
        'Eight awards post to the league feed after each week: King of the Slip (best week), Bagel Watch (worst week), Heartbreaker (bet lost by the smallest margin), Against All Odds (longest-odds win), Cash Cow (most profit from one bet), The Hot Hand (longest matchup win streak), The Ice Box (longest matchup loss streak) and The Roller Coaster (biggest swing from last week). Your commissioner can rename or turn off any of them.',
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
        'Fields can be 2, 4, 6, 8 or 16 teams, never more than the league has. Double elimination is available for 2, 4 and 8. A 6-team field gives the top two seeds a bye. Bigger fields and double elimination start earlier, in Weeks 17 and 18, and the bracket locks once the playoffs begin.',
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
        'Tap the share icon at the top of Bets, My Stats or any Matchup (current or past), or the small one on a leaderboard, to make a picture to send. It is a clean card built from the numbers on screen, not a screenshot. It follows your theme (light or dark, and scaled P/L colors), and a perfect week gets its flames behind the team logo (a skunked week gets stink lines and flies instead). Bets shares whatever your filters show: a few picks fill a standard 4:5 picture, and a long list makes it taller, like a long parlay slip (up to 30 picks, then "+N more"). Tap the small icon on one ticket to share just that bet. My Stats shares the tab you are on (Overview, Markets, Trends or Matchups). Picks that are hidden until kickoff stay hidden in the picture.',
      ],
    },
    {
      title: 'My Stats',
      body: [
        'Pick any team, or the whole league, at the top. Overview has ROI, P/L, record and breakdowns by position, odds range and stake size, plus by kickoff window (Wed, TNF, Sat, Sun Early, Sun Late, SNF, MNF; a window shows once you have picks in it). Odds ranges are shown in your odds format (American or decimal). Markets splits results by prop type. Trends shows weekly P/L and your best and worst players. Matchups (single team) shows your head-to-head history.',
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
      title: 'Activity feed and chat',
      body: [
        'League Home has an activity feed and a chat tab with an unread badge. The commissioner posts announcements in rich text and can pin up to 3. Anyone can react to a post with an emoji. Tap one of the four quick reactions, or the + for a full picker with a search box and every emoji category. Each team gets one reaction per post, so picking a different one moves yours instead of adding a second (tap your own again to remove it). Reactions show as chips with the logos of the teams that picked them, extra ones collapse into a stack, and tapping a chip or the stack shows who reacted. Weekly Moments and perfect or skunked weeks show up here as cards.',
      ],
    },
    {
      title: 'Notifications',
      body: [
        'The switches in Profile & Settings are your defaults for every league. Lineup reminders can fire when your lineup needs work, when you are trailing, or on every slate. Void request alerts reach the commissioner when a request comes in, and the member when it is answered.',
        'Settled-bet alerts tell you when your picks settle, usually within about 15 minutes of a game ending. Picks that settle together come in one push: up to three are listed with their result and profit, more than that as a record and net. Each one ends with where your matchup stands, as the gap only, so hidden picks stay hidden.',
        'Week results arrives when the week is final (Tuesday morning after Monday night): who won and the score, your record and place in the standings (regular season), and a note for a perfect or skunked week.',
        'Tap any push to go straight to that league: reminders open your Lineup, settled bets and week results open your Matchup, and void requests open Void Requests in Settings.',
        'Live scores on lock screen turns on the Live Activity for your matchup. More on that in the next topic.',
        'To favorite, mute or change alerts for a single league, see Your leagues under Basics & Lineup.',
      ],
    },
    {
      title: 'Lock screen and Dynamic Island',
      body: [
        'About 90 minutes before a slate kicks off, a lineup card appears with a ring counting down to kickoff, how many picks are in, and what is still missing. Once games start, it becomes your matchup: both scores, each side\'s record and how many picks are still live, and a bar showing your estimated chance to win. The bar is hidden while picks are hidden before game start, and it is an estimate, so it can trail the app a bit mid-game.',
        'On iOS 17 and later, the card also has a lineup scroller. Tap the arrows to step through your slots and see the position, player, line, stake and status of each. Scores use your Loss colors setting, so Scaled shows up here too.',
        'In the Dynamic Island, press and hold to expand. If you are in more than one league at the same time, the island shows one matchup at a time. Your favorite league goes first and wears a small gold star by its logo, and with no favorite the most urgent one goes first. Tap the league name pill to bring in the next league\'s matchup. It stays until the next slate, when your favorite takes the front again. Turn all of this off with Live scores on lock screen in Profile & Settings. Needs iOS 16.2 or later.',
      ],
    },
    {
      title: 'Taps and feedback',
      body: ['On iPhone, small haptic taps confirm the moments that matter: choosing a chip or a reaction, adding a pick to your roster, and a refused action. They only happen in the app on the phone.'],
    },
    {
      title: 'Colors and themes',
      body: ['Green is profit and red is loss. Each person can switch Loss colors to Scaled in Profile & Team, which tints a loss from yellow to red against the worst loss in view. Theme (Auto, Light, Dark or Midnight) and odds format are personal too and never change for anyone else.'],
    },
  ];

  const commissioner: Topic[] = [
    {
      title: 'Who can change what',
      body: ['League settings live on their own page: open Profile, then League Settings. Only the commissioner edits them. Everyone else sees the same page read-only, with a banner naming the commissioner.'],
    },
    {
      title: 'Changing settings mid-week',
      body: [
        'Rules that change how a week is played lock once any pick exists for the current week: lineup slots, weekly credits, bet limits, pick visibility, duplicate, correlation, market and minimum-game rules, buy-in, multipliers and penalties.',
        'You can still edit them. The change is saved as scheduled, shows an "Applies Week N" pill, and takes effect after Tuesday\'s settlement. You can discard scheduled changes in one tap.',
        'Everything else applies immediately: league name and visibility, Weekly Moments, perfect and skunked week announcements, alt lines, line movement, playoff format, payout splits and conference names.',
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
        'Weekly Moments: weekly awards, custom names, perfect and skunked week announcements.',
      ],
    },
    {
      title: 'AI teams',
      body: [
        'Empty spots can be filled with simulated teams, shown as AI teams. They follow the same market rules as everyone else: they skip blocked markets, stay inside slot caps and keep each stake at or under its cap. By default they count toward the prize pool like any other team, and the commissioner can change that when buy-ins are on.',
      ],
    },
    {
      title: 'Void Requests',
      body: [
        'Any member can request a void from Settings, then Void Requests: find the player, pick a reason and add a short note. The commissioner gets a push (unless Void requests is turned off in that league\'s League notifications), a red Review button, and a red ! on the Profile tab until every request is answered. Check to approve, X to deny. Approving voids every Over and Anytime TD pick on him that did not hit on the next settlement. Unders, moneylines and spreads are never touched.',
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
          <button onClick={onClose} className={`w-full text-sm py-2.5 rounded-xl ${SOFT_PRIMARY_BTN}`}>
            Got it
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
