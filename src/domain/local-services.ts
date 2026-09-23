export const localServiceUrls = {
  runner: 'http://127.0.0.1:8787',
  comfy: 'http://127.0.0.1:8188',
  lmStudio: 'http://127.0.0.1:1234'
} as const;

export type LocalServicePhase = 'checking' | 'starting' | 'ready' | 'unavailable';

export interface LocalServiceState {
  phase: LocalServicePhase;
  message: string;
}

export interface LocalServicesStatus {
  runner: LocalServiceState;
  comfy: LocalServiceState;
  lmStudio: LocalServiceState;
  overallReady: boolean;
  checkedAt: string;
}
