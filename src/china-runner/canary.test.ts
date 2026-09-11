import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import workflow from '../../workflows/minimax-h3-api.json';
import { products } from '../domain/data';
import { createH3ReferencePlan } from '../domain/h3';
import type { H3VideoBrief, Product } from '../domain/types';
import { buildCanaryRequest, type CanaryExecutor } from './canary-executor';
import { LocalComfyClient, LocalLmStudioClient } from './localhost-comfy';
import { ChinaAutoRunner } from './runner';
import { canonicalBundleHash, sha256 } from './staging';
import { CHINA_RUNNER_VERSION, type ChinaSessionBundle, type ReadinessProbe } from './types';

const roots: string[] = []; const runners: ChinaAutoRunner[] = [];
afterEach(() => { for (const runner of runners.splice(0)) runner.close(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const ready = (): ReadinessProbe => ({ ready: true, checkedAt: new Date().toISOString(), error: null, details: { available: true } });
const localClients = () => ({ comfy: { readiness: vi.fn(async () => ready()) } as unknown as LocalComfyClient, lmStudio: { readiness: vi.fn(async () => ready()) } as unknown as LocalLmStudioClient });
const brief = (product: Product): H3VideoBrief => ({ product: product.id, contentType: 'UGC Content', creativeVariety: 'Balanced', videoIdea: '', language: 'English', musicOnly: true, captions: false, subtitles: false, goal: 'Product reveal', customGoal: '', duration: 4, aspectRatio: '9:16', customAspectRatio: '', qualityPreset: 'Custom', megapixels: 0.98, multiple: 32, fps: 24, steps: 20, seedMode: 'fixed', seed: 42, refImageSize: 'max', workflowMode: 'REF2VA', cameraMotion: 'Cinematic', actionIntensity: 'Medium', pacing: 'Balanced', productFidelity: 'Exact', scheduler: 'simple', ending: 'Hero Shot', customEnding: '', sound: 'Music Only', promptDetail: 'Production', specialInstructions: '', references: createH3ReferencePlan(product) });

function bundle(root: string, product = products[0]): ChinaSessionBundle {
  const sourcePath = product.imagePath; const bytes = readFileSync(join(process.cwd(), sourcePath)); const assetId = `${product.id}-0`; const systemPrompt = 'canary exact system prompt';
  const result: ChinaSessionBundle = { sessionId: randomUUID(), schemaVersion: 1, expectedRunnerVersion: CHINA_RUNNER_VERSION, selectedProducts: [product.id], selectedContentTypes: ['UGC Content', 'Educational'], ordering: { productOrder: [product.id], contentTypeOrder: ['UGC Content', 'Educational'], shuffleProducts: false, shuffleContentTypes: false }, repeatPolicy: { mode: 'forever' }, products: [product], assets: [{ id: assetId, productId: product.id, sourcePath, filename: basename(sourcePath), mimeType: 'image/png', size: bytes.length, sha256: sha256(bytes), base64: bytes.toString('base64') }], productReferences: [{ productId: product.id, assetIds: [assetId] }], settings: { brief: brief(product) }, initialSettingsVersion: 1, systemPrompt, systemPromptSha256: sha256(systemPrompt), workflow: structuredClone(workflow), workflowSha256: sha256(JSON.stringify(workflow)), workflowVersion: 'canary-test', archiveRoot: join(root, 'archive'), bundleSha256: '' };
  result.bundleSha256 = canonicalBundleHash(result); return result;
}

function runnerWith(executor: CanaryExecutor, root = mkdtempSync(join(tmpdir(), 'proya-canary-')), interval = 60_000) {
  roots.push(root); const clients = localClients(); const runner = new ChinaAutoRunner({ mode: 'canary', stateRoot: join(root, 'state'), archiveRoot: join(root, 'archive'), canaryExecutor: executor, schedulerIntervalMs: interval, ...clients }); runners.push(runner); return { runner, root };
}
async function waitFor(check: () => boolean) { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)); } throw new Error('Timed out waiting for canary test state.'); }
const completeExecutor = (): CanaryExecutor => ({ executeStep: vi.fn(async (_session, _job, hooks) => hooks.update('COMPLETED', { archivePath: 'D:/AI Videos/canary.mp4', archiveSize: 123, archiveSha256: 'a'.repeat(64), vramAudit: { h3VramReleaseSucceeded: true, h3VramVerification: 'PASSED', h3VramPostMeasurementFresh: true } })) });

describe('China-owned one-job canary scheduler', () => {
  it('persists Start, creates exactly one job, and finishes without job 2', async () => {
    const { runner, root } = runnerWith(completeExecutor()); const input = bundle(root); await runner.stage(input);
    const start = await runner.startCanary(input.sessionId, input.bundleSha256); expect(start).toMatchObject({ idempotent: false, maxJobsPerSession: 1 });
    await waitFor(() => runner.session(input.sessionId)?.status === 'CANARY_FINISHED');
    expect(runner.jobs(input.sessionId)).toHaveLength(1); expect(runner.jobs(input.sessionId)[0].contentType).toBe('UGC Content');
    expect(await runner.startCanary(input.sessionId, input.bundleSha256)).toMatchObject({ idempotent: true, status: 'CANARY_FINISHED' });
    expect(runner.jobs(input.sessionId)).toHaveLength(1); expect(() => runner.simulateNextJob(input.sessionId)).toThrow(/disabled/);
  });

  it('builds the immutable request exclusively from staged China files and localhost settings', async () => {
    let captured = ''; const executor: CanaryExecutor = { executeStep: async (session, job, hooks) => {
      const request = buildCanaryRequest(session, job); captured = JSON.stringify(request);
      expect(request.promptEngine?.endpoint).toBe('http://127.0.0.1:1234/v1');
      expect(request.referenceImages?.[0].localPath).toContain(`${session.sessionDirectory}\\assets\\`);
      hooks.update('PREPARING', { request }); return hooks.update('COMPLETED');
    } };
    const { runner, root } = runnerWith(executor); const input = bundle(root); await runner.stage(input); await runner.startCanary(input.sessionId, input.bundleSha256);
    await waitFor(() => runner.session(input.sessionId)?.status === 'CANARY_FINISHED'); expect(captured).not.toContain('C:/not-hashed-or-used-by-china'); expect(runner.jobs(input.sessionId)[0].request).toBeTruthy();
  });

  it('rejects unstaged, mismatched, and a second active session', async () => {
    let resolve!: () => void; const pending = new Promise<void>(done => { resolve = done; });
    const executor: CanaryExecutor = { executeStep: async (_session, job) => { await pending; return job; } };
    const { runner, root } = runnerWith(executor); const first = bundle(root); const second = bundle(root, products[1]); await runner.stage(first); await runner.stage(second);
    await expect(runner.startCanary('00000000-0000-0000-0000-000000000000', 'x')).rejects.toThrow(/Unknown/);
    await expect(runner.startCanary(first.sessionId, '0'.repeat(64))).rejects.toThrow(/identity/);
    await runner.startCanary(first.sessionId, first.bundleSha256);
    await expect(runner.startCanary(second.sessionId, second.bundleSha256)).rejects.toThrow(/Another canary/); resolve();
  });

  it('continues independently after Start and recovers RUNNING state after runner restart', async () => {
    const hold: CanaryExecutor = { executeStep: async (_session, _job, hooks) => hooks.update('RUNNING') };
    const { runner, root } = runnerWith(hold); const input = bundle(root); await runner.stage(input); await runner.startCanary(input.sessionId, input.bundleSha256);
    await waitFor(() => runner.jobs(input.sessionId)[0]?.phase === 'RUNNING');
    runners.splice(runners.indexOf(runner), 1); runner.close();
    const clients = localClients(); const recovered = new ChinaAutoRunner({ mode: 'canary', stateRoot: join(root, 'state'), archiveRoot: join(root, 'archive'), canaryExecutor: completeExecutor(), schedulerIntervalMs: 60_000, ...clients }); runners.push(recovered);
    await waitFor(() => recovered.session(input.sessionId)?.status === 'CANARY_FINISHED'); expect(recovered.jobs(input.sessionId)).toHaveLength(1);
  });

  it('keeps an ambiguous submission intent durable and does not make a replacement job', async () => {
    const executor: CanaryExecutor = { executeStep: async (_session, _job, hooks) => hooks.update('SUBMISSION_INTENT_PERSISTED', { submissionHash: 'b'.repeat(64) }) };
    const { runner, root } = runnerWith(executor); const input = bundle(root); await runner.stage(input); await runner.startCanary(input.sessionId, input.bundleSha256);
    await waitFor(() => runner.jobs(input.sessionId)[0]?.phase === 'SUBMISSION_INTENT_PERSISTED'); expect(runner.jobs(input.sessionId)).toHaveLength(1);
  });

  it('stops as CANARY_FINISHED on validation failure', async () => {
    const executor: CanaryExecutor = { executeStep: async (_session, _job, hooks) => hooks.update('FAILED', { error: 'PROMPT_VALIDATION_FAILED' }) };
    const { runner, root } = runnerWith(executor); const input = bundle(root); await runner.stage(input); await runner.startCanary(input.sessionId, input.bundleSha256);
    await waitFor(() => runner.session(input.sessionId)?.status === 'CANARY_FINISHED'); expect(runner.jobs(input.sessionId)[0]).toMatchObject({ phase: 'FAILED', error: 'PROMPT_VALIDATION_FAILED' });
  });

  it('persists archive evidence and fresh local VRAM success', async () => {
    const { runner, root } = runnerWith(completeExecutor()); const input = bundle(root); await runner.stage(input); await runner.startCanary(input.sessionId, input.bundleSha256);
    await waitFor(() => runner.session(input.sessionId)?.status === 'CANARY_FINISHED');
    expect(runner.jobs(input.sessionId)[0]).toMatchObject({ phase: 'COMPLETED', archiveSize: 123, archiveSha256: 'a'.repeat(64), vramAudit: { h3VramReleaseSucceeded: true, h3VramPostMeasurementFresh: true } });
  });

  it('retries local /free verification and then finishes exactly once', async () => {
    let attempts = 0; const executor: CanaryExecutor = { executeStep: async (_session, _job, hooks) => ++attempts < 2 ? hooks.update('RELEASING_VRAM', { releaseAttempts: attempts, vramAudit: { h3VramReleaseSucceeded: false } }) : hooks.update('COMPLETED', { releaseAttempts: attempts, vramAudit: { h3VramReleaseSucceeded: true, h3VramVerification: 'PASSED', h3VramPostMeasurementFresh: true } }) };
    const { runner, root } = runnerWith(executor, undefined, 10); const input = bundle(root); await runner.stage(input); await runner.startCanary(input.sessionId, input.bundleSha256);
    await waitFor(() => runner.session(input.sessionId)?.status === 'CANARY_FINISHED'); expect(attempts).toBeGreaterThanOrEqual(2); expect(runner.jobs(input.sessionId)).toHaveLength(1);
  });

  it('fails closed when fresh local VRAM verification cannot pass', async () => {
    const executor: CanaryExecutor = { executeStep: async (_session, _job, hooks) => hooks.update('FAILED', { error: 'Fresh local GPU telemetry failed.', vramAudit: { h3VramReleaseSucceeded: false, h3VramPostMeasurementFresh: true } }) };
    const { runner, root } = runnerWith(executor); const input = bundle(root); await runner.stage(input); await runner.startCanary(input.sessionId, input.bundleSha256);
    await waitFor(() => runner.session(input.sessionId)?.status === 'CANARY_FINISHED'); expect(runner.jobs(input.sessionId)[0].phase).toBe('FAILED');
  });
});
