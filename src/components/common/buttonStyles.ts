/**
 * Soft, tinted action buttons (see .btn-soft-* in index.css): a faint fill, a matching hairline border
 * and bright tinted text, instead of a solid slab. Used for the main in-app actions. Onboarding keeps
 * the solid primary button on purpose, with the shared pressed feedback below.
 */
export const SOFT_PRIMARY_BTN = 'btn-soft-primary disabled:opacity-40';
export const SOFT_PROFIT_BTN = 'btn-soft-profit disabled:opacity-40';
export const SOFT_LOSS_BTN = 'btn-soft-loss disabled:opacity-40';

/** Onboarding buttons: the solid primary slab, an outlined secondary and a plain text link, all with
 * the same quick pressed feedback (a slight shrink) so every tap on the first screens registers.
 *
 * It used to hardcode `bg-primary text-white`, which ignored --color-on-primary entirely. That is
 * the right answer only for the accents whose text is meant to be white: on Gold, Mono, Teal and
 * Orange the theme asks for dark text, and the button painted white on a light fill anyway. Mono in
 * dark mode came out at 1.45:1 and Gold at 1.84:1, which is barely visible (see chat, Oct 2026).
 * `.btn-solid-primary` takes both the fill and the text from the theme, so every accent gets the
 * pairing it actually defines. */
export const ONBOARDING_PRIMARY_BTN =
  'w-full btn-solid-primary font-semibold py-3.5 rounded-xl transition active:brightness-90 active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 disabled:active:brightness-100';
export const ONBOARDING_SECONDARY_BTN =
  'w-full bg-bg-card border border-border font-semibold py-3.5 rounded-xl transition active:bg-bg-raised active:scale-[0.98] disabled:opacity-40';
/** The smaller outlined button used for Google and Apple sign-in. */
export const ONBOARDING_PROVIDER_BTN =
  'w-full bg-bg-card border border-border font-medium py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 transition active:bg-bg-raised active:scale-[0.98] disabled:opacity-40';
export const ONBOARDING_LINK_BTN = 'text-primary text-sm font-medium transition active:opacity-60';
