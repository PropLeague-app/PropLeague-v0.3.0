import { useCallback } from 'react';
import type { CSSProperties } from 'react';
import { useAppStore } from '../../store/useAppStore';
import { plStyleFor, type PlColorScale } from '../../engine/plColor';

/** The signed-in person's P/L color choice (App Preferences). Classic until they pick otherwise. */
export function usePlColorScale(): PlColorScale {
  return useAppStore((s) => s.profile?.plColorScale) ?? 'classic';
}

/**
 * Returns a function that gives the inline style to lay over the usual `text-profit` /
 * `text-loss` class for a P/L amount, or undefined when the classic look applies.
 *
 *   const plStyle = usePlStyle();
 *   <span className={pl >= 0 ? 'text-profit' : 'text-loss'} style={plStyle(pl, reference)}>...
 *
 * `reference` is the loss that counts as full red (see engine/plColor weekScaleRef and
 * seasonScaleRef). Without it nothing is scaled.
 */
export function usePlStyle(): (amount: number, reference?: number) => CSSProperties | undefined {
  const scale = usePlColorScale();
  return useCallback((amount: number, reference?: number) => plStyleFor(amount, scale, reference ?? 0), [scale]);
}
