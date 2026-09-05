import { describe, expect, it } from 'vitest';
import { buildH3ChatGPTRequest, buildH3Prompt, buildH3SettingsText, createH3ReferencePlan, createOptionalH3ReferencePlan } from './h3';
import { buildH3LockedProductPlatePlan, lockedProductPlatePromptBlock, recommendH3LockedProductPlate } from './locked-product-plate';
import { getProduct } from './data';
import type { H3VideoBrief } from './types';

const cleanser = getProduct('cleanser')!;

const brief = (overrides: Partial<H3VideoBrief> = {}): H3VideoBrief => ({
  product: cleanser.id,
  videoIdea: 'Static front-facing Cleanser hero with warm light and gentle foam motion around the product.',
  language: 'Indonesian',
  musicOnly: false,
  captions: false,
  subtitles: false,
  goal: 'Product awareness',
  customGoal: '',
  duration: 8,
  aspectRatio: '9:16',
  customAspectRatio: '',
  qualityPreset: 'Final',
  megapixels: 0.98,
  multiple: 32,
  fps: 24,
  workflowMode: 'AUTO',
  cameraMotion: 'Static',
  actionIntensity: 'Low',
  pacing: 'Slow',
  productFidelity: 'Exact',
  ending: 'Hero Shot',
  customEnding: '',
  sound: 'Sound + Music',
  promptDetail: 'Production',
  lockedProductPlateMode: 'Off',
  specialInstructions: '',
  references: createH3ReferencePlan(cleanser),
  ...overrides
});

describe('Locked Product Plate planning', () => {
  it('keeps the original product asset in the foreground and delegates motion to the environment', () => {
    const current = brief({ lockedProductPlateMode: 'Full Shot' });
    const plan = buildH3LockedProductPlatePlan(cleanser, current);
    const block = lockedProductPlatePromptBlock(cleanser, current);
    const prompt = buildH3Prompt({ product: cleanser, brief: current, concept: null });

    expect(plan).toMatchObject({ mode: 'Full Shot', enabled: true, coverage: 'full-shot', referenceAttached: true });
    expect(plan.sourceAssetPaths).toEqual([cleanser.imagePath]);
    expect(plan.sourcePlate).toContain('original foreground plate');
    expect(plan.generatedLayer).toContain('background/environment');
    expect(plan.compositing).toContain('Optional contact shadow and reflection');
    expect(block).toContain('mode: Full Shot');
    expect(block).toContain('H3 must not redraw or regenerate the package');
    expect(prompt).toContain('locked_product_plate:');
    expect(prompt).toContain('source pixels');
  });

  it.each([
    ['Opening Hero', 'opening-hero', 'opening hero beat'],
    ['Final Hero', 'final-hero', 'final hero beat']
  ] as const)('supports the %s selected-shot scope', (mode, coverage, scope) => {
    const plan = buildH3LockedProductPlatePlan(cleanser, brief({ lockedProductPlateMode: mode }));

    expect(plan).toMatchObject({ mode, enabled: true, coverage });
    expect(plan.motion).toContain(scope);
  });

  it('does not alter the existing H3 prompt when plate mode is off', () => {
    const prompt = buildH3Prompt({ product: cleanser, brief: brief(), concept: null });

    expect(prompt).not.toContain('locked_product_plate:');
    expect(buildH3SettingsText(brief(), 'L2VA')).toContain('Locked Product Plate: Off');
  });

  it('carries the enabled plate plan through the ChatGPT handoff', () => {
    const request = buildH3ChatGPTRequest({ product: cleanser, brief: brief({ lockedProductPlateMode: 'Final Hero' }) });

    expect(request).toContain('## LOCKED PRODUCT PLATE');
    expect(request).toContain('mode: Final Hero');
    expect(request).toContain('original product asset as the foreground plate');
    expect(request).toContain('finish with the described composite');
  });

  it('recommends the mode only for front-facing, minimally moving hero concepts', () => {
    const recommendation = recommendH3LockedProductPlate(cleanser, brief());
    const rotating = recommendH3LockedProductPlate(cleanser, brief({
      videoIdea: 'A 360-degree Cleanser rotation reveals the rear before returning to the front.',
      cameraMotion: 'Cinematic',
      actionIntensity: 'High'
    }));

    expect(recommendation).toMatchObject({ recommended: true, suggestedMode: 'Final Hero' });
    expect(recommendation.reason).toContain('animate the environment around it');
    expect(rotating.recommended).toBe(false);
    expect(rotating.blockers.join(' ')).toContain('rotation');

    const withoutExactPackaging = recommendH3LockedProductPlate(cleanser, brief({
      productFidelity: 'Auto',
      references: createOptionalH3ReferencePlan(cleanser)
    }));
    expect(withoutExactPackaging.recommended).toBe(false);
    expect(withoutExactPackaging.packagingExact).toBe(false);
    expect(withoutExactPackaging.blockers.join(' ')).toContain('packaging pixels');
  });

  it('derives the plan from each product reference instead of embedding a product-specific asset', () => {
    const serum = getProduct('serum')!;
    const current = brief({
      product: serum.id,
      videoIdea: 'Static front-facing Serum hero with light moving around the bottle.',
      references: createH3ReferencePlan(serum),
      lockedProductPlateMode: 'Full Shot'
    });
    const plan = buildH3LockedProductPlatePlan(serum, current);

    expect(plan.sourceAssetPaths).toEqual([serum.imagePath]);
    expect(plan.sourcePlate).toContain('Serum product image');
    expect(plan.sourcePlate).not.toContain('Cleanser');
  });
});
