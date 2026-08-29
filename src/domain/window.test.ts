import { describe, expect, it } from 'vitest';
import { maximizeButtonLabel, windowChannels, windowStateFromMaximized } from './window';

describe('window chrome state', () => {
  it('maps the native maximize state to the correct control label', () => {
    expect(maximizeButtonLabel(false)).toBe('Maximize');
    expect(maximizeButtonLabel(true)).toBe('Restore');
  });

  it('keeps the native state shape and IPC channels stable', () => {
    expect(windowStateFromMaximized(false)).toEqual({ isMaximized: false });
    expect(windowStateFromMaximized(true)).toEqual({ isMaximized: true });
    expect(windowChannels).toEqual({
      minimize: 'window:minimize',
      toggleMaximize: 'window:toggle-maximize',
      close: 'window:close',
      getState: 'window:get-state',
      state: 'window:state'
    });
  });
});
