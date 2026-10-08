import { describe, it, expect } from 'vitest';
import { applyStakeKey, type KeypadKey } from '../stakeInput';

const press = (keys: KeypadKey[], start = '') => keys.reduce((t, k) => applyStakeKey(t, k), start);

describe('applyStakeKey', () => {
  it('builds whole numbers', () => {
    expect(press(['1', '2', '5'])).toBe('125');
  });
  it('replaces a lone zero instead of stacking leading zeros', () => {
    expect(press(['0', '0', '7'])).toBe('7');
  });
  it('turns a leading dot into 0.', () => {
    expect(press(['.', '5'])).toBe('0.5');
  });
  it('allows one dot and two decimals', () => {
    expect(press(['1', '.', '2', '.', '3', '4', '5'])).toBe('1.23');
  });
  it('backspace removes the last character and is safe on empty', () => {
    expect(press(['back'], '12.5')).toBe('12.');
    expect(press(['back'], '')).toBe('');
  });
  it('caps whole digits', () => {
    expect(press(['9', '9', '9', '9', '9', '9', '9', '9', '9'])).toBe('9999999');
  });
});
