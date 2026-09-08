import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { defaultSettings } from '../../src/domain/settings';
import type { ComputeJobState, H3VramReleaseAuthorization, H3VramReleaseAudit, RemoteH3GenerationRequest, RemoteH3JobRecord } from '../../src/domain/types';
import { RemoteComfyComputeProvider, type ComfyFetch } from './compute-provider';
import { classifyPreviousH3Lifecycle, ComputeService } from './compute-service';

const id = '550e8400-e29b-41d4-a716-446655440000';
const secondId = '550e8400-e29b-41d4-a716-446655440001';
const baseUrl = 'https://comfy.example.test';
const output = { nodeId: '92', kind: 'video', filename: 'result.mp4', subfolder: '', type: 'output', url: `${baseUrl}/view?filename=result.mp4` };
const success: H3VramReleaseAudit = { h3VramReleaseRequested: true, h3VramReleaseSucceeded: true, h3VramReleaseDurationMs: 2000, h3VramReleaseError: null };
const json = (value: unknown) => new Response(JSON.stringify(value));
const stats = (reserved: number | null) => ({ devices: [{ type: 'cuda', name: 'RTX 5090', vram_total: 32 * 1024 ** 3, vram_free: 31 * 1024 ** 3, torch_vram_total: reserved }] });
const history = (completed = true) => ({ [id]: { status: { completed, status_str: completed ? 'success' : 'running' }, outputs: { '92': { videos: [output] } } } });
const releaseAuthorization = (completionEvidence: H3VramReleaseAuthorization['completionEvidence'] = 'history'): H3VramReleaseAuthorization => ({
  previousJobId: 'first', previousPromptId: id, completionProven: true, completionEvidence
});

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('native ComfyUI H3 memory handoff', () => {
  function provider(fetchImpl: ComfyFetch) { return new RemoteComfyComputeProvider({ baseUrl, workflowPath: '', fetchImpl }); }

  it('does not infer completion from history inside the release primitive', async () => {
    const fetchImpl = vi.fn(async () => json(history(false)));
    const remote = provider(fetchImpl);
    expect(await remote.getJobState(id)).toMatchObject({ status: 'running', outputs: [expect.objectContaining({ nodeId: '92' })] });
    expect(await remote.releaseH3Vram(releaseAuthorization())).toMatchObject({ h3VramReleaseRequested: false, h3VramReleaseSucceeded: false });
    expect(fetchImpl.mock.calls).toHaveLength(2);
  });

  it('classifies an empty queue plus completed history as finished remote work', async () => {
    const requests: Array<{ url: URL; init?: RequestInit }> = [];
    const remote = provider(async (input, init) => {
      requests.push({ url: new URL(input), init });
      const path = new URL(input).pathname;
      if (path === '/queue') return json({ queue_running: [], queue_pending: [] });
      expect(path).toBe(`/history/${id}`);
      return json(history());
    });
    await expect(remote.inspectH3Lifecycle(id)).resolves.toMatchObject({
      queueState: 'empty',
      historyState: 'completed',
      outputCaptured: true,
      remoteState: { status: 'completed', remotePromptId: id },
      queueSampleTimestamp: expect.any(String), queueRequestUrl: expect.stringContaining('/queue?_proya_ts='), queueFreshness: 'FRESH',
      historySampleTimestamp: expect.any(String), historyRequestUrl: expect.stringContaining(`/history/${id}?_proya_ts=`), historyFreshness: 'FRESH'
    });
    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.url.searchParams.get('_proya_ts')).toBeTruthy();
      expect(request.init?.cache).toBe('no-store');
      expect(new Headers(request.init?.headers).get('Cache-Control')).toBe('no-cache, no-store, max-age=0');
      expect(new Headers(request.init?.headers).get('Pragma')).toBe('no-cache');
    }
  });

  it('recovers a matching completed output from recent history when the original prompt UUID is gone', async () => {
    const recoveredId = '550e8400-e29b-41d4-a716-446655440099';
    const requests: Array<{ url: URL; init?: RequestInit }> = [];
    const remote = provider(async (input, init) => {
      requests.push({ url: new URL(input), init });
      const path = new URL(input).pathname;
      if (path === '/queue') return json({ queue_running: [], queue_pending: [] });
      if (path === `/history/${id}`) return json({});
      expect(path).toBe('/history');
      return json({ [recoveredId]: { status: { completed: true, status_str: 'success' }, outputs: { '92': { videos: [{ filename: 'h3-auto-job-1.mp4', subfolder: '', type: 'output' }] } } } });
    });
    await expect(remote.inspectH3Lifecycle(id, 'h3-auto-job')).resolves.toMatchObject({
      queueState: 'empty',
      historyState: 'completed',
      outputCaptured: true,
      recoveredPromptId: recoveredId,
      recoverySource: 'recent_history',
      remoteState: { status: 'completed', remotePromptId: recoveredId, outputs: [{ filename: 'h3-auto-job-1.mp4', nodeId: '92' }] }
    });
    expect(requests.map(({ url }) => url.pathname)).toEqual(['/queue', `/history/${id}`, '/history']);
    for (const request of requests) {
      expect(request.url.searchParams.get('_proya_ts')).toBeTruthy();
      expect(request.init?.cache).toBe('no-store');
      expect(new Headers(request.init?.headers).get('Cache-Control')).toBe('no-cache, no-store, max-age=0');
      expect(new Headers(request.init?.headers).get('Pragma')).toBe('no-cache');
    }
  });

  it.each(['running', 'pending', 'malformed'])('does not POST /free for a %s queue', async (kind) => {
    vi.useFakeTimers();
    const calls: string[] = [];
    const remote = provider(async (input) => {
      const path = new URL(input).pathname;
      calls.push(path);
      if (path.startsWith('/history')) return json(history());
      return json(kind === 'malformed' ? {} : { queue_running: kind === 'running' ? [[1, id]] : [], queue_pending: kind === 'pending' ? [[2, secondId]] : [] });
    });
    const pending = remote.releaseH3Vram(releaseAuthorization('china_archive'));
    await vi.advanceTimersByTimeAsync(4000);
    expect(await pending).toMatchObject({ h3VramReleaseRequested: false, h3VramReleaseSucceeded: false });
    expect(calls).not.toContain('/free');
  });

  it('checks idle again after telemetry and avoids unloading a newly active render', async () => {
    let queueCalls = 0;
    const free = vi.fn();
    const remote = provider(async (input) => {
      const path = new URL(input).pathname;
      if (path.startsWith('/history')) return json(history());
      if (path === '/queue') return json({ queue_running: ++queueCalls === 1 ? [] : [[1, secondId]], queue_pending: [] });
      if (path.startsWith('/system_stats')) return json(stats(10 * 1024 ** 3));
      free(); return new Response(null);
    });
    expect(await remote.releaseH3Vram(releaseAuthorization('china_archive'))).toMatchObject({ h3VramReleaseRequested: false, h3VramReleaseSucceeded: false });
    expect(free).not.toHaveBeenCalled();
  });

  it('uses the native body/auth, then waits through retained caches for two released GPU samples', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    let samples = 0;
    const remote = new RemoteComfyComputeProvider({ baseUrl, workflowPath: '', auth: { type: 'bearer', token: 'test-token' }, fetchImpl: async (input, init) => {
      const path = new URL(input).pathname;
      calls.push(path);
      if (path.startsWith('/history')) return json(history());
      if (path === '/queue') return json({ queue_running: [], queue_pending: [] });
      if (path.startsWith('/system_stats')) return json(stats(++samples <= 3 ? 10 * 1024 ** 3 : 0));
      expect(path).toBe('/free');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({ unload_models: true, free_memory: true });
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-token');
      return new Response(null, { status: 200 });
    } });
    let done = false;
    const pending = remote.releaseH3Vram(releaseAuthorization()).then((result) => { done = true; return result; });
    await vi.advanceTimersByTimeAsync(2000);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toMatchObject({ ...success, h3VramReleaseDurationMs: 4000, h3VramBeforeRelease: { devices: [{ torchReservedBytes: 10 * 1024 ** 3 }] }, h3VramAfterRelease: { devices: [{ torchReservedBytes: 0 }] } });
    expect(calls.filter((path) => path === '/free')).toHaveLength(1);
  });

  it('allows normal /free and bounded verification when exact durable output proves completion but history is missing', async () => {
    vi.useFakeTimers();
    const calls: string[] = [];
    let samples = 0;
    const remote = provider(async (input) => {
      const path = new URL(input).pathname;
      calls.push(path);
      if (path === '/queue') return json({ queue_running: [], queue_pending: [] });
      if (path.startsWith('/system_stats')) return json(stats(++samples <= 1 ? 10 * 1024 ** 3 : 0));
      if (path === '/free') return new Response(null);
      throw new Error(`Unexpected request ${path}`);
    });
    expect(classifyPreviousH3Lifecycle(
      state({ status: 'completed', outputs: [], h3VramReleaseRequested: false, h3VramReleaseSucceeded: false, h3VramReleaseDurationMs: null }),
      { queueState: 'empty', historyState: 'missing' },
      { outputs: [], chinaArchived: true },
      true
    )).toBe('COMPLETED_NEEDS_VRAM_RELEASE');
    const pending = remote.releaseH3Vram(releaseAuthorization('china_archive'));
    await vi.advanceTimersByTimeAsync(4000);
    await expect(pending).resolves.toMatchObject({ h3VramReleaseRequested: true, h3VramReleaseSucceeded: true });
    expect(calls.some(path => path.startsWith('/history'))).toBe(false);
    expect(calls.filter(path => path === '/free')).toHaveLength(1);
  });

  it('blocks on 24 GiB used after HTTP 200, then verifies only after a retry measures 3 GiB used', async () => {
    vi.useFakeTimers();
    const total = 32 * 1024 ** 3;
    let freeCalls = 0;
    const telemetryUrls: string[] = [];
    const remote = provider(async (input, init) => {
      const url = new URL(input);
      if (url.pathname === '/queue') return json({ queue_running: [], queue_pending: [] });
      if (url.pathname === '/free') { freeCalls += 1; return json({ ok: true }); }
      if (url.pathname === '/system_stats') {
        telemetryUrls.push(url.toString());
        expect(init?.cache).toBe('no-store');
        expect(new Headers(init?.headers).get('Cache-Control')).toContain('no-store');
        const used = (freeCalls >= 2 ? 3 : 24) * 1024 ** 3;
        return json({ devices: [{ type: 'cuda', name: 'RTX 5090', vram_total: total, vram_free: total - used, torch_vram_total: 64 * 1024 ** 2 }] });
      }
      throw new Error(`Unexpected request ${url.pathname}`);
    });

    const first = remote.releaseH3Vram(releaseAuthorization());
    await vi.advanceTimersByTimeAsync(16_000);
    await expect(first).resolves.toMatchObject({
      h3VramReleaseRequested: true, h3FreeRequestStatus: 200, h3VramReleaseSucceeded: false,
      h3VramVerification: 'FAILED', h3VramPostMeasurementFresh: true,
      h3VramRequiredFreeBytes: total * 0.9,
      h3VramAfterRelease: { devices: [{ vramFreeBytes: 8 * 1024 ** 3 }] }
    });

    const second = remote.releaseH3Vram(releaseAuthorization());
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(second).resolves.toMatchObject({
      h3VramReleaseSucceeded: true, h3FreeRequestStatus: 200, h3VramVerification: 'PASSED',
      h3VramPostMeasurementFresh: true, h3VramAfterRelease: { devices: [{ vramFreeBytes: 29 * 1024 ** 3 }] }
    });
    expect(freeCalls).toBe(2);
    expect(new Set(telemetryUrls).size).toBe(telemetryUrls.length);
  });

  it('cannot reuse a pre-release measurement when fresh post-release telemetry is unavailable', async () => {
    vi.useFakeTimers();
    let freeCalled = false;
    const remote = provider(async (input) => {
      const path = new URL(input).pathname;
      if (path === '/queue') return json({ queue_running: [], queue_pending: [] });
      if (path === '/free') { freeCalled = true; return new Response(null); }
      if (path === '/system_stats' && !freeCalled) return json(stats(0));
      throw new Error('post-release telemetry unavailable');
    });
    const pending = remote.releaseH3Vram(releaseAuthorization());
    await vi.advanceTimersByTimeAsync(16_000);
    await expect(pending).resolves.toMatchObject({
      h3VramReleaseSucceeded: null, h3VramVerification: 'UNAVAILABLE', h3VramPostMeasurementFresh: false,
      h3VramBeforeRelease: { devices: expect.any(Array) }, h3VramAfterRelease: null
    });
  });

  it('treats missing classifier authorization as an invariant failure without POSTing /free', async () => {
    const fetchImpl = vi.fn(async () => json({ queue_running: [], queue_pending: [] }));
    const result = await provider(fetchImpl).releaseH3Vram({ ...releaseAuthorization(), completionProven: false } as unknown as H3VramReleaseAuthorization);
    expect(result).toMatchObject({ h3VramReleaseRequested: false, h3VramReleaseSucceeded: false, h3VramReleaseError: expect.stringContaining('authoritative completed-lifecycle authorization') });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('contains no obsolete provider-level completion error in source', () => {
    const source = readFileSync(join(process.cwd(), 'electron/main/compute-provider.ts'), 'utf8');
    expect(source).not.toContain(['H3 execution has not finished in ComfyUI history', 'VRAM release was not requested.'].join('; '));
  });

  it.each(['retained', 'missing', 'cpu-only', 'telemetry-failure', 'second-gpu-retained'])('bounds the wait with %s telemetry and never reports false verification', async (mode) => {
    vi.useFakeTimers();
    const remote = provider(async (input) => {
      const path = new URL(input).pathname;
      if (path.startsWith('/history')) return json(history());
      if (path === '/queue') return json({ queue_running: [], queue_pending: [] });
      if (path === '/free') return new Response(null);
      if (mode === 'telemetry-failure') throw new Error('telemetry unavailable');
      if (mode === 'cpu-only') return json({ devices: [{ type: 'cpu', torch_vram_total: 0 }] });
      if (mode === 'second-gpu-retained') return json({ devices: [...stats(0).devices, ...stats(10 * 1024 ** 3).devices] });
      return json(stats(mode === 'missing' ? null : 10 * 1024 ** 3));
    });
    const pending = remote.releaseH3Vram(releaseAuthorization());
    await vi.advanceTimersByTimeAsync(16000);
    expect(await pending).toMatchObject({ h3VramReleaseRequested: true, h3VramReleaseSucceeded: mode.includes('retained') ? false : null, h3VramReleaseDurationMs: 15000, h3VramReleaseError: expect.any(String) });
  });

  it('surfaces a rejected free request instead of claiming success', async () => {
    const remote = provider(async (input) => {
      const path = new URL(input).pathname;
      if (path.startsWith('/history')) return json(history());
      if (path === '/queue') return json({ queue_running: [], queue_pending: [] });
      if (path.startsWith('/system_stats')) return json(stats(10 * 1024 ** 3));
      return new Response('unavailable', { status: 503 });
    });
    expect(await remote.releaseH3Vram(releaseAuthorization())).toMatchObject({ h3VramReleaseRequested: true, h3VramReleaseSucceeded: false, h3VramReleaseError: expect.stringContaining('503') });
  });

  it('does not equate low Torch reservations with free device VRAM under cudaMallocAsync', async () => {
    vi.useFakeTimers();
    const remote = provider(async (input) => {
      const path = new URL(input).pathname;
      if (path.startsWith('/history')) return json(history());
      if (path === '/queue') return json({ queue_running: [], queue_pending: [] });
      if (path === '/free') return new Response(null);
      return json({ devices: [{ type: 'cuda', vram_total: 34190458880, vram_free: 9982661576, torch_vram_total: 100663296 }] });
    });
    const pending = remote.releaseH3Vram(releaseAuthorization());
    await vi.advanceTimersByTimeAsync(16000);
    expect(await pending).toMatchObject({ h3VramReleaseRequested: true, h3VramReleaseSucceeded: false, h3VramReleaseError: expect.stringContaining('GPU memory remains occupied') });
  });

  it('fails verification if the queue becomes active after /free was accepted', async () => {
    vi.useFakeTimers();
    let freed = false;
    const remote = provider(async (input) => {
      const path = new URL(input).pathname;
      if (path.startsWith('/history')) return json(history());
      if (path === '/queue') return json({ queue_running: freed ? [[1, secondId]] : [], queue_pending: [] });
      if (path.startsWith('/system_stats')) return json(stats(0));
      freed = true; return new Response(null);
    });
    const pending = remote.releaseH3Vram(releaseAuthorization());
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({ h3VramReleaseRequested: true, h3VramReleaseSucceeded: false, h3VramReleaseError: expect.stringContaining('became busy') });
  });

  it('bounds stalled transport as well as the idle verification loop', async () => {
    vi.useFakeTimers();
    const remote = provider(async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
    }));
    const pending = remote.releaseH3Vram(releaseAuthorization());
    await vi.advanceTimersByTimeAsync(20000);
    expect(await pending).toMatchObject({ h3VramReleaseRequested: false, h3VramReleaseSucceeded: false, h3VramReleaseDurationMs: 20000 });
  });
});

function state(overrides: Partial<ComputeJobState> = {}): ComputeJobState {
  return { localJobId: 'first', remotePromptId: id, status: 'queued', progress: null, currentNode: null, queuePosition: null, queueRemaining: null, outputs: [], referenceUploads: [], remoteUploadedFilename: null, localResultPath: null, downloadError: null, error: null, connectionError: null, serverUrl: baseUrl, updatedAt: new Date().toISOString(), ...overrides };
}
function request(localJobId = 'first'): RemoteH3GenerationRequest {
  return { localJobId, prompt: 'Final prompt', mode: 'REF2VA', duration: 4, aspectRatio: '9:16', fps: 24, frames: 107, megapixels: 0.98, multiple: 32, firstFrame: null, lastFrame: null, productReference: 'reference.png' };
}
function generationBrief(): NonNullable<RemoteH3GenerationRequest['generationBrief']> {
  return {
    schemaVersion: 1, workflowMode: 'REF2VA', product: 'cleanser', contentType: 'UGC Content', contentFamily: 'UGC Content', duration: 4, aspectRatio: '9:16', language: 'English', videoIdea: 'safe test',
    creativeDirection: { concept: '', visualHook: '', creativeArchetype: '', environment: '', composition: '', cameraPath: '', framing: '', lightingStyle: '', primaryMotion: '', secondaryMotion: '', materialEffect: '', pacing: '', openingDevice: '', transitionLanguage: '', endingDevice: '', audioCharacter: '' },
    productCorrections: [], references: [], mediaManifest: '', allowedReferenceLabels: { subjects: [], pictures: [], videos: [], audios: [] }, musicOnly: true, captions: false, subtitles: false, sound: 'Music Only', specialInstructions: ''
  };
}
function record(localJobId: string, currentState: ComputeJobState, remotePromptId: string | null, autoJobId?: string): RemoteH3JobRecord {
  const jobRequest = { ...request(localJobId), ...(autoJobId ? { autoJobId } : {}) };
  return {
    localJobId,
    remotePromptId,
    createdAt: currentState.updatedAt,
    updatedAt: currentState.updatedAt,
    promptRecordId: null,
    product: null,
    workflowMode: 'REF2VA',
    prompt: jobRequest.prompt ?? '',
    request: jobRequest,
    localSourceReferencePath: null,
    remoteUploadedFilename: null,
    outputMetadata: currentState.outputs,
    localDownloadedPath: null,
    status: currentState.status,
    state: currentState
  };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

describe('serialized H3 service lifecycle', () => {
  function setup(autoDownload = true) {
    const settings = { ...defaultSettings(process.cwd()), computeMode: 'remote' as const, remoteComfyUrl: baseUrl, remoteAutoDownload: autoDownload, remoteComfyWorkflowPath: join(process.cwd(), 'workflows/minimax-h3-api.json') };
    const records = new Map<string, RemoteH3JobRecord>();
    const events: ComputeJobState[] = [];
    const listeners = new Map<string, (state: ComputeJobState) => void>();
    const proto = RemoteComfyComputeProvider.prototype;
    const idle = vi.spyOn(proto, 'assertQueueIdle').mockResolvedValue();
    const submit = vi.spyOn(proto, 'submitH3').mockImplementation(async (req) => state({ localJobId: req.localJobId!, remotePromptId: req.localJobId === 'first' ? id : secondId }));
    vi.spyOn(proto, 'watchJob').mockImplementation((promptId, listener) => { listeners.set(promptId, listener); return () => undefined; });
    const get = vi.spyOn(proto, 'getJobState').mockResolvedValue(state({ status: 'running' }));
    const inspect = vi.spyOn(proto, 'inspectH3Lifecycle').mockImplementation(async () => {
      const latest = [...records.values()].find((item) => item.remotePromptId === id);
      return latest && ['completed', 'failed', 'error'].includes(latest.state.status)
        ? { queueState: 'empty', historyState: 'completed', remoteState: state({ status: 'completed', outputs: [output] }), outputCaptured: true }
        : { queueState: 'queue_running', historyState: 'running', remoteState: state({ status: 'running' }), outputCaptured: false };
    });
    const release = vi.spyOn(proto, 'releaseH3Vram').mockImplementation(async (_authorization, onProgress) => { onProgress?.(success); return success; });
    const qwen = vi.spyOn(proto, 'recoverStaleQwen').mockResolvedValue({ activePromptJob: false, staleQwenDetected: false, staleQwenUnloadSucceeded: null, comfyFreeSucceeded: null, qwenRecoveryError: null });
    const download = vi.spyOn(proto, 'downloadOutput').mockResolvedValue({ output, localPath: 'C:/outputs/result.mp4', downloadedAt: new Date().toISOString() });
    const service = new ComputeService(() => settings, (s) => events.push(s), false, { listRemoteH3Jobs: () => [...records.values()], upsertRemoteH3Job: (record) => { records.set(record.localJobId, record); return record; } });
    return { service, records, events, listeners, submit, get, inspect, release, download, idle, qwen };
  }

  it('classifies the real archived-output state as COMPLETED_NEEDS_VRAM_RELEASE', () => {
    const current = state({
      status: 'completed',
      outputs: [output],
      h3VramReleaseRequested: false,
      h3VramReleaseSucceeded: false,
      h3VramReleaseDurationMs: null
    });
    expect(classifyPreviousH3Lifecycle(
      current,
      { queueState: 'empty', historyState: 'missing' },
      { outputs: [], chinaArchived: true },
      true
    )).toBe('COMPLETED_NEEDS_VRAM_RELEASE');
  });

  it('recovers archived exact output, releases VRAM, and allows the next Qwen without rerendering', async () => {
    const f = setup();
    try {
      await f.service.submitH3({ ...request(), autoJobId: 'h3-auto-job', autoSessionId: 'session-1' });
      f.listeners.get(id)!(state({ status: 'running', progress: 0.7, outputs: [] }));
      f.service.autoOutputEvidence = (jobId) => jobId === 'h3-auto-job'
        ? { outputs: [], chinaArchived: true, chinaArchivePath: 'D:\\AI Videos\\exact.mp4', laptopDownloaded: false }
        : null;
      const archive = vi.fn();
      f.service.autoArchive = archive;
      f.inspect.mockResolvedValue({ queueState: 'empty', historyState: 'missing', remoteState: null, outputCaptured: false });

      const recovered = await f.service.recoverAutoJob('first');
      expect(recovered).toMatchObject({ status: 'completed', remotePromptId: id, pipelineStage: 'COMPLETE', h3VramReleaseRequested: true, h3VramReleaseSucceeded: true });
      if (!recovered) throw new Error('Expected recovered state.');
      expect(recovered.h3LifecycleDiagnostics).toMatchObject({ outputCaptured: false, chinaArchived: true, remoteLifecycleState: 'RECOVERED_COMPLETED', reasonForBlocking: null });
      expect(recovered.failureStage).not.toBe('REMOTE_STATE_LOST');
      expect(f.release).toHaveBeenCalledWith({ previousJobId: 'first', previousPromptId: id, completionProven: true, completionEvidence: 'china_archive' }, expect.any(Function));
      expect(archive).not.toHaveBeenCalled();

      await f.service.submitH3({ ...request('second'), generationBrief: generationBrief() });
      expect(f.submit).toHaveBeenCalledTimes(2);
      expect(f.qwen).toHaveBeenCalledTimes(1);
    } finally { f.service.dispose(); }
  });

  it('replaces a persisted RUNNING_REMOTE snapshot with fresh empty control-plane evidence before release', async () => {
    const f = setup(false);
    try {
      const stale = state({
        status: 'completed', outputs: [output], pipelineStage: 'RELEASING_H3_VRAM',
        h3VramReleaseRequested: false, h3VramReleaseSucceeded: false, h3VramReleaseDurationMs: null,
        h3LifecycleDiagnostics: {
          previousJobId: 'first', previousPromptId: id, h3WasSubmitted: true,
          remoteQueueState: 'queue_running', historyState: 'running', outputCaptured: true, chinaArchived: true,
          vramReleaseRequested: false, vramReleaseSucceeded: false,
          classifierResult: 'RUNNING_REMOTE', classifierTimestamp: '2026-09-08T01:00:00.000Z',
          releaseAuthorized: false, freeAttempted: false,
          reasonForBlocking: 'Lifecycle invariant: H3 VRAM release requested from RUNNING_REMOTE.'
        }
      });
      f.records.set('first', record('first', stale, id, 'h3-auto-job'));
      f.service.autoOutputEvidence = () => ({ outputs: [output], chinaArchived: true, chinaArchivePath: 'D:\\AI Videos\\exact.mp4', laptopDownloaded: false });
      f.inspect.mockResolvedValue({
        queueState: 'empty', historyState: 'missing', remoteState: null, outputCaptured: false,
        queueSampleTimestamp: '2026-09-08T02:00:00.000Z', queueRequestUrl: '<remote>/queue?_proya_ts=fresh', queueFreshness: 'FRESH',
        historySampleTimestamp: '2026-09-08T02:00:01.000Z', historyRequestUrl: `<remote>/history/${id}?_proya_ts=fresh`, historyFreshness: 'FRESH'
      });

      await expect(f.service.recoverAutoJob('first')).resolves.toMatchObject({
        status: 'completed', pipelineStage: 'COMPLETE', h3VramReleaseRequested: true, h3VramReleaseSucceeded: true,
        h3LifecycleDiagnostics: {
          remoteQueueState: 'empty', historyState: 'missing', queueFreshness: 'FRESH', historyFreshness: 'FRESH',
          completionEvidence: 'CHINA_ARCHIVE', classifierResult: 'COMPLETED_NEEDS_VRAM_RELEASE',
          releaseAuthorized: true, freeAttempted: true, reasonForBlocking: null
        }
      });
      expect(f.inspect).toHaveBeenCalledTimes(1);
      expect(f.release).toHaveBeenCalledTimes(1);

      await f.service.submitH3({ ...request('second'), generationBrief: generationBrief() });
      expect(f.submit).toHaveBeenCalledTimes(1);
      expect(f.submit.mock.calls[0][0].localJobId).toBe('second');
      expect(f.qwen).toHaveBeenCalledTimes(1);
    } finally { f.service.dispose(); }
  });

  it('does not let a stale terminal listener classification prevent the fresh release transaction', async () => {
    const f = setup(false);
    try {
      await f.service.submitH3({ ...request(), autoJobId: 'h3-auto-job', autoSessionId: 'session-1' });
      f.service.autoOutputEvidence = () => ({ outputs: [output], chinaArchived: true, chinaArchivePath: 'D:\\AI Videos\\exact.mp4', laptopDownloaded: false });
      f.inspect.mockResolvedValue({
        queueState: 'empty', historyState: 'missing', remoteState: null, outputCaptured: false,
        queueSampleTimestamp: '2026-09-08T03:00:00.000Z', queueRequestUrl: '<remote>/queue?_proya_ts=fresh-terminal', queueFreshness: 'FRESH',
        historySampleTimestamp: '2026-09-08T03:00:01.000Z', historyRequestUrl: `<remote>/history/${id}?_proya_ts=fresh-terminal`, historyFreshness: 'FRESH'
      });
      f.listeners.get(id)!(state({
        status: 'completed', outputs: [output],
        h3LifecycleDiagnostics: {
          previousJobId: 'first', previousPromptId: id, h3WasSubmitted: true,
          remoteQueueState: 'queue_running', historyState: 'running', outputCaptured: true, chinaArchived: true,
          vramReleaseRequested: false, vramReleaseSucceeded: false,
          classifierResult: 'RUNNING_REMOTE', classifierTimestamp: '2026-09-08T01:00:00.000Z',
          releaseAuthorized: false, freeAttempted: false, reasonForBlocking: 'stale running snapshot'
        }
      }));

      await vi.waitFor(() => expect(f.records.get('first')?.state).toMatchObject({
        pipelineStage: 'COMPLETE', h3VramReleaseSucceeded: true,
        h3LifecycleDiagnostics: { remoteQueueState: 'empty', classifierResult: 'COMPLETED_NEEDS_VRAM_RELEASE', releaseAuthorized: true }
      }));
      expect(f.release).toHaveBeenCalledTimes(1);

      await f.service.submitH3({ ...request('second'), generationBrief: generationBrief() });
      expect(f.submit.mock.calls.map(call => call[0].localJobId)).toEqual(['first', 'second']);
    } finally { f.service.dispose(); }
  });

  it('retries failed recovered cleanup without resubmitting the completed H3', async () => {
    const f = setup();
    try {
      await f.service.submitH3({ ...request(), autoJobId: 'h3-auto-job', autoSessionId: 'session-1' });
      f.listeners.get(id)!(state({ status: 'running', outputs: [output] }));
      f.service.autoOutputEvidence = () => ({ outputs: [output], chinaArchived: true, chinaArchivePath: 'D:\\AI Videos\\exact.mp4', laptopDownloaded: false });
      f.inspect.mockResolvedValue({ queueState: 'empty', historyState: 'missing', remoteState: null, outputCaptured: false });
      f.release.mockResolvedValueOnce({ ...success, h3VramReleaseSucceeded: false, h3VramReleaseError: 'Temporary /free failure' }).mockResolvedValueOnce(success);

      await expect(f.service.recoverAutoJob('first')).resolves.toMatchObject({ status: 'completed', h3VramReleaseSucceeded: false });
      await f.service.submitH3({ ...request('second'), generationBrief: generationBrief() });
      expect(f.release).toHaveBeenCalledTimes(2);
      expect(f.submit).toHaveBeenCalledTimes(2);
      expect(f.submit.mock.calls.map(call => call[0].localJobId)).toEqual(['first', 'second']);
    } finally { f.service.dispose(); }
  });

  it('does not use output evidence whose persisted lifecycle identity belongs to another job', async () => {
    vi.useFakeTimers();
    const f = setup();
    try {
      await f.service.submitH3({ ...request(), autoJobId: 'h3-auto-job', autoSessionId: 'session-1' });
      f.listeners.get(id)!(state({
        status: 'running', outputs: [output],
        h3LifecycleDiagnostics: {
          previousJobId: 'different-job', previousPromptId: secondId, h3WasSubmitted: true,
          remoteQueueState: 'empty', historyState: 'missing', outputCaptured: true, chinaArchived: true,
          vramReleaseRequested: false, vramReleaseSucceeded: false, reasonForBlocking: null
        }
      }));
      f.service.autoOutputEvidence = () => ({ outputs: [], chinaArchived: true, chinaArchivePath: 'D:\\AI Videos\\other.mp4', laptopDownloaded: false });
      f.inspect.mockResolvedValue({ queueState: 'empty', historyState: 'missing', remoteState: null, outputCaptured: false });

      await expect(f.service.recoverAutoJob('first')).rejects.toThrow(/check 1\/3/);
      expect(f.release).not.toHaveBeenCalled();
      expect(f.records.get('first')?.state.h3LifecycleDiagnostics).toMatchObject({ remoteLifecycleState: 'ORPHANED_REMOTE_PROMPT', orphanReconciliationAttempts: 1 });
    } finally { f.service.dispose(); }
  });

  it('resumes archived-output cleanup after restart without duplicate H3 submission', async () => {
    const f = setup();
    try {
      const persisted = state({
        status: 'completed', outputs: [output], h3VramReleaseRequested: false, h3VramReleaseSucceeded: false,
        h3VramReleaseDurationMs: null,
        h3LifecycleDiagnostics: {
          previousJobId: 'stale', previousPromptId: id, h3WasSubmitted: true,
          remoteQueueState: 'empty', historyState: 'missing', outputCaptured: true, chinaArchived: true,
          vramReleaseRequested: false, vramReleaseSucceeded: false, reasonForBlocking: null
        }
      });
      f.records.set('stale', record('stale', persisted, id, 'h3-auto-job'));
      const restarted = new ComputeService(() => ({ ...defaultSettings(process.cwd()), computeMode: 'remote' as const, remoteComfyUrl: baseUrl }), () => undefined, false, {
        listRemoteH3Jobs: () => [...f.records.values()],
        upsertRemoteH3Job: (item) => { f.records.set(item.localJobId, item); return item; }
      });
      restarted.autoOutputEvidence = () => ({ outputs: [output], chinaArchived: true, chinaArchivePath: 'D:\\AI Videos\\exact.mp4', laptopDownloaded: false });
      try {
        await restarted.restoreJobs();
        await expect(restarted.recoverAutoJob('stale')).resolves.toMatchObject({ status: 'completed', h3VramReleaseSucceeded: true });
        expect(f.release).toHaveBeenCalledTimes(1);
        expect(f.submit).not.toHaveBeenCalled();
      } finally { restarted.dispose(); }
    } finally { f.service.dispose(); }
  });

  it('persists descriptors, releases once, then downloads before accepting the next generation', async () => {
    const f = setup();
    try {
      await f.service.submitH3(request());
      const gate = deferred<H3VramReleaseAudit>();
      f.release.mockImplementationOnce(async (_id, onProgress) => { onProgress?.({ h3VramReleaseRequested: true }); return gate.promise; });
      const complete = state({ status: 'completed', pipelineStage: 'GENERATING_H3', outputs: [output] });
      f.listeners.get(id)!(complete);
      f.listeners.get(id)!(complete);
      await vi.waitFor(() => expect(f.release).toHaveBeenCalledTimes(1));
      expect(f.records.get('first')?.state).toMatchObject({ outputs: [output], pipelineStage: 'RELEASING_H3_VRAM', h3VramReleaseRequested: true });
      expect(f.download).not.toHaveBeenCalled();
      const next = f.service.submitH3(request('second'));
      await Promise.resolve();
      expect(f.submit).toHaveBeenCalledTimes(1);
      gate.resolve(success);
      await next;
      expect(f.release).toHaveBeenCalledTimes(1);
      expect(f.download).toHaveBeenCalledTimes(1);
      expect(f.submit).toHaveBeenCalledTimes(2);
      const stages = f.events.filter((s) => s.localJobId === 'first').map((s) => s.pipelineStage);
      expect(stages.indexOf('RELEASING_H3_VRAM')).toBeLessThan(stages.indexOf('DOWNLOADING'));
      expect(stages.indexOf('DOWNLOADING')).toBeLessThan(stages.indexOf('COMPLETE'));
      expect(f.records.get('first')).toMatchObject({ ...success, state: { ...success, outputs: [output], localResultPath: 'C:/outputs/result.mp4' } });
      expect(f.records.get('first')?.state.h3LifecycleDiagnostics).toMatchObject({ vramReleaseRequested: true, vramReleaseSucceeded: true, reasonForBlocking: null });
    } finally { f.service.dispose(); }
  });

  it('rejects concurrent submissions and a second generation while the first is executing', async () => {
    const f = setup();
    try {
      const first = f.service.submitH3(request());
      await expect(f.service.submitH3(request('second'))).rejects.toThrow(/one at a time/);
      await first;
      await expect(f.service.submitH3(request('second'))).rejects.toThrow(/previous H3 job is not finished/);
      expect(f.submit).toHaveBeenCalledTimes(1);
      expect(f.release).not.toHaveBeenCalled();
      expect(f.records.get('first')?.state.h3LifecycleDiagnostics).toMatchObject({
        previousJobId: 'first',
        previousPromptId: id,
        h3WasSubmitted: true,
        remoteQueueState: 'queue_running',
        historyState: 'running',
        reasonForBlocking: expect.stringContaining('queue_running')
      });
    } finally { f.service.dispose(); }
  });

  it('keeps the handoff blocked while the previous prompt is queue_pending', async () => {
    const f = setup();
    try {
      await f.service.submitH3(request());
      f.inspect.mockResolvedValueOnce({ queueState: 'queue_pending', historyState: 'queued', remoteState: state({ status: 'queued' }), outputCaptured: false });
      await expect(f.service.submitH3(request('second'))).rejects.toThrow(/previous H3 job is not finished/);
      expect(f.submit).toHaveBeenCalledTimes(1);
      expect(f.records.get('first')?.state.h3LifecycleDiagnostics).toMatchObject({ remoteQueueState: 'queue_pending', historyState: 'queued', remoteLifecycleState: 'ACTIVE' });
    } finally { f.service.dispose(); }
  });

  it('allows the next Qwen job after PROMPT_VALIDATION_FAILED without an H3 VRAM latch', async () => {
    const f = setup();
    try {
      await f.service.submitH3(request());
      f.listeners.get(id)!(state({ status: 'failed', pipelineStage: 'PROMPT_VALIDATION_FAILED', failureStage: 'PROMPT_VALIDATION_FAILED', error: 'PROMPT_VALIDATION_FAILED: invalid prompt' }));
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      f.inspect.mockResolvedValueOnce({ queueState: 'empty', historyState: 'failed', remoteState: state({ status: 'failed', pipelineStage: 'PROMPT_VALIDATION_FAILED', failureStage: 'PROMPT_VALIDATION_FAILED', error: 'PROMPT_VALIDATION_FAILED: invalid prompt' }), outputCaptured: false });
      await f.service.submitH3(request('second'));
      expect(f.submit).toHaveBeenCalledTimes(2);
      expect(f.release).not.toHaveBeenCalled();
      expect(f.records.get('first')?.state).toMatchObject({
        status: 'failed',
        h3VramReleaseRequested: false,
        h3LifecycleDiagnostics: { h3WasSubmitted: false, vramReleaseRequested: false, vramReleaseSucceeded: null, reasonForBlocking: null }
      });
    } finally { f.service.dispose(); }
  });

  it('reconciles a stale running flag from completed remote history before the next submission', async () => {
    const f = setup();
    try {
      await f.service.submitH3(request());
      f.inspect.mockResolvedValueOnce({ queueState: 'empty', historyState: 'completed', remoteState: state({ status: 'completed', outputs: [output] }), outputCaptured: true });
      await f.service.submitH3(request('second'));
      expect(f.submit).toHaveBeenCalledTimes(2);
      expect(f.release).toHaveBeenCalledTimes(1);
      expect(f.records.get('first')?.state).toMatchObject({ status: 'completed', h3LifecycleDiagnostics: { remoteQueueState: 'empty', historyState: 'completed', outputCaptured: true, vramReleaseSucceeded: true } });
    } finally { f.service.dispose(); }
  });

  it('repairs a persisted active flag when no H3 submission ever occurred', async () => {
    const f = setup();
    try {
      const stale = state({ localJobId: 'stale', remotePromptId: null, status: 'running', submissionJson: undefined });
      f.records.set('stale', record('stale', stale, null, 'stale-auto-job'));
      await f.service.submitH3(request('second'));
      expect(f.submit).toHaveBeenCalledTimes(1);
      expect(f.records.get('stale')?.state).toMatchObject({ status: 'failed', remotePromptId: null, h3LifecycleDiagnostics: { h3WasSubmitted: false, remoteQueueState: 'empty', historyState: 'not_checked' } });
    } finally { f.service.dispose(); }
  });

  it('recovers an orphaned submitted job from persisted output evidence without rerendering it', async () => {
    const f = setup();
    try {
      await f.service.submitH3({ ...request(), autoJobId: 'h3-auto-job', autoSessionId: 'session-1' });
      f.listeners.get(id)!(state({ status: 'running', outputs: [output] }));
      f.service.autoOutputEvidence = () => ({ outputs: [output], chinaArchived: true, chinaArchivePath: 'D:\\AI Videos\\exact.mp4', laptopDownloaded: false });
      f.inspect.mockResolvedValueOnce({ queueState: 'empty', historyState: 'missing', remoteState: null, outputCaptured: false });
      await f.service.submitH3(request('second'));
      expect(f.submit).toHaveBeenCalledTimes(2);
      expect(f.release).toHaveBeenCalledWith({ previousJobId: 'first', previousPromptId: id, completionProven: true, completionEvidence: 'china_archive' }, expect.any(Function));
      expect(f.records.get('first')?.state).toMatchObject({ status: 'completed', remotePromptId: id, pipelineStage: 'COMPLETE', h3LifecycleDiagnostics: { remoteLifecycleState: 'RECOVERED_COMPLETED', orphanRecoverySource: 'china_archive', outputCaptured: true } });
    } finally { f.service.dispose(); }
  });

  it('bounds an orphaned submitted job, marks REMOTE_STATE_LOST, and preserves the original prompt UUID', async () => {
    vi.useFakeTimers();
    const f = setup();
    try {
      await f.service.submitH3(request());
      f.inspect.mockResolvedValue({ queueState: 'empty', historyState: 'missing', remoteState: null, outputCaptured: false });
      await expect(f.service.recoverAutoJob('first')).rejects.toThrow(/RECONCILING LOST REMOTE JOB/);
      await vi.advanceTimersByTimeAsync(5000);
      await expect(f.service.recoverAutoJob('first')).rejects.toThrow(/check 2\/3/);
      await vi.advanceTimersByTimeAsync(5000);
      await expect(f.service.recoverAutoJob('first')).resolves.toMatchObject({ status: 'failed', remotePromptId: null, failureStage: 'REMOTE_STATE_LOST', pipelineStage: 'REMOTE_STATE_LOST' });
      expect(f.submit).toHaveBeenCalledTimes(1);
      expect(f.records.get('first')?.state.h3LifecycleDiagnostics).toMatchObject({ previousPromptId: id, h3WasSubmitted: true, remoteQueueState: 'empty', historyState: 'missing', remoteLifecycleState: 'REMOTE_STATE_LOST', orphanReconciliationAttempts: 3, vramReleaseRequested: false, vramReleaseSucceeded: null, reasonForBlocking: null });
      expect(f.records.get('first')?.state).toMatchObject({ remotePromptId: null, h3VramReleaseRequested: false, h3VramReleaseSucceeded: null, h3VramReleaseDurationMs: null, h3VramReleaseError: null });
      const qwenBrief = {
        schemaVersion: 1, workflowMode: 'REF2VA', product: 'cleanser', contentType: 'UGC Content', contentFamily: 'UGC Content', duration: 4, aspectRatio: '9:16', language: 'English', videoIdea: 'safe test',
        creativeDirection: { concept: '', visualHook: '', creativeArchetype: '', environment: '', composition: '', cameraPath: '', framing: '', lightingStyle: '', primaryMotion: '', secondaryMotion: '', materialEffect: '', pacing: '', openingDevice: '', transitionLanguage: '', endingDevice: '', audioCharacter: '' },
        productCorrections: [], references: [], mediaManifest: '', allowedReferenceLabels: { subjects: [], pictures: [], videos: [], audios: [] }, musicOnly: true, captions: false, subtitles: false, sound: 'Music Only', specialInstructions: ''
      } as NonNullable<RemoteH3GenerationRequest['generationBrief']>;
      await f.service.submitH3({ ...request('second'), generationBrief: qwenBrief });
      expect(f.qwen).toHaveBeenCalledTimes(1);
      expect(f.submit).toHaveBeenCalledTimes(2);
    } finally { f.service.dispose(); }
  });

  it('does not count a network failure as orphan evidence and resumes the same bounded check', async () => {
    vi.useFakeTimers();
    const f = setup();
    try {
      await f.service.submitH3(request());
      f.inspect.mockResolvedValue({ queueState: 'empty', historyState: 'missing', remoteState: null, outputCaptured: false });
      await expect(f.service.recoverAutoJob('first')).rejects.toThrow(/check 1\/3/);
      expect(f.records.get('first')?.state.h3LifecycleDiagnostics?.orphanReconciliationAttempts).toBe(1);

      await vi.advanceTimersByTimeAsync(5000);
      f.inspect.mockRejectedValueOnce(new Error('Cloudflare network connection lost HTTP 502'));
      await expect(f.service.recoverAutoJob('first')).rejects.toThrow(/Cloudflare network connection lost/);
      expect(f.records.get('first')?.state.h3LifecycleDiagnostics?.orphanReconciliationAttempts).toBe(1);

      await expect(f.service.recoverAutoJob('first')).rejects.toThrow(/check 2\/3/);
      expect(f.records.get('first')?.state.h3LifecycleDiagnostics?.orphanReconciliationAttempts).toBe(2);
      expect(f.submit).toHaveBeenCalledTimes(1);
    } finally { f.service.dispose(); }
  });

  it('restores persisted REMOTE_STATE_LOST as terminal without reconciling or releasing again', async () => {
    const f = setup();
    try {
      const lost = state({
        status: 'failed', remotePromptId: null, progress: 0.38,
        pipelineStage: 'REMOTE_STATE_LOST', failureStage: 'REMOTE_STATE_LOST',
        h3VramReleaseRequested: false, h3VramReleaseSucceeded: null, h3VramReleaseDurationMs: null,
        h3LifecycleDiagnostics: {
          previousJobId: 'first', previousPromptId: id, h3WasSubmitted: true,
          remoteQueueState: 'empty', historyState: 'missing', outputCaptured: false, chinaArchived: false,
          vramReleaseRequested: false, vramReleaseSucceeded: null, reasonForBlocking: null,
          remoteLifecycleState: 'REMOTE_STATE_LOST', orphanReconciliationAttempts: 3
        }
      });
      f.records.set('first', record('first', lost, null, 'h3-auto-job'));
      const restarted = new ComputeService(() => ({ ...defaultSettings(process.cwd()), computeMode: 'remote' as const, remoteComfyUrl: baseUrl }), () => undefined, false, {
        listRemoteH3Jobs: () => [...f.records.values()],
        upsertRemoteH3Job: (item) => { f.records.set(item.localJobId, item); return item; }
      });
      try {
        await restarted.restoreJobs();
        await expect(restarted.recoverAutoJob('first')).resolves.toMatchObject({ status: 'failed', remotePromptId: null, pipelineStage: 'REMOTE_STATE_LOST' });
        expect(f.inspect).not.toHaveBeenCalled();
        expect(f.release).not.toHaveBeenCalled();
      } finally { restarted.dispose(); }
    } finally { f.service.dispose(); }
  });

  it('reconciles the orphan state after restart without starting a duplicate prompt', async () => {
    vi.useFakeTimers();
    const f = setup();
    try {
      const stale = state({ localJobId: 'stale', remotePromptId: id, status: 'running' });
      f.records.set('stale', record('stale', stale, id, 'stale-auto-job'));
      f.inspect.mockResolvedValue({ queueState: 'empty', historyState: 'missing', remoteState: null, outputCaptured: false });
      await expect(f.service.recoverAutoJob('stale')).rejects.toThrow(/RECONCILING LOST REMOTE JOB/);
      await vi.advanceTimersByTimeAsync(5000);
      await expect(f.service.recoverAutoJob('stale')).rejects.toThrow(/check 2\/3/);
      await vi.advanceTimersByTimeAsync(5000);
      await expect(f.service.recoverAutoJob('stale')).resolves.toMatchObject({ failureStage: 'REMOTE_STATE_LOST' });
      expect(f.submit).not.toHaveBeenCalled();
      expect(f.records.get('stale')?.state.remotePromptId).toBe(null);
    } finally { f.service.dispose(); }
  });

  it('reconciles persisted active state after restart without submitting a duplicate prompt', async () => {
    const f = setup();
    try {
      const stale = state({ localJobId: 'stale', remotePromptId: id, status: 'running' });
      f.records.set('stale', record('stale', stale, id));
      f.inspect.mockResolvedValueOnce({ queueState: 'empty', historyState: 'completed', remoteState: state({ localJobId: 'stale', status: 'completed', outputs: [output] }), outputCaptured: true });
      const recovered = await f.service.recoverAutoJob('stale');
      expect(recovered).toMatchObject({ status: 'completed', remotePromptId: id });
      expect(f.submit).not.toHaveBeenCalled();
      expect(f.release).toHaveBeenCalledTimes(1);
    } finally { f.service.dispose(); }
  });

  it('keeps the handoff blocked when output is complete but VRAM release is pending', async () => {
    const f = setup();
    try {
      await f.service.submitH3(request());
      f.inspect.mockResolvedValueOnce({ queueState: 'empty', historyState: 'completed', remoteState: state({ status: 'completed', outputs: [output] }), outputCaptured: true });
      f.release.mockResolvedValueOnce({ ...success, h3VramReleaseSucceeded: null, h3VramReleaseDurationMs: null, h3VramReleaseError: 'VRAM release still pending' });
      await expect(f.service.submitH3(request('second'))).rejects.toThrow(/vramReleaseSucceeded=—/i);
      expect(f.submit).toHaveBeenCalledTimes(1);
      expect(f.records.get('first')?.state.h3LifecycleDiagnostics).toMatchObject({ outputCaptured: true, vramReleaseSucceeded: null, reasonForBlocking: 'VRAM release still pending' });
    } finally { f.service.dispose(); }
  });

  it.each([false, null])('keeps video completion with release=%s and exposes its warning', async (succeeded) => {
    const f = setup();
    try {
      f.release.mockResolvedValue({ ...success, h3VramReleaseSucceeded: succeeded, h3VramReleaseError: 'Release warning' });
      f.inspect.mockResolvedValue({ queueState: 'empty', historyState: 'completed', remoteState: state({ status: 'completed', outputs: [output] }), outputCaptured: true });
      await f.service.submitH3(request());
      f.listeners.get(id)!(state({ status: 'completed', outputs: [output] }));
      const complete = await f.service.getJobState('first');
      expect(complete).toMatchObject({ status: 'completed', pipelineStage: 'RELEASING_H3_VRAM', h3VramReleaseSucceeded: succeeded, h3VramReleaseError: 'Release warning' });
      if (succeeded !== true) {
        await expect(f.service.submitH3(request('second'))).rejects.toThrow('Release warning');
        expect(f.submit).toHaveBeenCalledTimes(1);
        f.release.mockResolvedValue(success);
      }
      await f.service.submitH3(request('second'));
      expect(f.submit).toHaveBeenCalledTimes(2);
      expect(f.download).not.toHaveBeenCalled(); // Never starts while the first release attempt is unverified.
      expect(f.records.get('first')?.state.h3VramReleaseError).toBe(null);
    } finally { f.service.dispose(); }
  });

  it('releases during restart reconciliation with automatic download disabled', async () => {
    const f = setup(false);
    try {
      await f.service.submitH3(request());
      f.service.dispose();
      f.get.mockResolvedValue(state({ status: 'completed', outputs: [output] }));
      await f.service.restoreJobs();
      expect(f.release).toHaveBeenCalledTimes(1);
      expect(f.download).not.toHaveBeenCalled();
      expect(f.records.get('first')?.state).toMatchObject({ ...success, pipelineStage: 'COMPLETE', outputs: [output] });
      await f.service.downloadResult('first');
      expect(f.release).toHaveBeenCalledTimes(1);
      expect(f.download).toHaveBeenCalledTimes(1);
    } finally { f.service.dispose(); }
  });

  it('does not bypass the server queue check when there is no local history', async () => {
    const f = setup();
    try {
      f.idle.mockRejectedValue(new Error('ComfyUI queue is busy'));
      await expect(f.service.submitH3(request())).rejects.toThrow(/queue is busy/);
      expect(f.submit).not.toHaveBeenCalled();
    } finally { f.service.dispose(); }
  });

  it('resumes an interrupted release after restart before submitting the next generation', async () => {
    const f = setup(false);
    try {
      await f.service.submitH3(request());
      const record = f.records.get('first')!;
      record.state = state({ status: 'completed', outputs: [output], pipelineStage: 'RELEASING_H3_VRAM', h3VramReleaseRequested: true, h3VramReleaseDurationMs: null });
      const gate = deferred<H3VramReleaseAudit>();
      f.release.mockReturnValueOnce(gate.promise);
      f.service.dispose();
      const restore = f.service.restoreJobs();
      const submit = f.service.submitH3(request('second'));
      await Promise.resolve();
      expect(f.submit).toHaveBeenCalledTimes(1);
      gate.resolve(success);
      await restore;
      await submit;
      expect(f.release).toHaveBeenCalledTimes(1);
      expect(f.submit).toHaveBeenCalledTimes(2);
      expect(f.records.get('first')?.state).toMatchObject({ ...success, pipelineStage: 'COMPLETE' });
    } finally { f.service.dispose(); }
  });
});
