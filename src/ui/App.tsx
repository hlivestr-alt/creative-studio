import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { CalendarDays, Copy, History, Minus, PackageOpen, Settings, Square, X } from 'lucide-react';
import { AppProvider } from './AppContext';
import { TodayPage } from './TodayPage';
import { HistoryPage } from './HistoryPage';
import { SettingsPage } from './SettingsPage';
import { maximizeButtonLabel } from '../domain/window';
import appIconUrl from '../../assets/app-icon.svg';

function WindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);
  const maximizeLabel = maximizeButtonLabel(isMaximized);

  useEffect(() => {
    let mounted = true;
    void window.proya.window.getState().then((state) => {
      if (mounted) setIsMaximized(state.isMaximized);
    });
    const unsubscribe = window.proya.window.onState((state) => setIsMaximized(state.isMaximized));
    return () => { mounted = false; unsubscribe(); };
  }, []);

  return (
    <div className="window-controls" role="group" aria-label="Window controls">
      <button className="window-control" type="button" aria-label="Minimize" title="Minimize" onClick={() => void window.proya.window.minimize()}>
        <Minus size={15} strokeWidth={1.6} />
      </button>
      <button className="window-control" type="button" aria-label={maximizeLabel} title={maximizeLabel} onClick={() => void window.proya.window.toggleMaximize()}>
        {isMaximized ? <Copy size={14} strokeWidth={1.6} /> : <Square size={14} strokeWidth={1.6} />}
      </button>
      <button className="window-control window-control-close" type="button" aria-label="Close" title="Close" onClick={() => void window.proya.window.close()}>
        <X size={15} strokeWidth={1.6} />
      </button>
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <WindowControls />
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand-lockup">
            <img className="brand-mark" src={appIconUrl} alt="" aria-hidden="true" />
            <div className="brand-copy"><strong>PROYA Creative Studio</strong><span>Creative planning workspace</span></div>
          </div>
          <nav className="sidebar-nav" aria-label="Primary navigation">
            <NavLink end to="/today"><CalendarDays size={17} /><span>Today</span></NavLink>
            <NavLink end to="/history"><History size={17} /><span>History</span></NavLink>
          </nav>
          <div className="sidebar-divider" />
          <nav className="sidebar-nav sidebar-nav-secondary" aria-label="Workspace navigation">
            <NavLink end to="/settings"><Settings size={17} /><span>Settings</span></NavLink>
          </nav>
          <div className="sidebar-footer"><PackageOpen size={15} /><div><strong>Local workspace</strong><span>PROYA 5X Vitamin C</span></div></div>
        </aside>
        <main className="main-area">
          <Routes>
            <Route path="/today" element={<TodayPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/today" replace />} />
          </Routes>
        </main>
      </div>
    </AppProvider>
  );
}
