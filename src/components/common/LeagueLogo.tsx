import type { League } from '../../types';
import { IdentityBadge, type LogoSize } from './TeamLogo';

export function initialsFromLeagueName(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

/** League-level identity (manual v0.03 §3 #7, gained the emoji mode manual v0.1.1 §2
 * #3) — same three-mode rendering as a team's TeamLogo, via the shared IdentityBadge. */
export function LeagueLogo({ league, size = 'md' }: { league: Pick<League, 'name' | 'logoMode' | 'logoEmoji' | 'logoDataUrl' | 'logoColor'>; size?: LogoSize }) {
  return <IdentityBadge identity={league} initials={initialsFromLeagueName(league.name)} size={size} />;
}
