import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AppSettings, HistoryInput, HistoryRecord, HistoryUpdate } from '../domain/types';

interface AppState {
  history: HistoryRecord[];
  settings: AppSettings | null;
  loading: boolean;
  refreshHistory: () => Promise<void>;
  createHistory: (input: HistoryInput) => Promise<HistoryRecord>;
  updateHistory: (id: number, update: HistoryUpdate) => Promise<HistoryRecord>;
  saveSettings: (settings: AppSettings) => Promise<AppSettings>;
}

const Context = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshHistory = useCallback(async () => setHistory(await window.proya.history.list(100)), []);

  useEffect(() => {
    Promise.all([window.proya.history.list(100), window.proya.settings.get()])
      .then(([records, loadedSettings]) => { setHistory(records); setSettings(loadedSettings); })
      .finally(() => setLoading(false));
  }, []);

  const value = useMemo<AppState>(() => ({
    history, settings, loading, refreshHistory,
    createHistory: async (input) => { const record = await window.proya.history.create(input); setHistory((items) => [record, ...items]); return record; },
    updateHistory: async (id, update) => { const record = await window.proya.history.update(id, update); setHistory((items) => items.map((item) => item.id === id ? record : item)); return record; },
    saveSettings: async (next) => { const saved = await window.proya.settings.set(next); setSettings(saved); return saved; }
  }), [history, settings, loading, refreshHistory]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useApp() {
  const value = useContext(Context);
  if (!value) throw new Error('useApp must be used inside AppProvider');
  return value;
}
