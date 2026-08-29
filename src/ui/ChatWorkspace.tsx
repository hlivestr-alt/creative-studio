import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowUpRight, Copy, ExternalLink, LoaderCircle, Maximize2, MessageSquarePlus, PanelLeft, Sparkles } from 'lucide-react';
import type { WorkspaceLayout } from '../domain/types';

export interface ChatWorkspaceHandle { openAndCopy: () => Promise<void>; }

interface ChatWorkspaceProps {
  brief: string;
  layout: WorkspaceLayout;
  onLayout: (layout: WorkspaceLayout) => void;
  onCopy: () => Promise<void>;
}

export const ChatWorkspace = forwardRef<ChatWorkspaceHandle, ChatWorkspaceProps>(function ChatWorkspace({ brief, layout, onLayout, onCopy }, ref) {
  const workspaceRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<{ loading?: boolean; error?: string }>({});

  useEffect(() => window.proya.chat.onState(setState), []);
  const updateBounds = useCallback(() => {
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect) return;
    const isVisible = visible && layout !== 'controls' && rect.width > 0 && rect.height > 0;
    void window.proya.chat.setBounds({ x: rect.left, y: rect.top, width: rect.width, height: rect.height, visible: isVisible });
  }, [layout, visible]);

  useEffect(() => {
    const observer = new ResizeObserver(updateBounds);
    [workspaceRef.current, toolbarRef.current, hostRef.current].forEach((element) => { if (element) observer.observe(element); });
    window.addEventListener('resize', updateBounds);
    updateBounds();
    return () => { observer.disconnect(); window.removeEventListener('resize', updateBounds); };
  }, [updateBounds]);

  useEffect(() => window.proya.chat.onBoundsRefresh(updateBounds), [updateBounds]);
  useEffect(() => () => { void window.proya.chat.setBounds({ x: 0, y: 0, width: 0, height: 0, visible: false }); }, []);

  const open = useCallback(async (newChat = false) => { setVisible(true); if (newChat) await window.proya.chat.newChat(); else await window.proya.chat.open(); }, []);
  const openAndCopy = useCallback(async () => { if (layout === 'controls') onLayout('split'); await onCopy(); await open(false); }, [layout, onCopy, onLayout, open]);
  useImperativeHandle(ref, () => ({ openAndCopy }), [openAndCopy]);

  return (
    <section className={`chat-workspace ${layout === 'controls' ? 'hidden-pane' : ''}`} ref={workspaceRef}>
      <div className="chat-toolbar" ref={toolbarRef}>
        <div><span className="status-dot" /> <strong>ChatGPT workspace</strong>{state.loading && <LoaderCircle className="spin" size={14} />}</div>
        <div className="toolbar-actions">
          <button title="Split view" className={layout === 'split' ? 'active' : ''} onClick={() => onLayout('split')}><PanelLeft size={16} /></button>
          <button title="ChatGPT full screen" className={layout === 'chatgpt' ? 'active' : ''} onClick={() => onLayout('chatgpt')}><Maximize2 size={16} /></button>
          <button title="Open in default browser" onClick={() => window.proya.chat.openExternal()}><ExternalLink size={16} /></button>
        </div>
      </div>
      <div className="chat-browser-host" ref={hostRef} aria-hidden="true" />
      {!visible && (
        <div className="chat-welcome">
          <div className="chat-emblem"><Sparkles size={28} /></div>
          <span className="eyebrow">Human in the loop</span>
          <h2>Open ChatGPT beside your brief.</h2>
          <p>ChatGPT opens here as a normal visible browser. You review, paste, and press Send yourself.</p>
          <div className="chat-primary-actions">
            <button className="button primary" onClick={openAndCopy} disabled={!brief}><ArrowUpRight size={17} /> Open ChatGPT + Copy Brief</button>
            <button className="button secondary" onClick={() => open(false)}>Open ChatGPT</button>
          </div>
          <div className="chat-secondary-actions">
            <button onClick={() => open(true)}><MessageSquarePlus size={15} /> New chat</button>
            <button onClick={onCopy} disabled={!brief}><Copy size={15} /> Copy Brief</button>
          </div>
          {state.error && <p className="error-note">Embedded page unavailable: {state.error}. The external-browser fallback remains available.</p>}
        </div>
      )}
    </section>
  );
});
