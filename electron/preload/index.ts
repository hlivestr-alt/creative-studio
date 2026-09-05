import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { AppSettings, ChatPanelBounds, ComfyOutputFile, ComputeJobState, H3PromptEngineSettings, H3PromptEngineStatus, H3PromptInput, H3PromptRecord, H3PromptUpdate, H3WorkflowSettings, HistoryInput, HistoryRecord, HistoryUpdate, RemoteComfySystemInfo, RemoteH3GenerationRequest, RemoteH3JobRecord } from '../../src/domain/types';
import { windowChannels, type WindowState } from '../../src/domain/window';

const api = {
  history: {
    list: (limit?: number): Promise<HistoryRecord[]> => ipcRenderer.invoke('history:list', limit),
    create: (input: HistoryInput): Promise<HistoryRecord> => ipcRenderer.invoke('history:create', input),
    update: (id: number, update: HistoryUpdate): Promise<HistoryRecord> => ipcRenderer.invoke('history:update', id, update),
    listH3: (limit?: number): Promise<H3PromptRecord[]> => ipcRenderer.invoke('h3-history:list', limit),
    createH3: (input: H3PromptInput): Promise<H3PromptRecord> => ipcRenderer.invoke('h3-history:create', input),
    updateH3: (id: number, update: H3PromptUpdate): Promise<H3PromptRecord> => ipcRenderer.invoke('h3-history:update', id, update)
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    set: (settings: AppSettings): Promise<AppSettings> => ipcRenderer.invoke('settings:set', settings)
  },
  compute: {
    testConnection: (url: string): Promise<RemoteComfySystemInfo> => ipcRenderer.invoke('compute:test-connection', url),
    testPromptEngine: (url: string, settings?: H3PromptEngineSettings): Promise<H3PromptEngineStatus> => ipcRenderer.invoke('compute:test-prompt-engine', url, settings),
    getWorkflowDefaults: (): Promise<H3WorkflowSettings> => ipcRenderer.invoke('compute:get-workflow-defaults'),
    submitH3: (request: RemoteH3GenerationRequest): Promise<ComputeJobState> => ipcRenderer.invoke('compute:submit-h3', request),
    getJobState: (localJobId: string): Promise<ComputeJobState> => ipcRenderer.invoke('compute:get-job-state', localJobId),
    listJobs: (limit?: number): Promise<RemoteH3JobRecord[]> => ipcRenderer.invoke('compute:list-jobs', limit),
    downloadResult: (localJobId: string): Promise<ComputeJobState> => ipcRenderer.invoke('compute:download-result', localJobId),
    openResult: (localJobId: string): Promise<string> => ipcRenderer.invoke('compute:open-result', localJobId),
    openOutput: (output: ComfyOutputFile): Promise<void> => ipcRenderer.invoke('compute:open-output', output),
    onJobState: (callback: (state: ComputeJobState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: ComputeJobState) => callback(state);
      ipcRenderer.on('compute:job-state', listener);
      return () => { ipcRenderer.removeListener('compute:job-state', listener); };
    }
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
    getPathForFile: (file: File): string => webUtils.getPathForFile(file),
    authorizeReferenceFile: (file: File): Promise<string> => {
      const path = webUtils.getPathForFile(file);
      if (!path) throw new Error('Could not access the selected local image path. Please choose the image again.');
      return ipcRenderer.invoke('files:authorize-reference', path);
    },
    clearReferenceAuthorization: (): Promise<void> => ipcRenderer.invoke('files:clear-reference'),
    showProduct: (relativePath?: string): Promise<string> => ipcRenderer.invoke('files:show-product', relativePath),
    openFolder: (kind: 'products' | 'references' | 'remote-output'): Promise<string> => ipcRenderer.invoke('files:open-folder', kind),
    copyPath: (relativePath: string): Promise<void> => ipcRenderer.invoke('files:copy-path', relativePath),
    copyPaths: (relativePaths: string[]): Promise<void> => ipcRenderer.invoke('files:copy-paths', relativePaths)
  }
};

contextBridge.exposeInMainWorld('proya', api);

export type ProyaApi = typeof api;
