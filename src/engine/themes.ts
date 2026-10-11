// The app's themes and accent colors (1.2.10). Colors are painted by CSS variables in src/index.css,
// switched with two attributes on <html>: data-theme (which theme) and data-tone (light or dark, so
// every light theme shares the light-mode readability fixes and every dark theme the dark ones), plus
// data-accent for a non-blue accent. This file holds the few values code needs outside CSS (the
// native backdrop, team-color contrast, the Settings swatches); src/engine/__tests__/themes.test.ts
// checks they match index.css and that every theme and accent passes contrast.
import type { ResolvedTheme } from '../types';

export type Tone = 'light' | 'dark';

export interface ThemeDef {
  id: ResolvedTheme;
  label: string;
  tone: Tone;
  /** Same values as --color-bg / --color-bg-card / --color-text / --color-text-muted / --color-border in index.css. */
  bg: string;
  card: string;
  text: string;
  muted: string;
  border: string;
}

/** In the order Settings shows them: light tones first, then dark. 'dark' is Midnight and 'graphite'
 * is Dark (keys kept from before so saved choices need no migration). */
export const THEMES: ThemeDef[] = [
  { id: 'light', label: 'Light', tone: 'light', bg: '#e3e9f1', card: '#fbfcfe', text: '#202838', muted: '#5a6472', border: '#ccd5e2' },
  { id: 'linen', label: 'Linen', tone: 'light', bg: '#ebe5d9', card: '#fbf8f2', text: '#2b251f', muted: '#675d51', border: '#d8cebd' },
  { id: 'stone', label: 'Stone', tone: 'dark', bg: '#1f2125', card: '#2b2e33', text: '#eceef2', muted: '#a6abb6', border: '#3e424a' },
  { id: 'graphite', label: 'Dark', tone: 'dark', bg: '#0e0e10', card: '#1c1c1f', text: '#ececee', muted: '#9a9aa2', border: '#2e2e33' },
  { id: 'dark', label: 'Midnight', tone: 'dark', bg: '#141c29', card: '#1e2a3d', text: '#e8ecf5', muted: '#8a94a8', border: '#2c3a52' },
  { id: 'turf', label: 'Turf', tone: 'dark', bg: '#0c1813', card: '#162a20', text: '#e6f0ea', muted: '#93ab9e', border: '#264233' },
  { id: 'clay', label: 'Clay', tone: 'dark', bg: '#1d1512', card: '#2e221d', text: '#f3eae5', muted: '#b19f95', border: '#47372f' },
];

export const THEME_BY_ID = Object.fromEntries(THEMES.map((t) => [t.id, t])) as Record<ResolvedTheme, ThemeDef>;

export function themeTone(theme: ResolvedTheme): Tone {
  return THEME_BY_ID[theme]?.tone ?? 'dark';
}

export type AccentColor = 'blue' | 'teal' | 'indigo' | 'purple' | 'orange' | 'gold' | 'mono';

export interface AccentDef {
  id: AccentColor;
  label: string;
  /** --color-primary and --color-primary-ink on dark themes, then on light themes. */
  dark: { primary: string; ink: string };
  light: { primary: string; ink: string };
  /** Text on a solid primary fill (--color-on-primary). */
  onPrimary: string;
  /** On light themes, when it differs (Mono flips from light gray to near-black). */
  onPrimaryLight?: string;
  /** Replaces --color-accent (the purple of the Void Requests card, scheduled-change badges and voided
   * picks) when the accent itself is purple-ish, so those still stand apart from the buttons. */
  secondary?: { dark: string; light: string };
}

/** The app's default --color-accent (index.css @theme). */
export const DEFAULT_SECONDARY = '#9d4eed';

/** Green and red are never accents: they mean profit and loss everywhere. Blue is the original. */
export const ACCENTS: AccentDef[] = [
  { id: 'blue', label: 'Blue', dark: { primary: '#4c8df5', ink: '#a9c9ff' }, light: { primary: '#4c8df5', ink: '#1a52c4' }, onPrimary: '#ffffff' },
  { id: 'teal', label: 'Teal', dark: { primary: '#2cc5b4', ink: '#93efe3' }, light: { primary: '#0d8f83', ink: '#095c55' }, onPrimary: '#0b1716' },
  { id: 'indigo', label: 'Indigo', dark: { primary: '#7477f5', ink: '#c3c5ff' }, light: { primary: '#4f46e5', ink: '#3b33c4' }, onPrimary: '#ffffff', secondary: { dark: '#2cc5b4', light: '#0d8f83' } },
  { id: 'purple', label: 'Purple', dark: { primary: '#b16cf7', ink: '#dfc0ff' }, light: { primary: '#8b3fd9', ink: '#6d22b8' }, onPrimary: '#ffffff', secondary: { dark: '#2cc5b4', light: '#0d8f83' } },
  { id: 'orange', label: 'Orange', dark: { primary: '#f7853a', ink: '#ffc49c' }, light: { primary: '#d4600f', ink: '#8a3a06' }, onPrimary: '#1c1006' },
  { id: 'gold', label: 'Gold', dark: { primary: '#e8b923', ink: '#fbe08a' }, light: { primary: '#a67e00', ink: '#6b5200' }, onPrimary: '#1d1a12' },
  { id: 'mono', label: 'Mono', dark: { primary: '#d4d6dc', ink: '#f1f2f5' }, light: { primary: '#2b2f37', ink: '#1b1e24' }, onPrimary: '#16171a', onPrimaryLight: '#ffffff' },
];

export const ACCENT_BY_ID = Object.fromEntries(ACCENTS.map((a) => [a.id, a])) as Record<AccentColor, AccentDef>;
