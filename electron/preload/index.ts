import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings, ChatPanelBounds, HistoryInput, HistoryRecord, HistoryUpdate } from '../../src/domain/types';
import { windowChannels, type WindowState } from '../../src/domain/window';

const api = {
  history: {
    list: (limit?: number): Promise<HistoryRecord[]> => ipcRenderer.invoke('history:list', limit),
    create: (input: HistoryInput): Promise<HistoryRecord> => ipcRenderer.invoke('history:create', input),
    update: (id: number, update: HistoryUpdate): Promise<HistoryRecord> => ipcRenderer.invoke('history:update', id, update)
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    set: (settings: AppSettings): Promise<AppSettings> => ipcRenderer.invoke('settings:set', settings)
  },
  clipboard: { writeText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text) },
  window: {
    minimize: (): Promise<void> => ipcRenderer.invoke(windowChannels.minimize),
    toggleMaximize: (): Promise<WindowState> => ipcRenderer.invoke(windowChannels.toggleMaximize),
    close: (): Promise<void> => ipcRenderer.invoke(windowChannels.close),
    getState: (): Promise<WindowState> => ipcRenderer.invoke(windowChannels.getState),
    onState: (callback: (state: WindowState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: WindowState) => callback(state);
      ipcRenderer.on(windowChannels.state, listener);
      return () => { ipcRenderer.removeListener(windowChannels.state, listener); };
    }
  },
  chat: {
    open: (): Promise<void> => ipcRenderer.invoke('chat:open'),
    newChat: (): Promise<void> => ipcRenderer.invoke('chat:new'),
    openExternal: (): Promise<void> => ipcRenderer.invoke('chat:external'),
    setBounds: (bounds: ChatPanelBounds): Promise<void> => ipcRenderer.invoke('chat:bounds', bounds),
    onBoundsRefresh: (callback: () => void) => {
      const listener = () => callback();
      ipcRenderer.on('chat:bounds-refresh', listener);
      return () => { ipcRenderer.removeListener('chat:bounds-refresh', listener); };
    },
    onState: (callback: (state: { loading?: boolean; error?: string; url?: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: { loading?: boolean; error?: string; url?: string }) => callback(state);
      ipcRenderer.on('chat:state', listener);
      return () => { ipcRenderer.removeListener('chat:state', listener); };
    }
  },
  files: {
    showProduct: (relativePath?: string): Promise<string> => ipcRenderer.invoke('files:show-product', relativePath),
    openFolder: (kind: 'products' | 'references'): Promise<string> => ipcRenderer.invoke('files:open-folder', kind),
    copyPath: (relativePath: string): Promise<void> => ipcRenderer.invoke('files:copy-path', relativePath),
    copyPaths: (relativePaths: string[]): Promise<void> => ipcRenderer.invoke('files:copy-paths', relativePaths)
  }
};

contextBridge.exposeInMainWorld('proya', api);

export type ProyaApi = typeof api;
