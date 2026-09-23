import { describe, expect, it } from 'vitest';
import { getProduct } from './data';
import { buildCreativeFingerprint, createFixedProductTruth, planCreativeGenome } from './creative-diversity';
import { buildH3GenerationBrief, buildH3ReferenceContext, H3_SINGLE_SHOT_TIMING_CONTRACT, serializeH3GenerationBrief } from './h3-generation-brief';
import { createOptionalH3ReferencePlan } from './h3';
import type { H3VideoBrief } from './types';

const product = getProduct('cleanser')!;

const brief: H3VideoBrief = {
  product: product.id,
  contentType: 'Product B-Roll',
  creativeVariety: 'Balanced',
  videoIdea: 'A calm orange pollen halo forms around the cleanser in a bright greenhouse.',
  language: 'English',
  musicOnly: true,
  captions: false,
  subtitles: false,
  goal: 'Product reveal',
  customGoal: '',
  duration: 8,
  aspectRatio: '9:16',
  customAspectRatio: '',
  qualityPreset: 'Custom',
  megapixels: 0.98,
  multiple: 32,
  fps: 24,
  steps: 20,
  seedMode: 'fixed',
  seed: 42,
  refImageSize: 'max',
  workflowMode: 'REF2VA',
  cameraMotion: 'Cinematic',
  actionIntensity: 'High',
  pacing: 'Balanced',
  productFidelity: 'Exact',
  scheduler: 'simple',
  ending: 'Hero Shot',
  customEnding: '',
  sound: 'Music Only',
  promptDetail: 'Production',
  referenceFidelity: 'High',
  lockedProductPlateMode: 'Off',
  specialInstructions: 'Keep the tube front-facing and premium.',
  references: {
    ...createOptionalH3ReferencePlan(product),
    productReference: { source: 'selected-product', path: product.imagePath, description: `${product.officialName} packaging reference` }
  }
};

describe('H3GenerationBrief', () => {
  it.each([
    ['cleanser', 'dry and tight', 'bathroom sink'],
    ['serum', 'dark spots', 'mirror'],
    ['eye-cream', 'dark under-eyes', 'mirror']
  ] as const)('makes the %s Hook person and concern first', (productId, concern, setting) => {
    const selected = getProduct(productId)!;
    const result = buildH3GenerationBrief({
      product: selected,
      brief: { ...brief, product: productId, contentType: 'Hook', videoIdea: '', specialInstructions: '' }
    });
    const serialized = serializeH3GenerationBrief(result);
    expect(serialized).toContain(concern);
    expect(serialized).toContain(setting);
    expect(serialized).toContain('person and recognizable problem are the primary subject');
    expect(serialized).toContain('No product at any point');
    expect(result.workflowMode).toBe('T2VA');
    expect(result.references).toEqual([]);
    expect(result.creativeDirection.composition).toContain('Face and the relevant skin area dominate');
    expect(result.videoIdea).not.toContain('product reveal');
  });

  it('steers Product B-Roll toward practical edit inserts and away from luxury spectacle while preserving the product reference', () => {
    const serialized = serializeH3GenerationBrief(buildH3GenerationBrief({ product, brief }));

    expect(serialized).toContain('PRACTICAL PRODUCT B-ROLL CONTRACT');
    expect(serialized).toContain('social-commerce insert');
    expect(serialized).toContain('bathroom vanity, skincare shelf, clean countertop');
    expect(serialized).toContain('tripod, controlled handheld camera, small slider, simple macro move, or gentle push-in');
    expect(serialized).toContain('no sports-car-commercial lighting');
    expect(serialized).toContain('no sports-car-commercial lighting, black glossy supercar stage, aggressive orbit, huge lens flare');
    expect(serialized).toContain('Preserve the product directly from the authoritative reference');
    expect(serialized).toContain('<Picture 1>');
  });

  it('makes Educational output a text-free visual explanation and reserves requested captions for post-generation overlay', () => {
    const educational = buildH3GenerationBrief({
      product,
      brief: { ...brief, contentType: 'Educational', captions: true, subtitles: true, videoIdea: 'Show hydration entering dry-looking skin.' }
    });
    const serialized = serializeH3GenerationBrief(educational);

    expect(serialized).toContain('TEXT-FREE EDUCATIONAL CONTRACT');
    expect(serialized).toContain('understandable with zero text overlay');
    expect(serialized).toContain('hydration entering dry-looking skin');
    expect(serialized).toContain('NO readable text. NO typography, labels, words, letters, subtitles, captions');
    expect(serialized).toContain('deterministic post-generation application overlay if available');
    expect(serialized).not.toContain('Captions may be generated only');
    expect(serialized).not.toContain('Subtitles may be generated only');
  });

  it('gives Ingredient / Texture serum-specific and ingredient-macro guidance without generic product-ad drift or generated text', () => {
    const serum = getProduct('serum')!;
    const ingredientBrief = buildH3GenerationBrief({
      product: serum,
      brief: {
        ...brief,
        product: serum.id,
        contentType: 'Ingredient / Texture',
        videoIdea: 'Show the product texture.',
        references: {
          ...createOptionalH3ReferencePlan(serum),
          productReference: { source: 'selected-product', path: serum.imagePath, description: `${serum.officialName} packaging reference` }
        }
      }
    });
    const serialized = serializeH3GenerationBrief(ingredientBrief);

    expect(serialized).toContain('SKINCARE INGREDIENT / TEXTURE CONTRACT');
    expect(serialized).toContain('translucent clear serum droplet or bead');
    expect(serialized).toContain('vitamin-C-inspired citrus macro');
    expect(serialized).toContain('does not need to dominate every shot');
    expect(serialized).toContain('Do not drift into a food or beverage advertisement');
    expect(serialized).toContain('generic abstract luxury advertising');
    expect(serialized).toContain('NO readable text. NO typography, labels');
  });

  it('keeps Creative Diversity before Qwen and serializes only an intermediate REF2VA brief', () => {
    const plan = planCreativeGenome({
      product,
      contentFamily: 'Product B-Roll',
      userIdea: brief.videoIdea,
      specialInstructions: brief.specialInstructions,
      recentHistory: [],
      variety: 'Balanced',
      seed: 42,
      generationJobId: 'h3-canary-42'
    });
    const generationBrief = buildH3GenerationBrief({ product, brief: { ...brief, creativeGenome: plan.genome }, genome: plan.genome });
    const serialized = serializeH3GenerationBrief(generationBrief);

    expect(generationBrief.workflowMode).toBe('REF2VA');
    expect(generationBrief.contentFamily).toBe('Product B-Roll');
    expect(generationBrief.creativeDirection.visualHook).toBe(plan.genome.visualHook);
    expect(generationBrief.productCorrections).toContain('Preserve the product geometry directly from <Picture 1>. It is a wide, gently tapered squeeze tube with a white base flip-cap and glossy opaque orange finish. Do not simplify it into a cylindrical bottle/tube or matte surface.');
    expect(generationBrief.productCorrections.join(' ')).not.toContain('14 cm');
    expect(generationBrief.productCorrections.join(' ')).not.toContain('3.5 cm');
    expect(generationBrief.productCorrections.join(' ')).not.toContain('6 cm');
    expect(generationBrief.productCorrections.join(' ')).not.toMatch(/\b(?:is|as)\s+(?:a\s+)?cylindrical\b/i);
    expect(generationBrief.productCorrections.join(' ')).toContain('glossy opaque orange');
    expect(generationBrief.productCorrections).not.toContain(expect.stringContaining('rear surface'));
    expect(serialized.startsWith('WORKFLOW MODE LOCK: REF2VA.\nFormat the result as REF2VA.\nDo not switch generation modes.')).toBe(true);
    expect(serialized).toContain('REFERENCE MAP');
    expect(serialized).toContain('<Picture 1>');
    expect(serialized).toContain('Reference pixels own the exact silhouette, proportions, cap or lid shape, printed front design, and surface appearance.');
    expect(serialized).toContain('Qwen owns the scene, action, lighting, camera, pacing, sound, and H3 syntax.');
    expect(generationBrief.allowedReferenceLabels).toEqual({ subjects: ['<Subject 1>'], pictures: ['<Picture 1>'], videos: [], audios: [] });
    const singleManifest = JSON.parse(generationBrief.mediaManifest) as { mode: string; items: unknown[]; subjects: Array<Record<string, unknown>> };
    expect(singleManifest).toMatchObject({ mode: 'ref2va', items: [{ type: 'picture' }], subjects: [{ id: 1, sources: ['<Picture 1>'] }] });
    expect(singleManifest.items).toHaveLength(1);
    expect(singleManifest.subjects).toHaveLength(1);
    expect(serialized).toContain(H3_SINGLE_SHOT_TIMING_CONTRACT);
    expect(serialized).toContain('REPAIR CONTRACT');
    expect(serialized).toContain('remove numeric event times from shot prose');
    expect(serialized).toContain('never create a new label number');
    expect(serialized).not.toContain('<Picture 2>');
    expect(serialized).not.toContain('<Subject 2>');
    expect(serialized).toContain('No dialogue, voiceover, narration, creator speech, or other human speech.');
    expect(serialized).toContain('No generated captions or marketing text overlays.');
    expect(serialized).toContain('No generated subtitles or speech transcription.');
    for (const forbiddenHeader of ['subject_definitions', 'retention_analysis', 'detailed_description', 'overall_soundscape', 'non_diegetic_music']) {
      expect(serialized).not.toContain(forbiddenHeader);
    }
  });

  it('adds blank rear or side rules only when the planned concept exposes those surfaces', () => {
    const rotating = buildH3GenerationBrief({ product, brief: { ...brief, videoIdea: 'Rotate the cleanser around its side and reveal the blank rear surface.' } });
    expect(rotating.productCorrections).toEqual(expect.arrayContaining([
      expect.stringContaining('rear surface'),
      expect.stringContaining('side surface')
    ]));
  });

  it('removes speech-bearing Creative Diversity directions when Music Only is authoritative', () => {
    const generationBrief = buildH3GenerationBrief({
      product,
      brief,
      genome: {
        schemaVersion: 1,
        contentFamily: 'UGC Content',
        creativeArchetype: 'Creator Bathroom Check-In',
        visualHook: 'a creator speaks while holding the product',
        environment: 'bright bathroom',
        composition: 'handheld selfie frame',
        cameraPath: 'one deliberate reframe',
        framing: 'medium to close',
        lightingStyle: 'soft window light',
        primaryMotion: 'creator talks then raises the product',
        secondaryMotion: 'small towel movement',
        materialEffect: 'ceramic and glass',
        pacing: 'conversational and quick',
        openingDevice: 'creator enters mid-thought',
        transitionLanguage: 'spoken gesture leads to the close-up',
        endingDevice: 'product hold',
        audioCharacter: 'natural room tone with light creator speech'
      }
    });
    const serialized = serializeH3GenerationBrief(generationBrief);
    const creativeDirection = serialized.split('CREATIVE DIRECTION\n')[1].split('\n\nREFERENCE MAP')[0];

    expect(creativeDirection).not.toMatch(/\b(?:mid-thought|spoken|speech|dialogue|voiceover|voice-over|narration|speaks?|talks?)\b/i);
    expect(serialized).toContain('creator enters mid-action');
    expect(serialized).toContain('visible gesture leads to the close-up');
    expect(serialized).toContain('No dialogue, voiceover, narration, creator speech, or other human speech.');
  });

  it('builds a separate reference context and does not dump the full product record', () => {
    const generationBrief = buildH3GenerationBrief({ product, brief });
    const context = buildH3ReferenceContext(generationBrief);
    const productTruth = createFixedProductTruth(product);

    expect(context).toContain('<Picture 1>');
    expect(context).toContain('product identity and packaging truth');
    expect(context).toContain('<Subject 1> is the selected product represented by <Picture 1>');
    expect(context).not.toContain(productTruth.verifiedIngredients.join(','));
    expect(buildCreativeFingerprint({ ...generationBrief.creativeDirection, schemaVersion: 1, contentFamily: generationBrief.contentFamily })).toBeDefined();
  });

  it('keeps two concrete references in exact Picture/slot order while retaining one product subject', () => {
    const twoReferencePlan = {
      ...createOptionalH3ReferencePlan(product),
      productReference: { source: 'selected-product' as const, path: 'product.png', description: 'selected product packaging' },
      styleReference: { source: 'local-file' as const, path: 'style.png', description: 'warm studio light and shallow depth' }
    };
    const generationBrief = buildH3GenerationBrief({ product, brief, references: twoReferencePlan });
    const manifest = JSON.parse(generationBrief.mediaManifest) as { items: Array<Record<string, unknown>>; subjects: Array<Record<string, unknown>> };

    expect(generationBrief.references.map((reference) => [reference.pictureTag, reference.slot])).toEqual([
      ['<Picture 1>', 0],
      ['<Picture 2>', 1]
    ]);
    expect(manifest.items.map((item) => item.description)).toEqual(['selected product packaging', 'warm studio light and shallow depth']);
    expect(manifest.subjects).toHaveLength(1);
    expect(generationBrief.allowedReferenceLabels).toMatchObject({ subjects: ['<Subject 1>'], pictures: ['<Picture 1>', '<Picture 2>'] });
  });

  it('does not promote a text-only custom style note to a physical Picture label', () => {
    const generationBrief = buildH3GenerationBrief({
      product,
      brief,
      references: { ...createOptionalH3ReferencePlan(product), productReference: { source: 'selected-product', path: 'product.png', description: 'selected product packaging' }, styleReference: { source: 'custom', path: null, description: 'warm studio light' } }
    });

    expect(generationBrief.references).toHaveLength(1);
    expect(generationBrief.allowedReferenceLabels.pictures).toEqual(['<Picture 1>']);
    expect(generationBrief.specialInstructions).toContain('Text-only style direction');
    expect(generationBrief.specialInstructions).not.toContain('<Picture 2>');
  });

  it('builds Support B-Roll as theme-guided footage with no product or image identity contract', () => {
    const plan = planCreativeGenome({ product, contentFamily: 'Support B-Roll', recentHistory: [], seed: 9 });
    const generationBrief = buildH3GenerationBrief({
      product,
      brief: { ...brief, contentType: 'Support B-Roll', videoIdea: '', creativeGenome: plan.genome },
      genome: plan.genome
    });
    const serialized = serializeH3GenerationBrief(generationBrief);
    const manifest = JSON.parse(generationBrief.mediaManifest) as { items: unknown[]; subjects: unknown[] };

    expect(['Problem Hook', 'Skin Beauty Close-Up', 'Science Animation', 'Aesthetic Transition']).toContain(plan.genome.creativeArchetype);
    expect(generationBrief.workflowMode).toBe('T2VA');
    expect(generationBrief.references).toEqual([]);
    expect(generationBrief.productCorrections).toEqual([]);
    expect(generationBrief.allowedReferenceLabels).toEqual({ subjects: [], pictures: [], videos: [], audios: [] });
    expect(manifest).toMatchObject({ items: [], subjects: [], mode: 't2va' });
    expect(serialized).toContain('WORKFLOW MODE LOCK: T2VA.');
    expect(generationBrief.videoIdea).toContain('cleansing');
    expect(serialized).toContain('NON-PRODUCT SUPPORT B-ROLL CONTRACT');
    expect(serialized).toContain('Do not show a product, packaging, packshot');
    expect(serialized).not.toContain('<Picture 1>');
    expect(serialized).not.toContain('<Subject 1>');
  });

  it('collapses a duplicate physical file so a second label cannot be invented for the same image', () => {
    const duplicatePlan = {
      ...createOptionalH3ReferencePlan(product),
      productReference: { source: 'selected-product' as const, path: 'same.png', description: 'product identity' },
      styleReference: { source: 'local-file' as const, path: 'same.png', description: 'the same image' }
    };
    const generationBrief = buildH3GenerationBrief({ product, brief, references: duplicatePlan });

    expect(generationBrief.references.map((reference) => reference.pictureTag)).toEqual(['<Picture 1>']);
    expect(generationBrief.allowedReferenceLabels.pictures).toEqual(['<Picture 1>']);
  });
});
