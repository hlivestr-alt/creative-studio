import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import workflow from '../../workflows/minimax-h3-api.json';
import { products } from '../domain/data';
import { calculateH3FrameLength, createH3ReferencePlan, h3ContentTypeOptions } from '../domain/h3';
import { deriveMiniMaxH3T2VAWorkflowTemplate } from '../domain/minimax-h3-workflow';
import type { H3ContentType, H3VideoBrief, H3WorkflowSettingsSnapshot, Product } from '../domain/types';
import { LocalComfyClient, LocalLmStudioClient } from './localhost-comfy';
import { buildCanaryRequest, LocalCanaryExecutor } from './canary-executor';
import { LocalGenerationRunner } from './runner';
import { RunnerSingletonLock } from './service';
import { canonicalBundleHash, resolveArchivePath, sha256 } from './staging';
import { LOCAL_RUNNER_VERSION, type LocalSessionBundle, type ReadinessProbe } from './types';

const directories: string[] = [];
const runners: LocalGenerationRunner[] = [];
const temporary = () => { const path = mkdtempSync(join(tmpdir(), 'proya-local-runner-')); directories.push(path); return path; };
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

function createBundle(selected: Product[], contentTypes: H3ContentType[] = ['Product B-Roll', 'Cinematic Product Ad']): LocalSessionBundle {
  const assets: LocalSessionBundle['assets'] = [];
  const productReferences: LocalSessionBundle['productReferences'] = [];
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
  const supportBRollWorkflow = contentTypes.some(type => type === 'Support B-Roll' || type === 'Hook') ? deriveMiniMaxH3T2VAWorkflowTemplate(workflowObject) : null;
  const bundle = {
    sessionId: randomUUID(), schemaVersion: 1, selectedProducts, selectedContentTypes: contentTypes,
    ordering: { productOrder: [...selectedProducts], contentTypeOrder: [...contentTypes], shuffleProducts: false, shuffleContentTypes: false },
    repeatPolicy: { mode: 'forever' }, products: selected, assets, productReferences,
    settings: { brief: brief(selected[0]), text: { captions: false }, audio: { sound: 'Music Only' }, creative: { variety: 'Balanced' } },
    initialSettingsVersion: 1, systemPrompt, systemPromptSha256: sha256(systemPrompt), workflow: workflowObject,
    workflowSha256: sha256(JSON.stringify(workflowObject)), workflowVersion: 'minimax-h3-api-v1', archiveRoot: '', expectedRunnerVersion: LOCAL_RUNNER_VERSION,
    ...(supportBRollWorkflow ? { supportBRollWorkflow, supportBRollWorkflowSha256: sha256(JSON.stringify(supportBRollWorkflow)), supportBRollWorkflowVersion: 'minimax-h3-t2va-api-v1' } : {}),
    bundleSha256: ''
  } satisfies LocalSessionBundle;
  bundle.bundleSha256 = canonicalBundleHash(bundle);
  return bundle;
}

async function stage(input: LocalSessionBundle, clients: { comfy?: LocalComfyClient; lm?: LocalLmStudioClient } = {}): Promise<LocalGenerationRunner> {
  const root = temporary();
  const archiveRoot = join(root, 'archive');
  input.archiveRoot = archiveRoot;
  input.bundleSha256 = canonicalBundleHash(input);
  const runner = new LocalGenerationRunner({ stateRoot: join(root, 'state'), archiveRoot, comfy: clients.comfy ?? comfy(), lmStudio: clients.lm ?? lm() });
  runners.push(runner);
  await runner.stage(input);
  return runner;
}

function simulateCount(runner: LocalGenerationRunner, sessionId: string, count: number) {
  const jobs = [];
  for (let index = 0; index < count; index++) {
    const job = runner.simulateNextJob(sessionId);
    jobs.push(job);
    runner.simulatePhase(job.jobId, 'COMPLETED');
  }
  return jobs;
}

describe('Local Generation Runner Phase 1 shadow simulations', () => {
  it('simulates 1 product × 2 content types', async () => {
    const input = createBundle([products[0]], h3ContentTypeOptions.slice(0, 2)); const runner = await stage(input);
    expect(simulateCount(runner, input.sessionId, 2).map(job => job.contentType)).toEqual(h3ContentTypeOptions.slice(0, 2));
  });

  it('plans Hook as a product-free T2VA job driven only by the selected skin concern', async () => {
    const input = createBundle([products.find(product => product.id === 'eye-cream')!], ['Hook']);
    input.assets = []; input.productReferences = [];
    const runner = await stage(input);
    const job = runner.simulateNextJob(input.sessionId);
    expect(job.referenceAssetIds).toEqual([]);
    expect(job.generationBrief.workflowMode).toBe('T2VA');
    expect(job.generationBrief.references).toEqual([]);
    expect(job.generationBrief.videoIdea).toContain('dark under-eyes');
    expect((job.settingsSnapshot?.h3 as H3WorkflowSettingsSnapshot).frameLength).toBe(calculateH3FrameLength(job.durationSeconds!));
  });

  it('simulates 1 product across every registered content type', async () => {
    const input = createBundle([products[0]], [...h3ContentTypeOptions]); const runner = await stage(input);
    expect(simulateCount(runner, input.sessionId, h3ContentTypeOptions.length)).toHaveLength(h3ContentTypeOptions.length);
  });

  it('simulates 6 products across every registered content type', async () => {
    const input = createBundle(products.slice(0, 6), [...h3ContentTypeOptions]); const runner = await stage(input);
    const jobs = simulateCount(runner, input.sessionId, 6 * h3ContentTypeOptions.length);
    expect(new Set(jobs.map(job => job.product))).toEqual(new Set(products.slice(0, 6).map(product => product.id)));
  }, 120_000);

  it('plans Support B-Roll with one of four archetypes and no staged product reference input', async () => {
    const input = createBundle([products[0]], ['Support B-Roll']);
    input.assets = [];
    input.productReferences = [];
    const runner = await stage(input);
    const job = runner.simulateNextJob(input.sessionId);
    const request = buildCanaryRequest(runner.session(input.sessionId)!, job);
    expect(runner.session(input.sessionId)?.bundle.assets).toEqual([]);
    expect(['Problem Hook', 'Skin Beauty Close-Up', 'Science Animation', 'Aesthetic Transition']).toContain(job.creativeGenome.creativeArchetype);
    expect(job.referenceAssetIds).toEqual([]);
    expect(job.generationBrief.references).toEqual([]);
    expect(request).toMatchObject({ mode: 'T2VA', productReferencePath: null, referenceImages: [] });
    expect(job.generationBrief.specialInstructions).toContain('semantic theme driver');
  });

  it('requires one staged product master for a mixed Support B-Roll and UGC session but binds it only to UGC', async () => {
    const input = createBundle([products[0]], ['Support B-Roll', 'UGC Content']);
    const runner = await stage(input);
    const supportJob = runner.simulateNextJob(input.sessionId);
    runner.simulatePhase(supportJob.jobId, 'COMPLETED');
    const ugcJob = runner.simulateNextJob(input.sessionId);
    expect(input.assets).toHaveLength(1 + (products[0].referenceImagePaths?.length ?? 0));
    expect(supportJob.referenceAssetIds).toEqual([]);
    expect(supportJob.generationBrief.references).toEqual([]);
    expect(ugcJob.referenceAssetIds).toEqual(input.productReferences[0].assetIds);
    expect(buildCanaryRequest(runner.session(input.sessionId)!, ugcJob).mode).toBe('REF2VA');
    expect(ugcJob.generationBrief.references.length).toBeGreaterThan(0);
  });

  it('runs CTA locally from its staged master and retains separate Support B-Roll routing', async () => {
    const input = createBundle([products[0]], ['Support B-Roll', 'CTA / End Card']);
    input.settings.brief.cta = { style: 'Price', duration: 8, price: 'Rp75.000', action: 'Klik keranjang kuning', benefit: '', promo: '' };
    const runner = await stage(input);
    const broll = runner.simulateNextJob(input.sessionId);
    expect(broll.referenceAssetIds).toEqual([]);
    expect(buildCanaryRequest(runner.session(input.sessionId)!, broll).mode).toBe('T2VA');
    runner.simulatePhase(broll.jobId, 'COMPLETED');
    const job = runner.simulateNextJob(input.sessionId);
    expect(job.referenceAssetIds).toHaveLength(1 + (products[0].referenceImagePaths?.length ?? 0));
    const executor = new LocalCanaryExecutor();
    const completed = await executor.executeStep(runner.session(input.sessionId)!, job, { update: (phase, patch) => runner.store.updateJob(job.jobId, phase, patch) });
    expect(completed).toMatchObject({ phase: 'COMPLETED', promptId: null });
    expect(completed.archivePath).toContain('CTA-End-Card');
    expect(completed.archiveSha256).toMatch(/^[0-9a-f]{64}$/);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', completed.archivePath!], { encoding: 'utf8' });
    expect(probe.status).toBe(0);
    expect(Number(probe.stdout.trim())).toBe(job.durationSeconds);
    runner.simulatePhase(job.jobId, 'COMPLETED');
    expect(runner.session(input.sessionId)?.cycleNumber).toBe(2);
  }, 30000);

  it('CTA failure is terminal only for that job; Stop After Current prevents another', async () => {
    const input = createBundle([products[0]], ['CTA / End Card', 'Product Demo']);
    const runner = await stage(input);
    const job = runner.simulateNextJob(input.sessionId);
    const session = runner.session(input.sessionId)!;
    session.bundle.assets = [];
    const failed = await new LocalCanaryExecutor().executeStep(session, job, { update: (phase, patch) => runner.store.updateJob(job.jobId, phase, patch) });
    expect(failed.phase).toBe('FAILED');
    runner.simulatePhase(job.jobId, 'FAILED');
    expect(runner.simulateNextJob(input.sessionId).contentType).toBe('Product Demo');
    runner.requestStopAfterCurrent(input.sessionId);
    runner.simulatePhase(runner.session(input.sessionId)!.currentJobId!, 'COMPLETED');
    expect(runner.session(input.sessionId)?.status).toBe('STOPPED');
  });

  it('stages CTA-only without ComfyUI or Qwen readiness', async () => {
    const input = createBundle([products[0]], ['CTA / End Card']);
    const runner = await stage(input, { comfy: comfy(unavailable('ComfyUI')), lm: lm(unavailable('LM Studio')) });
    expect(runner.simulateNextJob(input.sessionId).referenceAssetIds.length).toBeGreaterThan(0);
  });

  it('never treats the Full Series serum thumbnail as a verified composite CTA master', async () => {
    const input = createBundle([products.find(product => product.id === 'full-series')!], ['CTA / End Card']);
    const runner = await stage(input);
    const job = runner.simulateNextJob(input.sessionId);
    const result = await new LocalCanaryExecutor().executeStep(runner.session(input.sessionId)!, job,
      { update: (phase, patch) => runner.store.updateJob(job.jobId, phase, patch) });
    expect(result.phase).toBe('FAILED');
    expect(result.error).toMatch(/verified composite master/);
  });

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

  it('keeps the newest stopped lifecycle authoritative over an older abandoned staged session', async () => {
    const abandoned = createBundle([products[0]], ['Support B-Roll']);
    const runner = await stage(abandoned);
    const newest = createBundle([products[0]], ['Support B-Roll']);
    newest.archiveRoot = runner.archiveRoot;
    newest.bundleSha256 = canonicalBundleHash(newest);
    await runner.stage(newest);
    runner.requestStopNow(newest.sessionId);

    expect(runner.session(abandoned.sessionId)?.status).toBe('STAGED');
    expect(runner.currentSession()).toMatchObject({ sessionId: newest.sessionId, status: 'STOPPED' });
  });

  it('recovers sessions and jobs after runner and SQLite restart', async () => {
    const input = createBundle([products[0]], ['Hook']); const first = await stage(input); const job = first.simulateNextJob(input.sessionId);
    expect(job.durationSeconds).toBeGreaterThanOrEqual(8);
    expect(job.durationSeconds).toBeLessThanOrEqual(15);
    expect(job.settingsSnapshot?.brief.duration).toBe(job.durationSeconds);
    expect(job.hookArchetype).toMatch(/Problem Only|Problem → After/);
    expect(job.settingsSnapshot?.brief.hookArchetype).toBe(job.hookArchetype);
    expect(job.generationBrief.hookArchetype).toBe(job.hookArchetype);
    const options = { stateRoot: first.stateRoot, archiveRoot: first.archiveRoot, comfy: comfy(), lmStudio: lm() };
    runners.splice(runners.indexOf(first), 1); first.close();
    const second = new LocalGenerationRunner(options); runners.push(second);
    expect(second.session(input.sessionId)?.currentJobId).toBe(job.jobId); expect(second.jobs(input.sessionId)).toHaveLength(1);
    expect(second.jobs(input.sessionId)[0].durationSeconds).toBe(job.durationSeconds);
    expect(second.jobs(input.sessionId)[0].hookArchetype).toBe(job.hookArchetype);
    expect(second.simulateNextJob(input.sessionId).hookArchetype).toBe(job.hookArchetype);
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
