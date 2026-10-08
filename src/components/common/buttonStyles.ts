/**
 * Soft, tinted action buttons (see .btn-soft-* in index.css): a faint fill, a matching hairline border
 * and bright tinted text, instead of a solid slab. Used for the main in-app actions. Onboarding keeps
 * the solid primary button on purpose, with the shared pressed feedback below.
 */
export const SOFT_PRIMARY_BTN = 'btn-soft-primary disabled:opacity-40';
export const SOFT_PROFIT_BTN = 'btn-soft-profit disabled:opacity-40';

/** Onboarding buttons: the solid primary slab, an outlined secondary and a plain text link, all with the
 * same quick pressed feedback (a slight shrink) so every tap on the first screens registers. */
export const ONBOARDING_PRIMARY_BTN =
  'w-full bg-primary text-white font-semibold py-3.5 rounded-xl transition active:brightness-90 active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 disabled:active:brightness-100';
export const ONBOARDING_SECONDARY_BTN =
  'w-full bg-bg-card border border-border font-semibold py-3.5 rounded-xl transition active:bg-bg-raised active:scale-[0.98] disabled:opacity-40';
/** The smaller outlined button used for Google and Apple sign-in. */
export const ONBOARDING_PROVIDER_BTN =
  'w-full bg-bg-card border border-border font-medium py-2.5 rounded-xl text-sm flex items-center justify-center gap-2 transition active:bg-bg-raised active:scale-[0.98] disabled:opacity-40';
export const ONBOARDING_LINK_BTN = 'text-primary text-sm font-medium transition active:opacity-60';
