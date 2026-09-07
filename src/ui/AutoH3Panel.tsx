import { useEffect, useState } from 'react';
import { defaultChinaRoot, defaultLaptopRoot, type AutoH3Snapshot } from '../domain/auto-h3';
import { products } from '../domain/data';
import { h3ContentTypeOptions } from '../domain/h3';
import type { H3VideoBrief } from '../domain/types';

function OrderedSelection<T extends string>({ title, values, selected, labels, onChange, disabled }: { title: string; values: readonly T[]; selected: T[]; labels?: Record<string, string>; onChange: (values: T[]) => void; disabled: boolean }) {
  const ordered = [...selected, ...values.filter(v => !selected.includes(v))];
  const move = (value: T, offset: number) => {
    const result = [...selected]; const index = result.indexOf(value);
    [result[index], result[index + offset]] = [result[index + offset], result[index]];
    onChange(result);
  };
  return <fieldset disabled={disabled}><legend>{title}</legend>{ordered.map(value => <div className="auto-selection-row" key={value}>
    <label><input type="checkbox" checked={selected.includes(value)} onChange={e => onChange(e.target.checked ? [...selected, value] : selected.filter(v => v !== value))} />{labels?.[value] ?? value}</label>
    <button type="button" aria-label={`Move ${labels?.[value] ?? value} up`} disabled={selected.indexOf(value) <= 0} onClick={() => move(value, -1)}>↑</button>
    <button type="button" aria-label={`Move ${labels?.[value] ?? value} down`} disabled={!selected.includes(value) || selected.indexOf(value) === selected.length - 1} onClick={() => move(value, 1)}>↓</button>
  </div>)}</fieldset>;
}

export function AutoH3Panel({ brief, onActive }: { brief: H3VideoBrief; onActive: (active: boolean) => void }) {
  const [mode, setMode] = useState('single');
  const [snapshot, setSnapshot] = useState<AutoH3Snapshot>({ sessions: [], jobs: [] });
  const [selectedProducts, setProducts] = useState(products.map(p => p.id));
  const [selectedContentTypes, setContentTypes] = useState([...h3ContentTypeOptions]);
  const [chinaRoot, setChinaRoot] = useState(defaultChinaRoot);
  const [laptopRoot, setLaptopRoot] = useState(defaultLaptopRoot);
  const [shuffleProducts, setShuffleProducts] = useState(false);
  const [shuffleContentTypes, setShuffleContentTypes] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState({ session: '', product: '', content: '', date: '', status: '' });
  const active = snapshot.sessions.find(s => s.status !== 'STOPPED');
  const session = active ?? snapshot.sessions[0];
  const current = snapshot.jobs.find(job => job.autoJobId === active?.currentJobId);
  useEffect(() => {
    let alive = true;
    const refresh = () => window.proya.autoH3.snapshot().then(value => { if (alive) setSnapshot(value); }).catch(reason => { if (alive) setError(String(reason)); });
    void refresh(); const timer = window.setInterval(() => void refresh(), 1000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => { onActive(Boolean(active)); }, [active, onActive]);
  const run = async (action: () => Promise<AutoH3Snapshot>) => {
    setBusy(true); setError('');
    try { setSnapshot(await action()); } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };
  const jobs = snapshot.jobs.filter(j => (!filter.session || j.sessionId === filter.session) && (!filter.product || j.product === filter.product) && (!filter.content || j.contentType === filter.content) && (!filter.date || j.createdAt.startsWith(filter.date)) && (!filter.status || j.status === filter.status || j.downloadStatus === filter.status));
  return <section className="h3-section auto-h3-panel">
    <h2>Auto Generation</h2>
    <label className="h3-field">Mode<select aria-label="H3 generation mode" value={mode} onChange={event => setMode(event.target.value)}><option value="single">Single Video</option><option value="auto">Auto Run</option></select></label>
    {(mode === 'auto' || active) && <>
      {!active && <>
        <div className="auto-selections"><OrderedSelection title="Products" values={products.map(p => p.id)} selected={selectedProducts} labels={Object.fromEntries(products.map(p => [p.id, p.shortName]))} onChange={setProducts} disabled={busy} />
          <OrderedSelection title="Content Types" values={h3ContentTypeOptions} selected={selectedContentTypes} onChange={setContentTypes} disabled={busy} /></div>
        <p>Creative Variety: <strong>{brief.creativeVariety ?? 'Balanced'}</strong> · Repeat: <strong>Forever</strong>. Uses the H3 settings below and each product’s verified master image.</p>
        <label className="auto-toggle"><input type="checkbox" checked={shuffleProducts} onChange={e => setShuffleProducts(e.target.checked)} /> Shuffle product order each cycle</label>
        <label className="auto-toggle"><input type="checkbox" checked={shuffleContentTypes} onChange={e => setShuffleContentTypes(e.target.checked)} /> Shuffle content-type order per product</label>
        <h3>Output</h3><label className="h3-field">China Archive Root<input value={chinaRoot} onChange={e => setChinaRoot(e.target.value)} /></label>
        <small>Must match PROYA_H3_ARCHIVE_ROOT on the China PC. Default: D:\AI Videos.</small>
        <label className="h3-field">Laptop Output Root<input value={laptopRoot} onChange={e => setLaptopRoot(e.target.value)} /></label>
        <button type="button" onClick={() => { void window.proya.autoH3.pickFolder().then(path => { if (path) setLaptopRoot(path); }); }}>Choose folder…</button>
        <button className="h3-generate-button" type="button" disabled={busy || !selectedProducts.length || !selectedContentTypes.length} onClick={() => void run(() => window.proya.autoH3.start({ selectedProducts, selectedContentTypes, shuffleProducts, shuffleContentTypes, chinaRoot, laptopRoot, brief }))}>START AUTO GENERATION</button>
      </>}
      {session && <div className="auto-status" aria-live="polite">
        <h3>{session.status === 'INTERRUPTED' ? 'Previous Auto Run interrupted' : `AUTO GENERATION — ${session.status}`}</h3>
        <dl><dt>Cycle</dt><dd>{session.cycleNumber}</dd><dt>Current Product</dt><dd>{products.find(p => p.id === session.productOrder[session.productIndex])?.shortName} ({session.productIndex + 1} / {session.productOrder.length})</dd>
          <dt>Current Content</dt><dd>{session.contentTypeOrder[session.contentTypeIndex]} ({session.contentTypeIndex + 1} / {session.contentTypeOrder.length})</dd>
          <dt>Completed / Failed</dt><dd>{session.completedCount} / {session.failedCount}</dd><dt>Laptop downloads</dt><dd>{session.pendingLaptopDownloads} pending</dd>
          <dt>Current Stage</dt><dd>{current?.state?.pipelineStage ?? (active ? 'PREPARING' : 'STOPPED')}</dd>
          <dt>Remote</dt><dd>{current?.state?.connectionError || /connection|network|reconcil|fetch|timeout/i.test(session.lastError ?? '') ? 'Remote connection lost — Retrying in 5 seconds…' : 'Connected'}</dd>
          <dt>China Archive</dt><dd>{current?.chinaArchiveError ?? (current?.chinaArchiveSucceeded ? 'Ready' : 'Waiting for output')}</dd><dt>Laptop Output</dt><dd>{session.laptopRoot}</dd></dl>
        {session.lastError && <p className="h3-help">{session.lastError}</p>}
        {session.status === 'INTERRUPTED' && <><button disabled={busy} onClick={() => void run(() => window.proya.autoH3.resume(session.sessionId))}>RESUME</button><button disabled={busy} onClick={() => void run(() => window.proya.autoH3.stop(session.sessionId))}>STOP SESSION</button></>}
        {active && session.status !== 'INTERRUPTED' && <button disabled={busy || session.stopRequested} onClick={() => void run(() => window.proya.autoH3.stop(session.sessionId))}>{session.stopRequested ? 'Stopping after current…' : 'STOP AFTER CURRENT'}</button>}
        {active && <details className="auto-advanced"><summary>Advanced / development</summary><p>Interrupts this session’s active ComfyUI job. Pending downloads continue.</p><button className="error-note" disabled={busy} onClick={() => void run(() => window.proya.autoH3.stop(session.sessionId, true))}>STOP NOW</button></details>}
      </div>}
      <details><summary>Auto Session history ({snapshot.jobs.length})</summary>
        <div className="h3-form-grid">
          <label>Session<select value={filter.session} onChange={e => setFilter({ ...filter, session: e.target.value })}><option value="">All sessions</option>{snapshot.sessions.map(s => <option key={s.sessionId} value={s.sessionId}>{s.startedAt} · {s.sessionId.slice(0, 8)}</option>)}</select></label>
          <label>Product<select value={filter.product} onChange={e => setFilter({ ...filter, product: e.target.value })}><option value="">All products</option>{products.map(p => <option key={p.id} value={p.id}>{p.shortName}</option>)}</select></label>
          <label>Content type<select value={filter.content} onChange={e => setFilter({ ...filter, content: e.target.value })}><option value="">All content types</option>{h3ContentTypeOptions.map(t => <option key={t}>{t}</option>)}</select></label>
          <label>Date<input type="date" value={filter.date} onChange={e => setFilter({ ...filter, date: e.target.value })} /></label>
          <label>Status<select value={filter.status} onChange={e => setFilter({ ...filter, status: e.target.value })}>{['', 'PREPARED', 'SUBMITTING', 'RENDERING', 'COMPLETED', 'FAILED', 'PENDING_DOWNLOAD', 'CANCELLED'].map(s => <option key={s} value={s}>{s || 'All statuses'}</option>)}</select></label>
        </div>
        {jobs.map(job => <details key={job.autoJobId}><summary>Cycle {job.cycleNumber} · {job.product} / {job.contentType} · {job.status} · {job.downloadStatus}</summary>
          <p>Session {job.sessionId}<br />{job.autoJobId}<br />Seed {job.request.seed} · Prompt: {job.state?.finalEnhancedPrompt ? 'Ready' : job.state?.failureStage ?? job.state?.pipelineStage ?? 'Pending'} · Render: {job.state?.status ?? 'Pending'}<br />Duration: {job.finishedAt ? `${Math.round((Date.parse(job.finishedAt) - Date.parse(job.createdAt)) / 1000)}s` : 'In progress'}</p>
          <p>China: {job.chinaArchivePath ?? job.chinaArchiveError ?? 'Pending'}<br />Laptop: {job.laptopOutputPath ?? job.laptopDownloadError ?? 'Pending'}</p>
          {job.downloadStatus === 'PENDING_DOWNLOAD' && <button onClick={() => void run(() => window.proya.autoH3.cancelDownload(job.autoJobId))}>Cancel pending download</button>}
          <p>CreativeFingerprint: {job.creativeFingerprint ?? 'Not planned'}</p><strong>CreativeGenome</strong><pre>{JSON.stringify(job.creativeGenome ?? job.request.generationBrief?.creativeDirection, null, 2)}</pre><p>{job.diagnostics.join('\n')}</p>
        </details>)}
      </details>
    </>}
    {error && <p className="error-note">{error}</p>}
  </section>;
}
