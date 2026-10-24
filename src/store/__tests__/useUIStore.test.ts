import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from '../useUIStore';

describe('NFL Slate view memory', () => {
  beforeEach(() => useUIStore.getState().resetSlateView());

  it('remembers the position filter per game', () => {
    const { setSlatePosition } = useUIStore.getState();
    setSlatePosition('pit-no', 'WR');
    setSlatePosition('ne-chi', 'TE');
    expect(useUIStore.getState().slatePositionByGame).toEqual({ 'pit-no': 'WR', 'ne-chi': 'TE' });
  });

  it('a reset clears the filters and the picked week together', () => {
    useUIStore.getState().setSlatePosition('pit-no', 'WR');
    useUIStore.getState().setSlateWeek(9);
    useUIStore.getState().resetSlateView();
    expect(useUIStore.getState().slatePositionByGame).toEqual({});
    expect(useUIStore.getState().slateWeek).toBeNull();
  });
});
