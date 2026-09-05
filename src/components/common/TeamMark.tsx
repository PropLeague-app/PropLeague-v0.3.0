import type { NFLTeam } from '../../types';

const SIZES = {
  xs: 'w-4 h-4 text-[8px]',
  sm: 'w-5 h-5 text-[9px]',
  md: 'w-7 h-7 text-[10px]',
} as const;

/** Team visual indicator used across NFL Slate, ML picks, Game Detail, and the
 * player-prop screens. Renders a colored abbreviation badge using the team's own
 * primaryColor -- no logo asset needed, no trademark exposure. Takes an optional
 * logoUrl so a real team logo can be swapped in later, once a specifically
 * licensed image source is confirmed (see chat: this depends on what a given
 * provider's terms of service actually permit for a multi-user product, not
 * just on whether the provider technically offers logo images at all) --
 * swapping it in means passing logoUrl here, not changing any of these call
 * sites individually. */
export function TeamMark({ team, size = 'md', logoUrl }: { team: NFLTeam; size?: keyof typeof SIZES; logoUrl?: string }) {
  if (logoUrl) {
    return <img src={logoUrl} alt={team.abbrev} className={`${SIZES[size]} rounded-full object-contain shrink-0`} />;
  }
  return (
    <span
      className={`${SIZES[size]} rounded-full flex items-center justify-center font-bold text-white shrink-0`}
      style={{ backgroundColor: team.primaryColor }}
    >
      {team.abbrev}
    </span>
  );
}