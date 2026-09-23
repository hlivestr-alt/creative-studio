import { describe, expect, it } from 'vitest';
import { isAutoDuration, selectAutoDuration } from './auto-duration';
import { calculateH3FrameLength } from './h3';

describe('new Auto Run duration', () => {
  it('selects integer seconds from 8 through 15 and varies across new jobs', () => {
    const values = Array.from({ length: 8 }, (_, index) => selectAutoDuration(() => (index + 0.5) / 8));
    expect(values).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
    expect(values.every(isAutoDuration)).toBe(true);
    expect(isAutoDuration(7)).toBe(false);
    expect(isAutoDuration(16)).toBe(false);
    expect(isAutoDuration(8.5)).toBe(false);
  });

  it('uses the native 17k+5 H3 grid without exceeding fifteen seconds', () => {
    for (let seconds = 8; seconds <= 15; seconds += 1) {
      const frames = calculateH3FrameLength(seconds);
      expect((frames - 5) % 17).toBe(0);
      expect(frames / 24).toBeLessThanOrEqual(15);
      expect(Math.abs(frames / 24 - seconds)).toBeLessThan(0.7);
    }
  });
});
