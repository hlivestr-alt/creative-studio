import { createHash } from 'node:crypto';
import { LOCAL_COMFY_URL, LOCAL_LM_STUDIO_URL, REQUIRED_QWEN_MODEL, type ReadinessProbe, type RunnerMode } from './types';

export interface RunnerFetchResponse<T = unknown> {
  value: T;
  status: number;
  url: string;
}

export type RunnerFetch = typeof fetch;

function exactLocalOrigin(value: string, expected: string): string {
  const url = new URL(value);
  if (url.origin !== expected || url.username || url.password) throw new Error(`Runner endpoint must be exactly ${expected}.`);
  return url.origin;
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}

export class LocalComfyClient {
  readonly baseUrl: string;

  constructor(private readonly mode: RunnerMode = 'shadow', private readonly fetchImpl: RunnerFetch = fetch, baseUrl = LOCAL_COMFY_URL) {
    this.baseUrl = exactLocalOrigin(baseUrl, LOCAL_COMFY_URL);
  }

  private async request<T = unknown>(path: string, init: RequestInit = {}): Promise<RunnerFetchResponse<T>> {
    const url = new URL(path, `${this.baseUrl}/`);
    if (url.origin !== LOCAL_COMFY_URL) throw new Error('Runner refused a non-local ComfyUI request.');
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if ((init.method ?? 'GET') === 'GET') {
      headers.set('Cache-Control', 'no-cache, no-store');
      headers.set('Pragma', 'no-cache');
    }
    const response = await this.fetchImpl(url, { ...init, headers, cache: 'no-store' });
    const text = await response.text();
    let value: unknown = text;
    try { value = text ? JSON.parse(text) : {}; } catch { /* Binary/text endpoints are returned as text. */ }
    if (!response.ok) throw new Error(`${url.pathname} failed (${response.status}): ${typeof value === 'string' ? value : JSON.stringify(value)}`);
    return { value: value as T, status: response.status, url: url.toString() };
  }

  objectInfo(): Promise<RunnerFetchResponse> { return this.request('/object_info'); }
  queue(): Promise<RunnerFetchResponse> { return this.request(`/queue?proya_fresh=${crypto.randomUUID()}`); }
  history(promptId?: string): Promise<RunnerFetchResponse> { return this.request(promptId ? `/history/${encodeURIComponent(promptId)}?proya_fresh=${crypto.randomUUID()}` : `/history?proya_fresh=${crypto.randomUUID()}`); }
  systemStats(): Promise<RunnerFetchResponse> { return this.request(`/system_stats?proya_fresh=${crypto.randomUUID()}`); }
  view(query: URLSearchParams): Promise<RunnerFetchResponse> { return this.request(`/view?${query.toString()}`); }

  uploadImage(body: FormData): Promise<RunnerFetchResponse> {
    return this.request('/upload/image', { method: 'POST', body });
  }

  async prompt(_body: unknown): Promise<never> {
    void _body;
    if (this.mode === 'shadow') throw new Error('SHADOW SAFETY: POST /prompt is forbidden.');
    throw new Error('Generation mode is not implemented in Phase 1.');
  }

  async free(_activeProductionWorkload = false): Promise<never> {
    void _activeProductionWorkload;
    if (this.mode === 'shadow') throw new Error('SHADOW SAFETY: POST /free is forbidden.');
    throw new Error('Generation mode is not implemented in Phase 1.');
  }

  async readiness(): Promise<ReadinessProbe> {
    try {
      const [objectInfo, stats, queue] = await Promise.all([this.objectInfo(), this.systemStats(), this.queue()]);
      return { ready: true, checkedAt: new Date().toISOString(), error: null, details: { objectInfoStatus: objectInfo.status, systemStatsStatus: stats.status, queueStatus: queue.status } };
    } catch (reason) {
      return { ready: false, checkedAt: new Date().toISOString(), error: errorText(reason) };
    }
  }

  async reconcileIdentity(identity: string): Promise<string | null> {
    const [queue, history] = await Promise.all([this.queue(), this.history()]);
    const validId = (id: unknown): id is string => typeof id === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id);
    const contains = (value: unknown): boolean => typeof value === 'string' ? value.includes(identity) : Array.isArray(value) ? value.some(contains) : Boolean(value && typeof value === 'object' && Object.values(value).some(contains));
    for (const payload of [queue.value, history.value]) {
      if (!payload || typeof payload !== 'object') continue;
      for (const [key, value] of Object.entries(payload)) {
        if (validId(key) && contains(value)) return key;
        if (Array.isArray(value)) for (const item of value) if (Array.isArray(item) && validId(item[1]) && contains(item)) return item[1];
      }
    }
    return null;
  }

  static submissionHash(body: unknown): string {
    return createHash('sha256').update(JSON.stringify(body)).digest('hex');
  }
}

export class LocalLmStudioClient {
  readonly baseUrl: string;

  constructor(private readonly fetchImpl: RunnerFetch = fetch, baseUrl = LOCAL_LM_STUDIO_URL) {
    this.baseUrl = exactLocalOrigin(baseUrl, LOCAL_LM_STUDIO_URL);
  }

  async readiness(): Promise<ReadinessProbe> {
    const checkedAt = new Date().toISOString();
    const unavailable = (error: string): ReadinessProbe => ({
      ready: false,
      checkedAt,
      error,
      details: { requiredModel: REQUIRED_QWEN_MODEL, available: false, matchedField: null, matchedValue: null }
    });
    try {
      const url = new URL('/api/v1/models', `${this.baseUrl}/`);
      const response = await this.fetchImpl(url, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache, no-store' }, cache: 'no-store' });
      if (!response.ok) throw new Error(`LM Studio model inspection failed (${response.status}).`);
      const payload = await response.json() as unknown;
      const records = Array.isArray(payload) ? payload : payload && typeof payload === 'object'
        ? [...(Array.isArray((payload as { data?: unknown }).data) ? (payload as { data: unknown[] }).data : []), ...(Array.isArray((payload as { models?: unknown }).models) ? (payload as { models: unknown[] }).models : [])]
        : [];
      const identifierFields = ['key', 'id', 'model', 'identifier', 'model_key', 'path'] as const;
      let match: { field: typeof identifierFields[number]; value: string } | null = null;
      for (const entry of records) {
        if (!entry || typeof entry !== 'object') continue;
        const item = entry as Record<string, unknown>;
        for (const field of identifierFields) {
          const value = item[field];
          if (typeof value === 'string' && value === REQUIRED_QWEN_MODEL) { match = { field, value }; break; }
        }
        if (match) break;
      }
      if (!match) return unavailable(`LM Studio does not list the exact required model ${REQUIRED_QWEN_MODEL}.`);
      return { ready: true, checkedAt, error: null, details: { requiredModel: REQUIRED_QWEN_MODEL, available: true, matchedField: match.field, matchedValue: match.value } };
    } catch (reason) {
      return unavailable(errorText(reason));
    }
  }
}
