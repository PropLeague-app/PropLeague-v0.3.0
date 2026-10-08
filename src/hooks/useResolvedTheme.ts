import { useEffect, useState } from 'react';
import { useAppStore } from '../store/useAppStore';
import { resolveTheme, systemPrefersDark } from '../services/theme';
import type { ResolvedTheme } from '../types';

/** The theme currently painted: the saved choice, with 'auto' resolved from the phone's appearance and
 * kept up to date if that changes while the app is open. */
export function useResolvedTheme(): ResolvedTheme {
  const chosen = useAppStore((s) => s.profile?.themeMode) ?? 'dark';
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  useEffect(() => {
    if (chosen !== 'auto') return;
    return watchSystemAppearance(setSystemDark);
  }, [chosen]);
  return resolveTheme(chosen, systemDark);
}

/** Calls back whenever the phone switches between light and dark; returns the unsubscribe. */
export function watchSystemAppearance(onChange: (dark: boolean) => void): () => void {
  let query: MediaQueryList;
  try {
    query = window.matchMedia('(prefers-color-scheme: dark)');
  } catch {
    return () => {};
  }
  const handler = (e: MediaQueryListEvent) => onChange(e.matches);
  query.addEventListener('change', handler);
  onChange(query.matches);
  return () => query.removeEventListener('change', handler);
}
