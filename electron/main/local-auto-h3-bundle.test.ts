import { describe, expect, it } from 'vitest';
import { products } from '../../src/domain/data';
import { createOptionalH3ReferencePlan } from '../../src/domain/h3';
import { defaultSettings } from '../../src/domain/settings';
import type { AutoH3Config } from '../../src/domain/auto-h3';
import type { H3VideoBrief } from '../../src/domain/types';
import { LOCAL_RUNNER_VERSION } from '../../src/local-runner/types';
import { canonicalBundleHash } from '../../src/local-runner/staging';
import { buildLocalSessionBundle } from './local-auto-h3-bundle';

const product = products.find(item => item.id === 'full-series')!;
const brief: H3VideoBrief = { product: product.id, contentType: 'Product B-Roll', creativeVariety: 'Balanced', videoIdea: 'real session', language: 'English', musicOnly: true, captions: false, subtitles: false, goal: 'Product reveal', customGoal: '', duration: 4, aspectRatio: '9:16', customAspectRatio: '', qualityPreset: 'Custom', megapixels: 0.98, multiple: 32, fps: 24, steps: 20, seedMode: 'random', seed: 42, refImageSize: 'max', workflowMode: 'REF2VA', cameraMotion: 'Cinematic', actionIntensity: 'High', pacing: 'Balanced', productFidelity: 'Exact', scheduler: 'simple', ending: 'Hero Shot', customEnding: '', sound: 'Music Only', promptDetail: 'Production', specialInstructions: 'preserve packaging', references: createOptionalH3ReferencePlan(product) };
brief.references.firstFrame = { source: 'local-file', description: 'must not stage', path: 'C:/manual/private.png' };
const config: AutoH3Config = { selectedProducts: [product.id], selectedContentTypes: ['Product B-Roll'], shuffleProducts: false, shuffleContentTypes: false, chinaRoot: String.raw`D:\AI Videos`, laptopRoot: 'C:/unused', brief };

describe('real Phase 3A China session bundle', () => {
  it('contains exact settings, hashes, and every Full Series verified master', () => {
    const { bundle, bundleSha256 } = buildLocalSessionBundle(config, defaultSettings(process.cwd()), LOCAL_RUNNER_VERSION, 'e8aacb62-cc96-4e3e-bf8d-16040ff47da5');
    expect(bundle.productReferences[0].assetIds).toHaveLength(new Set([product.imagePath, ...(product.referenceImagePaths ?? [])]).size);
    expect(bundle.assets.every(asset => asset.productId === product.id && asset.sha256.length === 64 && asset.size > 0)).toBe(true);
    expect(bundle.assets.some(asset => asset.sourcePath.includes('manual/private'))).toBe(false);
    expect(bundle.settings.h3).toMatchObject({ durationSeconds: 4, fps: 24, steps: 20, scheduler: 'simple', seedMode: 'random', refImageSize: 'max' });
    expect(bundle.systemPromptSha256).toHaveLength(64); expect(bundle.workflowSha256).toHaveLength(64);
    expect(bundleSha256).toBe(canonicalBundleHash(bundle));
  });

  it('uses deterministic product-scoped asset identities', () => {
    const first = buildLocalSessionBundle(config, defaultSettings(process.cwd()), LOCAL_RUNNER_VERSION, 'e8aacb62-cc96-4e3e-bf8d-16040ff47da5').bundle;
    const second = buildLocalSessionBundle(config, defaultSettings(process.cwd()), LOCAL_RUNNER_VERSION, 'e8aacb62-cc96-4e3e-bf8d-16040ff47da5').bundle;
    expect(first.assets.map(asset => [asset.id, asset.filename, asset.sha256])).toEqual(second.assets.map(asset => [asset.id, asset.filename, asset.sha256]));
    expect(first.bundleSha256).toBe(second.bundleSha256);
  });

  it('keeps a Support B-Roll-only Serum bundle metadata-only with zero assets', () => {
    const serum = products.find(item => item.id === 'serum')!;
    const supportConfig: AutoH3Config = {
      ...config,
      selectedProducts: [serum.id],
      selectedContentTypes: ['Support B-Roll'],
      brief: { ...brief, product: serum.id, contentType: 'Support B-Roll' }
    };
    const { bundle } = buildLocalSessionBundle(supportConfig, defaultSettings(process.cwd()), LOCAL_RUNNER_VERSION, 'e8aacb62-cc96-4e3e-bf8d-16040ff47da5');
    const t2va = bundle.supportBRollWorkflow as Record<string, { class_type: string; inputs: Record<string, unknown> }>;
    expect(bundle.assets).toEqual([]);
    expect(bundle.productReferences).toEqual([{ productId: serum.id, assetIds: [] }]);
    expect(bundle.products.find(item => item.id === serum.id)).toMatchObject({ id: serum.id, officialName: serum.officialName });
    expect(t2va['127']).toMatchObject({ inputs: { unet_name: 'minimax_h3_fl2va_pruned_int8_convrot.safetensors' } });
    expect(t2va['136']).toMatchObject({ class_type: 'MiniMaxH3ImageToVideo' });
    expect(t2va['136'].inputs).not.toHaveProperty('first_frame');
    expect(t2va['136'].inputs).not.toHaveProperty('ref_images.ref_image_0');
    expect(t2va['149']).toMatchObject({ inputs: { mode: 't2va' } });
    expect(Buffer.byteLength(JSON.stringify(bundle))).toBeLessThan(30_000);
  });

  it('stages the Serum master once when Support B-Roll is mixed with UGC Content', () => {
    const serum = products.find(item => item.id === 'serum')!;
    const mixedConfig: AutoH3Config = {
      ...config,
      selectedProducts: [serum.id],
      selectedContentTypes: ['Support B-Roll', 'UGC Content'],
      brief: { ...brief, product: serum.id, contentType: 'Support B-Roll' }
    };
    const { bundle } = buildLocalSessionBundle(mixedConfig, defaultSettings(process.cwd()), LOCAL_RUNNER_VERSION, 'e8aacb62-cc96-4e3e-bf8d-16040ff47da5');
    expect(bundle.assets).toHaveLength(new Set([serum.imagePath, ...(serum.referenceImagePaths ?? [])]).size);
    expect(bundle.productReferences[0].assetIds).toEqual(bundle.assets.map(asset => asset.id));
  });

});
