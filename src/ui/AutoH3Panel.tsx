import { useEffect, useState } from 'react';
import { defaultArchiveRoot, type AutoH3Snapshot, type LocalRunnerObserver, type LocalRunnerReadiness } from '../domain/auto-h3';
import { products } from '../domain/data';
import { h3ContentTypeOptions } from '../domain/h3';
import type { LocalServiceState, LocalServicesStatus } from '../domain/local-services';
import type { H3VideoBrief } from '../domain/types';

export function autoH3ConnectionLost(sessionError: string | null, jobError?: string | null): boolean {
  return Boolean(jobError || /connection|network|fetch|socket|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|timed?\s*out|timeout|\b5\d{2}\b/i.test(sessionError ?? ''));
}

export function autoH3CurrentStage(active: boolean, sessionError: string | null, job?: AutoH3Snapshot['jobs'][number]): string {
  if (!active) return 'STOPPED';
  if (autoH3ConnectionLost(sessionError, job?.state?.connectionError)) return 'WAITING FOR LOCAL ENGINE';
  if (job?.state?.h3LifecycleDiagnostics?.remoteLifecycleState === 'ORPHANED_REMOTE_PROMPT') return 'RECONCILING LOCAL JOB';
  if (job?.state?.pipelineStage === 'RELEASING_H3_VRAM') return 'RELEASING H3 VRAM';
  return job?.state?.pipelineStage?.replaceAll('REMOTE', 'LOCAL') ?? 'PREPARING';
}

export function autoH3ReconnectSessionId(readiness: LocalRunnerReadiness | null, observer: LocalRunnerObserver | null): string | null {
  const session = readiness?.session;
  if (!session || session.status === 'STAGED' || observer?.sessionId === session.sessionId) return null;
  return session.sessionId;
}

export function localGenerationRunnerReady(readiness: LocalRunnerReadiness | null): boolean {
  return readiness?.runner.mode === 'production'
    && readiness.runner.generationEnabled === true
    && readiness.runner.maxJobsPerSession === null
    && readiness.healthReady === true;
}

export type LocalGenerationReadinessStatus = 'CHECKING' | 'READY' | 'UNAVAILABLE' | 'INCOMPATIBLE';

export function localGenerationReadinessAfterSuccess(readiness: LocalRunnerReadiness): LocalGenerationReadinessStatus {
  return localGenerationRunnerReady(readiness) ? 'READY' : 'INCOMPATIBLE';
}

export function localGenerationReadinessAfterFailure(): LocalGenerationReadinessStatus { return 'UNAVAILABLE'; }

export function localGenerationReadinessAfterStartFailure(reason: unknown): LocalGenerationReadinessStatus {
  return String(reason).includes('INCOMPATIBLE_PRODUCTION_RUNNER') ? 'INCOMPATIBLE' : 'UNAVAILABLE';
}

export function localGenerationStartError(reason: unknown): string {
  const raw = reason instanceof Error ? reason.message : String(reason);
  const message = raw.replace(/^Error invoking remote method '[^']+':\s*/i, '').trim();
  return localRuntimeMessage(message || 'Production Start failed without an error response.');
}

export function localGenerationReadinessRetryMs(status?: LocalGenerationReadinessStatus, consecutiveFailures = 1): number {
  void status;
  void consecutiveFailures;
  return 2_000;
}

export function localGenerationRunLabel(status: LocalRunnerObserver['sessionStatus']): 'Running' | 'Starting' | 'Stopping' | 'Stopped' | 'Ready to start' | 'Unknown' {
  if (status === 'PRODUCTION_RUNNING') return 'Running';
  if (status === 'PRODUCTION_STARTING') return 'Starting';
  if (status === 'STOPPING') return 'Stopping';
  if (status === 'STOPPED' || status === 'FAILED' || status === 'CANARY_FINISHED' || status === 'TWO_JOB_CANARY_FINISHED') return 'Stopped';
  if (status === 'STAGED') return 'Ready to start';
  return 'Unknown';
}

export function localRuntimeMessage(value: string): string {
  return value
    .replace(/China\s+execution\s+PC/gi, 'Local Engine')
    .replace(/China\s+PC/gi, 'Local Engine')
    .replace(/China\s+Auto\s+Run/gi, 'Auto Run')
    .replace(/China/gi, 'local')
    .replace(/Cloudflare/gi, 'network')
    .replace(/remote/gi, 'local');
}

function OrderedSelection<T extends string>({ title, values, selected, labels, onChange, disabled }: { title: string; values: readonly T[]; selected: T[]; labels?: Record<string, string>; onChange: (values: T[]) => void; disabled: boolean }) {
  const ordered = [...selected, ...values.filter(value => !selected.includes(value))];
  const move = (value: T, offset: number) => {
    const result = [...selected];
    const index = result.indexOf(value);
    [result[index], result[index + offset]] = [result[index + offset], result[index]];
    onChange(result);
  };
  return <fieldset disabled={disabled}><legend>{title}</legend>{ordered.map(value => <div className="auto-selection-row" key={value}>
    <label><input type="checkbox" checked={selected.includes(value)} onChange={event => onChange(event.target.checked ? [...selected, value] : selected.filter(selectedValue => selectedValue !== value))} />{labels?.[value] ?? value}</label>
    <button type="button" aria-label={`Move ${labels?.[value] ?? value} up`} disabled={selected.indexOf(value) <= 0} onClick={() => move(value, -1)}>↑</button>
    <button type="button" aria-label={`Move ${labels?.[value] ?? value} down`} disabled={!selected.includes(value) || selected.indexOf(value) === selected.length - 1} onClick={() => move(value, 1)}>↓</button>
  </div>)}</fieldset>;
}

function statusText(state: LocalServiceState | undefined, service: 'Runner' | 'ComfyUI' | 'LM Studio'): string {
  if (!state) return 'Checking...';
  if (state.phase === 'ready') return 'Ready';
  if (state.phase === 'starting') return `${service} starting...`;
  if (service === 'LM Studio') return 'LM Studio unavailable';
  return localRuntimeMessage(state.message || `${service} unavailable`);
}

export function AutoH3Panel({ brief, onActive, onModeChange }: { brief: H3VideoBrief; onActive: (active: boolean) => void; onModeChange?: (auto: boolean) => void }) {
  const [mode, setMode] = useState('single');
  const [selectedProducts, setProducts] = useState(products.map(product => product.id));
  const [selectedContentTypes, setContentTypes] = useState([...h3ContentTypeOptions]);
  const [shuffleProducts, setShuffleProducts] = useState(false);
  const [shuffleContentTypes, setShuffleContentTypes] = useState(false);
  const [services, setServices] = useState<LocalServicesStatus | null>(null);
  const [readiness, setReadiness] = useState<LocalRunnerReadiness | null>(null);
  const [readinessStatus, setReadinessStatus] = useState<LocalGenerationReadinessStatus>('CHECKING');
  const [canary, setCanary] = useState<LocalRunnerObserver | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [startPreflighting, setStartPreflighting] = useState(false);
  const running = Boolean(canary && ['PRODUCTION_STARTING', 'PRODUCTION_RUNNING', 'STOPPING'].includes(canary.sessionStatus));
  const localReady = services?.overallReady === true && readinessStatus === 'READY';

  useEffect(() => { onActive(running); }, [running, onActive]);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const local = await window.proya.localServices.status();
        if (!alive) return;
        setServices(local);
        if (local.overallReady) {
          try {
            const nextReadiness = await window.proya.autoH3.canaryReadiness();
            if (!alive) return;
            setReadiness(nextReadiness);
            setReadinessStatus(localGenerationReadinessAfterSuccess(nextReadiness));
          } catch {
            if (alive) setReadinessStatus('UNAVAILABLE');
          }
        } else {
          setReadinessStatus('CHECKING');
        }
      } catch {
        if (alive) setReadinessStatus('UNAVAILABLE');
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  useEffect(() => {
    const sessionId = autoH3ReconnectSessionId(readiness, canary);
    if (!sessionId) return;
    void window.proya.autoH3.canaryStatus(sessionId).then(setCanary).catch(() => undefined);
  }, [readiness, canary]);

  useEffect(() => {
    if (!canary?.sessionId || !running) return;
    const timer = window.setInterval(() => {
      void window.proya.autoH3.canaryStatus(canary.sessionId).then(value => {
        setCanary(previous => value.connection === 'disconnected' && previous
          ? { ...previous, connection: 'disconnected', message: 'Local engine unavailable', lastAuthoritativeUpdate: previous.lastAuthoritativeUpdate }
          : value);
      });
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [canary?.sessionId, running]);

  useEffect(() => {
    if (!canary?.sessionId || !running) return;
    const timer = window.setTimeout(() => {
      void window.proya.autoH3.updateLocalSettings(canary.sessionId, brief).catch(reason => setError(localRuntimeMessage(String(reason))));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [brief, canary?.sessionId, running]);

  const config = () => ({
    selectedProducts,
    selectedContentTypes,
    shuffleProducts,
    shuffleContentTypes,
    chinaRoot: defaultArchiveRoot,
    laptopRoot: defaultArchiveRoot,
    brief
  });

  const startProduction = async () => {
    setBusy(true); setStartPreflighting(true); setError(''); setCanary(null);
    try {
      const observer = await window.proya.autoH3.startLocalAutoRun(config());
      if (!observer?.sessionId || !observer.sessionStatus) throw new Error('Start returned no authoritative session state.');
      setCanary(observer);
    } catch (reason) {
      const message = localGenerationStartError(reason);
      setReadinessStatus(localGenerationReadinessAfterStartFailure(reason));
      setError(message);
    } finally {
      setStartPreflighting(false); setBusy(false);
    }
  };

  const stop = async (immediately: boolean) => {
    if (!canary?.sessionId) return;
    setBusy(true); setError('');
    try { setCanary(await (immediately ? window.proya.autoH3.stopCanaryNow(canary.sessionId) : window.proya.autoH3.stopCanaryAfterCurrent(canary.sessionId))); }
    catch (reason) { setError(localRuntimeMessage(String(reason))); }
    finally { setBusy(false); }
  };

  return <section className="h3-section auto-h3-panel">
    <h2>Auto Generation</h2>
    <label className="h3-field">Mode<select aria-label="H3 generation mode" value={mode} onChange={event => { setMode(event.target.value); onModeChange?.(event.target.value === 'auto'); }}><option value="single">Single Video</option><option value="auto">Auto Run</option></select></label>
    {(mode === 'auto' || running || canary) && <>
      {!running && <>
        <div className="auto-selections"><OrderedSelection title="Products" values={products.map(product => product.id)} selected={selectedProducts} labels={Object.fromEntries(products.map(product => [product.id, product.shortName]))} onChange={setProducts} disabled={busy} />
          <OrderedSelection title="Content Types" values={h3ContentTypeOptions} selected={selectedContentTypes} onChange={setContentTypes} disabled={busy} /></div>
        <p>Creative Variety: <strong>{brief.creativeVariety ?? 'Balanced'}</strong> · Repeat: <strong>Forever</strong> · Duration: <strong>Random 8–15 sec</strong>. Product references are used only for content types that show the product.</p>
        <label className="auto-toggle"><input type="checkbox" checked={shuffleProducts} onChange={event => setShuffleProducts(event.target.checked)} /> Shuffle product order each cycle</label>
        <label className="auto-toggle"><input type="checkbox" checked={shuffleContentTypes} onChange={event => setShuffleContentTypes(event.target.checked)} /> Shuffle content-type order per product</label>
      </>}

      <div className="local-engine-panel" aria-live="polite">
        <h3>LOCAL ENGINE</h3>
        <dl>
          <dt>Runner</dt><dd>{statusText(services?.runner, 'Runner')}</dd>
          <dt>ComfyUI</dt><dd>{statusText(services?.comfy, 'ComfyUI')}</dd>
          <dt>LM Studio</dt><dd>{statusText(services?.lmStudio, 'LM Studio')}</dd>
          <dt>Overall</dt><dd>{localReady ? 'READY' : 'NOT READY'}</dd>
        </dl>
      </div>

      <p className="h3-help"><strong>Archive:</strong> D:\AI Videos</p>
      {!running && <button className="h3-generate-button" type="button" disabled={busy || !selectedProducts.length || !selectedContentTypes.length || !localReady} onClick={() => void startProduction()}>{startPreflighting ? 'STARTING...' : 'START AUTO RUN'}</button>}
      {error && <p className="error-note h3-error" role="alert">{error}</p>}
      {readinessStatus === 'INCOMPATIBLE' && <p className="h3-help">The local runner is not the required production build.</p>}

      {canary && <div className="auto-status" aria-live="polite">
        <h3>AUTO RUN — {canary.sessionStatus}</h3>
        <dl>
          <dt>Local Engine</dt><dd>{canary.connection === 'connected' ? 'Connected' : 'Unavailable'}</dd>
          <dt>Run</dt><dd>{localGenerationRunLabel(canary.sessionStatus)}</dd>
          <dt>Current Product</dt><dd>{canary.currentProduct ?? '—'}</dd>
          <dt>Current Content Type</dt><dd>{canary.currentContentType ?? '—'}</dd>
          <dt>Current Job</dt><dd>{canary.jobId ?? 'Preparing locally'}</dd>
          <dt>Current Phase</dt><dd>{localRuntimeMessage(canary.jobPhase ?? 'PREPARING')}</dd>
          <dt>Completed</dt><dd>{canary.completedCount}</dd>
          <dt>Failed</dt><dd>{canary.failedCount}</dd>
          <dt>Current Cycle</dt><dd>{canary.currentCycle}</dd>
          <dt>Archive</dt><dd>{canary.archivePath ?? 'D:\\AI Videos'}</dd>
          <dt>VRAM Ready</dt><dd>{canary.vramVerified ? 'YES' : 'PENDING / NOT REQUIRED'}</dd>
        </dl>
        {canary.message && <p>{localRuntimeMessage(canary.message)}</p>}
        {running && <p><button type="button" disabled={busy} onClick={() => void stop(false)}>STOP AFTER CURRENT</button> <button type="button" disabled={busy} onClick={() => void stop(true)}>STOP NOW</button></p>}
      </div>}
    </>}
  </section>;
}
