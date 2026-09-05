import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getProduct } from '../domain/data';
import { createOptionalH3ReferencePlan } from '../domain/h3';
import { clearProductReference, createLocalProductReference, isSupportedLocalReferenceImage, promptEngineStatusSnapshot, referenceAssetForSource, remoteProductReferencePath } from './H3VideoPromptsPage';

const product = getProduct('serum')!;

describe('H3 product reference picker state', () => {
  it('creates a local-file reference from an absolute image path', () => {
    const path = 'C:\\Users\\Creative\\References\\serum.JPG';
    const reference = createLocalProductReference(path);

    expect(reference).toEqual({
      source: 'local-file',
      path,
      description: 'Local product reference: serum.JPG'
    });
    expect(remoteProductReferencePath(reference)).toBe(path);
  });

  it('validates supported local image extensions', () => {
    expect(isSupportedLocalReferenceImage('C:\\References\\reference.png')).toBe(true);
    expect(isSupportedLocalReferenceImage('C:\\References\\reference.jpeg')).toBe(true);
    expect(isSupportedLocalReferenceImage('C:\\References\\reference.webp')).toBe(true);
    expect(isSupportedLocalReferenceImage('C:\\References\\reference.gif')).toBe(false);
    expect(() => createLocalProductReference('C:\\References\\reference.gif')).toThrow(/PNG, JPG, JPEG, or WebP/);
  });

  it('clears only the product reference asset', () => {
    const plan = createOptionalH3ReferencePlan(product);
    const localReference = createLocalProductReference('C:\\References\\serum.png');
    const nextPlan = { ...plan, productReference: localReference, styleReference: { source: 'custom' as const, description: 'warm studio', path: null } };
    const clearedPlan = { ...nextPlan, productReference: clearProductReference() };

    expect(clearedPlan.productReference).toEqual({ source: 'none', description: '', path: null });
    expect(clearedPlan.styleReference).toEqual(nextPlan.styleReference);
  });

  it('preserves selected-product and custom reference behavior', () => {
    const selectedProduct = referenceAssetForSource(clearProductReference(), 'selected-product', product, 'productReference');
    const custom = referenceAssetForSource({ source: 'custom', description: 'handheld bathroom scene', path: null }, 'custom', product, 'productReference');

    expect(selectedProduct).toMatchObject({ source: 'selected-product', path: product.imagePath });
    expect(remoteProductReferencePath(selectedProduct)).toBe(product.imagePath);
    expect(custom).toEqual({ source: 'custom', description: 'handheld bathroom scene', path: null });
    expect(remoteProductReferencePath(custom)).toBeNull();
  });

  it('passes the local productReference.path into the existing remote handoff', () => {
    const path = 'C:\\References\\custom-serum.webp';
    const reference = createLocalProductReference(path);
    const requestPath = remoteProductReferencePath(reference);

    expect(reference.path).toBe(path);
    expect(requestPath).toBe(path);
  });

  it('renders the prompt engine as observed read-only status with no model selector', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'ui', 'H3VideoPromptsPage.tsx'), 'utf8');
    const start = source.indexOf('function PromptEngineSettings');
    const end = source.indexOf('function RemoteH3Status', start);
    const component = source.slice(start, end);
    expect(component).not.toMatch(/<select|<input/);
    expect(component).toContain('Test Prompt Engine');
    expect(component).toContain('LM Studio');
    expect(component).toContain('Model selection, context, GPU/offload, quantization, template, and reasoning settings stay in LM Studio.');
    expect(component).not.toContain('settings.model');
    expect(source).not.toMatch(/ChatGPT/);
  });

  it('shows the fixed Qwen label regardless of other discovered models', () => {
    const status = {
      enhancerInstalled: true,
      validatorInstalled: true,
      requiredNodesInstalled: true,
      lmStudioConnected: true,
      models: ['qwen/qwen3.8-27b', 'qwen/other'],
      observedModelId: 'qwen/qwen3.8-27b',
      observedInstanceId: 'instance-1',
      selectedModel: null,
      qwenReady: true,
      error: null,
      checkedAt: '2026-09-04T00:00:00.000Z'
    };
    expect(promptEngineStatusSnapshot(status)).toEqual({ connection: 'Connected', model: 'Qwen 3.8 27B', status: 'Ready' });
    expect(promptEngineStatusSnapshot({ ...status, observedModelId: null, selectedModel: null, qwenReady: false })).toMatchObject({ model: 'Qwen 3.8 27B' });
  });
});
