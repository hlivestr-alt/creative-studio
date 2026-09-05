import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppSettings, H3PromptInput, H3PromptRecord, H3PromptUpdate, HistoryInput, HistoryRecord, HistoryUpdate } from '../domain/types';

interface AppState {
  history: HistoryRecord[];
  h3History: H3PromptRecord[];
  settings: AppSettings | null;
  loading: boolean;
  refreshHistory: () => Promise<void>;
  refreshH3History: () => Promise<void>;
  createHistory: (input: HistoryInput) => Promise<HistoryRecord>;
  updateHistory: (id: number, update: HistoryUpdate) => Promise<HistoryRecord>;
  createH3Prompt: (input: H3PromptInput) => Promise<H3PromptRecord>;
  updateH3Prompt: (id: number, update: H3PromptUpdate) => Promise<H3PromptRecord>;
  saveSettings: (settings: AppSettings) => Promise<AppSettings>;
}

const Context = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [h3History, setH3History] = useState<H3PromptRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshHistory = useCallback(async () => setHistory(await window.proya.history.list(100)), []);
  const refreshH3History = useCallback(async () => setH3History(await window.proya.history.listH3(100)), []);

  useEffect(() => {
    Promise.all([window.proya.history.list(100), window.proya.history.listH3(100), window.proya.settings.get()])
      .then(([records, h3Records, loadedSettings]) => { setHistory(records); setH3History(h3Records); setSettings(loadedSettings); })
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo<AppState>(() => ({
    history, h3History, settings, loading, refreshHistory, refreshH3History,
    createHistory: async (input) => { const record = await window.proya.history.create(input); setHistory((items) => [record, ...items]); return record; },
    updateHistory: async (id, update) => { const record = await window.proya.history.update(id, update); setHistory((items) => items.map((item) => item.id === id ? record : item)); return record; },
    createH3Prompt: async (input) => { const record = await window.proya.history.createH3(input); setH3History((items) => [record, ...items]); return record; },
    updateH3Prompt: async (id, update) => { const record = await window.proya.history.updateH3(id, update); setH3History((items) => items.map((item) => item.id === id ? record : item)); return record; },
    saveSettings: async (next) => { const saved = await window.proya.settings.set(next); setSettings(saved); return saved; }
  }), [history, h3History, settings, loading, refreshHistory, refreshH3History]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useApp() {
  const value = useContext(Context);
  if (!value) throw new Error('useApp must be used inside AppProvider');
  return value;
}
