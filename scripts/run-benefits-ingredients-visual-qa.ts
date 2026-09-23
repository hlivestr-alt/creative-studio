import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLocalSessionBundle } from '../electron/main/local-auto-h3-bundle';
import { defaultSettings } from '../src/domain/settings';
import { createOptionalH3ReferencePlan } from '../src/domain/h3';
import { getProduct } from '../src/domain/data';
import type { AutoH3Config } from '../src/domain/auto-h3';
import type { H3ContentType, H3VideoBrief, ProductId } from '../src/domain/types';
import type { PersistedJob, PersistedSession, RunnerCapabilities } from '../src/local-runner/types';

const baseUrl = 'http://127.0.0.1:8787/proya/auto';
const workspace = process.cwd();
const reportRoot = join(workspace, 'visual-qa', 'benefits-ingredients');
mkdirSync(reportRoot, { recursive: true });

const samples: Array<{ name: string; product: ProductId; contentType: Extract<H3ContentType, 'Benefits' | 'Ingredients'> }> = [
  { name: 'serum-benefits', product: 'serum', contentType: 'Benefits' },
  { name: 'skin-cream-benefits', product: 'skin-cream', contentType: 'Benefits' },
  { name: 'cleanser-benefits', product: 'cleanser', contentType: 'Benefits' },
  { name: 'serum-ingredients', product: 'serum', contentType: 'Ingredients' },
  { name: 'cleanser-ingredients', product: 'cleanser', contentType: 'Ingredients' },
  { name: 'toner-ingredients', product: 'toner', contentType: 'Ingredients' }
];
const requestedNames = new Set((process.env.PROYA_QA_SAMPLES ?? '').split(',').map(value => value.trim()).filter(Boolean));
const runSamples = requestedNames.size ? samples.filter(sample => requestedNames.has(sample.name)) : samples;
if (requestedNames.size && runSamples.length !== requestedNames.size) throw new Error('PROYA_QA_SAMPLES contains an unknown sample name.');

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}/${path}`, init);
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${text}`);
  return JSON.parse(text) as T;
}

function brief(productId: ProductId, contentType: 'Benefits' | 'Ingredients'): H3VideoBrief {
  const product = getProduct(productId)!;
  return {
    product: productId, contentType, creativeVariety: 'High', videoIdea: '', language: 'English', musicOnly: true,
    captions: false, subtitles: false, goal: contentType === 'Benefits' ? 'Show verified visible result' : 'Ingredient education',
    customGoal: '', duration: 8, aspectRatio: '9:16', customAspectRatio: '', qualityPreset: 'Custom', megapixels: 0.98,
    multiple: 32, fps: 24, steps: 20, seedMode: 'random', seed: 42, refImageSize: 'max', workflowMode: 'T2VA',
    cameraMotion: 'Cinematic', actionIntensity: 'Medium', pacing: 'Balanced', productFidelity: 'Exact', scheduler: 'simple',
    ending: 'Hold', customEnding: '', sound: 'Music Only', promptDetail: 'Production', specialInstructions: '',
    references: createOptionalH3ReferencePlan(product)
  };
}

async function runSample(sample: typeof samples[number], capabilities: RunnerCapabilities) {
  const settings = defaultSettings(workspace);
  const config: AutoH3Config = {
    selectedProducts: [sample.product], selectedContentTypes: [sample.contentType], shuffleProducts: false, shuffleContentTypes: false,
    chinaRoot: String.raw`D:\AI Videos`, laptopRoot: reportRoot, brief: brief(sample.product, sample.contentType)
  };
  const { bundle } = buildLocalSessionBundle(config, settings, capabilities.runnerVersion);
  if (bundle.assets.length || bundle.productReferences.some(binding => binding.assetIds.length)) throw new Error(`${sample.name} staged a forbidden product asset.`);
  await json('stage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bundle) });
  await json('start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId: bundle.sessionId, bundleHash: bundle.bundleSha256 }) });
  await json(`session/${bundle.sessionId}/stop-after-current`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  console.log(`[${sample.name}] started ${bundle.sessionId}`);
  for (;;) {
    await new Promise(resolve => setTimeout(resolve, 10_000));
    const sessionResult = await json<{ session: PersistedSession }>(`session/${bundle.sessionId}`);
    const jobsResult = await json<{ jobs: PersistedJob[] }>(`jobs?sessionId=${bundle.sessionId}`);
    const job = jobsResult.jobs[0];
    console.log(`[${sample.name}] ${sessionResult.session.status} / ${job?.phase ?? 'planning'}${job?.error ? ` / ${job.error}` : ''}`);
    if (job?.phase === 'FAILED') throw new Error(`${sample.name} failed: ${job.error}`);
    if (job?.phase === 'COMPLETED' && sessionResult.session.status === 'STOPPED') {
      if (job.referenceAssetIds.length || job.generationBrief.references.length || job.request?.referenceImages?.length || job.request?.productReferencePath) throw new Error(`${sample.name} received a forbidden product reference.`);
      if (job.generationBrief.workflowMode !== 'T2VA' || job.request?.mode !== 'T2VA') throw new Error(`${sample.name} did not remain T2VA.`);
      const record = {
        name: sample.name, product: sample.product, contentType: sample.contentType, durationSeconds: job.durationSeconds,
        archivePath: job.archivePath, archiveSha256: job.archiveSha256, jobId: job.jobId,
        creativeArchetype: job.creativeGenome.creativeArchetype, prompt: job.executionState?.finalEnhancedPrompt ?? null
      };
      writeFileSync(join(reportRoot, `${sample.name}.json`), JSON.stringify(record, null, 2));
      return record;
    }
  }
}

const capabilities = await json<RunnerCapabilities>('capabilities');
const health = await json<{ ready: boolean }>('health');
if (!health.ready) throw new Error('Local H3 stack is not ready.');
const results = [];
for (const sample of runSamples) results.push(await runSample(sample, capabilities));
const manifest = samples.map(sample => {
  const path = join(reportRoot, `${sample.name}.json`);
  if (!existsSync(path)) throw new Error(`Final QA record is missing: ${sample.name}`);
  return JSON.parse(readFileSync(path, 'utf8'));
});
writeFileSync(join(reportRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(results, null, 2));
