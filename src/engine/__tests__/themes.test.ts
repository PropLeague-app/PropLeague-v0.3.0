import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ACCENTS, DEFAULT_SECONDARY, THEMES, themeTone } from '../themes';
import { resolveTheme } from '../../services/theme';

const css = readFileSync(resolve(__dirname, '../../index.css'), 'utf8');

/** The variables set for `selector` in index.css, merged across every block that names it exactly
 * (alone or as the last line of a grouped selector). */
function block(selector: string): Record<string, string> {
  const vars: Record<string, string> = {};
  let from = 0;
  let found = false;
  for (;;) {
    const start = css.indexOf(`${selector} {`, from);
    if (start < 0) break;
    found = true;
    const body = css.slice(start, css.indexOf('}', start));
    for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) vars[m[1]] = m[2].trim().toLowerCase();
    from = start + 1;
  }
  if (!found) throw new Error(`no block for ${selector}`);
  return vars;
}

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function hue(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  let h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  if (h < 0) h += 360;
  return h;
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** `percent` of `top` over `base`, like the soft buttons' color-mix (sRGB here, close enough to check). */
function mix(top: string, percent: number, base: string): string {
  const a = rgb(top);
  const b = rgb(base);
  return `#${a.map((v, i) => Math.round(v * (percent / 100) + b[i] * (1 - percent / 100)).toString(16).padStart(2, '0')).join('')}`;
}

describe('themes', () => {
  it('match the colors painted by index.css', () => {
    const midnight = block('@theme');
    for (const t of THEMES) {
      const vars = t.id === 'dark' ? midnight : block(`:root[data-theme='${t.id}']`);
      expect(vars['--color-bg']).toBe(t.bg);
      expect(vars['--color-bg-card']).toBe(t.card);
      expect(vars['--color-text']).toBe(t.text);
      expect(vars['--color-text-muted']).toBe(t.muted);
      expect(vars['--color-border']).toBe(t.border);
    }
  });

  it('keep body and muted text readable on cards and the page', () => {
    for (const t of THEMES) {
      expect(contrast(t.text, t.card), `${t.id} text`).toBeGreaterThanOrEqual(7);
      expect(contrast(t.muted, t.card), `${t.id} muted on card`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(t.muted, t.bg), `${t.id} muted on page`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('know their tone, and Auto resolves to Light or Dark', () => {
    expect(THEMES.filter((t) => t.tone === 'light').map((t) => t.id)).toEqual(['light', 'linen']);
    expect(themeTone('turf')).toBe('dark');
    expect(resolveTheme('auto', true)).toBe('graphite');
    expect(resolveTheme('auto', false)).toBe('light');
    expect(resolveTheme('clay', false)).toBe('clay');
  });
});

describe('accents', () => {
  it('match the colors painted by index.css', () => {
    for (const a of ACCENTS.filter((x) => x.id !== 'blue')) {
      const dark = block(`:root[data-accent='${a.id}']`);
      const light = block(`:root[data-tone='light'][data-accent='${a.id}']`);
      expect(dark['--color-primary']).toBe(a.dark.primary);
      expect(dark['--color-primary-ink']).toBe(a.dark.ink);
      expect(dark['--color-on-primary']).toBe(a.onPrimary);
      expect(light['--color-primary']).toBe(a.light.primary);
      expect(light['--color-primary-ink']).toBe(a.light.ink);
    }
  });

  it('read clearly on every theme: button text, links and solid fills', () => {
    for (const t of THEMES) {
      for (const a of ACCENTS) {
        const { primary, ink } = a[t.tone];
        const softButton = mix(primary, 16, t.bg); // .btn-soft-primary fill
        const label = `${a.id} on ${t.id}`;
        expect(contrast(ink, softButton), `${label}: soft button text`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(primary, t.card), `${label}: primary on card`).toBeGreaterThanOrEqual(3);
        expect(contrast(a.onPrimary, primary), `${label}: text on a solid fill`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('keep the purple action color (Void Requests, scheduled changes) distinct from the accent', () => {
    for (const a of ACCENTS) {
      for (const tone of ['dark', 'light'] as const) {
        const secondary = a.secondary?.[tone] ?? DEFAULT_SECONDARY;
        const gap = Math.abs(hue(a[tone].primary) - hue(secondary));
        expect(Math.min(gap, 360 - gap), `${a.id} ${tone}`).toBeGreaterThanOrEqual(40);
      }
      if (a.secondary) {
        expect(block(`:root[data-accent='${a.id}']`)['--color-accent']).toBe(a.secondary.dark);
        expect(block(`:root[data-tone='light'][data-accent='${a.id}']`)['--color-accent']).toBe(a.secondary.light);
        const onAccent = block(`:root[data-accent='${a.id}']`)['--color-on-accent'];
        expect(contrast(onAccent, a.secondary.dark)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('never use green or red, which mean profit and loss', () => {
    for (const a of ACCENTS) {
      for (const hex of [a.dark.primary, a.light.primary]) {
        const [r, g, b] = rgb(hex).map((v) => v / 255);
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const d = max - min;
        let hue = 0;
        if (d > 0) hue = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
        if (hue < 0) hue += 360;
        const red = hue < 15 || hue > 345;
        const green = hue > 85 && hue < 160;
        expect(red || green, `${a.id} ${hex} hue ${Math.round(hue)}`).toBe(false);
      }
    }
  });
});
