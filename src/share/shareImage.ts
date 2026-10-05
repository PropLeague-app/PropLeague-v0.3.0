// Turns a share card into a PNG and hands it to the system share sheet.
//
// How it works: html-to-image copies the card's DOM into an SVG, draws that to a canvas and
// returns a PNG data URL. On iPhone the PNG is written to the app's cache folder with
// @capacitor/filesystem and passed to @capacitor/share, which opens the normal iOS share sheet
// (Messages, Instagram, Save Image, and so on). In a plain browser it falls back to the Web Share
// API, then to a download.
import { Capacitor } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { toPng } from 'html-to-image';
import { SHARE_W } from './palette';

export type ShareOutcome = 'shared' | 'cancelled' | 'downloaded';

/** The page background in the current theme, used behind the card in case any edge is transparent. */
function pageBackground(): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim();
    if (v) return v;
  } catch {
    /* fall through */
  }
  return '#141c29';
}

/** Renders the card element at 1080 wide and as tall as the card is: 1350 for the
 * standard shape, more for long slips and stats pictures, less for a single bet. The element must not carry its own scale: the on-screen preview scales a
 * parent, never the card itself. */
export async function renderCardPng(node: HTMLElement): Promise<string> {
  const opts = {
    width: SHARE_W,
    height: Math.round(node.offsetHeight),
    pixelRatio: 1,
    cacheBust: false,
    // The app uses system fonts, so there is nothing to embed; skipping avoids a stylesheet fetch.
    skipFonts: true,
    backgroundColor: pageBackground(),
    style: { transform: 'none' },
  };
  // WebKit paints images and emoji blank on the first pass. Draw once to warm it up, then keep the second.
  await toPng(node, opts);
  return toPng(node, opts);
}

export function shareFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `propleague-${slug || 'share'}-${stamp}`;
}

function isCancel(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return /cancel/i.test(msg) || (err instanceof DOMException && err.name === 'AbortError');
}

export async function shareImageFile(dataUrl: string, fileName: string, title: string): Promise<ShareOutcome> {
  if (Capacitor.isNativePlatform()) {
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    const written = await Filesystem.writeFile({ path: `${fileName}.png`, data: base64, directory: Directory.Cache });
    try {
      await Share.share({ title, files: [written.uri] });
      return 'shared';
    } catch (err) {
      if (isCancel(err)) return 'cancelled';
      throw err;
    }
  }

  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], `${fileName}.png`, { type: 'image/png' });
  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return 'shared';
    } catch (err) {
      if (isCancel(err)) return 'cancelled';
      throw err;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${fileName}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return 'downloaded';
}
