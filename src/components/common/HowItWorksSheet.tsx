import type { LeagueSettings, Position } from '../../types';

interface ExplainerSection {
  icon: string;
  title: string;
  body: string[];
}

const POSITION_LABELS: Record<Position | 'ML', string> = {
  QB: 'quarterback',
  RB: 'running back',
  WR: 'wide receiver',
  TE: 'tight end',
  K: 'kicker',
  ML: 'moneyline/spread',
};

function slotBreakdown(settings: LeagueSettings): string {
  const order: (Position | 'ML')[] = ['QB', 'RB', 'WR', 'TE', 'K', 'ML'];
  return order
    .filter((pos) => settings.lineupSlots[pos] > 0)
    .map((pos) => `${settings.lineupSlots[pos]} ${POSITION_LABELS[pos]}${settings.lineupSlots[pos] > 1 ? 's' : ''}`)
    .join(', ');
}

/** League-agnostic by default ("$100 by default, set by your commissioner"); when a
 * league's settings are passed in, the actual configured numbers are substituted and
 * stated as fact rather than as defaults (manual v0.03 §3 #9, kept as-is per manual
 * v0.3.0 §3). Rewritten from a swipeable card deck into one continuous scrolling page
 * of plain sections (manual v0.3.0 §3) — skimmable, no card chrome. */
function buildSections(settings: LeagueSettings | null): ExplainerSection[] {
  const credits = settings?.weeklyCredits ?? 100;
  const slotTotal = settings ? Object.values(settings.lineupSlots).reduce((a, b) => a + b, 0) : 8;
  const playoffTeams = settings?.playoffTeams ?? 4;
  const byDefault = settings ? '' : ' by default';
  const commissionerNote = settings ? '' : ', set by your commissioner';
  const minBet = settings?.minBetPerSlot ?? 1;
  const slots = settings ? slotBreakdown(settings) : `1 ${POSITION_LABELS.QB}, 2 ${POSITION_LABELS.RB}s, 2 ${POSITION_LABELS.WR}s, 1 ${POSITION_LABELS.TE}, 1 ${POSITION_LABELS.K}, 1 ${POSITION_LABELS.ML}`;

  const sections: ExplainerSection[] = [
    {
      icon: '🏈',
      title: 'What PropLeague is',
      body: [
        'PropLeague is fantasy football meets sports betting: instead of drafting players, you build a weekly portfolio of real NFL player props and go head-to-head against another team in your league every week.',
      ],
    },
    {
      icon: '💳',
      title: 'Your weekly credits',
      body: [
        `Every week you get a budget of betting credits to allocate across your lineup — $${credits}${byDefault}${commissionerNote}. Unused credits count against you, so the goal is to allocate the full budget every week.`,
      ],
    },
    {
      icon: '🎯',
      title: 'Building a lineup',
      body: [
        `Your lineup has ${slotTotal} slots${byDefault}: ${slots}. Each slot is filled with a real prop bet — passing yards, receptions, anytime TD, and more — at real sportsbook-style odds, except the moneyline/spread slot, which is a pick on an actual game outcome.`,
        `Every pick needs at least $${minBet.toFixed(2)} staked, and picks must come from at least two different games — no putting your whole budget on one matchup.`,
      ],
    },
    {
      icon: '📊',
      title: 'How scoring works',
      body: [
        'Once games kick off, your picks settle to a win, loss, or push based on the real result. Your weekly score is the total profit or loss across your whole lineup — win more than you lose, and you post a positive score for the week.',
        'Leaving credits unallocated or slots empty counts as a loss on that amount, so an incomplete lineup still costs you.',
      ],
    },
    {
      icon: '⚔️',
      title: 'Head-to-head & standings',
      body: [
        "Your team's weekly score goes up against one opponent's — whoever profits more wins the matchup, same as a regular fantasy week. Standings rank by record first, then season-long profit/loss, then a few tiebreakers if it's still close.",
      ],
    },
    {
      icon: '🏆',
      title: 'Playoffs',
      body: [
        `The top ${playoffTeams} teams make the playoffs${byDefault}, seeded by regular-season standings and aligned with the real NFL postseason schedule so your championship lands on Conference Championship week.`,
      ],
    },
  ];

  // (conditional) manual v0.3.0 §3: shown generically outside a league (nothing to
  // hide yet) or inside a league that actually has it on — omitted for a league that
  // has explicitly turned buy-ins off, since it wouldn't apply to that league at all.
  if (!settings || settings.buyInEnabled) {
    const body = [
      'If your commissioner turns on buy-ins, every team chips in to a shared prize pool. Each week, the pool moves by the league\'s combined real-dollar profit or loss — your stake converts to a small real-dollar share proportional to how much of your weekly budget it used.',
      'The pool locks at the end of the regular season and pays out to the top finishers once a champion is crowned. It\'s always virtual — no real money ever changes hands.',
    ];
    // manual v0.3.0 §8: a genuinely new mechanic, not just a setting, so it gets its
    // own paragraph here — only when this league actually has it on, since it's a
    // real behavior change to explain, not a hypothetical feature to advertise.
    if (settings?.poolMultipliers.enabled) {
      body.push(
        "This league also scales how much each team's wagers move the pool, based on standing — a team ranked higher moves the pool a bit more, one ranked lower a bit less. One team's boost always comes out of the others' shares, so the pool's total exposure is never changed by this, just whose picks move it more.",
      );
    }
    sections.push({ icon: '💰', title: 'Buy-in & prize pool', body });
  }

  return sections;
}

/** Full-screen "how does this work" explainer — used both as the onboarding route
 * (league = null, generic defaults) and as an in-league overlay from Settings' help
 * bubble (league-aware, shows this league's real configured numbers). One continuous
 * scrolling page (manual v0.3.0 §3) rather than a swipeable card deck. */
export function HowItWorksSheet({ settings, onClose }: { settings: LeagueSettings | null; onClose: () => void }) {
  const sections = buildSections(settings);
  return (
    <div className="fixed inset-0 z-[60] bg-bg flex justify-center">
      <div className="w-full max-w-md min-h-screen flex flex-col border-x border-border">
        <div
          className="flex justify-between items-center p-4 sticky top-0 bg-bg z-10 border-b border-border"
          style={{ paddingTop: 'calc(1rem + env(safe-area-inset-top))' }}
        >
          <h1 className="text-lg font-bold">How PropLeague Works</h1>
          <button onClick={onClose} className="text-text-muted text-sm">
            Close
          </button>
        </div>
        <div
          className="flex-1 overflow-y-auto px-4 py-5 space-y-6"
          style={{ paddingBottom: 'calc(1.25rem + env(safe-area-inset-bottom))' }}
        >
          {sections.map((section) => (
            <div key={section.title}>
              <h2 className="text-base font-bold flex items-center gap-2 mb-1.5">
                <span>{section.icon}</span>
                {section.title}
              </h2>
              {section.body.map((paragraph, i) => (
                <p key={i} className="text-text-muted text-sm leading-relaxed mt-1.5 first:mt-0">
                  {paragraph}
                </p>
              ))}
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-border">
          <button onClick={onClose} className="w-full bg-primary text-white font-semibold py-3 rounded-xl">
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
