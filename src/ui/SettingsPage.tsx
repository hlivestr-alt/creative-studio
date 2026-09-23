import { CheckCircle2, Cpu, ExternalLink, FolderOpen, LockKeyhole, RefreshCw, RotateCcw, Save, Server, ShieldCheck, XCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { chatGptHomeUrl } from '../domain/settings';
import { captionModeOptions, postStructureOptions, workflowModeOptions, type AppSettings, type RemoteComfySystemInfo } from '../domain/types';
import { useApp } from './AppContext';

export function SettingsPage() {
  const { settings, saveSettings } = useApp();
  if (!settings) return <div className="loading-screen"><span className="spinner" /> Loading settings…</div>;
  return <SettingsForm initial={settings} saveSettings={saveSettings} />;
}

function SettingsForm({ initial, saveSettings }: { initial: AppSettings; saveSettings: (settings: AppSettings) => Promise<AppSettings> }) {
  const [draft, setDraft] = useState<AppSettings>(initial);
  const [saved, setSaved] = useState(false);
  const [connection, setConnection] = useState<RemoteComfySystemInfo | null>(null);
  const [testingConnection, setTestingConnection] = useState(false);
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => { event.preventDefault(); await saveSettings(draft); setSaved(true); window.setTimeout(() => setSaved(false), 1800); };
  const testConnection = async () => {
    setTestingConnection(true);
    try {
      setConnection(await window.proya.compute.testConnection(draft.remoteComfyUrl));
    } catch (reason) {
      setConnection({ connected: false, url: draft.remoteComfyUrl, comfyVersion: null, gpuName: null, vramTotalBytes: null, vramFreeBytes: null, latencyMs: null, error: reason instanceof Error ? reason.message : 'Could not test the ComfyUI connection.' });
    } finally {
      setTestingConnection(false);
    }
  };
  return <div className="page-scroll settings-page">
    <header className="page-header wide"><div><span className="eyebrow">Workspace defaults</span><h1>Settings</h1><p>Manage local defaults, source folders, ChatGPT, and compute routing.</p></div></header>
    <form className="settings-layout" onSubmit={submit}>
      <nav className="settings-nav" aria-label="Settings sections">
        <a href="#settings-chatgpt">ChatGPT</a>
        <a href="#settings-compute">Local engine</a>
        <a href="#settings-creative">Creative defaults</a>
        <a href="#settings-files">Files</a>
        <a href="#settings-advanced">Advanced</a>
      </nav>

      <div className="settings-content">
        <section className="settings-section" id="settings-chatgpt">
          <div className="settings-section-title"><span className="settings-section-icon"><ExternalLink size={18} /></span><div><h2>ChatGPT workspace</h2><p>The official site opens in its own persistent Electron browser profile.</p></div></div>
          <label className="settings-field settings-field-wide"><span>Default ChatGPT workspace URL</span><div className="settings-url-row"><input aria-label="Default ChatGPT workspace URL" type="url" value={draft.chatGptUrl} onChange={(e) => update('chatGptUrl', e.target.value)} required /><button type="button" onClick={() => update('chatGptUrl', chatGptHomeUrl)}><RotateCcw size={15} /> Use ChatGPT home fallback</button></div><small>Paste your existing Creative Project URL to make it the default target. Open ChatGPT, Open ChatGPT + Copy Brief, and New chat all use this saved HTTPS URL. New installs use the normal ChatGPT home fallback because project URLs are account-specific.</small></label>
          <details className="settings-details"><summary>Privacy and session details</summary><div className="security-callout"><LockKeyhole size={17} /><div><strong>Credentials stay with the browser session</strong><p>The app does not capture passwords, expose cookies, scrape responses, or send messages unattended.</p></div></div></details>
        </section>

        <section className="settings-section" id="settings-compute">
          <div className="settings-section-title"><span className="settings-section-icon"><Cpu size={18} /></span><div><h2>Local engine</h2><p>The H3 tab sends the structured brief and settings to ComfyUI on this PC. The runner and custom workflow continue to own the Qwen and MiniMax H3 lifecycle.</p></div></div>
          <div className="settings-grid">
            <label className="settings-field"><span>Compute mode</span><input aria-label="Compute mode" value="Local engine" readOnly /><small>Execution is fixed to services on this PC.</small></label>
            <label className="settings-field"><span>ComfyUI URL</span><input aria-label="ComfyUI URL" type="url" value={draft.remoteComfyUrl} readOnly required /><small>Fixed local service endpoint.</small></label>
            <label className="settings-field settings-field-wide"><span>H3 API workflow file</span><input aria-label="H3 API workflow file" value={draft.remoteComfyWorkflowPath} onChange={(e) => update('remoteComfyWorkflowPath', e.target.value)} placeholder="C:\\Workflows\\minimax-h3-api.json" /><small>Uses the existing API-format workflow. UI workflow JSON is rejected.</small></label>
            <label className="settings-field settings-field-wide path-field"><span>Result output folder</span><div><input aria-label="Result output folder" value={draft.remoteOutputDirectory} onChange={(e) => update('remoteOutputDirectory', e.target.value)} placeholder="C:\\PROYA\\H3 Outputs" /><button type="button" onClick={() => void window.proya.files.openFolder('remote-output')}><FolderOpen size={15} /> Open</button></div><small>Generated videos are saved locally on this PC.</small></label>
            <label className="settings-field settings-checkbox-field"><span>Automatic result download</span><input aria-label="Automatic result download" type="checkbox" checked={draft.remoteAutoDownload} onChange={(e) => update('remoteAutoDownload', e.target.checked)} /><small>Download the SaveVideo result after ComfyUI reports completion. Turn off to use Download Result manually.</small></label>
          </div>
          <div className="remote-connection-panel">
            <div className="remote-connection-header"><div><span className="settings-section-icon"><Server size={17} /></span><div><strong>Connection status</strong><small>{connection?.url || draft.remoteComfyUrl}</small></div></div><button className="button secondary small" type="button" onClick={() => void testConnection()} disabled={testingConnection}><RefreshCw size={14} className={testingConnection ? 'spin' : ''} />{testingConnection ? 'Testing…' : 'Test connection'}</button></div>
            {connection === null ? <div className="remote-connection-empty"><span className="remote-status-dot" /><span>LOCAL ENGINE</span><small>Test the local ComfyUI system stats endpoint.</small></div> : <div className={`remote-connection-result ${connection.connected ? 'connected' : 'disconnected'}`}><div className="remote-status-line">{connection.connected ? <CheckCircle2 size={16} /> : <XCircle size={16} />}<strong>{connection.connected ? 'LOCAL ENGINE READY' : 'LOCAL ENGINE UNAVAILABLE'}</strong>{connection.latencyMs !== null && <small>{connection.latencyMs} ms</small>}</div>{connection.connected ? <div className="remote-system-grid"><div><span>ComfyUI version</span><strong>{connection.comfyVersion ?? 'Unavailable'}</strong></div><div><span>GPU</span><strong>{connection.gpuName ?? 'Unavailable'}</strong></div><div><span>VRAM</span><strong>{formatVram(connection.vramTotalBytes)} total</strong></div><div><span>Free VRAM</span><strong>{formatVram(connection.vramFreeBytes)}</strong></div></div> : <p>{connection.error ?? 'ComfyUI unavailable'}</p>}</div>}
          </div>
          <div className="security-callout remote-auth-note"><LockKeyhole size={17} /><div><strong>Local-only compute</strong><p>ComfyUI, the production runner, and LM Studio use loopback endpoints on this PC. The app does not expose or configure these services for external access.</p></div></div>
        </section>

        <section className="settings-section" id="settings-creative">
          <div className="settings-section-title"><span className="settings-section-icon"><RotateCcw size={18} /></span><div><h2>Creative defaults</h2><p>Used when you begin a new session on Today.</p></div></div>
          <div className="settings-grid"><label className="settings-field"><span>Default workflow</span><select value={draft.defaultWorkflowMode} onChange={(e) => update('defaultWorkflowMode', e.target.value as AppSettings['defaultWorkflowMode'])}>{workflowModeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>Direct Image Prompt keeps the daily path to one approved prompt.</small></label><label className="settings-field"><span>Default post structure</span><select value={draft.defaultPostStructure} onChange={(e) => update('defaultPostStructure', e.target.value as AppSettings['defaultPostStructure'])}>{postStructureOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>Carousel adds a slide-count control on Today.</small></label><label className="settings-field"><span>Default caption length</span><select value={draft.defaultCaptionMode} onChange={(e) => update('defaultCaptionMode', e.target.value as AppSettings['defaultCaptionMode'])}>{captionModeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><small>Used by Direct Image Prompt sessions.</small></label><label className="settings-field"><span>Default language</span><select value={draft.defaultLanguage} onChange={(e) => update('defaultLanguage', e.target.value as AppSettings['defaultLanguage'])}><option>Indonesian</option><option>English</option></select></label><label className="settings-field"><span>Default format</span><select value={draft.defaultFormat} onChange={(e) => update('defaultFormat', e.target.value as AppSettings['defaultFormat'])}><option>Instagram Feed 4:5</option><option>Square 1:1</option><option>Story / TikTok 9:16</option></select></label><label className="settings-field"><span>Default creativity</span><select value={draft.defaultCreativity} onChange={(e) => update('defaultCreativity', e.target.value as AppSettings['defaultCreativity'])}><option>Safe</option><option>Balanced</option><option>Experimental</option></select></label></div>
        </section>

        <section className="settings-section" id="settings-files">
          <div className="settings-section-title"><span className="settings-section-icon"><FolderOpen size={18} /></span><div><h2>Files</h2><p>Master references remain read-only from the studio.</p></div></div>
          <label className="settings-field path-field"><span>Product assets directory</span><div><input value={draft.productAssetsDirectory} onChange={(e) => update('productAssetsDirectory', e.target.value)} /><button type="button" onClick={() => void window.proya.files.openFolder('products')}><FolderOpen size={15} /> Open</button></div></label>
          <label className="settings-field path-field"><span>References directory</span><div><input value={draft.referencesDirectory} onChange={(e) => update('referencesDirectory', e.target.value)} /><button type="button" onClick={() => void window.proya.files.openFolder('references')}><FolderOpen size={15} /> Open</button></div></label>
        </section>

        <details className="settings-section settings-details-section" id="settings-advanced">
          <summary className="settings-section-summary"><span className="settings-section-icon"><ShieldCheck size={18} /></span><div><h2>Advanced</h2><p>Technical planning controls used less often.</p></div></summary>
          <div className="settings-section-body"><label className="settings-field settings-field-narrow"><span>Recent-history window</span><input type="number" min="1" max="100" value={draft.recentHistoryWindow} onChange={(e) => update('recentHistoryWindow', Number(e.target.value))} /><small>Used to discourage repeated concepts.</small></label></div>
        </details>

        <div className="settings-footer"><div><ShieldCheck size={16} /><span>Planning and H3 execution stay on this PC.</span></div><button className="button primary" type="submit"><Save size={16} />{saved ? 'Saved' : 'Save settings'}</button></div>
      </div>
    </form>
  </div>;
}

function formatVram(bytes: number | null): string {
  if (bytes === null) return 'Unavailable';
  const gibibytes = bytes / (1024 ** 3);
  if (gibibytes >= 1) return `${gibibytes.toFixed(1)} GiB`;
  return `${(bytes / (1024 ** 2)).toFixed(0)} MiB`;
}
