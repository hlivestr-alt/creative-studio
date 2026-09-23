import { describe, expect, it } from 'vitest';
import { getProduct } from './data';
import { buildH3GenerationBrief, serializeH3GenerationBrief } from './h3-generation-brief';
import { createOptionalH3ReferencePlan } from './h3';
import { HOOK_ARCHETYPE_WEIGHTS, hookArchetypes, selectHookArchetype } from './hook-archetype';
import type { H3VideoBrief } from './types';

function hookBrief(productId: H3VideoBrief['product'], hookArchetype: H3VideoBrief['hookArchetype']): H3VideoBrief {
  const product = getProduct(productId)!;
  return {
    product: productId, contentType: 'Hook', hookArchetype, creativeVariety: 'Balanced', videoIdea: '', language: 'English',
    musicOnly: true, captions: false, subtitles: false, goal: 'Hook', customGoal: '', duration: 12, aspectRatio: '9:16',
    customAspectRatio: '', qualityPreset: 'Custom', megapixels: 0.98, multiple: 32, fps: 24, steps: 20,
    seedMode: 'fixed', seed: 42, refImageSize: 'max', workflowMode: 'REF2VA', cameraMotion: 'Cinematic',
    actionIntensity: 'Medium', pacing: 'Balanced', productFidelity: 'Exact', scheduler: 'simple', ending: 'Hold',
    customEnding: '', sound: 'Music Only', promptDetail: 'Production', specialInstructions: '',
    references: {
      ...createOptionalH3ReferencePlan(product),
      productReference: { source: 'selected-product', description: 'must be stripped', path: product.imagePath }
    }
  };
}

describe('Hook archetypes', () => {
  it('exposes both internal archetypes with the requested 55/45 draw boundary', () => {
    expect(hookArchetypes).toEqual(['Problem Only', 'Problem → After']);
    expect(HOOK_ARCHETYPE_WEIGHTS).toEqual({ 'Problem Only': 0.55, 'Problem → After': 0.45 });
    expect(selectHookArchetype(() => 0)).toBe('Problem Only');
    expect(selectHookArchetype(() => 0.549999)).toBe('Problem Only');
    expect(selectHookArchetype(() => 0.55)).toBe('Problem → After');
    expect(selectHookArchetype(() => 0.999999)).toBe('Problem → After');
  });

  it.each([
    ['eye-cream', 'tired-looking dark under-eyes', 'more refreshed, rested, brighter, and fresher'],
    ['serum', 'dark-spot appearance', 'brighter, more even, and more radiant'],
    ['cleanser', 'just-washed skin', 'clean, fresh, soft, comfortable']
  ] as const)('builds a product-free Problem → After %s Hook with both states', (productId, before, after) => {
    const generation = buildH3GenerationBrief({
      product: getProduct(productId)!,
      brief: hookBrief(productId, 'Problem → After')
    });
    const text = serializeH3GenerationBrief(generation);
    expect(generation.hookArchetype).toBe('Problem → After');
    expect(generation.workflowMode).toBe('T2VA');
    expect(generation.references).toEqual([]);
    expect(generation.allowedReferenceLabels).toEqual({ subjects: [], pictures: [], videos: [], audios: [] });
    expect(generation.productCorrections).toEqual([]);
    expect(text).toContain('BEFORE appearance:');
    expect(text).toContain(before);
    expect(text).toContain(after);
    expect(text).toContain('same person and same general setting');
    expect(text).toContain('first 35–50%');
    expect(text).toContain('remaining 40–55%');
    expect(text).toContain('No product at any point');
    expect(text).toContain('pump bottle');
    expect(text).toContain('background or mirror');
    if (productId === 'cleanser') {
      expect(text).toContain('not acne, rash, irritation, or strong redness');
      expect(text).toContain('natural moisture sheen');
    }
    expect(text).not.toContain('<Picture 1>');
    expect(text).not.toContain('<Subject 1>');
    expect(text).not.toContain('must be stripped');
  });

  it('keeps Problem Only focused on the concern through the end', () => {
    const generation = buildH3GenerationBrief({
      product: getProduct('eye-cream')!,
      brief: hookBrief('eye-cream', 'Problem Only')
    });
    const text = serializeH3GenerationBrief(generation);
    expect(generation.creativeDirection.creativeArchetype).toBe('Problem Only');
    expect(text).toContain('Focus entirely on the relatable problem');
    expect(text).not.toContain('BEFORE appearance:');
    expect(text).not.toContain('AFTER appearance:');
  });
});
