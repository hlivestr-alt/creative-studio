import { ExternalLink, FolderOpen, LockKeyhole, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { chatGptHomeUrl } from '../domain/settings';
import { captionModeOptions, postStructureOptions, workflowModeOptions, type AppSettings } from '../domain/types';
import { useApp } from './AppContext';

export function SettingsPage() {
  const { settings, saveSettings } = useApp();
  if (!settings) return <div className="loading-screen"><span className="spinner" /> Loading settings…</div>;
  return <SettingsForm initial={settings} saveSettings={saveSettings} />;
}

function SettingsForm({ initial, saveSettings }: { initial: AppSettings; saveSettings: (settings: AppSettings) => Promise<AppSettings> }) {
  const [draft, setDraft] = useState<AppSettings>(initial);
  const [saved, setSaved] = useState(false);
  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => { event.preventDefault(); await saveSettings(draft); setSaved(true); window.setTimeout(() => setSaved(false), 1800); };
  return <div className="page-scroll settings-page">
    <header className="page-header wide"><div><span className="eyebrow">Workspace defaults</span><h1>Settings</h1><p>Manage local defaults, source folders, and the visible ChatGPT workspace.</p></div></header>
    <form className="settings-layout" onSubmit={submit}>
      <nav className="settings-nav" aria-label="Settings sections">
        <a href="#settings-chatgpt">ChatGPT</a>
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

        <div className="settings-footer"><div><ShieldCheck size={16} /><span>All planning data stays on this computer.</span></div><button className="button primary" type="submit"><Save size={16} />{saved ? 'Saved' : 'Save settings'}</button></div>
      </div>
    </form>
  </div>;
}
