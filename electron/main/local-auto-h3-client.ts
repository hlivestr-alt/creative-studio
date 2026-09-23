import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { CanaryStartResult, LocalSessionBundle, PersistedJob, PersistedSession, RunnerCapabilities, SessionSettings, StageResult } from '../../src/local-runner/types';

export class LocalRunnerTransportError extends Error {}

type FetchLike = typeof fetch;

export class LocalAutoH3Client {
  constructor(private runnerBaseUrl: string, private fetcher: FetchLike = fetch, private timeoutMs = 20_000) {}

  private endpoint(path: string): string {
    return new URL(`/proya/auto/${path.replace(/^\/+/, '')}`, this.runnerBaseUrl).toString();
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, sessionAbsenceIsNormal = false): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const url = this.endpoint(path);
    const requestPath = new URL(url).pathname + new URL(url).search;
    try {
      const headers: Record<string, string> = method === 'GET'
        ? { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
        : { 'Content-Type': 'application/json' };
      const response = await this.fetcher(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, cache: method === 'GET' ? 'no-store' : undefined });
      const responseText = await response.text();
      let payload: Record<string, unknown> = {};
      try { payload = responseText ? JSON.parse(responseText) as Record<string, unknown> : {}; }
      catch { /* Preserve the exact non-JSON response in the diagnostic below. */ }
      if (!response.ok) {
        if (sessionAbsenceIsNormal && response.status === 404 && payload.session === null && !('error' in payload)) return payload as T;
        const responseBody = responseText || String(payload.error ?? response.statusText) || '<empty>';
        const status = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
        throw new Error(`${method} ${requestPath} -> ${status}; body: ${responseBody}`);
      }
      return payload as T;
    } catch (reason) {
      if (reason instanceof Error && reason.message.startsWith(`${method} ${requestPath} -> HTTP `)) throw reason;
      throw new LocalRunnerTransportError(`Runner unavailable: ${method} ${requestPath} -> NETWORK_ERROR; body: n/a; ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally { clearTimeout(timer); }
  }

  private liveReadPath(path: string): string { return `${path}?readiness=${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  capabilities(): Promise<RunnerCapabilities> { return this.request('GET', this.liveReadPath('capabilities')); }
  health(): Promise<Record<string, unknown>> { return this.request('GET', this.liveReadPath('health')); }
  version(): Promise<{ version: string; mode: 'shadow' | 'canary' | 'two-job-canary' | 'production' }> { return this.request('GET', this.liveReadPath('version')); }
  currentSession(): Promise<{ session: PersistedSession | null }> {
    // Keep mutable reads unique so every status decision uses authoritative state.
    return this.request('GET', `session/current?readiness=${Date.now()}`);
  }
  session(id: string): Promise<{ session: PersistedSession | null; persistence?: { assetRecordCount: number; settingsVersions: number[] } | null }> {
    return this.request('GET', `session/${encodeURIComponent(id)}?readiness=${Date.now()}-${Math.random().toString(36).slice(2)}`, undefined, true);
  }
  jobs(sessionId?: string, afterRevision = 0): Promise<{ jobs: PersistedJob[] }> {
    const query = new URLSearchParams({ afterRevision: String(afterRevision) });
    if (sessionId) query.set('sessionId', sessionId);
    return this.request('GET', `jobs?${query}`);
  }

  stageSession(bundle: LocalSessionBundle): Promise<StageResult> { return this.request('POST', 'stage', bundle); }

  startCanary(sessionId: string, bundleHash: string): Promise<CanaryStartResult> { return this.request('POST', 'start', { sessionId, bundleHash }); }
  updateSettings(sessionId: string, version: number, settings: SessionSettings): Promise<{ session: PersistedSession }> { return this.request('POST', `session/${encodeURIComponent(sessionId)}/settings`, { version, settings }); }
  acknowledgeLocalOutputSync(jobId: string, path: string): Promise<{ job: PersistedJob }> { return this.request('POST', `jobs/${encodeURIComponent(jobId)}/laptop-synced`, { path }); }
  stopAfterCurrent(sessionId: string): Promise<{ session: PersistedSession }> { return this.request('POST', `session/${encodeURIComponent(sessionId)}/stop-after-current`); }
  stopNow(sessionId: string): Promise<{ session: PersistedSession }> { return this.request('POST', `session/${encodeURIComponent(sessionId)}/stop-now`); }

  async downloadArtifact(jobId: string, expectedSha256: string, destinationRoot: string): Promise<{ path: string; size: number; sha256: string }> {
    if (!/^[A-Za-z0-9_-]{1,220}$/.test(jobId) || !/^[0-9a-f]{64}$/.test(expectedSha256) || !isAbsolute(destinationRoot)) throw new Error('Invalid canary artifact download identity or destination.');
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), Math.max(this.timeoutMs, 180_000));
    try {
      const response = await this.fetcher(this.endpoint(`jobs/${jobId}/artifact`), { signal: controller.signal, headers: { Accept: 'video/mp4' } });
      if (!response.ok) throw new Error(`Local archive endpoint returned HTTP ${response.status}.`);
      const declared = response.headers.get('x-proya-sha256')?.toLowerCase();
      if (declared !== expectedSha256) throw new Error('Local archive response SHA-256 does not match authoritative job state.');
      const bytes = Buffer.from(await response.arrayBuffer()); const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== expectedSha256) throw new Error('Local archive file failed SHA-256 verification.');
      mkdirSync(destinationRoot, { recursive: true }); const target = join(destinationRoot, `${jobId}.mp4`); const temporary = `${target}.partial`;
      writeFileSync(temporary, bytes, { flush: true }); renameSync(temporary, target);
      await this.acknowledgeLocalOutputSync(jobId, target);
      return { path: target, size: bytes.length, sha256: actual };
    } finally { clearTimeout(timer); }
  }
}
