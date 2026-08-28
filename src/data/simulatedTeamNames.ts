export const FUNNY_TEAM_NAMES = [
  'The Prop Daddies',
  'Fourth & Long Shots',
  'Interception Nation',
  'The Juice Boxers',
  'Cover Your Aces',
  'Under the Lights',
  'The Bad Beat Boys',
  'Parlay Voyage',
  'The Line Movers',
  'Sunday Scaries',
  'The Vig Vikings',
  'Chalk It Up',
  'The Hedge Fund',
  'Moneyline Mafia',
  'The Overtime Oddities',
  'Push Comes to Shove',
  'The Bankroll Bandits',
  'Sweat Equity FC',
  'The Backdoor Cover',
  'Prime Time Props',
  'The Longshot Legends',
  'Handle With Care',
  'The Same Game Parlay',
  'Cashing Out Crew',
  'The Steam Chasers',
  'Redzone Royalty',
  'The Book Busters',
  'Garbage Time Gang',
  'The Public Fade',
  'Sharps & Squares',
] as const;

export const FUNNY_OWNER_NAMES = [
  'Riley P.',
  'Jordan T.',
  'Casey M.',
  'Morgan B.',
  'Avery K.',
  'Drew S.',
  'Cameron L.',
  'Jamie R.',
  'Reese D.',
  'Quinn W.',
  'Skyler H.',
  'Peyton C.',
  'Rowan F.',
  'Emerson G.',
  'Blake N.',
  'Sawyer J.',
  'Dakota V.',
  'Finley A.',
  'Harper Y.',
  'Marlowe Z.',
  'Kendall O.',
  'Remy I.',
  'Tatum U.',
  'Wren E.',
  'Sage X.',
  'Briar Q.',
  'Ellis K.',
  'Nova P.',
  'Indigo R.',
] as const;

// Expanded 24+ color palette (manual v0.1.1 §2 #1).
export const TEAM_LOGO_COLORS = [
  '#4C8DF5', '#9D4EED', '#F55C5C', '#3DDC84', '#F5A45C',
  '#4CE0D6', '#E85C97', '#7C93FF', '#FFC24C', '#5CD6A6',
  '#EF4444', '#F97316', '#EAB308', '#84CC16', '#22C55E',
  '#10B981', '#14B8A6', '#06B6D4', '#0EA5E9', '#3B82F6',
  '#6366F1', '#8B5CF6', '#A855F7', '#D946EF', '#EC4899',
  '#F43F5E', '#78716C', '#64748B',
] as const;

export function abbrevFromName(name: string): string {
  const words = name.replace(/^The\s+/i, '').split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}
