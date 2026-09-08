import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultSettings } from '../../src/domain/settings';
import { ComputeService, readExactSystemPrompt, readH3WorkflowDefaultsFromFile, reconcileRemoteJobState, withWorkflowSettingsSnapshot } from './compute-service';
import { h3WorkflowTemplateDefaults, validateH3WorkflowSettings } from '../../src/domain/minimax-h3-workflow';
import type { ComputeJobState, RemoteH3GenerationRequest, RemoteH3JobRecord } from '../../src/domain/types';

const remotePromptId = '550e8400-e29b-41d4-a716-446655440000';

function state(status: ComputeJobState['status'], overrides: Partial<ComputeJobState> = {}): ComputeJobState {
  return {
    localJobId: 'local-job-1', remotePromptId: '550e8400-e29b-41d4-a716-446655440000', status, progress: null, currentNode: null, queuePosition: null, queueRemaining: null, outputs: [], referenceUploads: [],
    remoteUploadedFilename: 'PROYA_H3_REF_serum_hash.png', localResultPath: 'C:/outputs/result.mp4', downloadError: null, error: null, connectionError: null,
    serverUrl: 'https://comfy.example.test', updatedAt: '2026-08-31T00:00:00.000Z', ...overrides
  };
}

function remoteRequest(localJobId?: string): RemoteH3GenerationRequest {
  return {
    prompt: 'Final prompt', mode: 'REF2VA', duration: 4, aspectRatio: '9:16', fps: 24, frames: 107, megapixels: 0.98, multiple: 32,
    firstFrame: null, lastFrame: null, productReference: 'reference.png', ...(localJobId ? { localJobId } : {})
  };
}

function remoteRecord(localJobId: string, currentState: ComputeJobState, remoteId: string | null): RemoteH3JobRecord {
  const request = remoteRequest(localJobId);
  return {
    localJobId,
    remotePromptId: remoteId,
    createdAt: currentState.updatedAt,
    updatedAt: currentState.updatedAt,
    promptRecordId: null,
    product: null,
    workflowMode: 'REF2VA',
    prompt: request.prompt ?? '',
    request,
    localSourceReferencePath: null,
    remoteUploadedFilename: null,
    outputMetadata: currentState.outputs,
    localDownloadedPath: null,
    status: currentState.status,
    state: currentState
  };
}

describe('ComputeService job reconciliation', () => {
  it('reads Reset to Workflow Defaults from the current API workflow file', () => {
    const defaults = readH3WorkflowDefaultsFromFile(join(process.cwd(), 'workflows', 'minimax-h3-api.json'));
    expect(defaults).toEqual(h3WorkflowTemplateDefaults);
  });

  it('reads the authoritative system prompt byte-for-byte and fails closed when absent', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'proya-h3-system-prompt-'));
    try {
      const promptPath = join(temporaryDirectory, 'minimax-h3-lmstudio-system.md');
      const exactText = 'System Prompt: Video Prompt Rewriter\r\nKeep these bytes.\r\n';
      writeFileSync(promptPath, exactText, 'utf8');
      expect(readExactSystemPrompt(promptPath)).toEqual({ text: exactText, hash: createHash('sha256').update(exactText, 'utf8').digest('hex') });
      expect(() => readExactSystemPrompt(join(temporaryDirectory, 'missing.md'))).toThrow(/system prompt is missing/);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('keeps the supplied production system-prompt SHA unchanged', () => {
    const prompt = readExactSystemPrompt(join(process.cwd(), 'prompts', 'minimax-h3-lmstudio-system.md'));
    expect(prompt.hash).toBe('267166287054ae853f25eadeaee73750be2fe874678c4a47adc2a4a1c15aaef2');
  });

  it('reloads changed defaults from the configured workflow file', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'proya-h3-workflow-'));
    try {
      const workflow = JSON.parse(readFileSync(join(process.cwd(), 'workflows', 'minimax-h3-api.json'), 'utf8')) as Record<string, Record<string, Record<string, unknown>>>;
      const metadata = workflow['115']._meta as Record<string, unknown>;
      const defaults = metadata.proya_h3_workflow_defaults as Record<string, unknown>;
      defaults.steps = 36;
      const workflowPath = join(temporaryDirectory, 'minimax-h3-api.json');
      writeFileSync(workflowPath, JSON.stringify(workflow), 'utf8');

      expect(readH3WorkflowDefaultsFromFile(workflowPath).steps).toBe(36);
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('captures a complete effective workflow snapshot and a fresh random seed', () => {
    const first = withWorkflowSettingsSnapshot(remoteRequest());
    const second = withWorkflowSettingsSnapshot(remoteRequest());

    expect(first.workflowSettings).toMatchObject({ durationSeconds: 4, aspectRatio: '9:16', frameLength: 107, steps: 20, scheduler: 'simple', seedMode: 'random', refImageSize: 'match' });
    expect(first.workflowSettings?.seed).toBe(first.seed);
    expect(Number.isSafeInteger(first.workflowSettings?.seed)).toBe(true);
    expect(Number.isSafeInteger(second.workflowSettings?.seed)).toBe(true);
    expect(second.workflowSettings?.seed).not.toBe(first.workflowSettings?.seed);
  });

  it('preserves an exact fixed seed in the submitted snapshot', () => {
    const request = withWorkflowSettingsSnapshot({ ...remoteRequest(), seed: 424242, steps: 32, scheduler: 'beta', refImageSize: 'max' });

    expect(request.workflowSettings).toMatchObject({ seed: 424242, seedMode: 'fixed', steps: 32, scheduler: 'beta', refImageSize: 'max' });
    expect(request.seed).toBe(424242);
  });

  it('keeps a supplied duration snapshot immutable and derives the native frame length from it', () => {
    const snapshot = validateH3WorkflowSettings({
      ...h3WorkflowTemplateDefaults,
      durationSeconds: 15,
      seedMode: 'fixed',
      seed: 42
    });
    const request = withWorkflowSettingsSnapshot({
      ...remoteRequest(),
      duration: 15,
      frames: snapshot.frameLength,
      megapixels: snapshot.megapixels,
      multiple: snapshot.multiple,
      fps: snapshot.fps,
      steps: snapshot.steps,
      seed: snapshot.seed,
      scheduler: snapshot.scheduler,
      refImageSize: snapshot.refImageSize,
      workflowSettings: snapshot
    });

    expect(request.workflowSettings).toMatchObject({ durationSeconds: 15, frameLength: 362 });
    expect(request.duration).toBe(15);
    expect(request.frames).toBe(362);
    expect(request.workflowSettings).not.toBe(snapshot);
  });

  it('keeps a queued or running job recoverable when the restarted client cannot see it yet', () => {
    const reconciled = reconcileRemoteJobState(state('running', { progress: 0.45 }), state('submitted'));
    expect(reconciled.status).toBe('running');
    expect(reconciled.progress).toBe(0.45);
    expect(reconciled.connectionError).toMatch(/not exposed/);
    expect(reconciled.localResultPath).toBe('C:/outputs/result.mp4');
  });

  it('accepts terminal history state and preserves persisted upload metadata', () => {
    const reconciled = reconcileRemoteJobState(state('queued'), state('completed', {
      outputs: [{ nodeId: '92', kind: 'video', filename: 'result.mp4', subfolder: '', type: 'output', url: 'https://comfy.example.test/view?filename=result.mp4' }],
      progress: 1
    }));
    expect(reconciled).toMatchObject({ status: 'completed', progress: 1, remoteUploadedFilename: 'PROYA_H3_REF_serum_hash.png', outputs: [{ nodeId: '92', kind: 'video' }] });
  });

  it('restores using remotePromptId and never sends a legacy local ID to ComfyUI', async () => {
    const persisted = [remoteRecord('local-h3-job-123', state('queued', { localJobId: 'local-h3-job-123', remotePromptId }), remotePromptId)];
    const persistence = {
      listRemoteH3Jobs: () => persisted,
      upsertRemoteH3Job: (record: RemoteH3JobRecord) => { persisted[0] = record; return record; }
    };
    const requestedUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      requestedUrls.push(url);
      if (new URL(url).pathname === `/history/${remotePromptId}`) {
        return new Response(JSON.stringify({ [remotePromptId]: { status: { status_str: 'running', completed: false }, outputs: {} } }), { status: 200 });
      }
      throw new Error(`Unexpected ComfyUI request: ${url}`);
    };
    const settings = { ...defaultSettings(process.cwd()), computeMode: 'remote' as const, remoteComfyUrl: 'https://comfy.example.test', remoteComfyWorkflowPath: join(process.cwd(), 'workflows', 'minimax-h3-api.json'), remoteAutoDownload: false };
    const service = new ComputeService(() => settings, () => undefined, false, persistence);
    try {
      await service.restoreJobs();
      expect(requestedUrls.some(url => new URL(url).pathname === `/history/${remotePromptId}`)).toBe(true);
      expect(requestedUrls.some(url => new URL(url).pathname === '/history/local-h3-job-123')).toBe(false);
      expect(persisted[0]).toMatchObject({ localJobId: 'local-h3-job-123', remotePromptId, state: { localJobId: 'local-h3-job-123', remotePromptId } });
    } finally {
      service.dispose();
      globalThis.fetch = originalFetch;
    }
  });

  it('marks a legacy tracked job unreconcilable without contacting ComfyUI', async () => {
    const persisted = [remoteRecord('legacy-local-job', state('queued', { localJobId: 'legacy-local-job', remotePromptId: null }), null)];
    const persistence = {
      listRemoteH3Jobs: () => persisted,
      upsertRemoteH3Job: (record: RemoteH3JobRecord) => { persisted[0] = record; return record; }
    };
    let fetchCount = 0;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { fetchCount += 1; throw new Error('should not contact ComfyUI'); };
    const settings = { ...defaultSettings(process.cwd()), computeMode: 'remote' as const, remoteComfyUrl: 'https://comfy.example.test', remoteComfyWorkflowPath: join(process.cwd(), 'workflows', 'minimax-h3-api.json'), remoteAutoDownload: false };
    const service = new ComputeService(() => settings, () => undefined, false, persistence);
    try {
      await service.restoreJobs();
      expect(fetchCount).toBe(0);
      expect(persisted[0]).toMatchObject({ localJobId: 'legacy-local-job', remotePromptId: null, state: { status: 'error', remotePromptId: null } });
    } finally {
      service.dispose();
      globalThis.fetch = originalFetch;
    }
  });

  it('keeps a completed H3 job retryable when the first laptop download fails', async () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'proya-h3-download-retry-'));
    const output = { nodeId: '92', kind: 'video', filename: 'result.mp4', subfolder: '', type: 'output', url: '' };
    const completed = state('completed', {
      localResultPath: null, outputs: [output], h3VramReleaseRequested: true,
      h3VramReleaseSucceeded: true, h3VramReleaseDurationMs: 2000
    });
    const persisted = [remoteRecord('retryable-h3-job', completed, remotePromptId)];
    const persistence = {
      listRemoteH3Jobs: () => persisted,
      upsertRemoteH3Job: (record: RemoteH3JobRecord) => { persisted[0] = record; return record; }
    };
    const settings = {
      ...defaultSettings(process.cwd()),
      computeMode: 'remote' as const,
      remoteComfyUrl: 'https://comfy.example.test',
      remoteComfyWorkflowPath: join(process.cwd(), 'workflows', 'minimax-h3-api.json'),
      remoteOutputDirectory: temporaryDirectory,
      remoteAutoDownload: false
    };
    const originalFetch = globalThis.fetch;
    let downloadAttempts = 0;
    globalThis.fetch = async (input) => {
      if (!String(input).includes('/view?')) throw new Error(`Unexpected request during retry test: ${String(input)}`);
      downloadAttempts += 1;
      if (downloadAttempts === 1) throw new Error('laptop connection dropped');
      return new Response(Buffer.from('video-fixture'), { status: 200 });
    };
    const service = new ComputeService(() => settings, () => undefined, false, persistence);
    try {
      await expect(service.downloadResult('retryable-h3-job')).rejects.toThrow(/connection dropped/);
      expect(persisted[0].state).toMatchObject({ status: 'failed', pipelineStage: 'DOWNLOAD_FAILED', failureStage: 'DOWNLOAD_FAILED' });
      await expect(service.downloadResult('retryable-h3-job')).resolves.toMatchObject({ status: 'completed', pipelineStage: 'COMPLETE', localResultPath: join(temporaryDirectory, 'result.mp4') });
      expect(downloadAttempts).toBe(2);
    } finally {
      service.dispose();
      globalThis.fetch = originalFetch;
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
