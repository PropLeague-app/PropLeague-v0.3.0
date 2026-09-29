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
  // A hairline border (manual, see chat) so the badge stays visually distinct from the
  // page even when a team's own color/logo happens to sit close to the background.
  const cls = `${SIZE_CLASSES[size]} rounded-full flex items-center justify-center font-bold text-white shrink-0 overflow-hidden border border-border`;
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

type TeamLogoTeam = LogoIdentity & { abbrev: string; isSimulated?: boolean };

// "AI"-controlled team indicator (see chat, Sept 2026) -- same top-right-corner-of-
// the-thing-it's-attached-to placement as the lineup-needed "!" on the bottom tab
// bar and the unread-chat count on the Chat feed pill (see BottomTabBar.tsx /
// ActivityFeed.tsx), but deliberately NOT that same bg-loss red: red on this app is
// reserved for "something needs your attention" (an unread message, an incomplete
// lineup), and a bot-run team isn't an alert -- it's just a fact about the team, so
// it gets its own color. Reuses --color-accent (the purple already used for the
// Voided pill/badge elsewhere) rather than introducing a fourth semantic color into
// the palette for a single indicator. Sized per logo size so it stays legible at the
// small sizes the app actually uses (xs is only ~16px across) without dwarfing the
// circle it sits on at the larger ones.
const AI_BADGE_CLASSES = {
  xs: '-top-0.5 -right-0.5 w-3 h-3 text-[5px]',
  sm: '-top-1 -right-1 w-3.5 h-3.5 text-[6px]',
  md: '-top-1 -right-1 w-4 h-4 text-[7px]',
  lg: '-top-1.5 -right-1.5 w-5 h-5 text-[8px]',
} as const;

export function TeamLogo({ team, size = 'md' }: { team: TeamLogoTeam; size?: LogoSize }) {
  const badge = <IdentityBadge identity={team} initials={team.abbrev.slice(0, 2)} size={size} />;
  if (!team.isSimulated) return badge;
  return (
    <span className="relative inline-block shrink-0 leading-none">
      {badge}
      <span
        className={`absolute ${AI_BADGE_CLASSES[size]} rounded-full bg-accent text-white font-bold leading-none flex items-center justify-center`}
        aria-label="AI-controlled team"
        title="AI-controlled team"
      >
        AI
      </span>
    </span>
  );
}
