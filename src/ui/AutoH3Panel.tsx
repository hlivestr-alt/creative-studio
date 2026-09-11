import { useEffect, useState } from 'react';
import { defaultChinaRoot, defaultLaptopRoot, type AutoH3Snapshot, type ChinaCanaryObserver, type ChinaCanaryReadiness, type ChinaShadowDraftIdentity, type ChinaShadowStageReport } from '../domain/auto-h3';
import { products } from '../domain/data';
import { h3ContentTypeOptions } from '../domain/h3';
import type { H3VideoBrief } from '../domain/types';
import type { RuntimeDiagnostics } from '../domain/runtime';

export function autoH3ConnectionLost(sessionError: string | null, jobError?: string | null): boolean {
  return Boolean(jobError || /connection|network|fetch|socket|cloudflare|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|timed?\s*out|timeout|\b5\d{2}\b/i.test(sessionError ?? ''));
}

export function autoH3CurrentStage(active: boolean, sessionError: string | null, job?: AutoH3Snapshot['jobs'][number]): string {
  if (!active) return 'STOPPED';
  if (autoH3ConnectionLost(sessionError, job?.state?.connectionError)) return 'WAITING_FOR_REMOTE';
  if (job?.state?.h3LifecycleDiagnostics?.remoteLifecycleState === 'ORPHANED_REMOTE_PROMPT') return 'RECONCILING LOST REMOTE JOB';
  if (job?.state?.pipelineStage === 'RELEASING_H3_VRAM' && (job.state.h3LifecycleDiagnostics?.outputCaptured || job.state.h3LifecycleDiagnostics?.chinaArchived)) return 'RELEASING H3 VRAM';
  return job?.state?.pipelineStage ?? 'PREPARING';
}

export function autoH3ReconnectSessionId(readiness: ChinaCanaryReadiness | null, observer: ChinaCanaryObserver | null): string | null {
  const session = readiness?.session;
  if (!session || session.status === 'STAGED' || observer?.sessionId === session.sessionId) return null;
  return session.sessionId;
}

export function chinaProductionRunnerReady(readiness: ChinaCanaryReadiness | null): boolean {
  return readiness?.runner.mode === 'production'
    && readiness.runner.generationEnabled === true
    && readiness.runner.maxJobsPerSession === null
    && readiness.healthReady === true;
}

export type ChinaProductionReadinessStatus = 'CHECKING' | 'READY' | 'TEMPORARILY_UNREACHABLE' | 'INCOMPATIBLE';

export function chinaProductionReadinessAfterSuccess(readiness: ChinaCanaryReadiness): ChinaProductionReadinessStatus {
  return chinaProductionRunnerReady(readiness) ? 'READY' : 'INCOMPATIBLE';
}

export function chinaProductionReadinessAfterFailure(): ChinaProductionReadinessStatus {
  return 'TEMPORARILY_UNREACHABLE';
}

export function chinaProductionReadinessAfterStartFailure(reason: unknown): ChinaProductionReadinessStatus {
  return String(reason).includes('INCOMPATIBLE_PRODUCTION_RUNNER') ? 'INCOMPATIBLE' : 'TEMPORARILY_UNREACHABLE';
}

export function chinaProductionReadinessRetryMs(status: ChinaProductionReadinessStatus, consecutiveFailures = 1): number {
  return status === 'TEMPORARILY_UNREACHABLE' && consecutiveFailures === 1 ? 2_000 : 5_000;
}

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
  const [runtime, setRuntime] = useState<RuntimeDiagnostics | null>(null);
  const [selectedProducts, setProducts] = useState(products.map(p => p.id));
  const [selectedContentTypes, setContentTypes] = useState([...h3ContentTypeOptions]);
  const [chinaRoot, setChinaRoot] = useState(defaultChinaRoot);
  const [laptopRoot, setLaptopRoot] = useState(defaultLaptopRoot);
  const [shuffleProducts, setShuffleProducts] = useState(false);
  const [shuffleContentTypes, setShuffleContentTypes] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [shadowReport, setShadowReport] = useState<ChinaShadowStageReport | null>(null);
  const [shadowDraft, setShadowDraft] = useState<ChinaShadowDraftIdentity | null>(null);
  const [canaryReadiness, setCanaryReadiness] = useState<ChinaCanaryReadiness | null>(null);
  const [readinessError, setReadinessError] = useState('');
  const [readinessStatus, setReadinessStatus] = useState<ChinaProductionReadinessStatus>('CHECKING');
  const [startPreflighting, setStartPreflighting] = useState(false);
  const [canary, setCanary] = useState<ChinaCanaryObserver | null>(null);
  const [canaryDownload, setCanaryDownload] = useState('');
  const [lastArtifactSyncRevision, setLastArtifactSyncRevision] = useState(0);
  const [filter, setFilter] = useState({ session: '', product: '', content: '', date: '', status: '' });
  const active = snapshot.sessions.find(s => s.status !== 'STOPPED');
  const session = active ?? snapshot.sessions[0];
  const current = snapshot.jobs.find(job => job.autoJobId === active?.currentJobId);
  const activeSessionId = active?.sessionId;
  const activeStatus = active?.status;
  const lifecycle = current?.state?.h3LifecycleDiagnostics;
  useEffect(() => {
    let alive = true;
    const refresh = () => Promise.all([window.proya.autoH3.snapshot(), window.proya.runtime.getDiagnostics()]).then(([value, diagnostics]) => {
      if (alive) { setSnapshot(value); setRuntime(diagnostics); }
    }).catch(reason => { if (alive) setError(String(reason)); });
    void refresh(); const timer = window.setInterval(() => void refresh(), 1000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    const sessionId = autoH3ReconnectSessionId(canaryReadiness, canary);
    if (!sessionId) return;
    let alive = true;
    void window.proya.autoH3.canaryStatus(sessionId).then(value => { if (alive) setCanary(value); }).catch(reason => { if (alive) setError(String(reason)); });
    return () => { alive = false; };
  }, [canaryReadiness, canary]);
  useEffect(() => {
    if (!canary?.sessionId
      || canary.connection !== 'connected'
      || canary.revision <= lastArtifactSyncRevision
      || !canary.jobs.some(job => job.phase === 'COMPLETED')) return;
    void window.proya.autoH3.syncCanaryArtifacts(canary.sessionId, laptopRoot).then(results => {
      setLastArtifactSyncRevision(canary.revision);
      if (results.length) setCanaryDownload(results.map(result => `${result.path} (${result.size} bytes, SHA-256 verified${result.downloaded ? '' : ', already present'})`).join('\n'));
    }).catch(reason => setError(`Artifact sync failed; China jobs remain authoritative: ${String(reason)}`));
  }, [canary, laptopRoot, lastArtifactSyncRevision]);
  useEffect(() => { onActive(Boolean(active)); }, [active, onActive]);
  useEffect(() => {
    if (!activeSessionId || activeStatus === 'INTERRUPTED') return;
    void window.proya.autoH3.updateCurrentBrief(brief).catch(() => undefined);
  }, [activeSessionId, activeStatus, brief]);
  useEffect(() => {
    if (!canary?.sessionId || ['CANARY_FINISHED', 'TWO_JOB_CANARY_FINISHED', 'STOPPED', 'FAILED'].includes(canary.sessionStatus)) return;
    const timer = window.setInterval(() => { void window.proya.autoH3.canaryStatus(canary.sessionId).then(value => setCanary(previous => value.connection === 'disconnected' && previous ? { ...previous, connection: 'disconnected', message: value.message, lastAuthoritativeUpdate: previous.lastAuthoritativeUpdate } : value)); }, 2000);
    return () => window.clearInterval(timer);
  }, [canary?.sessionId, canary?.sessionStatus]);
  useEffect(() => {
    if (!canary?.sessionId || !['PRODUCTION_STARTING', 'PRODUCTION_RUNNING', 'STOPPING'].includes(canary.sessionStatus)) return;
    const timer = window.setTimeout(() => { void window.proya.autoH3.updateChinaSettings(canary.sessionId, brief).catch(reason => setError(`Settings update was not committed to China: ${String(reason)}`)); }, 500);
    return () => window.clearTimeout(timer);
  }, [brief, canary?.sessionId, canary?.sessionStatus]);
  useEffect(() => {
    let alive = true;
    let timer: number | null = null;
    let consecutiveFailures = 0;
    const refresh = async () => {
      let nextStatus: ChinaProductionReadinessStatus;
      try {
        const value = await window.proya.autoH3.canaryReadiness();
        if (!alive) return;
        setCanaryReadiness(value); setReadinessError('');
        consecutiveFailures = 0; nextStatus = chinaProductionReadinessAfterSuccess(value); setReadinessStatus(nextStatus);
      } catch (reason) {
        if (!alive) return;
        consecutiveFailures++; setReadinessError(String(reason)); nextStatus = chinaProductionReadinessAfterFailure(); setReadinessStatus(nextStatus);
      }
      timer = window.setTimeout(() => void refresh(), chinaProductionReadinessRetryMs(nextStatus, consecutiveFailures));
    };
    void refresh();
    return () => { alive = false; if (timer !== null) window.clearTimeout(timer); };
  }, []);
  const run = async (action: () => Promise<AutoH3Snapshot>) => {
    setBusy(true); setError('');
    try { setSnapshot(await action()); } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };
  const shadowConfig = () => ({ selectedProducts, selectedContentTypes, shuffleProducts, shuffleContentTypes, chinaRoot, laptopRoot, brief });
  const stageShadow = async (stageUpdated = false) => {
    setBusy(true); setError(''); setShadowReport(null);
    try { setShadowReport(await window.proya.autoH3.stageShadow(shadowConfig(), stageUpdated)); setShadowDraft(null); setCanaryReadiness(await window.proya.autoH3.canaryReadiness()); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };
  const newShadowSession = async () => {
    setBusy(true); setError(''); setShadowReport(null);
    try { setShadowDraft(await window.proya.autoH3.newShadowSession(shadowConfig())); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };
  const startCanary = async () => {
    const identity = canaryReadiness?.session ?? (shadowReport ? { sessionId: shadowReport.bundleId, bundleHash: shadowReport.bundleSha256 } : null);
    if (!identity) return;
    setBusy(true); setError('');
    try { setCanary(await window.proya.autoH3.startCanary(identity.sessionId, identity.bundleHash)); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };
  const startTwoJobCanary = async () => {
    const identity = canaryReadiness?.session ?? (shadowReport ? { sessionId: shadowReport.bundleId, bundleHash: shadowReport.bundleSha256 } : null);
    if (!identity) return;
    setBusy(true); setError('');
    try { setCanary(await window.proya.autoH3.startTwoJobCanary(identity.sessionId, identity.bundleHash)); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };
  const startProduction = async () => {
    setBusy(true); setStartPreflighting(true); setError('');
    try { setCanary(await window.proya.autoH3.startChinaAutoRun(shadowConfig())); }
    catch (reason) { setReadinessStatus(chinaProductionReadinessAfterStartFailure(reason)); setReadinessError(String(reason)); setError(String(reason)); }
    finally { setStartPreflighting(false); setBusy(false); }
  };
  const canaryButtonVisible = canaryReadiness?.runner.mode === 'canary'
    && canaryReadiness.runner.generationEnabled === true
    && canaryReadiness.runner.canaryStartEnabled === true
    && canaryReadiness.runner.maxJobsPerSession === 1
    && canaryReadiness.proxyStartEndpointAvailable === true
    && canaryReadiness.stagedReady === true
    && canaryReadiness.session?.status === 'STAGED';
  const twoJobCanaryButtonVisible = canaryReadiness?.runner.mode === 'two-job-canary'
    && canaryReadiness.runner.generationEnabled === true
    && canaryReadiness.runner.canaryStartEnabled === true
    && canaryReadiness.runner.maxJobsPerSession === 2
    && canaryReadiness.proxyStartEndpointAvailable === true
    && canaryReadiness.healthReady === true
    && canaryReadiness.stagedReady === true
    && canaryReadiness.session?.status === 'STAGED'
    && canaryReadiness.session.plannedJobs.length === 2;
  const stopCanary = async (immediately: boolean) => {
    if (!canary?.sessionId) return;
    setBusy(true); setError('');
    try { setCanary(await (immediately ? window.proya.autoH3.stopCanaryNow(canary.sessionId) : window.proya.autoH3.stopCanaryAfterCurrent(canary.sessionId))); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };
  const downloadCanary = async () => {
    if (!canary?.jobId) return;
    setBusy(true); setError('');
    try { const result = await window.proya.autoH3.downloadCanaryArtifact(canary.sessionId, canary.jobId, laptopRoot); setCanaryDownload(`${result.path} (${result.size} bytes, SHA-256 verified)`); }
    catch (reason) { setError(`Artifact download failed; China job remains authoritative: ${String(reason)}`); }
    finally { setBusy(false); }
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
        <p className="h3-help">{startPreflighting ? 'Connecting to China production runner...' : readinessStatus === 'READY' ? 'China Production Runner: READY' : readinessStatus === 'TEMPORARILY_UNREACHABLE' ? 'China connection temporarily unavailable — retrying' : readinessStatus === 'INCOMPATIBLE' ? 'China Production Runner: INCOMPATIBLE' : 'Checking China Production Runner…'}</p>
        <button className="h3-generate-button" type="button" disabled={busy || !selectedProducts.length || !selectedContentTypes.length || readinessStatus === 'INCOMPATIBLE'} onClick={() => void startProduction()}>START CHINA AUTO RUN</button>
        {readinessStatus === 'INCOMPATIBLE' && <p className="h3-help">The live runner does not advertise the required production mode, generation capability, unlimited scheduler, and healthy state.</p>}
        {readinessStatus === 'TEMPORARILY_UNREACHABLE' && readinessError && <p className="h3-help">{readinessError}</p>}
        {canary && <div className="auto-status" aria-live="polite">
          <h3>AUTO RUN — {canary.sessionStatus}</h3>
          <dl>
            <dt>China</dt><dd>{canary.connection === 'connected' ? 'Connected' : 'Remote Disconnected'}</dd>
            <dt>Run</dt><dd>{['STOPPED', 'FAILED'].includes(canary.sessionStatus) ? 'Stopped' : 'Running'}</dd>
            <dt>Current Product</dt><dd>{canary.currentProduct ?? '—'}</dd><dt>Current Content Type</dt><dd>{canary.currentContentType ?? '—'}</dd>
            <dt>Current Job</dt><dd>{canary.jobId ?? 'Preparing on China'}</dd><dt>Current Phase</dt><dd>{canary.jobPhase ?? 'PREPARING'}</dd>
            <dt>Completed</dt><dd>{canary.completedCount}</dd><dt>Failed</dt><dd>{canary.failedCount}</dd><dt>Current Cycle</dt><dd>{canary.currentCycle}</dd>
            <dt>Last Archive</dt><dd>{canary.archivePath ?? '—'}</dd><dt>VRAM Ready</dt><dd>{canary.vramVerified ? 'YES' : 'PENDING / NOT REQUIRED'}</dd>
          </dl>
          {canary.message && <p>{canary.message}</p>}
          {['PRODUCTION_STARTING', 'PRODUCTION_RUNNING', 'STOPPING'].includes(canary.sessionStatus) && <p><button type="button" disabled={busy} onClick={() => void stopCanary(false)}>STOP AFTER CURRENT</button> <button type="button" disabled={busy} onClick={() => void stopCanary(true)}>STOP NOW</button></p>}
        </div>}
        <details className="auto-advanced"><summary>Advanced / development</summary>
          <h4>Legacy laptop-owned Auto Generation</h4>
          <p>Rollback/development only. This path is not used by START CHINA AUTO RUN.</p>
          <button type="button" disabled={busy || !selectedProducts.length || !selectedContentTypes.length} onClick={() => void run(() => window.proya.autoH3.start({ selectedProducts, selectedContentTypes, shuffleProducts, shuffleContentTypes, chinaRoot, laptopRoot, brief }))}>Legacy Start Auto Generation</button>
          <h4>Phase 3A — staging</h4>
          <p>Phase 3A staging transfers configuration and verified masters only. It never starts generation.</p>
          <button type="button" disabled={busy || !selectedProducts.length || !selectedContentTypes.length} onClick={() => void stageShadow()}>Stage Session to China (Shadow)</button>
          <button type="button" disabled={busy || !selectedProducts.length || !selectedContentTypes.length} onClick={() => void stageShadow(true)}>Stage Updated Session</button>
          <button type="button" disabled={busy || !selectedProducts.length || !selectedContentTypes.length} onClick={() => void newShadowSession()}>New Session</button>
          {shadowDraft && <p>New local draft prepared: {shadowDraft.sessionId}<br />Bundle SHA-256: {shadowDraft.bundleSha256}<br />State: {shadowDraft.stagingState}</p>}
          <h4>Phase 3B — 1-job autonomous canary</h4>
          <p>This control starts only the China-owned canary runner. It does not use laptop Auto Generation.</p>
          {canaryButtonVisible && canaryReadiness?.session && <div className="auto-status">
            <dl><dt>Session</dt><dd>{canaryReadiness.session.sessionId}</dd><dt>Runner</dt><dd>CANARY</dd><dt>Maximum jobs</dt><dd>{canaryReadiness.runner.maxJobsPerSession}</dd></dl>
            <button type="button" disabled={busy || canary?.sessionStatus === 'CANARY_RUNNING' || canary?.sessionStatus === 'CANARY_STARTING'} onClick={() => void startCanary()}>Start 1-Job China Canary</button>
          </div>}
          <h4>Phase 3C — 2-job autonomous canary</h4>
          <p>One Start acknowledgement transfers both job lifecycle decisions to the China runner. Laptop or Cloudflare visibility is not required between jobs.</p>
          {twoJobCanaryButtonVisible && canaryReadiness?.session && <div className="auto-status">
            <dl>
              <dt>Session</dt><dd>{canaryReadiness.session.sessionId}</dd>
              <dt>Runner mode</dt><dd>TWO-JOB-CANARY</dd>
              <dt>Maximum jobs</dt><dd>2</dd>
              <dt>Planned Job 1</dt><dd>{canaryReadiness.session.plannedJobs[0].product} / {canaryReadiness.session.plannedJobs[0].contentType}</dd>
              <dt>Planned Job 2</dt><dd>{canaryReadiness.session.plannedJobs[1].product} / {canaryReadiness.session.plannedJobs[1].contentType}</dd>
            </dl>
            <button type="button" disabled={busy} onClick={() => void startTwoJobCanary()}>Start 2-Job China Canary</button>
          </div>}
          {canary && <dl>
            <dt>Canary connection</dt><dd>{canary.connection === 'connected' ? 'CONNECTED' : 'REMOTE DISCONNECTED'}</dd>
            <dt>China session</dt><dd>{canary.sessionId}</dd><dt>Authoritative session status</dt><dd>{canary.sessionStatus}</dd>
            <dt>Job</dt><dd>{canary.jobId ?? 'Preparing locally on China'}</dd><dt>Job phase</dt><dd>{canary.jobPhase ?? '—'}</dd>
            <dt>Prompt ID</dt><dd>{canary.promptId ?? '—'}</dd><dt>Archive</dt><dd>{canary.archivePath ?? '—'}</dd>
            <dt>Archive SHA-256</dt><dd>{canary.archiveSha256 ?? '—'}</dd><dt>Local VRAM verified</dt><dd>{canary.vramVerified ? 'YES' : 'NO'}</dd>
            <dt>Completed / Failed</dt><dd>{canary.completedCount} / {canary.failedCount}</dd><dt>Runner revision</dt><dd>{canary.revision}</dd>
            <dt>Last authoritative update</dt><dd>{canary.lastAuthoritativeUpdate ?? '—'}</dd>
          </dl>}
          {canary?.jobs.map((job, index) => <dl key={job.jobId}><dt>Job {index + 1}</dt><dd>{job.product} / {job.contentType}</dd><dt>Phase</dt><dd>{job.phase}</dd><dt>Prompt ID</dt><dd>{job.promptId ?? '—'}</dd><dt>Archive</dt><dd>{job.archivePath ?? '—'}</dd><dt>VRAM verified</dt><dd>{job.vramVerified ? 'YES' : 'NO'}</dd></dl>)}
          {canary?.message && <p>{canary.message}</p>}
          {canary && ['CANARY_STARTING', 'CANARY_RUNNING', 'TWO_JOB_CANARY_STARTING', 'TWO_JOB_CANARY_RUNNING', 'STOPPING'].includes(canary.sessionStatus) && <p><button type="button" disabled={busy} onClick={() => void stopCanary(false)}>Stop After Current</button> <button type="button" disabled={busy} onClick={() => void stopCanary(true)}>Stop Now</button></p>}
          {canary?.jobPhase === 'COMPLETED' && <button type="button" disabled={busy} onClick={() => void downloadCanary()}>Download Verified China Canary MP4</button>}
          {canaryDownload && <p>Laptop copy: {canaryDownload}</p>}
          {shadowReport && <dl>
            <dt>Runner connection</dt><dd>{shadowReport.runnerConnection}</dd><dt>Runner version</dt><dd>{shadowReport.runnerVersion}</dd>
            <dt>Bundle ID</dt><dd>{shadowReport.bundleId}</dd><dt>Bundle SHA-256</dt><dd>{shadowReport.bundleSha256}</dd>
            <dt>Selected products</dt><dd>{shadowReport.selectedProducts.join(', ')}</dd><dt>Selected content types</dt><dd>{shadowReport.selectedContentTypes.join(', ')}</dd>
            <dt>Settings version</dt><dd>{shadowReport.settingsVersion}</dd><dt>Assets staged / expected</dt><dd>{shadowReport.assetsStaged} / {shadowReport.assetsExpected}</dd>
            <dt>Workflow hash</dt><dd>{shadowReport.workflowSha256}</dd><dt>System prompt hash</dt><dd>{shadowReport.systemPromptSha256}</dd>
            <dt>Archive readiness</dt><dd>{shadowReport.archiveReady ? 'READY' : 'NOT READY'}</dd><dt>Comfy readiness</dt><dd>{shadowReport.comfyReady ? 'READY' : 'NOT READY'}</dd>
            <dt>Qwen readiness</dt><dd>{shadowReport.qwenReady ? 'READY' : 'NOT READY'}</dd><dt>Stage status</dt><dd>{shadowReport.stageStatus}</dd>
          </dl>}
        </details>
      </>}
      {session && <div className="auto-status" aria-live="polite">
        <h3>{session.status === 'INTERRUPTED' ? 'Previous Auto Run interrupted' : `AUTO GENERATION — ${session.status}`}</h3>
        <dl><dt>Cycle</dt><dd>{session.cycleNumber}</dd><dt>Current Product</dt><dd>{products.find(p => p.id === session.productOrder[session.productIndex])?.shortName} ({session.productIndex + 1} / {session.productOrder.length})</dd>
          <dt>Current Content</dt><dd>{session.contentTypeOrder[session.contentTypeIndex]} ({session.contentTypeIndex + 1} / {session.contentTypeOrder.length})</dd>
          <dt>Completed / Failed</dt><dd>{session.completedCount} / {session.failedCount}</dd><dt>Laptop downloads</dt><dd>{session.pendingLaptopDownloads} pending</dd>
          <dt>Current Stage</dt><dd>{autoH3CurrentStage(Boolean(active), session.lastError, current)}</dd>
          <dt>Remote</dt><dd>{autoH3ConnectionLost(session.lastError, current?.state?.connectionError) ? 'China connection lost — retrying in 5 seconds.' : 'Connected'}</dd>
          <dt>China Archive</dt><dd>{current?.chinaArchiveError ?? (current?.chinaArchiveSucceeded ? 'Ready' : 'Waiting for output')}</dd><dt>Laptop Output</dt><dd>{session.laptopRoot}</dd></dl>
        {session.lastError && <p className="h3-help">{session.lastError}</p>}
        {current?.state?.pipelineStage === 'RELEASING_H3_VRAM' && lifecycle?.chinaArchived && !lifecycle.outputCaptured && <p className="h3-help">China archive confirms the video completed. Finishing H3 VRAM cleanup.</p>}
        {current?.state?.pipelineStage === 'RELEASING_H3_VRAM' && lifecycle?.outputCaptured && <p className="h3-help">Video output was recovered. Finishing GPU cleanup before the next job.</p>}
        {lifecycle && <details className="auto-advanced"><summary>H3 lifecycle diagnostics</summary><dl><dt>Previous job</dt><dd>{lifecycle.previousJobId ?? '—'}</dd><dt>Previous prompt</dt><dd>{lifecycle.previousPromptId ?? '—'}</dd><dt>H3 submitted</dt><dd>{String(lifecycle.h3WasSubmitted)}</dd><dt>Remote lifecycle</dt><dd>{lifecycle.remoteLifecycleState ?? '—'}</dd><dt>Orphan checks</dt><dd>{lifecycle.orphanReconciliationAttempts ?? 0}</dd><dt>Remote queue</dt><dd>{lifecycle.remoteQueueState}</dd><dt>History</dt><dd>{lifecycle.historyState}</dd><dt>Output captured</dt><dd>{String(lifecycle.outputCaptured)}</dd><dt>China archived</dt><dd>{String(lifecycle.chinaArchived)}</dd><dt>VRAM release requested</dt><dd>{lifecycle.vramReleaseRequested === null ? '—' : String(lifecycle.vramReleaseRequested)}</dd><dt>VRAM release succeeded</dt><dd>{lifecycle.vramReleaseSucceeded === null ? '—' : String(lifecycle.vramReleaseSucceeded)}</dd></dl><p>{lifecycle.reasonForBlocking ?? 'No lifecycle prerequisite is currently blocking the handoff.'}</p></details>}
        {lifecycle && <details className="auto-advanced"><summary>Live lifecycle decision</summary><dl>
          <dt>Queue sample</dt><dd>{lifecycle.remoteQueueState.replace('queue_', '').toUpperCase()}</dd>
          <dt>Queue sample timestamp</dt><dd>{lifecycle.queueSampleTimestamp ?? '—'}</dd>
          <dt>Queue request URL</dt><dd>{lifecycle.queueRequestUrl ?? '—'}</dd>
          <dt>Queue freshness</dt><dd>{lifecycle.queueFreshness ?? 'UNAVAILABLE'}</dd>
          <dt>History sample</dt><dd>{lifecycle.historyState.toUpperCase()}</dd>
          <dt>History sample timestamp</dt><dd>{lifecycle.historySampleTimestamp ?? '—'}</dd>
          <dt>History request URL</dt><dd>{lifecycle.historyRequestUrl ?? '—'}</dd>
          <dt>History freshness</dt><dd>{lifecycle.historyFreshness ?? 'UNAVAILABLE'}</dd>
          <dt>Completion evidence</dt><dd>{lifecycle.completionEvidence ?? 'NONE'}</dd>
          <dt>Classifier</dt><dd>{lifecycle.classifierResult ?? '—'}</dd>
          <dt>Classifier timestamp</dt><dd>{lifecycle.classifierTimestamp ?? '—'}</dd>
          <dt>Release authorization</dt><dd>{lifecycle.releaseAuthorized === null || lifecycle.releaseAuthorized === undefined ? '—' : lifecycle.releaseAuthorized ? 'YES' : 'NO'}</dd>
          <dt>/free attempted</dt><dd>{current?.state?.h3VramReleaseRequested ? 'YES' : 'NO'}</dd>
        </dl></details>}
        {session.status === 'INTERRUPTED' && <><button disabled={busy} onClick={() => void run(() => window.proya.autoH3.resume(session.sessionId, brief))}>RESUME</button><button disabled={busy} onClick={() => void run(() => window.proya.autoH3.stop(session.sessionId, true))}>STOP SESSION</button></>}
        {active && session.status !== 'INTERRUPTED' && <button disabled={busy || session.stopRequested} onClick={() => void run(() => window.proya.autoH3.stop(session.sessionId))}>{session.stopRequested ? 'Stopping after current…' : 'STOP AFTER CURRENT'}</button>}
        <details className="auto-advanced"><summary>Advanced / development</summary>
          <dl>
            <dt>RUNNING EXECUTABLE</dt><dd>{runtime?.runningExecutable ?? 'Unavailable'}</dd>
            <dt>BUILD TIMESTAMP</dt><dd>{runtime?.buildTimestamp ?? 'Unavailable'}</dd>
            <dt>APP VERSION / BUILD ID</dt><dd>{runtime ? `${runtime.appVersion} / ${runtime.buildId}` : 'Unavailable'}</dd>
            <dt>APP.ASAR SHA-256</dt><dd>{runtime?.appAsarSha256 ?? 'Unavailable'}</dd>
            <dt>USER DATA DIRECTORY</dt><dd>{runtime?.userDataDirectory ?? 'Unavailable'}</dd>
            <dt>ACTIVE DATABASE PATH</dt><dd>{runtime?.activeDatabasePath ?? 'Unavailable'}</dd>
            <dt>DATABASE SCHEMA VERSION</dt><dd>{runtime?.databaseSchemaVersion ?? 'Unavailable'}</dd>
            <dt>LIFECYCLE SCHEMA / VERSION</dt><dd>{runtime?.lifecycleSchemaVersion ?? 'Unavailable'}</dd>
            <dt>CURRENT AUTO SESSION ID</dt><dd>{runtime?.currentAutoSessionId ?? '—'}</dd>
            <dt>CURRENT AUTO JOB ID</dt><dd>{runtime?.currentAutoJobId ?? '—'}</dd>
            <dt>CURRENT COMPUTE JOB ID</dt><dd>{runtime?.currentComputeJobId ?? '—'}</dd>
            <dt>CURRENT COMFY PROMPT ID</dt><dd>{runtime?.currentComfyPromptId ?? '—'}</dd>
          </dl>
          {active && <><p>Interrupts this session’s active ComfyUI job. Pending downloads continue.</p><button className="error-note" disabled={busy} onClick={() => void run(() => window.proya.autoH3.stop(session.sessionId, true))}>STOP NOW</button></>}
        </details>
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
