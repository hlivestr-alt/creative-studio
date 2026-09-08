import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AutoH3Service, sanitizeAutoH3Brief } from './auto-h3-service';
import { HistoryDatabase, loadSqlite } from './database';
import { ComputeService } from './compute-service';
import { defaultSettings } from '../../src/domain/settings';
import { products } from '../../src/domain/data';
import { h3ContentTypeOptions, createOptionalH3ReferencePlan } from '../../src/domain/h3';
import type { ComputeJobState, H3VideoBrief, RemoteH3GenerationRequest } from '../../src/domain/types';
import { defaultChinaRoot, type AutoH3Config } from '../../src/domain/auto-h3';
import { autoH3CurrentStage } from '../../src/ui/AutoH3Panel';

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

  it('freezes the current job and resolves the next job from the latest H3 brief', async () => {
    await service.start(config); await flush();
    expect(service.snapshot().sessions[0]).not.toHaveProperty('brief');
    expect(submitted).toHaveLength(1);
    const first = submitted[0];
    const updatedBrief: H3VideoBrief = {
      ...structuredClone(config.brief),
      duration: 8,
      aspectRatio: '16:9',
      megapixels: 0.49,
      multiple: 16,
      steps: 12,
      scheduler: 'beta',
      seedMode: 'fixed',
      seed: 424242,
      refImageSize: 'match',
      language: 'Indonesian',
      musicOnly: false,
      captions: true,
      subtitles: true,
      sound: 'Sound + Music'
    };
    updatedBrief.references.productReference = { source: 'local-file', description: 'stale manual reference', path: 'C:\\stale\\eye-cream.png' };

    service.updateCurrentBrief(updatedBrief);
    expect(first.workflowSettings).toMatchObject({ durationSeconds: 4, aspectRatio: '9:16', megapixels: 0.98, multiple: 32, fps: 24, steps: 20, scheduler: 'simple', seedMode: 'random', refImageSize: 'max' });
    expect(first.generationBrief).toMatchObject({ duration: 4, aspectRatio: '9:16', language: 'English', musicOnly: true, captions: false, subtitles: false, sound: 'Music Only' });

    complete = true;
    await service.tick();
    await service.tick();

    expect(submitted).toHaveLength(2);
    expect(submitted[1].workflowSettings).toMatchObject({ durationSeconds: 8, aspectRatio: '16:9', megapixels: 0.49, multiple: 16, fps: 24, steps: 12, scheduler: 'beta', seedMode: 'fixed', seed: 424242, refImageSize: 'match' });
    expect(submitted[1].generationBrief).toMatchObject({ duration: 8, aspectRatio: '16:9', language: 'Indonesian', musicOnly: false, captions: true, subtitles: true, sound: 'Sound + Music' });
    expect(submitted[1].productReferencePath).toContain(products[0].imagePath.replaceAll('/', '\\').split('\\').at(-1));
    expect(submitted[1].productReferencePath).not.toContain('eye-cream.png');
  });

  it('sanitizes stale single-job references and injects each Auto Run product master', async () => {
    config.selectedProducts = products.slice(0, 2).map(product => product.id);
    config.selectedContentTypes = [h3ContentTypeOptions[0]];
    config.brief.references = {
      firstFrame: { source: 'local-file', description: 'manual first', path: 'C:\\manual\\first.png' },
      lastFrame: { source: 'local-file', description: 'manual last', path: 'C:\\manual\\last.png' },
      productReference: { source: 'local-file', description: 'old product', path: 'C:\\manual\\eye-cream.png' },
      styleReference: { source: 'local-file', description: 'manual style', path: 'C:\\manual\\style.png' },
      referenceImages: [{ role: 'product-front', asset: { source: 'local-file', description: 'manual angle', path: 'C:\\manual\\angle.png' } }]
    };
    const original = structuredClone(config.brief);

    await service.start(config); await flush();
    expect(config.brief).toEqual(original);
    expect(submitted).toHaveLength(1);
    expect(submitted[0].referenceImages).toHaveLength(1);
    expect(submitted[0].productReferencePath).toContain(products[0].imagePath.replaceAll('/', '\\').split('\\').at(-1));
    expect(JSON.stringify(submitted[0])).not.toContain('C:\\manual');

    complete = true;
    await service.tick();
    await service.tick();
    expect(submitted).toHaveLength(2);
    expect(submitted[1].product).toBe(products[1].id);
    expect(submitted[1].productReferencePath).toContain(products[1].imagePath.replaceAll('/', '\\').split('\\').at(-1));
    expect(submitted[1].productReferencePath).not.toBe(submitted[0].productReferencePath);
    expect(JSON.stringify(submitted[1])).not.toContain(products[0].imagePath);
  });

  it('keeps manual references intact outside the Auto Run sanitizer input', () => {
    const manual = structuredClone(config.brief);
    manual.references.productReference = { source: 'local-file', description: 'manual single-job reference', path: 'C:\\manual\\single.png' };
    const sanitized = sanitizeAutoH3Brief(manual);
    expect(manual.references.productReference).toMatchObject({ source: 'local-file', path: 'C:\\manual\\single.png' });
    expect(sanitized.references.productReference).toEqual({ source: 'none', description: '', path: null });
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

  it('advances a validation failure once after cleanup and does not rerender the invalid combination', async () => {
    await service.start(config); await flush();
    vi.mocked(compute.recoverAutoJob).mockImplementation(async id => {
      const request = submitted.find(r => r.localJobId === id);
      if (!request) return null;
      if (request === submitted[0]) return {
        ...state(request, true),
        status: 'failed',
        pipelineStage: 'PROMPT_VALIDATION_FAILED',
        failureStage: 'PROMPT_VALIDATION_FAILED',
        error: 'PROMPT_VALIDATION_FAILED: invalid after all repair attempts',
        llmUnloadRequested: true,
        llmUnloadSucceeded: true,
        llmInstanceId: 'exact-qwen-instance'
      };
      return state(request, false);
    });

    await service.tick();
    expect(service.snapshot().sessions[0]).toMatchObject({ failedCount: 1, contentTypeIndex: 1 });
    expect(submitted).toHaveLength(1);

    await service.tick();
    expect(submitted).toHaveLength(2);
    expect(service.snapshot().sessions[0].failedCount).toBe(1);
    await service.tick();
    expect(service.snapshot().sessions[0].failedCount).toBe(1);
  });

  it('advances a REMOTE_STATE_LOST orphan exactly once without rerendering the vanished prompt', async () => {
    await service.start(config); await flush();
    const first = submitted[0];
    vi.mocked(compute.recoverAutoJob).mockResolvedValueOnce({
      ...state(first, true),
      status: 'failed',
      remotePromptId: null,
      pipelineStage: 'REMOTE_STATE_LOST',
      failureStage: 'REMOTE_STATE_LOST',
      error: 'Remote execution record was lost. Marked failed and continuing.',
      h3LifecycleDiagnostics: {
        previousJobId: first.autoJobId!,
        previousPromptId: remoteId,
        h3WasSubmitted: true,
        remoteQueueState: 'empty',
        historyState: 'missing',
        outputCaptured: false,
        chinaArchived: false,
        vramReleaseRequested: false,
        vramReleaseSucceeded: null,
        reasonForBlocking: 'Remote execution record was lost. Marked failed and continuing.',
        remoteLifecycleState: 'REMOTE_STATE_LOST',
        orphanReconciliationAttempts: 3
      }
    });
    await service.tick();
    const finalized = service.snapshot();
    expect(finalized.sessions[0]).toMatchObject({ failedCount: 1, contentTypeIndex: 1, currentJobId: null, lastError: null });
    expect(finalized.jobs.find(job => job.autoJobId === first.autoJobId)?.state).toMatchObject({
      status: 'failed',
      remotePromptId: null,
      currentNode: null,
      h3VramReleaseRequested: false,
      h3VramReleaseSucceeded: null,
      h3LifecycleDiagnostics: { previousPromptId: remoteId, reasonForBlocking: null }
    });
    expect(submitted).toHaveLength(1);
    await service.tick();
    expect(submitted).toHaveLength(2);
    expect(submitted[1].autoJobId).not.toBe(first.autoJobId);
    expect(service.snapshot().sessions[0].failedCount).toBe(1);
  });

  it('advances successfully after archive-only completion cleanup without recounting failure or resubmitting H3', async () => {
    await service.start(config); await flush();
    const first = submitted[0];
    vi.mocked(compute.recoverAutoJob).mockImplementation(async id => {
      const request = submitted.find(item => item.localJobId === id);
      if (!request) return null;
      if (id !== first.autoJobId) return state(request, false);
      return {
        ...state(first, true), outputs: [], h3VramReleaseRequested: true, h3VramReleaseSucceeded: true,
        h3VramReleaseDurationMs: 2000,
        h3LifecycleDiagnostics: {
          previousJobId: first.autoJobId!, previousPromptId: remoteId, h3WasSubmitted: true,
          remoteQueueState: 'empty', historyState: 'missing', outputCaptured: false, chinaArchived: true,
          vramReleaseRequested: true, vramReleaseSucceeded: true, reasonForBlocking: null,
          remoteLifecycleState: 'RECOVERED_COMPLETED'
        }
      };
    });

    await service.tick();
    expect(service.snapshot().sessions[0]).toMatchObject({ completedCount: 1, failedCount: 0, contentTypeIndex: 1 });
    expect(submitted).toHaveLength(1);
    await service.tick();
    expect(submitted).toHaveLength(2);
    expect(submitted[1].autoJobId).not.toBe(first.autoJobId);
    expect(service.snapshot().sessions[0].failedCount).toBe(0);
    expect(compute.autoProvider().archiveAutoOutput).not.toHaveBeenCalled();
  });

  it('uses only the connection blocker after lost finalization and automatically starts the next item on reconnect', async () => {
    await service.start(config); await flush();
    const first = submitted[0];
    vi.mocked(compute.recoverAutoJob).mockImplementation(async id => {
      if (id !== first.autoJobId) return null;
      return {
        ...state(first, true), status: 'failed', remotePromptId: null,
        pipelineStage: 'REMOTE_STATE_LOST', failureStage: 'REMOTE_STATE_LOST',
        error: 'Remote execution record was lost. Marked failed and continuing without resubmitting the old prompt.',
        h3LifecycleDiagnostics: {
          previousJobId: first.autoJobId!, previousPromptId: remoteId, h3WasSubmitted: true,
          remoteQueueState: 'empty', historyState: 'missing', outputCaptured: false, chinaArchived: false,
          vramReleaseRequested: false, vramReleaseSucceeded: null, reasonForBlocking: null,
          remoteLifecycleState: 'REMOTE_STATE_LOST', orphanReconciliationAttempts: 3
        }
      };
    });
    await service.tick();

    disconnected = true;
    vi.mocked(compute.submitH3).mockImplementation(async request => {
      if (disconnected) throw new Error('Cloudflare network connection lost HTTP 502');
      submitted.push(request);
      return state(request, false);
    });
    await service.tick();
    let snapshot = service.snapshot();
    const waitingJob = snapshot.jobs.find(job => job.autoJobId === snapshot.sessions[0].currentJobId);
    expect(snapshot.sessions[0]).toMatchObject({ failedCount: 1, contentTypeIndex: 1 });
    expect(snapshot.sessions[0].lastError).toContain('Cloudflare network connection lost');
    expect(snapshot.sessions[0].lastError).not.toContain('previous H3 job is not finished');
    expect(autoH3CurrentStage(true, snapshot.sessions[0].lastError, waitingJob)).toBe('WAITING_FOR_REMOTE');
    expect(submitted).toHaveLength(1);

    disconnected = false;
    await service.tick();
    snapshot = service.snapshot();
    expect(submitted).toHaveLength(2);
    expect(submitted[1].autoJobId).toBe(snapshot.sessions[0].currentJobId);
    expect(submitted[1].autoJobId).not.toBe(first.autoJobId);
    expect(snapshot.sessions[0].failedCount).toBe(1);
  });

  it('does not recount or re-enter reconciliation after a persisted REMOTE_STATE_LOST restart', async () => {
    await service.start(config); await flush();
    const first = submitted[0];
    vi.mocked(compute.recoverAutoJob).mockResolvedValueOnce({
      ...state(first, true), status: 'failed', remotePromptId: null,
      pipelineStage: 'REMOTE_STATE_LOST', failureStage: 'REMOTE_STATE_LOST',
      error: 'Remote execution record was lost.',
      h3LifecycleDiagnostics: {
        previousJobId: first.autoJobId!, previousPromptId: remoteId, h3WasSubmitted: true,
        remoteQueueState: 'empty', historyState: 'missing', outputCaptured: false, chinaArchived: false,
        vramReleaseRequested: false, vramReleaseSucceeded: null, reasonForBlocking: null,
        remoteLifecycleState: 'REMOTE_STATE_LOST', orphanReconciliationAttempts: 3
      }
    });
    await service.tick();
    const sessionId = service.snapshot().sessions[0].sessionId;
    service.dispose(); db.close();
    db = new HistoryDatabase(join(root, 'test.sqlite'), await loadSqlite());
    service = new AutoH3Service(db, compute, () => defaultSettings(process.cwd()));
    expect(service.snapshot().sessions[0]).toMatchObject({ status: 'INTERRUPTED', failedCount: 1, currentJobId: null, contentTypeIndex: 1 });

    service.resume(sessionId, config.brief); await flush();
    expect(submitted).toHaveLength(2);
    expect(submitted[1].autoJobId).not.toBe(first.autoJobId);
    expect(service.snapshot().sessions[0].failedCount).toBe(1);
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

  it('Stop Now records a local stop when the remote interrupt is unavailable', async () => {
    vi.spyOn(compute.autoProvider(), 'interruptAutoJob').mockRejectedValue(new Error('HTTP 502'));
    await service.start(config); await flush();
    const sessionId = service.snapshot().sessions[0].sessionId;

    const snapshot = await service.stop(sessionId, true);

    expect(snapshot.sessions[0].status).toBe('STOPPED');
    expect(snapshot.sessions[0].stoppedAt).toBeTruthy();
    expect(snapshot.sessions[0].lastError).toContain('remote interrupt not confirmed');
    expect(snapshot.jobs[0].diagnostics.join('\n')).toContain('HTTP 502');
  });
});
