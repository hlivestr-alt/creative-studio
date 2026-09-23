import { describe, expect, it } from 'vitest';
import { getProduct } from './data';
import { h3ContentTypeOptions, createOptionalH3ReferencePlan } from './h3';
import { buildH3GenerationBrief, h3ContentTypeContract, serializeH3GenerationBrief } from './h3-generation-brief';
import { getCreativeFamilyGrammar, planCreativeGenome } from './creative-diversity';
import { isNoProductVideo, isSupportBRoll } from './support-b-roll';
import { isCtaEndCard } from './cta-settings';
import type { H3VideoBrief, Product } from './types';

const serum = getProduct('serum')!;
const minimalBrief = (contentType: H3VideoBrief['contentType']): H3VideoBrief => ({
  product: 'serum', contentType, creativeVariety: 'Balanced', videoIdea: 'Invent an exotic ingredient and a medical cure.',
  language: 'English', musicOnly: true, captions: true, subtitles: true, goal: 'Product reveal', customGoal: '',
  duration: 4, aspectRatio: '9:16', customAspectRatio: '', qualityPreset: 'Custom', megapixels: 0.98,
  multiple: 32, fps: 24, steps: 20, seedMode: 'fixed', seed: 1, refImageSize: 'max', workflowMode: 'REF2VA',
  cameraMotion: 'Cinematic', actionIntensity: 'High', pacing: 'Balanced', productFidelity: 'Exact',
  scheduler: 'simple', ending: 'Hero Shot', customEnding: '', sound: 'Music Only', promptDetail: 'Production',
  specialInstructions: 'Claim an unverified medical cure.', references: createOptionalH3ReferencePlan(serum)
});

describe('active local video content types', () => {
  it('exposes exactly six types in UI and Auto Run selection', () => {
    expect(h3ContentTypeOptions).toEqual(['Hook', 'Benefits', 'Ingredients', 'Product', 'Support B-Roll', 'CTA / End Card']);
  });

  for (const type of ['Benefits', 'Ingredients'] as const) {
    it(`${type} passes only same-product verified facts and rejects missing or tampered facts`, () => {
      const withForbiddenProductReference = minimalBrief(type);
      withForbiddenProductReference.references.productReference = { source: 'selected-product', path: serum.imagePath, description: 'must be removed' };
      withForbiddenProductReference.references.styleReference = { source: 'local-file', path: 'style.png', description: 'must also be removed from this zero-reference job' };
      const result = buildH3GenerationBrief({ product: serum, brief: withForbiddenProductReference });
      const text = serializeH3GenerationBrief(result);
      const facts = type === 'Benefits' ? serum.benefitTerritories : serum.ingredients;
      expect(result.workflowMode).toBe('T2VA');
      expect(result.references).toEqual([]);
      expect(result.productCorrections).toEqual([]);
      expect(result.allowedReferenceLabels).toEqual({ subjects: [], pictures: [], videos: [], audios: [] });
      expect(JSON.parse(result.mediaManifest)).toMatchObject({ mode: 't2va', items: [], subjects: [] });
      expect(text).toContain(`PRODUCT-FREE VERIFIED ${type.toUpperCase()} CONTRACT`);
      expect(text).toContain('ZERO product references and ZERO visible product');
      expect(text).toContain('no bottle, package, packshot');
      for (const fact of facts) expect(text).toContain(fact);
      expect(text).not.toContain('exotic ingredient');
      expect(text).not.toContain('unverified medical cure');
      expect(text).not.toContain('must be removed');
      expect(text).not.toContain('<Picture 1>');
      expect(text).not.toContain('<Subject 1>');
      expect(text).toContain('NO readable text');
      expect(text).toContain('NO typography, labels, words, letters, subtitles, captions');
      expect(text).not.toContain('A tactile opening detail that resolves to the product');
      const field = type === 'Benefits' ? 'benefitTerritories' : 'ingredients';
      expect(() => buildH3GenerationBrief({ product: { ...serum, [field]: [] } as Product, brief: minimalBrief(type) })).toThrow(/Verified .* are missing/);
      expect(() => buildH3GenerationBrief({ product: { ...serum, [field]: ['Made up'] } as Product, brief: minimalBrief(type) })).toThrow(/Verified .* are missing/);
    });
  }

  it('keeps Benefits result-led and Ingredients education-led instead of using product showcase grammar', () => {
    const benefitDirections = getCreativeFamilyGrammar('Benefits').directions;
    const ingredientDirections = getCreativeFamilyGrammar('Ingredients').directions;
    expect(benefitDirections.map(direction => direction.creativeArchetype)).toEqual([
      'Human Before and After', 'Skin Macro Result', 'Hydration Result', 'Radiance Result', 'Comfort Result', 'Barrier Support Metaphor'
    ]);
    expect(ingredientDirections.map(direction => direction.creativeArchetype)).toEqual([
      'Ingredient Macro', 'Foam Formulation', 'Mist Formulation', 'Cream Formulation', 'Active Particle Interaction', 'Skin Layer Visualization', 'Clean Lab Aesthetic', 'Antioxidant Particle Metaphor'
    ]);
    for (const direction of [...benefitDirections, ...ingredientDirections]) {
      expect(`${direction.visualHook} ${direction.openingDevice} ${direction.endingDevice}`).not.toMatch(/product|package|packshot|hero reveal/i);
    }
    expect(h3ContentTypeContract(serum, 'Benefits').join(' ')).toContain('human skin close-ups');
    expect(h3ContentTypeContract(serum, 'Ingredients').join(' ')).toContain('No fake chemical formulas');
    expect(isNoProductVideo('Benefits')).toBe(true);
    expect(isNoProductVideo('Ingredients')).toBe(true);
  });

  it('filters randomized fact-led styles to visuals that fit the exact selected product', () => {
    const allowedSerumBenefits = new Set(['Human Before and After', 'Skin Macro Result', 'Radiance Result']);
    const allowedSerumIngredients = new Set(['Ingredient Macro', 'Active Particle Interaction', 'Skin Layer Visualization', 'Clean Lab Aesthetic', 'Antioxidant Particle Metaphor']);
    const allowedCleanserIngredients = new Set(['Ingredient Macro', 'Foam Formulation', 'Active Particle Interaction', 'Skin Layer Visualization', 'Clean Lab Aesthetic', 'Antioxidant Particle Metaphor']);
    const allowedTonerIngredients = new Set(['Ingredient Macro', 'Mist Formulation', 'Active Particle Interaction', 'Skin Layer Visualization', 'Clean Lab Aesthetic', 'Antioxidant Particle Metaphor']);
    for (let seed = 1; seed <= 40; seed++) {
      expect(allowedSerumBenefits.has(planCreativeGenome({ product: 'serum', contentFamily: 'Benefits', seed }).genome.creativeArchetype)).toBe(true);
      expect(allowedSerumIngredients.has(planCreativeGenome({ product: 'serum', contentFamily: 'Ingredients', seed }).genome.creativeArchetype)).toBe(true);
      expect(allowedCleanserIngredients.has(planCreativeGenome({ product: 'cleanser', contentFamily: 'Ingredients', seed }).genome.creativeArchetype)).toBe(true);
      expect(allowedTonerIngredients.has(planCreativeGenome({ product: 'toner', contentFamily: 'Ingredients', seed }).genome.creativeArchetype)).toBe(true);
    }
  });

  it('keeps Product broad, Hook opening-led, Support B-Roll no-product, and CTA separate', () => {
    const productContract = h3ContentTypeContract(serum, 'Product').join(' ');
    expect(productContract).toContain('visible from FRAME 1');
    expect(productContract).toContain('35–60% of frame height');
    expect(productContract).toContain('No wall, door, curtain, darkness, transformation');
    expect(productContract).toContain('Packaging print is visual appearance inherited from the verified reference');
    const directions = getCreativeFamilyGrammar('Product').directions;
    expect(directions.map(direction => direction.creativeArchetype)).toEqual([
      'Clean Hero', 'Vanity or Shelf', 'Macro Packaging Detail', 'Usage or Dispensing', 'Top-Down Product'
    ]);
    for (const direction of directions) {
      expect(direction.openingDevice).toMatch(/product|package/i);
      expect(direction.openingDevice).not.toMatch(/empty|dark|reveal|curtain|door|wall|before/i);
      expect(direction.cameraPath).not.toMatch(/orbit|rotate|sweep/i);
    }
    const productBrief = buildH3GenerationBrief({ product: serum, brief: { ...minimalBrief('Product'), videoIdea: '' } });
    const serializedProduct = serializeH3GenerationBrief(productBrief);
    expect(productBrief.workflowMode).toBe('REF2VA');
    expect(serializedProduct).toContain('reference-faithful product clearly from the first frame');
    expect(serializedProduct).not.toContain('polished product reveal');
    expect(h3ContentTypeContract(serum, 'Hook').join(' ')).toContain('person and recognizable problem are the primary subject');
    expect(buildH3GenerationBrief({ product: serum, brief: minimalBrief('Hook') }).workflowMode).toBe('T2VA');
    const support = buildH3GenerationBrief({ product: serum, brief: minimalBrief('Support B-Roll') });
    expect(isSupportBRoll('Support B-Roll')).toBe(true);
    expect(support.workflowMode).toBe('T2VA');
    expect(support.references).toEqual([]);
    expect(isCtaEndCard('CTA / End Card')).toBe(true);
    expect(isSupportBRoll('CTA / End Card')).toBe(false);
  });

  it('keeps all five new visual types speech-free when speech was not requested', () => {
    for (const contentType of ['Hook', 'Benefits', 'Ingredients', 'Product', 'Support B-Roll'] as const) {
      const brief = { ...minimalBrief(contentType), musicOnly: false, sound: 'Auto' as const,
        language: 'Indonesian' as const, videoIdea: 'Show soft fine foam and clear skincare texture.',
        specialInstructions: 'Keep a practical visual shot without dialogue.' };
      const text = serializeH3GenerationBrief(buildH3GenerationBrief({ product: serum, brief }));
      expect(text).toContain('SPEECH MODE: NONE');
      expect(text).toContain('Dialogue language is metadata only');
      expect(text).toContain('Never quote texture, ingredient, benefit, visual, or camera descriptions');
      expect(text).not.toContain('SPEECH MODE: VISIBLE DIALOGUE');
    }
  });

  it('preserves an explicit visible-dialogue request without promoting it to voiceover', () => {
    const result = buildH3GenerationBrief({ product: serum, brief: {
      ...minimalBrief('Hook'), musicOnly: false, sound: 'Auto',
      videoIdea: 'A woman says “My skin feels fresh” while holding the serum.'
    } });
    const text = serializeH3GenerationBrief(result);
    expect(result.speechMode).toBe('visible-dialogue');
    expect(text).toContain('SPEECH MODE: VISIBLE DIALOGUE');
    expect(text).toContain('A woman says “My skin feels fresh”');
    expect(text).toContain('an explicit vocal action in the same sentence');
    expect(text).toContain('never replace with voiceover');
  });
});
