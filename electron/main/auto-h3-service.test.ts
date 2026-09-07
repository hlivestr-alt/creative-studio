import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AutoH3Service } from './auto-h3-service';
import { HistoryDatabase, loadSqlite } from './database';
import { ComputeService } from './compute-service';
import { defaultSettings } from '../../src/domain/settings';
import { products } from '../../src/domain/data';
import { h3ContentTypeOptions, createOptionalH3ReferencePlan } from '../../src/domain/h3';
import type { ComputeJobState, H3VideoBrief, RemoteH3GenerationRequest } from '../../src/domain/types';
import { defaultChinaRoot, type AutoH3Config } from '../../src/domain/auto-h3';

const remoteId = '550e8400-e29b-41d4-a716-446655440000';
function state(request: RemoteH3GenerationRequest, done: boolean): ComputeJobState {
  return { localJobId: request.localJobId!, remotePromptId: remoteId, status: done ? 'completed' : 'running', progress: done ? 1 : 0.5, currentNode: null, queuePosition: null, queueRemaining: null, outputs: [{ filename: `${request.autoJobId}.mp4`, subfolder: '', type: 'output', kind: 'video', nodeId: '92', url: 'https://comfy.test/view' }], referenceUploads: [], remoteUploadedFilename: null, localResultPath: null, downloadError: null, error: null, connectionError: null, serverUrl: 'https://comfy.test', updatedAt: new Date().toISOString(), h3VramReleaseSucceeded: done ? true : null, h3VramReleaseDurationMs: done ? 1000 : null };
}

describe('Auto H3 simulation (no GPU)', () => {
  let root: string;
  let db: HistoryDatabase;
  let service: AutoH3Service;
  let compute: ComputeService;
  let config: AutoH3Config;
  let submitted: RemoteH3GenerationRequest[];
  let complete: boolean;
  let disconnected: boolean;
  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'proya-auto-simulation-'));
    db = new HistoryDatabase(join(root, 'test.sqlite'), await loadSqlite());
    const settings = defaultSettings(process.cwd());
    const brief: H3VideoBrief = { product: products[0].id, contentType: h3ContentTypeOptions[0], creativeVariety: 'Balanced', videoIdea: '', language: 'English', musicOnly: true, captions: false, subtitles: false, goal: 'Product reveal', customGoal: '', duration: 4, aspectRatio: '9:16', customAspectRatio: '', qualityPreset: 'Custom', megapixels: 0.98, multiple: 32, fps: 24, steps: 20, seedMode: 'random', seed: 42, refImageSize: 'max', workflowMode: 'REF2VA', cameraMotion: 'Cinematic', actionIntensity: 'High', pacing: 'Balanced', productFidelity: 'Exact', scheduler: 'simple', ending: 'Hero Shot', customEnding: '', sound: 'Music Only', promptDetail: 'Production', specialInstructions: '', references: createOptionalH3ReferencePlan(products[0]) };
    config = { selectedProducts: products.slice(0, 3).map(p => p.id), selectedContentTypes: [...h3ContentTypeOptions], shuffleProducts: false, shuffleContentTypes: false, chinaRoot: defaultChinaRoot, laptopRoot: root, brief };
    submitted = []; complete = false; disconnected = false;
    compute = new ComputeService(() => settings, () => undefined, true, db);
    vi.spyOn(compute.autoProvider(), 'testAutoArchive').mockResolvedValue();
    vi.spyOn(compute.autoProvider(), 'archiveAutoOutput').mockResolvedValue({ path: 'D:\\AI Videos\\verified.mp4', size: 5 });
    vi.spyOn(compute.autoProvider(), 'downloadAutoArchive').mockRejectedValue(new Error('HTTP 502'));
    vi.spyOn(compute, 'submitH3').mockImplementation(async request => { submitted.push(request); return state(request, false); });
    vi.spyOn(compute, 'recoverAutoJob').mockImplementation(async id => {
      if (disconnected) throw new Error('Cloudflare disconnect HTTP 502');
      const request = submitted.find(r => r.localJobId === id);
      return request ? state(request, complete) : null;
    });
    service = new AutoH3Service(db, compute, () => settings);
  });
  afterEach(() => { service.dispose(); compute.dispose(); db.close(); vi.useRealTimers(); rmSync(root, { recursive: true, force: true }); });
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

  it('executes products outermost, registry types innermost, two complete cycles', async () => {
    await service.start(config); await flush(); complete = true;
    const expected = config.selectedProducts.length * h3ContentTypeOptions.length * 2;
    for (let i = 0; i < expected; i++) { await service.tick(); if (i < expected - 1) await service.tick(); }
    expect(submitted).toHaveLength(expected);
    expect(expected).toBe(3 * h3ContentTypeOptions.length * 2);
    const order = [1, 2].flatMap(cycle => config.selectedProducts.flatMap(product => h3ContentTypeOptions.map(type => [cycle, product, type])));
    expect(service.snapshot().jobs.reverse().map(j => [j.cycleNumber, j.product, j.contentType])).toEqual(order);
    expect(service.snapshot().sessions[0].cycleNumber).toBe(3);
    expect(new Set(submitted.map(r => r.autoJobId)).size).toBe(expected);
    expect(new Set(submitted.map(r => r.seed)).size).toBe(expected);
  }, 30000);

  it('runs the requested three product / seven selected type / two cycle fixture (42)', async () => {
    config.selectedContentTypes = h3ContentTypeOptions.slice(0, 7);
    await service.start(config); await flush(); complete = true;
    for (let i = 0; i < 42; i++) { await service.tick(); if (i < 41) await service.tick(); }
    expect(submitted).toHaveLength(42);
    expect(service.snapshot().sessions[0].cycleNumber).toBe(3);
  }, 30000);

  it('Stop After Current finishes the job and does not submit another', async () => {
    await service.start(config); await flush();
    await service.stop(service.snapshot().sessions[0].sessionId); await flush();
    expect(service.snapshot().sessions[0].status).toBe('STOPPING');
    complete = true; await service.tick(); await service.tick();
    expect(service.snapshot().sessions[0].status).toBe('STOPPED');
    expect(submitted).toHaveLength(1);
    expect(service.snapshot().jobs[0].downloadStatus).toBe('PENDING_DOWNLOAD');
  });

  it('30 second outage retries every five seconds and resumes the same remote job', async () => {
    await service.start(config); await flush();
    vi.useFakeTimers(); disconnected = true; service.activate();
    const reconcile = vi.mocked(compute.recoverAutoJob); reconcile.mockClear();
    await vi.advanceTimersByTimeAsync(30000);
    expect(reconcile).toHaveBeenCalledTimes(6);
    expect(submitted).toHaveLength(1);
    disconnected = false; await vi.advanceTimersByTimeAsync(5000);
    expect(reconcile).toHaveBeenLastCalledWith(submitted[0].localJobId);
    expect(submitted).toHaveLength(1);
  });

  it('failed laptop download does not block the next GPU job', async () => {
    await service.start(config); await flush(); complete = true; await service.tick();
    await service.downloadTick(); await service.tick();
    expect(submitted).toHaveLength(2);
    const first = service.snapshot().jobs.find(j => j.autoJobId === submitted[0].autoJobId)!;
    expect(first.downloadStatus).toBe('PENDING_DOWNLOAD');
    expect(first.laptopDownloadError).toContain('502');
    expect(first.chinaArchiveSucceeded).toBe(true);
  });

  it('recovers session cursor and pending downloads from SQLite without auto starting GPU', async () => {
    await service.start(config); await flush(); complete = true; await service.tick();
    await service.tick();
    const original = service.snapshot().sessions[0];
    service.dispose(); db.close();
    db = new HistoryDatabase(join(root, 'test.sqlite'), await loadSqlite());
    service = new AutoH3Service(db, compute, () => defaultSettings(process.cwd()));
    expect(service.snapshot().sessions[0].status).toBe('INTERRUPTED');
    expect(service.snapshot().sessions[0].currentJobId).toBe(original.currentJobId);
    await service.tick(); await service.downloadTick();
    expect(submitted).toHaveLength(2);
    service.resume(original.sessionId); await flush();
    expect(submitted).toHaveLength(2); // adopts the second job
  });

  it.each([false, null])('does not advance when VRAM release is %s', async released => {
    await service.start(config); await flush();
    vi.mocked(compute.recoverAutoJob).mockResolvedValue({ ...state(submitted[0], true), h3VramReleaseSucceeded: released });
    await service.tick(); await service.tick();
    expect(submitted).toHaveLength(1);
    expect(service.snapshot().sessions[0].completedCount).toBe(0);
  });

  it.each([['PROMPT_GENERATION_FAILED', 3], ['GENERATING_H3', 2]] as const)('bounds deterministic %s failures and moves to the next combination', async (stage, count) => {
    await service.start(config); await flush();
    vi.mocked(compute.recoverAutoJob).mockImplementation(async id => {
      const request = submitted.find(r => r.localJobId === id);
      return request ? { ...state(request, true), status: 'failed', pipelineStage: stage, error: 'deterministic test failure' } : null;
    });
    for (let i = 0; i < count; i++) { await service.tick(); if (i < count - 1) await service.tick(); }
    expect(submitted).toHaveLength(count);
    expect(service.snapshot().sessions[0].contentTypeIndex).toBe(1);
    expect(service.snapshot().sessions[0].failedCount).toBe(count);
    expect(service.snapshot().jobs.every(j => j.diagnostics.includes('deterministic test failure'))).toBe(true);
  });

  it('keeps download concurrency at one while the next video can be submitted', async () => {
    await service.start(config); await flush(); complete = true; await service.tick();
    let rejectDownload!: (error: Error) => void;
    const download = vi.mocked(compute.autoProvider().downloadAutoArchive);
    download.mockImplementation(() => new Promise((_resolve, reject) => { rejectDownload = reject; }));
    const pending = service.downloadTick(); await flush();
    await service.downloadTick(); await service.tick();
    expect(download).toHaveBeenCalledTimes(1);
    expect(submitted).toHaveLength(2);
    rejectDownload(new Error('HTTP 502')); await pending;
    download.mockRejectedValue(new Error('HTTP 502'));
    await service.downloadTick(); expect(download).toHaveBeenCalledTimes(2);
  });

  it('retries archive copying separately without rerendering the completed video', async () => {
    await service.start(config); await flush(); complete = true; await service.tick();
    vi.mocked(compute.autoProvider().archiveAutoOutput).mockRejectedValueOnce(new Error('Copy permission temporarily unavailable'));
    await service.downloadTick(); await service.tick();
    expect(submitted).toHaveLength(2);
    const first = service.snapshot().jobs.find(j => j.autoJobId === submitted[0].autoJobId)!;
    expect(first.status).toBe('COMPLETED');
    expect(first.chinaArchiveError).toContain('Copy permission');
    await service.downloadTick();
    expect(service.snapshot().jobs.find(j => j.autoJobId === first.autoJobId)?.chinaArchiveSucceeded).toBe(true);
    expect(submitted).toHaveLength(2);
  });

  it('keeps fixed H3 seeds while making fresh creative plans and supports cancellation', async () => {
    config.brief.seedMode = 'fixed'; config.brief.seed = 42;
    await service.start(config); await flush(); complete = true; await service.tick(); await service.tick();
    expect(submitted.map(r => r.seed)).toEqual([42, 42]);
    const first = service.snapshot().jobs.find(j => j.autoJobId === submitted[0].autoJobId)!;
    service.cancelDownload(first.autoJobId);
    await service.downloadTick();
    expect(compute.autoProvider().downloadAutoArchive).not.toHaveBeenCalled();
    expect(service.snapshot().jobs.find(j => j.autoJobId === first.autoJobId)?.downloadStatus).toBe('CANCELLED');
  });

  it('Stop Now targets the current prompt and suppresses a rerender retry', async () => {
    vi.spyOn(compute.autoProvider(), 'interruptAutoJob').mockResolvedValue();
    await service.start(config); await flush();
    await service.stop(service.snapshot().sessions[0].sessionId, true); await flush();
    expect(compute.autoProvider().interruptAutoJob).toHaveBeenCalledWith(remoteId);
    vi.mocked(compute.recoverAutoJob).mockResolvedValue({ ...state(submitted[0], true), status: 'failed', error: 'Execution interrupted' });
    await service.tick(); await service.tick();
    expect(submitted).toHaveLength(1);
    expect(service.snapshot().sessions[0].status).toBe('STOPPED');
  });
});
