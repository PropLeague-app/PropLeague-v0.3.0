import type { NFLTeam } from '../../types';

/** Badge size in px, ring thickness (a 1px dark rim plus the secondary band), and the abbreviation
 * font size for two-letter and three-letter teams. Verdana is wide, so three-letter teams (WAS, NYJ,
 * MIN) get a smaller font to stay inside the ring instead of spilling over it. */
const SIZES = {
  xs: { px: 26, ring: 2, font2: 10, font3: 8 },
  sm: { px: 32, ring: 3, font2: 11, font3: 9 },
  md: { px: 36, ring: 3, font2: 12, font3: 10 },
} as const;

/** Relative luminance, 0 (black) to 1 (white). */
function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** The badge's fill and ring. The fill is the team's primary color, except when that is too light
 * for the white abbreviation (Steelers yellow, Saints gold): then the two swap, so those read as a
 * dark badge with a gold ring like the rest. */
export function badgeColors(team: Pick<NFLTeam, 'primaryColor' | 'secondaryColor'>): { fill: string; ring: string } {
  const lightPrimary = luminance(team.primaryColor) > 0.4;
  const darkerSecondary = luminance(team.secondaryColor) < luminance(team.primaryColor);
  return lightPrimary && darkerSecondary
    ? { fill: team.secondaryColor, ring: team.primaryColor }
    : { fill: team.primaryColor, ring: team.secondaryColor };
}

/** Team visual indicator used across NFL Slate, ML picks, Game Detail, and the
 * player-prop screens. Renders a colored abbreviation badge using the team's own
 * primaryColor, ringed in its secondary color -- no logo asset needed, no trademark exposure. Takes an optional
 * logoUrl so a real team logo can be swapped in later, once a specifically
 * licensed image source is confirmed (see chat: this depends on what a given
 * provider's terms of service actually permit for a multi-user product, not
 * just on whether the provider technically offers logo images at all) --
 * swapping it in means passing logoUrl here, not changing any of these call
 * sites individually. */
export function TeamMark({ team, size = 'md', logoUrl }: { team: NFLTeam; size?: keyof typeof SIZES; logoUrl?: string }) {
  const dim = SIZES[size];
  if (logoUrl) {
    return <img src={logoUrl} alt={team.abbrev} className="rounded-full object-contain shrink-0" style={{ width: dim.px, height: dim.px }} />;
  }
  const { fill, ring } = badgeColors(team);
  return (
    <span
      className="rounded-full flex items-center justify-center font-bold text-white shrink-0"
      style={{
        width: dim.px,
        height: dim.px,
        fontSize: team.abbrev.length >= 3 ? dim.font3 : dim.font2,
        lineHeight: 1,
        letterSpacing: '-0.02em',
        whiteSpace: 'nowrap',
        backgroundColor: fill,
        // Layers draw front to back: a darker rim on the outside edge, the secondary-color band
        // beneath it, then the fill. Inset shadows follow the circle at any size.
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${fill} 55%, black), inset 0 0 0 ${dim.ring}px ${ring}`,
      }}
    >
      {team.abbrev}
    </span>
  );
}
