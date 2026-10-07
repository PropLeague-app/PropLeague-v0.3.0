/** One rule for how big an emoji sits inside a round logo, shared by the in-app badge (TeamLogo) and the
 * share-image logo so they can never drift apart.
 *
 * The emoji is sized to a fixed share of the circle's *inside* (diameter minus the border on both
 * sides), not of its outside diameter. A fixed-width border takes a much bigger bite out of a small
 * circle, so sizing from the outside made small logos look crammed against the rim while large ones
 * looked fine. 0.78 reproduces the look of the large (48px) logo, which is the reference size. */
export const EMOJI_FILL = 0.78;

/** Emoji are drawn at this font size and then scaled down with a CSS transform. WKWebView (the iOS
 * runtime) does not shrink emoji text below roughly a 20px font: a requested 18px, 17px or 11px emoji
 * all came out about the same size as a 20px one, so small logos (sm, xs) rendered far bigger relative
 * to their circle than the md and lg ones, which is why they looked inconsistent. A transform scales
 * the already-sized glyph proportionally at every size. */
export const EMOJI_BASE_PX = 100;

export function emojiFontPx(diameter: number, borderPx: number): number {
  return Math.round((diameter - borderPx * 2) * EMOJI_FILL * 10) / 10;
}
