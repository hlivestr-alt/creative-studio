import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLocalSessionBundle } from '../electron/main/local-auto-h3-bundle';
import { defaultSettings } from '../src/domain/settings';
import { createOptionalH3ReferencePlan } from '../src/domain/h3';
import { getProduct } from '../src/domain/data';
import type { AutoH3Config } from '../src/domain/auto-h3';
import type { HookArchetype } from '../src/domain/hook-archetype';
import type { H3VideoBrief } from '../src/domain/types';
import type { PersistedJob, PersistedSession, RunnerCapabilities } from '../src/local-runner/types';

const baseUrl = 'http://127.0.0.1:8787/proya/auto';
const workspace = process.cwd();
const reportRoot = join(workspace, 'visual-qa', 'hook-archetypes');
mkdirSync(reportRoot, { recursive: true });

const samples: Array<{ name: string; product: H3VideoBrief['product']; archetype: HookArchetype }> = [
  { name: 'eye-cream-problem-only', product: 'eye-cream', archetype: 'Problem Only' },
  { name: 'eye-cream-problem-after', product: 'eye-cream', archetype: 'Problem → After' },
  { name: 'serum-problem-after', product: 'serum', archetype: 'Problem → After' },
  { name: 'cleanser-problem-after', product: 'cleanser', archetype: 'Problem → After' }
];

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}/${path}`, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

function brief(productId: H3VideoBrief['product'], archetype: HookArchetype): H3VideoBrief {
  const product = getProduct(productId)!;
  return {
    product: productId, contentType: 'Hook', hookArchetype: archetype, creativeVariety: 'Balanced', videoIdea: '',
    language: 'English', musicOnly: true, captions: false, subtitles: false, goal: 'Hook', customGoal: '', duration: 8,
    aspectRatio: '9:16', customAspectRatio: '', qualityPreset: 'Custom', megapixels: 0.98, multiple: 32, fps: 24,
    steps: 20, seedMode: 'random', seed: 42, refImageSize: 'max', workflowMode: 'T2VA', cameraMotion: 'Cinematic',
    actionIntensity: 'Medium', pacing: 'Balanced', productFidelity: 'Exact', scheduler: 'simple', ending: 'Hold',
    customEnding: '', sound: 'Music Only', promptDetail: 'Production', specialInstructions: '',
    references: createOptionalH3ReferencePlan(product)
  };
}

async function runSample(sample: typeof samples[number], capabilities: RunnerCapabilities) {
  const settings = defaultSettings(workspace);
  const config: AutoH3Config = {
    selectedProducts: [sample.product], selectedContentTypes: ['Hook'], shuffleProducts: false, shuffleContentTypes: false,
    chinaRoot: String.raw`D:\AI Videos`, laptopRoot: reportRoot, brief: brief(sample.product, sample.archetype)
  };
  const { bundle } = buildLocalSessionBundle(config, settings, capabilities.runnerVersion);
  await json('stage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bundle) });
  await json('start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: bundle.sessionId, bundleHash: bundle.bundleSha256 }) });
  await json(`session/${bundle.sessionId}/stop-after-current`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  console.log(`[${sample.name}] started ${bundle.sessionId} as ${sample.archetype}`);
  for (;;) {
    await new Promise(resolve => setTimeout(resolve, 10_000));
    const sessionResult = await json<{ session: PersistedSession }>(`session/${bundle.sessionId}`);
    const jobsResult = await json<{ jobs: PersistedJob[] }>(`jobs?sessionId=${bundle.sessionId}`);
    const job = jobsResult.jobs[0];
    console.log(`[${sample.name}] ${sessionResult.session.status} / ${job?.phase ?? 'planning'}${job?.error ? ` / ${job.error}` : ''}`);
    if (job?.phase === 'FAILED') throw new Error(`${sample.name} failed: ${job.error}`);
    if (job?.phase === 'COMPLETED' && sessionResult.session.status === 'STOPPED') {
      if (job.hookArchetype !== sample.archetype || job.generationBrief.hookArchetype !== sample.archetype) throw new Error(`${sample.name} archetype persistence mismatch.`);
      if (job.referenceAssetIds.length || job.generationBrief.references.length || job.request?.referenceImages?.length || job.request?.productReferencePath) throw new Error(`${sample.name} received a forbidden product reference.`);
      const record = { name: sample.name, product: sample.product, archetype: sample.archetype, durationSeconds: job.durationSeconds, archivePath: job.archivePath, archiveSha256: job.archiveSha256, jobId: job.jobId, prompt: job.executionState?.finalEnhancedPrompt ?? null };
      writeFileSync(join(reportRoot, `${sample.name}.json`), JSON.stringify(record, null, 2));
      return record;
    }
  }
}

const capabilities = await json<RunnerCapabilities>('capabilities');
const results = [];
for (const sample of samples) {
  const recordPath = join(reportRoot, `${sample.name}.json`);
  if (existsSync(recordPath)) {
    const existing = JSON.parse(readFileSync(recordPath, 'utf8'));
    if (existing.archivePath && existsSync(existing.archivePath)) {
      console.log(`[${sample.name}] reusing completed archived sample`);
      results.push(existing);
      continue;
    }
  }
  results.push(await runSample(sample, capabilities));
}
writeFileSync(join(reportRoot, 'manifest.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
