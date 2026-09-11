import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import workflow from '../../workflows/minimax-h3-api.json';
import { products } from '../domain/data';
import { createH3ReferencePlan } from '../domain/h3';
import type { H3VideoBrief } from '../domain/types';
import type { CanaryExecutor } from './canary-executor';
import { LocalComfyClient, LocalLmStudioClient } from './localhost-comfy';
import { ChinaAutoRunner } from './runner';
import { canonicalBundleHash } from './staging';
import { CHINA_RUNNER_VERSION, type ChinaSessionBundle } from './types';

const roots: string[] = [];
const runners: ChinaAutoRunner[] = [];
const digest = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const verified = () => ({ h3VramReleaseSucceeded: true, h3VramVerification: 'PASSED' as const, h3VramPostMeasurementFresh: true });

afterEach(() => {
  for (const runner of runners.splice(0)) { try { runner.close(); } catch { /* closed */ } }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function brief(): H3VideoBrief {
  return { product: 'cleanser', contentType: 'UGC Content', creativeVariety: 'Balanced', videoIdea: '', language: 'English', musicOnly: true, captions: false, subtitles: false, goal: 'Product reveal', customGoal: '', duration: 4, aspectRatio: '9:16', customAspectRatio: '', qualityPreset: 'Custom', megapixels: 0.98, multiple: 32, fps: 24, steps: 20, seedMode: 'fixed', seed: 42, refImageSize: 'max', workflowMode: 'REF2VA', cameraMotion: 'Cinematic', actionIntensity: 'Medium', pacing: 'Balanced', productFidelity: 'Exact', scheduler: 'simple', ending: 'Hero Shot', customEnding: '', sound: 'Music Only', promptDetail: 'Production', specialInstructions: '', references: createH3ReferencePlan(products[0]) };
}

function bundle(root: string): ChinaSessionBundle {
  const selected = products.filter(product => product.id === 'cleanser' || product.id === 'serum');
  const assets = selected.map(product => {
    const bytes = readFileSync(join(process.cwd(), product.imagePath));
    return { id: `${product.id}-master`, productId: product.id, sourcePath: product.imagePath, filename: basename(product.imagePath), mimeType: 'image/png' as const, size: bytes.length, sha256: digest(bytes), base64: bytes.toString('base64') };
  });
  const value: ChinaSessionBundle = {
    sessionId: randomUUID(), schemaVersion: 1, expectedRunnerVersion: CHINA_RUNNER_VERSION,
    selectedProducts: selected.map(product => product.id), selectedContentTypes: ['UGC Content', 'Educational'],
    ordering: { productOrder: selected.map(product => product.id), contentTypeOrder: ['UGC Content', 'Educational'], shuffleProducts: false, shuffleContentTypes: false },
    repeatPolicy: { mode: 'forever' }, products: selected, assets,
    productReferences: selected.map(product => ({ productId: product.id, assetIds: [`${product.id}-master`] })),
    settings: { brief: brief() }, initialSettingsVersion: 1, systemPrompt: 'production system prompt', systemPromptSha256: digest('production system prompt'),
    workflow: structuredClone(workflow), workflowSha256: digest(JSON.stringify(workflow)), workflowVersion: 'production-test', archiveRoot: join(root, 'archive'), bundleSha256: ''
  };
  value.bundleSha256 = canonicalBundleHash(value);
  return value;
}

function clients() {
  const readiness = vi.fn(async () => ({ ready: true, checkedAt: new Date().toISOString(), error: null }));
  return { comfy: { readiness } as unknown as LocalComfyClient, lmStudio: { readiness } as unknown as LocalLmStudioClient };
}

function runner(executor: CanaryExecutor, root = mkdtempSync(join(tmpdir(), 'proya-production-')), interval = 60_000) {
  roots.push(root);
  const value = new ChinaAutoRunner({ mode: 'production', stateRoot: join(root, 'state'), archiveRoot: join(root, 'archive'), canaryExecutor: executor, schedulerIntervalMs: interval, ...clients() });
  runners.push(value);
  return { runner: value, root };
}

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 300; attempt++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('Timed out waiting for production scheduler.');
}

describe('final China-owned production scheduler', () => {
  it('advertises unlimited production and loops product/content order across cycles with one GPU job at a time', async () => {
    let active = 0; let maximum = 0; const owner: { runner?: ChinaAutoRunner } = {};
    const executor: CanaryExecutor = { executeStep: async (_session, job, hooks) => {
      active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 2)); active--;
      const result = hooks.update('COMPLETED', { promptId: randomUUID(), archivePath: `D:/AI Videos/${job.jobId}.mp4`, archiveSize: 10, archiveSha256: 'a'.repeat(64), vramAudit: verified() });
      if (owner.runner!.jobs(job.sessionId).length === 5) owner.runner!.requestStopAfterCurrent(job.sessionId);
      return result;
    } };
    const created = runner(executor); owner.runner = created.runner; const staged = bundle(created.root);
    await created.runner.stage(staged);
    await expect(created.runner.startCanary(staged.sessionId, staged.bundleSha256)).resolves.toMatchObject({ maxJobsPerSession: null });
    await waitFor(() => created.runner.session(staged.sessionId)?.status === 'STOPPED');
    expect(created.runner.jobs(staged.sessionId).map(job => `${job.product}/${job.contentType}`)).toEqual([
      'cleanser/UGC Content', 'cleanser/Educational', 'serum/UGC Content', 'serum/Educational', 'cleanser/UGC Content'
    ]);
    expect(created.runner.jobs(staged.sessionId).map(job => job.referenceAssetIds[0])).toEqual(['cleanser-master', 'cleanser-master', 'serum-master', 'serum-master', 'cleanser-master']);
    expect(maximum).toBe(1);
  }, 15_000);

  it('keeps current settings immutable, applies the next committed version, and advances after validation failure', async () => {
    const owner: { runner?: ChinaAutoRunner } = {};
    const executor: CanaryExecutor = { executeStep: async (session, job, hooks) => {
      if (job.contentType === 'UGC Content') {
        const next = structuredClone(session.bundle.settings); next.brief.videoIdea = 'newest committed settings';
        owner.runner!.updateSettings(session.sessionId, 2, next);
        return hooks.update('FAILED', { error: 'PROMPT_VALIDATION_FAILED', executionState: { pipelineStage: 'PROMPT_VALIDATION_FAILED' } as never });
      }
      owner.runner!.requestStopAfterCurrent(session.sessionId);
      return hooks.update('COMPLETED', { promptId: randomUUID(), archivePath: 'D:/AI Videos/job.mp4', archiveSha256: 'b'.repeat(64), vramAudit: verified() });
    } };
    const created = runner(executor); owner.runner = created.runner; const staged = bundle(created.root); staged.selectedProducts = ['cleanser']; staged.ordering.productOrder = ['cleanser']; staged.products = staged.products.filter(p => p.id === 'cleanser'); staged.assets = staged.assets.filter(a => a.productId === 'cleanser'); staged.productReferences = staged.productReferences.filter(a => a.productId === 'cleanser'); staged.bundleSha256 = canonicalBundleHash(staged);
    await created.runner.stage(staged); await created.runner.startCanary(staged.sessionId, staged.bundleSha256);
    await waitFor(() => created.runner.session(staged.sessionId)?.status === 'STOPPED');
    expect(created.runner.jobs(staged.sessionId).map(job => [job.phase, job.settingsVersion, job.settingsSnapshot?.brief.videoIdea])).toEqual([['FAILED', 1, ''], ['COMPLETED', 2, 'newest committed settings']]);
  });

  it('blocks the next position on unsafe VRAM evidence and resumes the same logical position after restart', async () => {
    const first = runner({ executeStep: async (_session, _job, hooks) => hooks.update('FAILED', { promptId: randomUUID(), executionState: { pipelineStage: 'GENERATING_H3' } as never, vramAudit: { h3VramReleaseSucceeded: false, h3VramVerification: 'FAILED', h3VramPostMeasurementFresh: true }, error: 'VRAM_NOT_VERIFIED' }) }, undefined, 10);
    const staged = bundle(first.root); await first.runner.stage(staged); await first.runner.startCanary(staged.sessionId, staged.bundleSha256);
    await waitFor(() => first.runner.jobs(staged.sessionId)[0]?.phase === 'FAILED');
    expect(first.runner.jobs(staged.sessionId)).toHaveLength(1);
    first.runner.close(); runners.splice(runners.indexOf(first.runner), 1);
    const recovered = new ChinaAutoRunner({ mode: 'production', stateRoot: join(first.root, 'state'), archiveRoot: join(first.root, 'archive'), schedulerIntervalMs: 10, ...clients(), canaryExecutor: { executeStep: async (session, job, hooks) => { if (job.phase === 'FAILED') return job; return hooks.update('FAILED', { error: 'unexpected' }); } } });
    runners.push(recovered); await new Promise(resolve => setTimeout(resolve, 50));
    expect(recovered.jobs(staged.sessionId)).toHaveLength(1);
    expect(recovered.session(staged.sessionId)?.currentJobId).toBe(recovered.jobs(staged.sessionId)[0].jobId);
  });

  it('makes repeated Start idempotent and Stop Now preserves the cursor', async () => {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const created = runner({ executeStep: async (_session, job, hooks) => { await gate; return hooks.update('FAILED', { error: 'stopped safely', promptId: job.promptId }); } });
    const staged = bundle(created.root); await created.runner.stage(staged);
    const [a, b] = await Promise.all([created.runner.startCanary(staged.sessionId, staged.bundleSha256), created.runner.startCanary(staged.sessionId, staged.bundleSha256)]);
    expect([a.idempotent, b.idempotent]).toEqual([false, false]);
    await waitFor(() => created.runner.jobs(staged.sessionId).length === 1); const before = created.runner.session(staged.sessionId)!;
    created.runner.requestStopNow(staged.sessionId); release(); await waitFor(() => created.runner.session(staged.sessionId)?.status === 'STOPPED');
    const after = created.runner.session(staged.sessionId)!;
    expect([after.cycleNumber, after.productIndex, after.contentTypeIndex]).toEqual([before.cycleNumber, before.productIndex, before.contentTypeIndex]);
    expect(created.runner.jobs(staged.sessionId)).toHaveLength(1);
  });
});
