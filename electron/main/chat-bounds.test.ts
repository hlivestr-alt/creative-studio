import { describe, expect, it } from 'vitest';
import { calculateChatViewBounds, hiddenChatViewBounds } from './chat-bounds';

describe('ChatGPT WebContentsView bounds', () => {
  it('subtracts the container y offset from the available window height', () => {
    expect(calculateChatViewBounds(
      { x: 760, y: 54, width: 740, height: 906 },
      { width: 1500, height: 960 }
    )).toEqual({ x: 760, y: 54, width: 740, height: 906 });

    expect(calculateChatViewBounds(
      { x: 760, y: 54, width: 740, height: 1200 },
      { width: 1500, height: 960 }
    )).toEqual({ x: 760, y: 54, width: 740, height: 906 });
  });

  it('clamps a host that is partially outside the BrowserWindow content area', () => {
    expect(calculateChatViewBounds(
      { x: -12.4, y: 40.2, width: 420.6, height: 900.7 },
      { width: 400, height: 800 }
    )).toEqual({ x: 0, y: 40, width: 400, height: 760 });
  });

  it('rounds fractional DOM coordinates without clipping the visible edge', () => {
    expect(calculateChatViewBounds(
      { x: 100.25, y: 53.75, width: 300.25, height: 706.1 },
      { width: 1000, height: 800 }
    )).toEqual({ x: 100, y: 53, width: 301, height: 707 });
  });

  it('returns empty bounds for an invalid or zero-sized window', () => {
    expect(calculateChatViewBounds(
      { x: 100, y: 50, width: 500, height: 500 },
      { width: 0, height: 0 }
    )).toEqual(hiddenChatViewBounds());
  });
});
