export interface WindowState {
  isMaximized: boolean;
}

export const windowChannels = {
  minimize: 'window:minimize',
  toggleMaximize: 'window:toggle-maximize',
  close: 'window:close',
  getState: 'window:get-state',
  state: 'window:state'
} as const;

export function windowStateFromMaximized(isMaximized: boolean): WindowState {
  return { isMaximized };
}

export function maximizeButtonLabel(isMaximized: boolean): 'Maximize' | 'Restore' {
  return isMaximized ? 'Restore' : 'Maximize';
}
