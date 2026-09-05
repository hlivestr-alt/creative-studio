import { afterEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { defaultSettings } from '../../src/domain/settings';
import type { ComputeJobState, H3VramReleaseAudit, RemoteH3GenerationRequest, RemoteH3JobRecord } from '../../src/domain/types';
import { RemoteComfyComputeProvider, type ComfyFetch } from './compute-provider';
import { ComputeService } from './compute-service';

const id = '550e8400-e29b-41d4-a716-446655440000';
const secondId = '550e8400-e29b-41d4-a716-446655440001';
const baseUrl = 'https://comfy.example.test';
const output = { nodeId: '92', kind: 'video', filename: 'result.mp4', subfolder: '', type: 'output', url: `${baseUrl}/view?filename=result.mp4` };
const success: H3VramReleaseAudit = { h3VramReleaseRequested: true, h3VramReleaseSucceeded: true, h3VramReleaseDurationMs: 2000, h3VramReleaseError: null };
const json = (value: unknown) => new Response(JSON.stringify(value));
const stats = (reserved: number | null) => ({ devices: [{ type: 'cuda', name: 'RTX 5090', vram_total: 32 * 1024 ** 3, vram_free: 31 * 1024 ** 3, torch_vram_total: reserved }] });
const history = (completed = true) => ({ [id]: { status: { completed, status_str: completed ? 'success' : 'running' }, outputs: { '92': { videos: [output] } } } });

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('native ComfyUI H3 memory handoff', () => {
  function provider(fetchImpl: ComfyFetch) { return new RemoteComfyComputeProvider({ baseUrl, workflowPath: '', fetchImpl }); }

  it('waits for actual completion even when SaveVideo descriptors already exist', async () => {
    const fetchImpl = vi.fn(async () => json(history(false)));
    const remote = provider(fetchImpl);
    expect(await remote.getJobState(id)).toMatchObject({ status: 'running', outputs: [expect.objectContaining({ nodeId: '92' })] });
    expect(await remote.releaseH3Vram(id)).toMatchObject({ h3VramReleaseRequested: false, h3VramReleaseSucceeded: false });
    expect(fetchImpl.mock.calls).toHaveLength(2);
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
    const pending = remote.releaseH3Vram(id);
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
      if (path === '/system_stats') return json(stats(10 * 1024 ** 3));
      free(); return new Response(null);
    });
    expect(await remote.releaseH3Vram(id)).toMatchObject({ h3VramReleaseRequested: false, h3VramReleaseSucceeded: false });
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
      if (path === '/system_stats') return json(stats(++samples <= 3 ? 10 * 1024 ** 3 : 0));
      expect(path).toBe('/free');
      expect(init?.method).toBe('POST');
      expect(JSON.parse(String(init?.body))).toEqual({ unload_models: true, free_memory: true });
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-token');
      return new Response(null, { status: 200 });
    } });
    let done = false;
    const pending = remote.releaseH3Vram(id).then((result) => { done = true; return result; });
    await vi.advanceTimersByTimeAsync(2000);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toMatchObject({ ...success, h3VramReleaseDurationMs: 4000, h3VramBeforeRelease: { devices: [{ torchReservedBytes: 10 * 1024 ** 3 }] }, h3VramAfterRelease: { devices: [{ torchReservedBytes: 0 }] } });
    expect(calls.filter((path) => path === '/free')).toHaveLength(1);
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
    const pending = remote.releaseH3Vram(id);
    await vi.advanceTimersByTimeAsync(16000);
    expect(await pending).toMatchObject({ h3VramReleaseRequested: true, h3VramReleaseSucceeded: mode.includes('retained') ? false : null, h3VramReleaseDurationMs: 15000, h3VramReleaseError: expect.any(String) });
  });

  it('surfaces a rejected free request instead of claiming success', async () => {
    const remote = provider(async (input) => {
      const path = new URL(input).pathname;
      if (path.startsWith('/history')) return json(history());
      if (path === '/queue') return json({ queue_running: [], queue_pending: [] });
      if (path === '/system_stats') return json(stats(10 * 1024 ** 3));
      return new Response('unavailable', { status: 503 });
    });
    expect(await remote.releaseH3Vram(id)).toMatchObject({ h3VramReleaseRequested: true, h3VramReleaseSucceeded: false, h3VramReleaseError: expect.stringContaining('503') });
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
    const pending = remote.releaseH3Vram(id);
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
      if (path === '/system_stats') return json(stats(0));
      freed = true; return new Response(null);
    });
    const pending = remote.releaseH3Vram(id);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toMatchObject({ h3VramReleaseRequested: true, h3VramReleaseSucceeded: false, h3VramReleaseError: expect.stringContaining('became busy') });
  });

  it('bounds stalled transport as well as the idle verification loop', async () => {
    vi.useFakeTimers();
    const remote = provider(async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
    }));
    const pending = remote.releaseH3Vram(id);
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
    const release = vi.spyOn(proto, 'releaseH3Vram').mockImplementation(async (_id, onRequested) => { onRequested?.(); return success; });
    const download = vi.spyOn(proto, 'downloadOutput').mockResolvedValue({ output, localPath: 'C:/outputs/result.mp4', downloadedAt: new Date().toISOString() });
    const service = new ComputeService(() => settings, (s) => events.push(s), false, { listRemoteH3Jobs: () => [...records.values()], upsertRemoteH3Job: (record) => { records.set(record.localJobId, record); return record; } });
    return { service, records, events, listeners, submit, get, release, download, idle };
  }

  it('persists descriptors, releases once, then downloads before accepting the next generation', async () => {
    const f = setup();
    try {
      await f.service.submitH3(request());
      const gate = deferred<H3VramReleaseAudit>();
      f.release.mockImplementationOnce(async (_id, onRequested) => { onRequested?.(); return gate.promise; });
      const complete = state({ status: 'completed', pipelineStage: 'GENERATING_H3', outputs: [output] });
      f.listeners.get(id)!(complete);
      f.listeners.get(id)!(complete);
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
    } finally { f.service.dispose(); }
  });

  it.each([false, null])('keeps video completion with release=%s and exposes its warning', async (succeeded) => {
    const f = setup();
    try {
      f.release.mockResolvedValue({ ...success, h3VramReleaseSucceeded: succeeded, h3VramReleaseError: 'Release warning' });
      await f.service.submitH3(request());
      f.listeners.get(id)!(state({ status: 'completed', outputs: [output] }));
      const complete = await f.service.getJobState('first');
      expect(complete).toMatchObject({ status: 'completed', pipelineStage: 'COMPLETE', h3VramReleaseSucceeded: succeeded, h3VramReleaseError: 'Release warning' });
      if (succeeded === false) {
        await expect(f.service.submitH3(request('second'))).rejects.toThrow('Release warning');
        expect(f.submit).toHaveBeenCalledTimes(1);
        f.release.mockResolvedValue(success);
      }
      await f.service.submitH3(request('second'));
      expect(f.submit).toHaveBeenCalledTimes(2);
      expect(f.download).toHaveBeenCalledTimes(1);
      expect(f.records.get('first')?.state.h3VramReleaseError).toBe(succeeded === false ? null : 'Release warning');
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
