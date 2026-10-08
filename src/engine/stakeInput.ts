export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '.' | 'back';

const MAX_INT_DIGITS = 7;

/**
 * Applies one keypad press to the stake text. Rules: at most two decimals, a single dot (a leading
 * dot becomes "0."), no leading zeros ("007" is "7"), and a cap on whole digits so the box can't overflow.
 */
export function applyStakeKey(text: string, key: KeypadKey): string {
  if (key === 'back') return text.slice(0, -1);
  if (key === '.') {
    if (text.includes('.')) return text;
    return text === '' ? '0.' : `${text}.`;
  }
  const dot = text.indexOf('.');
  if (dot !== -1) {
    return text.length - dot - 1 >= 2 ? text : text + key;
  }
  if (text === '0') return key;
  if (text.length >= MAX_INT_DIGITS) return text;
  return text + key;
}
