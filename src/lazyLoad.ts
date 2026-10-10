// Code splitting (1.2.10). Screens and pieces most people rarely open are loaded the first time
// they are needed instead of at launch, which roughly halves the JavaScript the app parses before
// its first screen. To keep taps instant, everything registered here is also fetched quietly in the
// background shortly after launch (prefetchLazyChunks), so by the time someone opens one of these
// it is usually already loaded. On device every chunk is read from the app bundle, never the network.
import { lazy } from 'react';

const loaders: (() => Promise<unknown>)[] = [];

/** React.lazy for a named export, registered for background prefetch. */
export function lazyNamed<M, K extends keyof M>(loader: () => Promise<M>, name: K) {
  loaders.push(loader);
  // The cast is only for TypeScript: lazy() wants a default export, and the caller gets back the
  // same component type it named, so its props stay checked at every use.
  return lazy(async () => ({ default: (await loader())[name] as never })) as unknown as M[K];
}

let prefetched = false;

/** Loads every registered chunk in the background, once, when the phone is idle after launch. */
export function prefetchLazyChunks(): void {
  if (prefetched) return;
  prefetched = true;
  const run = () => {
    for (const load of loaders) void load().catch(() => undefined); // a failed prefetch just loads on first use
  };
  const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 4000 });
  else window.setTimeout(run, 1500);
}
