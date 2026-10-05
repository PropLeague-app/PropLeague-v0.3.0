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
 *   <span className={pl >= 0 ? 'text-profit' : 'text-loss'} style={plStyle(pl, atRisk)}>...
 *
 * `atRisk` is what the amount is measured against (the week's credits for a weekly total,
 * credits times weeks played for a season total). Without it nothing is scaled.
 */
export function usePlStyle(): (amount: number, atRisk?: number) => CSSProperties | undefined {
  const scale = usePlColorScale();
  return useCallback((amount: number, atRisk?: number) => plStyleFor(amount, scale, atRisk ?? 0), [scale]);
}
