import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import workflow from '../../workflows/minimax-h3-api.json';
import { products } from '../domain/data';
import { createH3ReferencePlan, h3ContentTypeOptions } from '../domain/h3';
import type { H3ContentType, H3VideoBrief, Product } from '../domain/types';
import { LocalComfyClient, LocalLmStudioClient } from './localhost-comfy';
import { ChinaAutoRunner } from './runner';
import { RunnerSingletonLock } from './service';
import { canonicalBundleHash, resolveArchivePath, sha256 } from './staging';
import { CHINA_RUNNER_VERSION, type ChinaSessionBundle, type ReadinessProbe } from './types';

const directories: string[] = [];
const runners: ChinaAutoRunner[] = [];
const temporary = () => { const path = mkdtempSync(join(tmpdir(), 'proya-china-runner-')); directories.push(path); return path; };
afterEach(() => {
  for (const runner of runners.splice(0)) runner.close();
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

const ready = (): ReadinessProbe => ({ ready: true, checkedAt: new Date().toISOString(), error: null });
const unavailable = (name: string): ReadinessProbe => ({ ready: false, checkedAt: new Date().toISOString(), error: `${name} unavailable` });
const comfy = (probe = ready(), promptId: string | null = null) => ({ readiness: vi.fn(async () => probe), reconcileIdentity: vi.fn(async () => promptId) }) as unknown as LocalComfyClient;
const lm = (probe = ready()) => ({ readiness: vi.fn(async () => probe) }) as unknown as LocalLmStudioClient;

function brief(product: Product): H3VideoBrief {
  return {
    product: product.id, contentType: 'Product B-Roll', creativeVariety: 'Balanced', videoIdea: '', language: 'English', musicOnly: true,
    captions: false, subtitles: false, goal: 'Product reveal', customGoal: '', duration: 8, aspectRatio: '9:16', customAspectRatio: '',
    qualityPreset: 'Final', megapixels: 0.98, multiple: 32, fps: 24, workflowMode: 'REF2VA', cameraMotion: 'Cinematic',
    actionIntensity: 'Medium', pacing: 'Balanced', productFidelity: 'Exact', ending: 'Hero Shot', customEnding: '', sound: 'Music Only',
    promptDetail: 'Production', specialInstructions: '', references: createH3ReferencePlan(product)
  };
}

function createBundle(selected: Product[], contentTypes: H3ContentType[] = ['Product B-Roll', 'Cinematic Product Ad']): ChinaSessionBundle {
  const assets: ChinaSessionBundle['assets'] = [];
  const productReferences: ChinaSessionBundle['productReferences'] = [];
  for (const product of selected) {
    const assetIds: string[] = [];
    for (const sourcePath of [product.imagePath, ...(product.referenceImagePaths ?? [])]) {
      const bytes = readFileSync(join(process.cwd(), sourcePath));
      const id = `${product.id}-${assetIds.length}`;
      assetIds.push(id);
      assets.push({ id, productId: product.id, sourcePath, filename: basename(sourcePath), mimeType: 'image/png', size: bytes.length, sha256: sha256(bytes), base64: bytes.toString('base64') });
    }
    productReferences.push({ productId: product.id, assetIds });
  }
  const systemPrompt = 'Exact immutable shadow test system prompt.';
  const selectedProducts = selected.map(product => product.id);
  const workflowObject = structuredClone(workflow) as Record<string, unknown>;
  const bundle = {
    sessionId: randomUUID(), schemaVersion: 1, selectedProducts, selectedContentTypes: contentTypes,
    ordering: { productOrder: [...selectedProducts], contentTypeOrder: [...contentTypes], shuffleProducts: false, shuffleContentTypes: false },
    repeatPolicy: { mode: 'forever' }, products: selected, assets, productReferences,
    settings: { brief: brief(selected[0]), text: { captions: false }, audio: { sound: 'Music Only' }, creative: { variety: 'Balanced' } },
    initialSettingsVersion: 1, systemPrompt, systemPromptSha256: sha256(systemPrompt), workflow: workflowObject,
    workflowSha256: sha256(JSON.stringify(workflowObject)), workflowVersion: 'minimax-h3-api-v1', archiveRoot: '', expectedRunnerVersion: CHINA_RUNNER_VERSION,
    bundleSha256: ''
  } satisfies ChinaSessionBundle;
  bundle.bundleSha256 = canonicalBundleHash(bundle);
  return bundle;
}

async function stage(input: ChinaSessionBundle, clients: { comfy?: LocalComfyClient; lm?: LocalLmStudioClient } = {}): Promise<ChinaAutoRunner> {
  const root = temporary();
  const archiveRoot = join(root, 'archive');
  input.archiveRoot = archiveRoot;
  input.bundleSha256 = canonicalBundleHash(input);
  const runner = new ChinaAutoRunner({ stateRoot: join(root, 'state'), archiveRoot, comfy: clients.comfy ?? comfy(), lmStudio: clients.lm ?? lm() });
  runners.push(runner);
  await runner.stage(input);
  return runner;
}

function simulateCount(runner: ChinaAutoRunner, sessionId: string, count: number) {
  const jobs = [];
  for (let index = 0; index < count; index++) {
    const job = runner.simulateNextJob(sessionId);
    jobs.push(job);
    runner.simulatePhase(job.jobId, 'COMPLETED');
  }
  return jobs;
}

describe('China Auto Runner Phase 1 shadow simulations', () => {
  it('simulates 1 product × 2 content types', async () => {
    const input = createBundle([products[0]], h3ContentTypeOptions.slice(0, 2)); const runner = await stage(input);
    expect(simulateCount(runner, input.sessionId, 2).map(job => job.contentType)).toEqual(h3ContentTypeOptions.slice(0, 2));
  });

  it('simulates 1 product × 8 content types', async () => {
    const input = createBundle([products[0]], [...h3ContentTypeOptions]); const runner = await stage(input);
    expect(simulateCount(runner, input.sessionId, 8)).toHaveLength(8);
  });

  it('simulates 6 products × 8 content types', async () => {
    const input = createBundle(products.slice(0, 6), [...h3ContentTypeOptions]); const runner = await stage(input);
    const jobs = simulateCount(runner, input.sessionId, 48);
    expect(new Set(jobs.map(job => job.product))).toEqual(new Set(products.slice(0, 6).map(product => product.id)));
  }, 120_000);

  it('advances multiple cycles without duplicate scheduler jobs', async () => {
    const input = createBundle([products[0]], h3ContentTypeOptions.slice(0, 2)); const runner = await stage(input);
    const jobs = simulateCount(runner, input.sessionId, 6);
    expect(new Set(jobs.map(job => job.schedulerKey)).size).toBe(6);
    expect(runner.session(input.sessionId)?.cycleNumber).toBe(4);
  });

  it('creates fresh history-aware CreativeGenomes', async () => {
    const input = createBundle([products[0]], ['Product B-Roll']); const runner = await stage(input);
    const jobs = simulateCount(runner, input.sessionId, 4);
    expect(new Set(jobs.map(job => job.creativeFingerprint)).size).toBe(4);
  });

  it('selects each product verified master and never reuses the previous product binding', async () => {
    const input = createBundle(products.slice(0, 3), ['Product B-Roll']); const runner = await stage(input);
    const jobs = simulateCount(runner, input.sessionId, 3);
    expect(jobs.map(job => job.referenceAssetIds[0])).toEqual(products.slice(0, 3).map(product => `${product.id}-0`));
  });

  it('stages every required Full Series master reference', async () => {
    const fullSeries = products.find(product => product.id === 'full-series')!;
    const input = createBundle([fullSeries]); const runner = await stage(input);
    expect(input.productReferences[0].assetIds).toHaveLength(1 + (fullSeries.referenceImagePaths?.length ?? 0));
    expect(runner.session(input.sessionId)?.bundle.productReferences[0].assetIds).toEqual(input.productReferences[0].assetIds);
  });

  it('captures settings version at creation and applies an update only to the next job', async () => {
    const input = createBundle([products[0]], h3ContentTypeOptions.slice(0, 2)); const runner = await stage(input);
    const first = runner.simulateNextJob(input.sessionId);
    const nextSettings = structuredClone(input.settings); nextSettings.brief.language = 'Indonesian';
    runner.updateSettings(input.sessionId, 2, nextSettings);
    expect(runner.store.getJob(first.jobId)?.settingsVersion).toBe(1);
    runner.simulatePhase(first.jobId, 'COMPLETED');
    const second = runner.simulateNextJob(input.sessionId);
    expect(second.settingsVersion).toBe(2); expect(second.generationBrief.language).toBe('Indonesian');
  });

  it('persists Stop After Current and stops after the current terminal phase', async () => {
    const input = createBundle([products[0]]); const runner = await stage(input); const job = runner.simulateNextJob(input.sessionId);
    runner.requestStopAfterCurrent(input.sessionId); runner.simulatePhase(job.jobId, 'COMPLETED');
    expect(runner.session(input.sessionId)?.status).toBe('STOPPED');
  });

  it('persists Stop Now without submitting or interrupting work', async () => {
    const input = createBundle([products[0]]); const runner = await stage(input); runner.simulateNextJob(input.sessionId);
    expect(runner.requestStopNow(input.sessionId)).toMatchObject({ stopNow: true, status: 'STOPPED' });
  });

  it('recovers sessions and jobs after runner and SQLite restart', async () => {
    const input = createBundle([products[0]]); const first = await stage(input); const job = first.simulateNextJob(input.sessionId);
    const options = { stateRoot: first.stateRoot, archiveRoot: first.archiveRoot, comfy: comfy(), lmStudio: lm() };
    runners.splice(runners.indexOf(first), 1); first.close();
    const second = new ChinaAutoRunner(options); runners.push(second);
    expect(second.session(input.sessionId)?.currentJobId).toBe(job.jobId); expect(second.jobs(input.sessionId)).toHaveLength(1);
  });

  it('enforces singleton locking', () => {
    const root = temporary(); const first = new RunnerSingletonLock(root); const second = new RunnerSingletonLock(root);
    first.acquire(); expect(() => second.acquire()).toThrow(/already active/); first.release(); expect(() => second.acquire()).not.toThrow(); second.release();
  });

  it('rejects archive traversal', () => {
    expect(() => resolveArchivePath(temporary(), '../escape.mp4')).toThrow(/Invalid|escapes/);
    expect(() => resolveArchivePath(temporary(), 'safe/video.mp4')).not.toThrow();
  });

  it('rejects a staging asset hash mismatch', async () => {
    const input = createBundle([products[0]]); input.assets[0].sha256 = '0'.repeat(64);
    await expect(stage(input)).rejects.toThrow(/hash or size mismatch/);
  });

  it('rejects a missing product asset', async () => {
    const input = createBundle([products[0]]); input.productReferences[0].assetIds = [];
    await expect(stage(input)).rejects.toThrow(/Missing product asset mapping/);
  });

  it('rejects an invalid workflow with a matching supplied hash', async () => {
    const input = createBundle([products[0]]); delete input.workflow['149']; input.workflowSha256 = sha256(JSON.stringify(input.workflow));
    await expect(stage(input)).rejects.toThrow(/workflow|node|placeholder/i);
  });

  it('rejects a wrong system prompt hash', async () => {
    const input = createBundle([products[0]]); input.systemPromptSha256 = '0'.repeat(64);
    await expect(stage(input)).rejects.toThrow(/System prompt hash mismatch/);
  });

  it('is idempotent for the same ID/hash and conflicts for a changed bundle', async () => {
    const input = createBundle([products[0]]); const runner = await stage(input);
    expect((await runner.stage(input)).bundleHash).toBe(input.bundleSha256);
    input.settings.brief.videoIdea = 'changed'; input.bundleSha256 = canonicalBundleHash(input);
    await expect(runner.stage(input)).rejects.toThrow(/different bundle hash/);
  });

  it('rejects staging when local ComfyUI is unavailable', async () => {
    const input = createBundle([products[0]]);
    await expect(stage(input, { comfy: comfy(unavailable('ComfyUI')) })).rejects.toThrow(/ComfyUI unavailable/);
  });

  it('rejects staging when local LM Studio is unavailable', async () => {
    const input = createBundle([products[0]]);
    await expect(stage(input, { lm: lm(unavailable('LM Studio')) })).rejects.toThrow(/LM Studio unavailable/);
  });

  it('keeps ambiguous submission intent pending and never creates a duplicate job', async () => {
    const input = createBundle([products[0]], ['Product B-Roll']); const runner = await stage(input, { comfy: comfy(ready(), null) });
    const job = runner.simulateNextJob(input.sessionId); runner.persistSubmissionIntent(job.jobId, { prompt: { jobId: job.jobId } });
    expect(await runner.recoverSubmissionIntent(job.jobId)).toMatchObject({ ambiguous: true });
    expect(runner.simulateNextJob(input.sessionId).jobId).toBe(job.jobId); expect(runner.jobs(input.sessionId)).toHaveLength(1);
  });

  it('adopts a locally reconciled prompt ID without posting', async () => {
    const promptId = randomUUID(); const input = createBundle([products[0]], ['Product B-Roll']); const runner = await stage(input, { comfy: comfy(ready(), promptId) });
    const job = runner.simulateNextJob(input.sessionId); runner.persistSubmissionIntent(job.jobId, { prompt: { jobId: job.jobId } });
    expect((await runner.recoverSubmissionIntent(job.jobId)).job).toMatchObject({ phase: 'SUBMITTED', promptId });
  });

  it('hard-blocks prompt submission and free in shadow mode', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'));
    const client = new LocalComfyClient('shadow', fetchMock as typeof fetch);
    await expect(client.prompt({})).rejects.toThrow(/forbidden/); await expect(client.free()).rejects.toThrow(/forbidden/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('exposes fixed localhost-only capabilities', async () => {
    const input = createBundle([products[0]]); const runner = await stage(input);
    expect(runner.capabilities()).toMatchObject({ listenAddress: '127.0.0.1:8787', comfyUrl: 'http://127.0.0.1:8188', lmStudioUrl: 'http://127.0.0.1:1234', generationEnabled: false, promptSubmissionEnabled: false });
    await expect(runner.submitGeneration()).rejects.toThrow(/SHADOW SAFETY/);
  });
});
