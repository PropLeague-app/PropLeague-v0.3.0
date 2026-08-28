import type { LogoIdentity } from '../../types';

const SIZE_CLASSES = {
  xs: 'w-4 h-4 text-[6px]',
  sm: 'w-6 h-6 text-[9px]',
  md: 'w-9 h-9 text-xs',
  lg: 'w-12 h-12 text-sm',
} as const;

// manual v0.2.0 §4 #8 sized these to ~80-85% of the circle's diameter (up from an
// under-sized ~45-55%), but that read as slightly crowding the circle edge — manual
// v0.2.1 §5 #5 dials it back ~5-10% to ~75% at every size variant, and adds a subtle
// drop-shadow (applied where these classes are used, not here) so the glyph stays
// readable against light and dark logoColor backgrounds alike.
const EMOJI_SIZE_CLASSES = {
  xs: 'text-[12px] leading-none',
  sm: 'text-[18px] leading-none',
  md: 'text-[27px] leading-none',
  lg: 'text-[36px] leading-none',
} as const;

/** Small dark drop-shadow (not a box-shadow, which would just box the whole glyph's
 * bounding square) — reads as a soft outline around the emoji's actual silhouette, so
 * it stays legible on both the lightest and darkest colors in the logo palette. */
const EMOJI_SHADOW_STYLE = { filter: 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.45))' } as const;

export type LogoSize = keyof typeof SIZE_CLASSES;

/** Renders any unified logo identity (a team, or the league itself as of manual
 * v0.1.1 §2 #3) in whichever of the three modes is active — emoji, initials-on-color,
 * or an uploaded image (manual v0.03 §3 #6). The one place this rendering logic
 * lives, shared by TeamLogo and LeagueLogo, so every screen that shows an identity
 * gets all three modes for free. Falls back to the initials treatment for pre-v0.1.1
 * data with no explicit mode, or an image mode missing its data URL. */
export function IdentityBadge({ identity, initials, size = 'md' }: { identity: LogoIdentity; initials: string; size?: LogoSize }) {
  const cls = `${SIZE_CLASSES[size]} rounded-full flex items-center justify-center font-bold text-white shrink-0 overflow-hidden`;
  if (identity.logoMode === 'image' && identity.logoDataUrl) {
    return <img src={identity.logoDataUrl} alt="" className={cls} />;
  }
  if (identity.logoMode === 'emoji' && identity.logoEmoji) {
    return (
      <div className={`${cls} ${EMOJI_SIZE_CLASSES[size]}`} style={{ backgroundColor: identity.logoColor }}>
        <span style={EMOJI_SHADOW_STYLE}>{identity.logoEmoji}</span>
      </div>
    );
  }
  return (
    <div className={cls} style={{ backgroundColor: identity.logoColor }}>
      {initials}
    </div>
  );
}

type TeamLogoTeam = LogoIdentity & { abbrev: string };

export function TeamLogo({ team, size = 'md' }: { team: TeamLogoTeam; size?: LogoSize }) {
  return <IdentityBadge identity={team} initials={team.abbrev.slice(0, 2)} size={size} />;
}
