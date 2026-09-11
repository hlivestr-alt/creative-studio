import { describe, expect, it } from 'vitest';
import { products } from '../../src/domain/data';
import { createOptionalH3ReferencePlan } from '../../src/domain/h3';
import { defaultSettings } from '../../src/domain/settings';
import type { AutoH3Config } from '../../src/domain/auto-h3';
import type { H3VideoBrief } from '../../src/domain/types';
import { CHINA_RUNNER_VERSION } from '../../src/china-runner/types';
import { canonicalBundleHash } from '../../src/china-runner/staging';
import { buildChinaSessionBundle } from './china-auto-h3-bundle';

const product = products.find(item => item.id === 'full-series')!;
const brief: H3VideoBrief = { product: product.id, contentType: 'Product B-Roll', creativeVariety: 'Balanced', videoIdea: 'real session', language: 'English', musicOnly: true, captions: false, subtitles: false, goal: 'Product reveal', customGoal: '', duration: 4, aspectRatio: '9:16', customAspectRatio: '', qualityPreset: 'Custom', megapixels: 0.98, multiple: 32, fps: 24, steps: 20, seedMode: 'random', seed: 42, refImageSize: 'max', workflowMode: 'REF2VA', cameraMotion: 'Cinematic', actionIntensity: 'High', pacing: 'Balanced', productFidelity: 'Exact', scheduler: 'simple', ending: 'Hero Shot', customEnding: '', sound: 'Music Only', promptDetail: 'Production', specialInstructions: 'preserve packaging', references: createOptionalH3ReferencePlan(product) };
brief.references.firstFrame = { source: 'local-file', description: 'must not stage', path: 'C:/manual/private.png' };
const config: AutoH3Config = { selectedProducts: [product.id], selectedContentTypes: ['Product B-Roll'], shuffleProducts: false, shuffleContentTypes: false, chinaRoot: String.raw`D:\AI Videos`, laptopRoot: 'C:/unused', brief };

describe('real Phase 3A China session bundle', () => {
  it('contains exact settings, hashes, and every Full Series verified master', () => {
    const { bundle, bundleSha256 } = buildChinaSessionBundle(config, defaultSettings(process.cwd()), CHINA_RUNNER_VERSION, 'e8aacb62-cc96-4e3e-bf8d-16040ff47da5');
    expect(bundle.productReferences[0].assetIds).toHaveLength(new Set([product.imagePath, ...(product.referenceImagePaths ?? [])]).size);
    expect(bundle.assets.every(asset => asset.productId === product.id && asset.sha256.length === 64 && asset.size > 0)).toBe(true);
    expect(bundle.assets.some(asset => asset.sourcePath.includes('manual/private'))).toBe(false);
    expect(bundle.settings.h3).toMatchObject({ durationSeconds: 4, fps: 24, steps: 20, scheduler: 'simple', seedMode: 'random', refImageSize: 'max' });
    expect(bundle.systemPromptSha256).toHaveLength(64); expect(bundle.workflowSha256).toHaveLength(64);
    expect(bundleSha256).toBe(canonicalBundleHash(bundle));
  });

  it('uses deterministic product-scoped asset identities', () => {
    const first = buildChinaSessionBundle(config, defaultSettings(process.cwd()), CHINA_RUNNER_VERSION, 'e8aacb62-cc96-4e3e-bf8d-16040ff47da5').bundle;
    const second = buildChinaSessionBundle(config, defaultSettings(process.cwd()), CHINA_RUNNER_VERSION, 'e8aacb62-cc96-4e3e-bf8d-16040ff47da5').bundle;
    expect(first.assets.map(asset => [asset.id, asset.filename, asset.sha256])).toEqual(second.assets.map(asset => [asset.id, asset.filename, asset.sha256]));
    expect(first.bundleSha256).toBe(second.bundleSha256);
  });
});
