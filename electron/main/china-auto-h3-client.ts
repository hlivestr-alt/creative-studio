import { isTransientTransport } from '../../src/domain/auto-h3';
import { createHash } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { CanaryStartResult, ChinaSessionBundle, PersistedJob, PersistedSession, RunnerCapabilities, SessionSettings, StageResult } from '../../src/china-runner/types';

export class ChinaRunnerTransportError extends Error {}

type FetchLike = typeof fetch;

export class ChinaAutoH3Client {
  constructor(private externalComfyUrl: string, private fetcher: FetchLike = fetch, private timeoutMs = 20_000) {}

  private endpoint(path: string): string {
    return new URL(`/proya/runner/${path.replace(/^\/+/, '')}`, this.externalComfyUrl).toString();
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = method === 'GET'
        ? { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }
        : { 'Content-Type': 'application/json' };
      const response = await this.fetcher(this.endpoint(path), { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal, cache: method === 'GET' ? 'no-store' : undefined });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) throw new Error(`China runner proxy returned HTTP ${response.status}: ${String(payload.error ?? response.statusText)}`);
      return payload as T;
    } catch (reason) {
      if (reason instanceof Error && reason.message.startsWith('China runner proxy returned')) throw reason;
      throw new ChinaRunnerTransportError(`China runner proxy disconnected or timed out: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally { clearTimeout(timer); }
  }

  private liveReadPath(path: string): string { return `${path}?readiness=${Date.now()}-${Math.random().toString(36).slice(2)}`; }
  capabilities(): Promise<RunnerCapabilities> { return this.request('GET', this.liveReadPath('capabilities')); }
  health(): Promise<Record<string, unknown>> { return this.request('GET', this.liveReadPath('health')); }
  version(): Promise<{ version: string; mode: 'shadow' | 'canary' | 'two-job-canary' | 'production' }> { return this.request('GET', this.liveReadPath('version')); }
  currentSession(): Promise<{ session: PersistedSession | null }> {
    // The external edge cached an earlier null response for this mutable resource.
    // A unique query keeps discovery authoritative without changing the runner API.
    return this.request('GET', `session/current?readiness=${Date.now()}`);
  }
  session(id: string): Promise<{ session: PersistedSession | null; persistence?: { assetRecordCount: number; settingsVersions: number[] } | null }> { return this.request('GET', `session/${encodeURIComponent(id)}`); }
  jobs(sessionId?: string, afterRevision = 0): Promise<{ jobs: PersistedJob[] }> {
    const query = new URLSearchParams({ afterRevision: String(afterRevision) });
    if (sessionId) query.set('sessionId', sessionId);
    return this.request('GET', `jobs?${query}`);
  }

  async stageSession(bundle: ChinaSessionBundle): Promise<StageResult> {
    try { return await this.request('POST', 'stage', bundle); }
    catch (reason) {
      if (!isTransientTransport(reason)) throw reason;
      try {
        const persisted = (await this.session(bundle.sessionId)).session;
        if (persisted?.bundleHash === bundle.bundleSha256) return { staged: true, sessionId: persisted.sessionId, revision: persisted.revision, bundleHash: persisted.bundleHash, sessionDirectory: persisted.sessionDirectory, mode: 'shadow' };
      } catch { /* Keep the original ambiguous transport result. */ }
      throw reason;
    }
  }

  startCanary(sessionId: string, bundleHash: string): Promise<CanaryStartResult> { return this.request('POST', 'start', { sessionId, bundleHash }); }
  updateSettings(sessionId: string, version: number, settings: SessionSettings): Promise<{ session: PersistedSession }> { return this.request('POST', `session/${encodeURIComponent(sessionId)}/settings`, { version, settings }); }
  acknowledgeLaptopSync(jobId: string, path: string): Promise<{ job: PersistedJob }> { return this.request('POST', `jobs/${encodeURIComponent(jobId)}/laptop-synced`, { path }); }
  stopAfterCurrent(sessionId: string): Promise<{ session: PersistedSession }> { return this.request('POST', `session/${encodeURIComponent(sessionId)}/stop-after-current`); }
  stopNow(sessionId: string): Promise<{ session: PersistedSession }> { return this.request('POST', `session/${encodeURIComponent(sessionId)}/stop-now`); }

  async downloadArtifact(jobId: string, expectedSha256: string, destinationRoot: string): Promise<{ path: string; size: number; sha256: string }> {
    if (!/^[A-Za-z0-9_-]{1,220}$/.test(jobId) || !/^[0-9a-f]{64}$/.test(expectedSha256) || !isAbsolute(destinationRoot)) throw new Error('Invalid canary artifact download identity or destination.');
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), Math.max(this.timeoutMs, 180_000));
    try {
      const response = await this.fetcher(this.endpoint(`jobs/${jobId}/artifact`), { signal: controller.signal, headers: { Accept: 'video/mp4' } });
      if (!response.ok) throw new Error(`China artifact endpoint returned HTTP ${response.status}.`);
      const declared = response.headers.get('x-proya-sha256')?.toLowerCase();
      if (declared !== expectedSha256) throw new Error('China artifact response SHA-256 does not match authoritative job state.');
      const bytes = Buffer.from(await response.arrayBuffer()); const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== expectedSha256) throw new Error('Downloaded China artifact failed SHA-256 verification.');
      mkdirSync(destinationRoot, { recursive: true }); const target = join(destinationRoot, `${jobId}.mp4`); const temporary = `${target}.partial`;
      writeFileSync(temporary, bytes, { flush: true }); renameSync(temporary, target);
      await this.acknowledgeLaptopSync(jobId, target);
      return { path: target, size: bytes.length, sha256: actual };
    } finally { clearTimeout(timer); }
  }
}
