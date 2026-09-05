import { describe, expect, it } from 'vitest';
import {
  buildH3ChatGPTRequest,
  buildH3ConceptRequest,
  buildH3Concepts,
  buildH3PlanningPackage,
  buildH3Prompt,
  buildH3RecommendedSettings,
  buildH3Timeline,
  buildH3ReferenceSlotMappings,
  applyH3WorkflowSettings,
  h3WorkflowSettingsFromBrief,
  calculateH3FrameLength,
  createOptionalH3ReferencePlan,
  createH3ReferencePlan,
  h3RefImageSize,
  resolveH3Workflow
} from './h3';
import { getProduct } from './data';
import { planCreativeGenome } from './creative-diversity';
import type { CreativeGenome, H3VideoBrief } from './types';

const product = getProduct('skin-cream')!;
const serum = getProduct('serum')!;
const eyeCream = getProduct('eye-cream')!;

const eyeCreamGalleryGenome: CreativeGenome = {
  schemaVersion: 1,
  contentFamily: 'Cinematic Product Ad',
  creativeArchetype: 'Suspended Gallery Reveal',
  visualHook: 'an elegant vertical gallery suspended in a cool dark void, where floating rectangular frames descend one by one as a citrus-gold beam moves downward toward the product hero',
  environment: 'a deep cool ambient void containing a vertical suspended gallery and a lower hero chamber',
  composition: 'a central axis with nested depth, floating rectangular frames at different distances, and the product in the lower hero chamber',
  cameraPath: 'a controlled upward crane through the gallery with a subtle straight push-in at the end',
  framing: 'wide vertical scale resolving to a final medium hero composition',
  lightingStyle: 'a narrow warm citrus-gold beam descending through cool blue-black ambient shadow',
  primaryMotion: 'floating rectangular frames lower one by one as the citrus-gold beam descends, sending reflections across their edges',
  secondaryMotion: 'warm reflections travel across frame edges and haze as each layer is reached',
  materialEffect: 'suspended acrylic frames, faint haze, black depth, and restrained reflective surfaces',
  pacing: 'slow escalating reveal with a calm final settle',
  openingDevice: 'begin in darkness with one narrow citrus-gold beam above the empty gallery',
  transitionLanguage: 'the last descending frame opens directly onto the lower hero chamber',
  endingDevice: 'transition into a subtle straight push-in and settle into a restrained vertical gallery hero lock',
  audioCharacter: 'sparse electronic pulses with soft mechanical clicks, airy resonance, and a sustained warm final tone'
};

function ref2vaBrief(overrides: Partial<H3VideoBrief> = {}): H3VideoBrief {
  return brief({
    product: eyeCream.id,
    workflowMode: 'REF2VA',
    duration: 12,
    language: 'English',
    musicOnly: true,
    captions: false,
    subtitles: false,
    sound: 'Music Only',
    references: { ...createOptionalH3ReferencePlan(eyeCream), productReference: { source: 'selected-product', description: 'Eye Cream front reference', path: eyeCream.imagePath } },
    creativeGenome: eyeCreamGalleryGenome,
    videoIdea: 'One continuous suspended-gallery reveal with no cuts.',
    ...overrides
  });
}

function renderRef2VA(productOverride: ReturnType<typeof getProduct>, current: H3VideoBrief): string {
  if (!productOverride) throw new Error('Expected product fixture.');
  return buildH3Prompt({ product: productOverride, brief: current, concept: null, resolvedMode: 'REF2VA' });
}

const brief = (overrides: Partial<H3VideoBrief> = {}): H3VideoBrief => ({
  product: product.id,
  videoIdea: 'A futuristic building mechanically transforms into the product.',
  language: 'Indonesian',
  musicOnly: false,
  captions: false,
  subtitles: false,
  goal: 'Transformation',
  customGoal: '',
  duration: 15,
  aspectRatio: '9:16',
  customAspectRatio: '',
  qualityPreset: 'Final',
  megapixels: 0.98,
  multiple: 32,
  fps: 24,
  workflowMode: 'AUTO',
  cameraMotion: 'Cinematic',
  actionIntensity: 'High',
  pacing: 'Balanced',
  productFidelity: 'Exact',
  ending: 'Hero Shot',
  customEnding: '',
  sound: 'Sound Design + Music',
  promptDetail: 'Production',
  specialInstructions: '',
  references: createH3ReferencePlan(product),
  ...overrides
});

function productLock(prompt: string): string {
  const start = prompt.indexOf('product_reference_lock:');
  if (start >= 0) {
    const planningEnd = prompt.indexOf('\n\nverified_product_identity:', start);
    if (planningEnd > start) return prompt.slice(start, planningEnd);
    return prompt.split('\n').find((line) => line.startsWith('product_reference_lock:')) ?? '';
  }
  const firstParagraphEnd = prompt.indexOf('\n\n');
  return `product_reference_lock: ${prompt.slice(0, firstParagraphEnd >= 0 ? firstParagraphEnd : prompt.length)}`;
}

describe('MiniMax H3 helpers', () => {
  it('calculates the nearest valid 17k+5 frame length', () => {
    expect(calculateH3FrameLength(4)).toBe(107);
    expect(calculateH3FrameLength(5)).toBe(124);
    expect(calculateH3FrameLength(15)).toBe(362);
  });

  it('enforces the supported duration boundaries', () => {
    expect(() => calculateH3FrameLength(3)).toThrow(RangeError);
    expect(() => calculateH3FrameLength(16)).toThrow(RangeError);
    expect(calculateH3FrameLength(8)).toBeGreaterThanOrEqual(8 * 24);
  });

  it('selects Auto workflow from planned reference roles', () => {
    const base = createH3ReferencePlan(product);
    expect(resolveH3Workflow('AUTO', base).mode).toBe('L2VA');
    expect(resolveH3Workflow('AUTO', { ...base, firstFrame: { source: 'custom', description: 'Futuristic building', path: null } }).mode).toBe('FL2VA');
    expect(resolveH3Workflow('AUTO', { ...base, firstFrame: { source: 'custom', description: 'Opening scene', path: null }, lastFrame: { source: 'none', description: '', path: null } }).mode).toBe('I2VA');
    expect(resolveH3Workflow('AUTO', { ...base, lastFrame: { source: 'none', description: '', path: null } }).mode).toBe('REF2VA');
    expect(resolveH3Workflow('AUTO', { ...base, lastFrame: { source: 'none', description: '', path: null }, productReference: { source: 'none', description: '', path: null }, styleReference: { source: 'none', description: '', path: null } }).mode).toBe('T2VA');
    expect(resolveH3Workflow('T2VA', base).mode).toBe('T2VA');
  });

  it('uses the official mode-specific H3 prompt shapes', () => {
    const noReferences = createOptionalH3ReferencePlan(product);
    const firstAndLast = {
      ...noReferences,
      firstFrame: { source: 'custom' as const, description: 'opening reference', path: null },
      lastFrame: { source: 'custom' as const, description: 'ending reference', path: null }
    };
    const lastOnly = { ...noReferences, lastFrame: { source: 'custom' as const, description: 'ending reference', path: null } };
    const render = (workflowMode: H3VideoBrief['workflowMode'], references: H3VideoBrief['references'], resolvedMode: H3VideoBrief['workflowMode']) =>
      buildH3Prompt({ product, brief: brief({ workflowMode, references }), concept: null, resolvedMode: resolvedMode as Exclude<H3VideoBrief['workflowMode'], 'AUTO'> });

    const t2va = render('T2VA', noReferences, 'T2VA');
    expect(t2va).toMatch(/^integrated_multimodal_description:\n\[Shot 1\]/);
    expect(t2va).not.toContain('subject_definitions:');

    const i2va = render('I2VA', { ...noReferences, firstFrame: { source: 'custom', description: 'opening reference', path: null } }, 'I2VA');
    expect(i2va).toMatch(/^For the target video, at 0\.00 seconds into the target video, <Picture 1> \(from \[Shot 1\]\) is fully referenced\.\n\nintegrated_multimodal_description:/);

    const fl2va = render('FL2VA', firstAndLast, 'FL2VA');
    expect(fl2va).toMatch(/^How the reference pictures align with the target video — Picture 1 \(from Shot 1\) aligns with the 0\.00-second mark of the target video; Picture 2 \(from Shot 3\) aligns with the 15\.00-second mark of the target video\.\n\nintegrated_multimodal_description:/);

    const l2va = render('L2VA', lastOnly, 'L2VA');
    expect(l2va).toMatch(/^How the reference pictures align with the target video — <Picture 1> \(from \[Shot 3\]\) aligns with the 15\.00-second mark of the target video\.\n\nintegrated_multimodal_description:/);
  });

  it('formats Ref2VA with all six fields and stable Picture-to-subject roles', () => {
    const references = {
      ...createOptionalH3ReferencePlan(eyeCream),
      productReference: { source: 'selected-product' as const, description: 'Eye Cream front reference', path: eyeCream.imagePath }
    };
    const prompt = buildH3Prompt({ product: eyeCream, brief: brief({ product: eyeCream.id, workflowMode: 'REF2VA', references, videoIdea: 'An elegant gallery reveal.' }), concept: null });
    const fields = ['subject_definitions:', 'summary:', 'retention_analysis:', 'detailed_description:', 'overall_soundscape:', 'non_diegetic_music:'];

    expect(fields.map((field) => prompt.indexOf(field)).every((index, position, indexes) => position === 0 || index > indexes[position - 1])).toBe(true);
    expect(prompt).toContain('<Subject 1> is the PROYA Eye Cream shown in <Picture 1>, which defines its visible identity, proportions, packaging appearance, and finish.');
    expect(prompt).toContain('[reference generation]');
    expect(prompt).toContain('<Subject 1> (appears in [Shot 1]): fully_preserved -');
    expect(prompt).toContain('[Shot 1]');
    expect(prompt).toContain('overall_soundscape:');
    expect(prompt).toContain('non_diegetic_music:');
    expect(prompt).not.toContain('<Picture 2>');
    expect(prompt).not.toContain('<Subject 2>');
    expect(prompt).not.toContain('the supplied Product Reference');
  });

  it('carries the selected CreativeGenome into a rich continuous Ref2VA choreography', () => {
    const prompt = renderRef2VA(eyeCream, ref2vaBrief());
    const detailStart = prompt.indexOf('detailed_description:\n') + 'detailed_description:\n'.length;
    const detailEnd = prompt.indexOf('\noverall_soundscape:', detailStart);
    const detail = prompt.slice(detailStart, detailEnd);

    expect(prompt).toContain(eyeCreamGalleryGenome.creativeArchetype);
    expect(prompt).toContain(eyeCreamGalleryGenome.visualHook);
    expect(detail).toContain(eyeCreamGalleryGenome.environment);
    expect(detail).toContain(eyeCreamGalleryGenome.composition);
    expect(detail).toContain('camera descends');
    expect(detail).toContain('floating frames descend one by one as the citrus-gold beam travels down');
    expect(detail).toContain(eyeCreamGalleryGenome.lightingStyle);
    expect(detail).toContain('The film begins in darkness with one narrow citrus-gold beam');
    expect(detail).toContain('closing beat transitions into a subtle straight push-in');
    expect(detail).toContain('lower hero chamber');
    expect(detail).toContain('No added captions, subtitles, or on-screen copy.');
    expect(detail).not.toContain('creativeArchetype:');
    expect(detail).not.toContain('cameraPath:');
    expect(detail).not.toContain('primaryMotion:');
    expect(detail).not.toContain('premium warm-lit skincare studio');
    expect(prompt).not.toContain('faint reflective chimes');
    expect(prompt).toContain('No dialogue, voiceover, or narration.');
    expect(prompt).toContain('sparse electronic pulses with soft mechanical clicks');
  });

  it('keeps materially different CreativeGenome inputs materially different in detailed_description', () => {
    const liquidGenome: CreativeGenome = {
      ...eyeCreamGalleryGenome,
      creativeArchetype: 'Reflective Liquid Orbit',
      visualHook: 'a clear liquid ribbon traces a complete orbit around the hero and leaves the package untouched',
      environment: 'a black reflective liquid stage with a warm horizon line',
      composition: 'an off-center hero framed by one continuous orbit with open negative space',
      cameraPath: 'a slow lateral tracking move synchronized to the orbit',
      lightingStyle: 'a thin warm rim against a cool black reflective field',
      primaryMotion: 'a clear ribbon loops around the base and exits frame',
      secondaryMotion: 'micro ripples follow the ribbon path and fade outward',
      materialEffect: 'reflective liquid surface, transparent fluid ribbon, and black glass',
      openingDevice: 'open on a single liquid ripple before the product enters the frame',
      transitionLanguage: 'the orbit completes and falls away to the label',
      endingDevice: 'minimal reflective hero hold',
      audioCharacter: 'smooth liquid sweep with sparse low percussion'
    };
    const galleryPrompt = renderRef2VA(eyeCream, ref2vaBrief());
    const liquidPrompt = renderRef2VA(eyeCream, ref2vaBrief({ creativeGenome: liquidGenome, videoIdea: 'One continuous reflective liquid orbit with no cuts.' }));
    const galleryDetail = galleryPrompt.slice(galleryPrompt.indexOf('detailed_description:'), galleryPrompt.indexOf('\noverall_soundscape:'));
    const liquidDetail = liquidPrompt.slice(liquidPrompt.indexOf('detailed_description:'), liquidPrompt.indexOf('\noverall_soundscape:'));
    const changedMarkers = [
      ['suspended gallery', 'liquid stage'],
      ['vertical gallery', 'complete orbit'],
      ['camera descends', 'lateral move'],
      ['rectangular frames', 'clear ribbon'],
      ['citrus-gold beam', 'thin warm rim']
    ];

    expect(changedMarkers.filter(([galleryMarker, liquidMarker]) => galleryDetail.includes(galleryMarker) !== liquidDetail.includes(galleryMarker)
      || galleryDetail.includes(liquidMarker) !== liquidDetail.includes(liquidMarker))).toHaveLength(5);
    expect(galleryDetail).not.toBe(liquidDetail);
    expect(liquidDetail).toContain('As a clear ribbon loops around the base and exits frame');
    expect(liquidDetail).toContain('A restrained lateral move follows the environmental action');
  });

  it('uses the Creative Diversity Engine genome as the formatter input without flattening it', () => {
    const plan = planCreativeGenome({ product: eyeCream, contentFamily: 'Cinematic Product Ad', seed: 5401, now: new Date('2026-09-01T00:00:00.000Z') });
    const prompt = renderRef2VA(eyeCream, ref2vaBrief({ creativeGenome: plan.genome, videoIdea: 'Use the selected cinematic direction.' }));
    const detailStart = prompt.indexOf('detailed_description:\n') + 'detailed_description:\n'.length;
    const detail = prompt.slice(detailStart, prompt.indexOf('\noverall_soundscape:', detailStart));

    expect(prompt).toContain(plan.genome.visualHook);
    expect(detail).toContain(plan.genome.environment);
    expect(detail).toContain(plan.genome.composition);
    expect(detail).toContain(plan.genome.primaryMotion);
    expect(detail).toContain(plan.genome.lightingStyle);
    expect(prompt).toContain(plan.genome.creativeArchetype);
  });

  it('does not create fake timed shots for a continuous concept', () => {
    const prompt = renderRef2VA(eyeCream, ref2vaBrief({ duration: 8 }));
    const detail = prompt.slice(prompt.indexOf('detailed_description:'), prompt.indexOf('\noverall_soundscape:'));

    expect(detail).toMatch(/^detailed_description:\n\[Shot 1\]/);
    expect(detail).not.toContain('[Shot 2]');
    expect(detail).not.toContain('[Shot 3]');
    expect(prompt).toContain('<Subject 1> (appears in [Shot 1]): fully_preserved -');
  });

  it('uses strictly increasing timestamps only when actual Ref2VA cuts are requested', () => {
    const prompt = renderRef2VA(eyeCream, ref2vaBrief({ duration: 10, videoIdea: 'Cut to a close detail at 00:03.500, then hard cut to the final hero.' }));
    const detail = prompt.slice(prompt.indexOf('detailed_description:'), prompt.indexOf('\noverall_soundscape:'));
    const timestamps = [...detail.matchAll(/\[Shot \d+\] At (\d{2}):(\d{2}\.\d{3})/g)].map((match) => Number(match[1]) * 60 + Number(match[2]));

    expect(detail).toContain('[Shot 1]');
    expect(detail).toContain('[Shot 2] At 00:03.500, Cut to');
    expect(detail).toContain('[Shot 3] At 00:07.000, Cut to');
    expect(timestamps).toEqual([3.5, 7]);
    expect(timestamps[0]).toBeGreaterThan(0);
    expect(timestamps[1]).toBeGreaterThan(timestamps[0]);
    expect(timestamps[1]).toBeLessThanOrEqual(10);
    expect(prompt).toContain('<Subject 1> (appears in [Shot 1], [Shot 2], [Shot 3]): fully_preserved -');
  });

  it('retains style references as weak references without making them product subjects', () => {
    const references = {
      ...createOptionalH3ReferencePlan(eyeCream),
      referenceImages: [
        { role: 'product-front' as const, asset: { source: 'local-file' as const, description: 'front image', path: 'C:\\refs\\eye-front.png' } },
        { role: 'style' as const, asset: { source: 'local-file' as const, description: 'cool gallery light', path: 'C:\\refs\\gallery-style.png' } }
      ]
    };
    const prompt = renderRef2VA(eyeCream, ref2vaBrief({ references }));

    expect(prompt).toContain('<Subject 2> is the reference in <Picture 2>; use it only for lighting, palette, and atmosphere, never product identity.');
    expect(prompt).toContain('<Subject 2> (appears in [Shot 1]): weak_reference - retain only lighting, palette, and atmosphere from <Picture 2>;');
    expect(prompt).not.toContain('<Subject 2>: fully_preserved');
  });

  it('keeps Music Only free of speech while preserving concrete sound and music directions', () => {
    const prompt = renderRef2VA(eyeCream, ref2vaBrief({ creativeGenome: { ...eyeCreamGalleryGenome, audioCharacter: 'spoken narration over a rising electronic bed' } }));

    expect(prompt).toContain('No spoken dialogue, voiceover, creator speech, narration, or other speech.');
    expect(prompt).toContain('overall_soundscape:');
    expect(prompt).toContain('non_diegetic_music: A restrained instrumental score');
    expect(prompt).toContain('instrumental texture over a rising electronic bed');
    expect(prompt).not.toContain('non_diegetic_music: N/A');
  });

  it('keeps Ref2VA connection order and semantic roles for two independent references', () => {
    const eyeCream = getProduct('eye-cream')!;
    const references = {
      ...createOptionalH3ReferencePlan(eyeCream),
      referenceImages: [
        { role: 'product-front' as const, asset: { source: 'local-file' as const, description: 'front image', path: 'C:\\refs\\front.png' } },
        { role: 'product-back' as const, asset: { source: 'local-file' as const, description: 'back image', path: 'C:\\refs\\back.png' } }
      ]
    };
    const mappings = buildH3ReferenceSlotMappings(references);
    const prompt = buildH3Prompt({ product: eyeCream, brief: brief({ product: eyeCream.id, workflowMode: 'REF2VA', references }), concept: null });

    expect(mappings.map((mapping) => [mapping.pictureTag, mapping.refInput, mapping.nodeId, mapping.role])).toEqual([
      ['<Picture 1>', 'ref_images.ref_image_0', '137', 'product-front'],
      ['<Picture 2>', 'ref_images.ref_image_1', '139', 'product-back']
    ]);
    expect(prompt.indexOf('<Picture 1> (product-front)')).toBeLessThan(prompt.indexOf('<Picture 2> (product-back)'));
    expect(prompt).toContain('<Picture 1>');
    expect(prompt).toContain('<Picture 2>');
  });

  it('does not create a second slot when the default product and style sources are the same file', () => {
    const eyeCream = getProduct('eye-cream')!;
    const references = {
      ...createOptionalH3ReferencePlan(eyeCream),
      productReference: { source: 'selected-product' as const, description: 'front', path: eyeCream.imagePath },
      styleReference: { source: 'selected-product' as const, description: 'same file', path: eyeCream.imagePath }
    };

    expect(buildH3ReferenceSlotMappings(references)).toHaveLength(1);
  });

  it('maps Reference Fidelity to the official ref_image_size values', () => {
    expect(h3RefImageSize(brief({ referenceFidelity: 'High' }))).toBe('max');
    expect(h3RefImageSize(brief({ referenceFidelity: 'Standard' }))).toBe('match');
    expect(buildH3RecommendedSettings(brief({ referenceFidelity: 'High' })).refImageSize).toBe('max');
    expect(buildH3RecommendedSettings(brief({ referenceFidelity: 'Standard' })).refImageSize).toBe('match');
  });

  it('uses direct Ref Image Size and workflow settings as the live source of truth', () => {
    const current = brief({ refImageSize: 'match', referenceFidelity: 'High', steps: 31, seedMode: 'fixed', seed: 1234 });
    const settings = h3WorkflowSettingsFromBrief(current);
    const recommendation = buildH3RecommendedSettings(current);

    expect(settings).toMatchObject({ durationSeconds: 15, aspectRatio: '9:16', megapixels: 0.98, multiple: 32, fps: 24, steps: 31, scheduler: 'simple', seedMode: 'fixed', seed: 1234, refImageSize: 'match' });
    expect(recommendation.refImageSize).toBe('match');
    expect(recommendation).not.toHaveProperty('referenceFidelity');
    expect(recommendation).not.toHaveProperty('quality');
    expect(applyH3WorkflowSettings(current, { ...settings, durationSeconds: 8, aspectRatio: '16:9', refImageSize: 'max' })).toMatchObject({ duration: 8, aspectRatio: '16:9', customAspectRatio: '', refImageSize: 'max' });
  });

  it('builds an H3-native chronological prompt with exact endpoint references', () => {
    const current = brief({ references: { ...createH3ReferencePlan(product), firstFrame: { source: 'custom', description: 'Futuristic building', path: null } } });
    const resolved = resolveH3Workflow(current.workflowMode, current.references).mode;
    const timeline = buildH3Timeline(current.duration, product, null, resolved, current.ending);
    const prompt = buildH3PlanningPackage({ product, brief: current, concept: null, resolvedMode: resolved, timeline });
    expect(prompt).toContain('h3_workflow: FL2VA');
    expect(prompt).toContain('system_instruction:');
    expect(prompt).toContain('frame_length: 362 H3 frames');
    expect(prompt).toContain('integrated_multimodal_description:');
    expect(prompt).toContain('<Picture 1>: exact first-frame image');
    expect(prompt).toContain('<Picture 2>: exact final-frame image');
    expect(prompt).toContain('facade panels unlock and separate');
    expect(prompt).toContain('final seams close');
    expect(prompt).toContain('overall_soundscape:');
    expect(prompt).toContain('non_diegetic_music:');
    expect(prompt).toContain('product_reference_lock:');
  });

  it('omits audio sections for a silent prompt and constructs the ChatGPT request', () => {
    const current = brief({ sound: 'Silent', workflowMode: 'T2VA', references: { ...createH3ReferencePlan(product), firstFrame: { source: 'none', description: '', path: null }, lastFrame: { source: 'none', description: '', path: null }, productReference: { source: 'none', description: '', path: null } } });
    const prompt = buildH3PlanningPackage({ product, brief: current, concept: null });
    expect(prompt).not.toContain('overall_soundscape:');
    expect(prompt).not.toContain('non_diegetic_music:');
    const request = buildH3ConceptRequest({ product, brief: current });
    expect(request).toContain('# MINIMAX H3 CONCEPT REQUEST');
    expect(request).toContain(`Product: ${product.shortName}`);
    expect(request).toContain('Create exactly three meaningfully different video concepts');
    expect(request).toContain('main action; recommended H3 mode');
  });

  it('creates three distinct concept directions from one rough idea', () => {
    const concepts = buildH3Concepts(brief(), product);
    expect(concepts).toHaveLength(3);
    expect(new Set(concepts.map((concept) => concept.title)).size).toBe(3);
    expect(new Set(concepts.map((concept) => concept.visualHook)).size).toBe(3);
    expect(concepts.every((concept) => concept.recommendedDuration === 15)).toBe(true);
    expect(concepts[0].mainAction).toContain('columns retract');
  });

  it('builds a concise ChatGPT H3 handoff while retaining verified benefits and claims', () => {
    const references = {
      ...createOptionalH3ReferencePlan(product),
      firstFrame: { source: 'custom' as const, description: 'A futuristic building establishing frame', path: null },
      lastFrame: { source: 'selected-product' as const, description: 'Exact Skin Cream final frame', path: product.imagePath }
    };
    const current = brief({ contentType: 'Product Transformation', references });
    const request = buildH3ChatGPTRequest({ product, brief: current });
    const settings = buildH3RecommendedSettings(current);
    expect(settings.mode).toBe('FL2VA');
    expect(settings.frames).toBe(362);
    expect(request).toContain('MiniMax H3 Video Creative Director and Prompt Writer');
    expect(request).toContain('Content type: Product Transformation');
    expect(request).toContain('Product reference lock:');
    expect(request).not.toContain(product.packagingDescription);
    expect(request).not.toContain(product.physicalIdentity.labelAppearance);
    expect(request).not.toMatch(/\b\d+(?:\.\d+)?\s*cm\b/);
    expect(request).toContain('Verified benefit territories:');
    expect(request).toContain('Claim safety: Prefer conservative cosmetic language');
    expect(request).toContain('Ref2VA uses all six full-reference fields');
  });

  it('adds creator-style defaults for UGC without overriding explicit instructions', () => {
    const request = buildH3ChatGPTRequest({ product, brief: brief({ contentType: 'UGC Content', videoIdea: 'A girl casually shows the cream in her bedroom.' }) });
    expect(request).toContain('Content type: UGC Content');
    expect(request).toContain('natural smartphone-style framing');
    expect(request).toContain('believable everyday environments');
    expect(request).toContain('Do not force people, a phone look, or UGC styling');
  });

  it('passes the selected language and distinguishes captions from subtitles', () => {
    const request = buildH3ChatGPTRequest({ product, brief: brief({ language: 'Indonesian', captions: true, subtitles: true }) });

    expect(request).toContain('Language: Indonesian');
    expect(request).toContain('Captions: Yes');
    expect(request).toContain('Subtitles: Yes');
    expect(request).toContain('Language rule: All newly generated human-facing language in the video must be in Indonesian');
    expect(request).toContain('Captions: Creative on-screen text/headlines selected for the video concept.');
    expect(request).toContain('Subtitles: Text that follows spoken dialogue/voiceover.');
    expect(request).toContain('speech transcription, not additional marketing headlines');
    expect(request).toContain('approximately when each caption appears');
    expect(request).toContain('lower safe-area placement');
  });

  it('passes English and keeps locked product and packaging language unchanged', () => {
    const request = buildH3ChatGPTRequest({ product, brief: brief({ language: 'English' }) });

    expect(request).toContain('Language: English');
    expect(request).toContain(`Product: ${product.shortName}`);
    expect(request).toContain('Locked branding rule: Do not translate official product names, logos, packaging text, ingredient names');
    expect(request).toContain('Preserve official names exactly as supplied');
  });

  it('makes Music Only authoritative over speech and subtitles while preserving captions', () => {
    const current = brief({ language: 'English', musicOnly: true, captions: true, subtitles: true, sound: 'Silent' });
    const request = buildH3ChatGPTRequest({ product, brief: current });
    const prompt = buildH3PlanningPackage({ product, brief: current, concept: null });
    const settings = buildH3RecommendedSettings(current);

    expect(request).toContain('Music Only: Yes');
    expect(request).toContain('Captions: Yes');
    expect(request).toContain('Subtitles: No');
    expect(request).toContain('No spoken dialogue, voiceover, creator speech, narration, or other speech');
    expect(request).toContain('Music Only does not mean no visual text');
    expect(request).toContain('sound effects may still be used where appropriate');
    expect(request).toContain('Subtitles are unavailable because Music Only has no speech to transcribe');
    expect(prompt).toContain('music_only_audio:');
    expect(prompt).toContain('no_spoken_audio: No spoken dialogue, voiceover, creator speech, narration, or other speech.');
    expect(prompt).toContain('non_diegetic_music: Include music or a soundtrack');
    expect(settings.audio).toBe('Music Only');
  });

  it('requests no added marketing overlays when captions are disabled', () => {
    const request = buildH3ChatGPTRequest({ product, brief: brief({ captions: false, subtitles: false }) });

    expect(request).toContain('When captions are disabled, do not add marketing text or caption overlays unless the user explicitly requests them in the Idea / Instructions field.');
    expect(request).toContain('When subtitles are disabled, do not add subtitles or transcription unless the user explicitly requests them.');
  });

  it('keeps an ordinary single-product Ref2VA lock to one short block', () => {
    const cleanser = getProduct('cleanser')!;
    const current = brief({
      product: cleanser.id,
      workflowMode: 'REF2VA',
      references: { ...createOptionalH3ReferencePlan(cleanser), productReference: { source: 'selected-product', description: 'Cleanser front reference', path: cleanser.imagePath } },
      videoIdea: 'A stationary front-facing Cleanser hero shot.'
    });
    const prompt = buildH3Prompt({ product: cleanser, brief: current, concept: null });
    const lock = productLock(prompt);
    const lockText = lock.replace('product_reference_lock: ', '');
    const sentences = lockText.split(/(?<=[.!?])\s+/).filter(Boolean);

    expect(sentences.length).toBeLessThanOrEqual(5);
    expect(lock.length).toBeLessThan(650);
    expect(lock).toContain('<Subject 1> is the PROYA Cleanser shown in <Picture 1>');
    expect(lock).toContain('which defines its visible identity, proportions, packaging appearance, and finish.');
    expect(lock).toContain('The tube body is opaque.');
    expect(lock).not.toContain('front artwork');
    expect(lock).not.toContain('Do not redesign or replace the product.');
    expect(prompt).not.toContain('product_reference_lock:');
    expect(prompt).not.toContain('FIRST VISIBLE APPEARANCE');
    expect(prompt).not.toContain('final_hero_reference_reminder');
  });

  it('separates the internal planning package from the concise stationary render prompt', () => {
    const cleanser = getProduct('cleanser')!;
    const current = brief({
      product: cleanser.id,
      workflowMode: 'REF2VA',
      language: 'English',
      sound: 'Silent',
      duration: 8,
      references: { ...createOptionalH3ReferencePlan(cleanser), productReference: { source: 'selected-product', description: 'Cleanser Product Reference', path: cleanser.imagePath } },
      videoIdea: 'A stationary front-facing Cleanser hero shot with warm environmental light.'
    });
    const planning = buildH3PlanningPackage({ product: cleanser, brief: current, concept: null });
    const render = buildH3Prompt({ product: cleanser, brief: current, concept: null });
    const renderWords = render.split(/\s+/).filter(Boolean).length;

    expect(planning).toContain('planning_package: internal context only; do not inject this package into {{H3_PROMPT}}.');
    expect(planning).toContain('system_instruction:');
    expect(planning).toContain('frame_length: 192 H3 frames');
    expect(planning).toContain('verified_product_identity:');
    expect(planning).toContain('reference_files: product-assets/cleanser.png');
    expect(planning).toContain('claim_safety:');
    expect(renderWords).toBeGreaterThanOrEqual(75);
    expect(render.length).toBeLessThan(planning.length);
    expect(render).toMatch(/^subject_definitions:\n/);
    expect(render).toContain('<Subject 1> is the PROYA Cleanser shown in <Picture 1>');
    expect(render).toContain('summary:\n[reference generation]');
    expect(render).toContain('retention_analysis:');
    expect(render).toContain('detailed_description:\n');
    expect(render).toContain('[Shot 1]');
    expect(render).not.toContain('[Shot 2]');
    expect(render).not.toContain('[Shot 3]');
    expect(render).toContain('overall_soundscape: N/A');
    expect(render).toContain('non_diegetic_music: N/A');
    expect(render).not.toMatch(/separate surfaces or particles gather|the material resolves|silhouette becomes clear|components settle|final seams close/i);
    expect(render).not.toMatch(/20[–-]25%|three-quarter|dolly-orbit|smooth\s+\d+%\s+arc/i);
    expect(render).not.toContain('system_instruction:');
    expect(render).not.toContain('claim_safety:');
    expect(render).not.toContain('frame_length:');
    expect(render).not.toContain('product-assets/cleanser.png');

    expect(cleanser.physicalIdentity.packageComponents.length).toBeGreaterThan(0);
    expect(cleanser.physicalIdentity.frontSurfaceAppearance).toBeDefined();
    expect(cleanser.physicalIdentity.rearSurfaceAppearance.content).toBe('blank');
    expect(cleanser.physicalIdentity.sideSurfaceAppearance.content).toBe('blank');
    expect(cleanser.physicalIdentity.opacityBehavior).toContain('opaque');
    expect(cleanser.physicalIdentity.dimensions.overallHeightCm).toBe(14);
  });

  it('teaches the ChatGPT handoff to return a separate H3_RENDER_PROMPT', () => {
    const cleanser = getProduct('cleanser')!;
    const request = buildH3ChatGPTRequest({
      product: cleanser,
      brief: brief({
        product: cleanser.id,
        workflowMode: 'REF2VA',
        language: 'English',
        sound: 'Silent',
        references: createH3ReferencePlan(cleanser),
        videoIdea: 'A stationary front-facing Cleanser hero shot.'
      })
    });

    expect(request).toContain('H3_RENDER_PROMPT');
    expect(request).toContain('Only the text under H3_RENDER_PROMPT is intended for the {{H3_PROMPT}} value.');
    expect(request).toContain('Keep H3_RENDER_PROMPT free of system instructions, workflow/settings metadata');
  });

  it('keeps transformation choreography available only for an explicit transformation premise', () => {
    const current = brief({
      workflowMode: 'REF2VA',
      language: 'English',
      sound: 'Silent',
      videoIdea: 'A futuristic building mechanically transforms into the Skin Cream product.'
    });
    const prompt = buildH3Prompt({ product, brief: current, concept: null });

    expect(prompt).toContain('facade panels unlock and separate');
    expect(prompt).toContain('final seams close');
    expect(prompt).toContain('[reference generation] Using <Picture 1> to preserve <Subject 1>\'s reference-visible identity');
    expect(prompt).toContain('presents <Subject 1> in a Premium live-action skincare advertising: a futuristic building mechanically transforms into the Skin Cream product');
  });

  it('keeps rotating Toner choreography in the render prompt without generic reconstruction language', () => {
    const toner = getProduct('toner')!;
    const current = brief({
      product: toner.id,
      workflowMode: 'REF2VA',
      language: 'English',
      sound: 'Silent',
      references: { ...createOptionalH3ReferencePlan(toner), productReference: { source: 'selected-product', description: 'Toner Product Reference', path: toner.imagePath } },
      videoIdea: 'Rotate the Toner through its rear and side surfaces, then return to front.'
    });
    const prompt = buildH3Prompt({ product: toner, brief: current, concept: null });

    expect(prompt).toContain('Rotate the Toner slowly through the requested rear and side surfaces, then return to front; preserve its reference appearance and proportions.');
    expect(prompt).toContain('If the rear or sides become visible, they are completely blank continuations of the package surface with no printed content.');
    expect(prompt).not.toMatch(/separate surfaces or particles gather|the material resolves|silhouette becomes clear|components settle|final seams close/i);
  });

  it('keeps the Serum dropper action while preventing generic product reconstruction', () => {
    const current = brief({
      product: serum.id,
      workflowMode: 'REF2VA',
      language: 'English',
      sound: 'Silent',
      references: createH3ReferencePlan(serum),
      videoIdea: 'The Serum dropper lifts and releases one visible clear liquid droplet in a macro shot.'
    });
    const prompt = buildH3Prompt({ product: serum, brief: current, concept: null });

    expect(prompt).toContain('Any visible serum liquid is clear and colorless.');
    expect(prompt).toContain('Lift the Serum dropper and release one visible clear, colorless liquid droplet; keep the opaque/coated bottle front-facing and unchanged.');
    expect(prompt).not.toMatch(/separate surfaces or particles gather|the material resolves|silhouette becomes clear|components settle|final seams close/i);
    expect(prompt).not.toContain('system_instruction:');
  });

  it('does not emit label appearance, exact package copy, or written front-layout prose', () => {
    for (const productId of ['cleanser', 'toner', 'serum', 'eye-cream', 'skin-cream', 'mask'] as const) {
      const selected = getProduct(productId)!;
      const current = brief({
        product: selected.id,
        workflowMode: 'REF2VA',
        references: { ...createOptionalH3ReferencePlan(selected), productReference: { source: 'selected-product', description: `${selected.shortName} front reference`, path: selected.imagePath } },
        videoIdea: `A stationary front-facing ${selected.shortName} product hero.`
      });
      const prompt = buildH3Prompt({ product: selected, brief: current, concept: null });
      const handoff = buildH3ChatGPTRequest({ product: selected, brief: current });
      const conceptRequest = buildH3ConceptRequest({ product: selected, brief: current });
      const identity = selected.physicalIdentity;

      expect(prompt).not.toContain('front artwork');
      expect(prompt).not.toContain('labelAppearance');
      expect(prompt).not.toContain(selected.packagingDescription);
      expect(prompt).not.toContain(selected.size);
      expect(prompt).not.toContain(identity.labelAppearance);
      expect(prompt).not.toContain(identity.frontSurfaceAppearance.printedArtwork);
      expect(prompt).not.toMatch(/\b(?:exact typography|exact PROYA wordmark|exact product name|100g marking|100ml marking|30ml marking)\b/i);
      for (const generatedPrompt of [handoff, conceptRequest]) {
        expect(generatedPrompt).not.toContain('labelAppearance');
        expect(generatedPrompt).not.toContain(selected.packagingDescription);
        expect(generatedPrompt).not.toContain(selected.size);
        expect(generatedPrompt).not.toContain(identity.labelAppearance);
        expect(generatedPrompt).not.toContain(identity.frontSurfaceAppearance.printedArtwork);
        expect(generatedPrompt).not.toMatch(/\b(?:exact typography|exact PROYA wordmark|exact product name|100g marking|100ml marking|30ml marking)\b/i);
      }
    }
  });

  it('emits only the verified Cleanser opacity correction', () => {
    const cleanser = getProduct('cleanser')!;
    const prompt = buildH3Prompt({
      product: cleanser,
      brief: brief({ product: cleanser.id, workflowMode: 'REF2VA', references: { ...createOptionalH3ReferencePlan(cleanser), productReference: { source: 'selected-product', description: 'Cleanser reference', path: cleanser.imagePath } }, videoIdea: 'A stationary Cleanser hero shot.' }),
      concept: null
    });
    const lock = productLock(prompt);

    expect(lock).toContain('The tube body is opaque.');
    expect(lock).not.toContain('white flip-top');
    expect(lock).not.toContain('centimeter');
    expect(lock).not.toContain('PROYA wordmark');
  });

  it('emits only the verified Toner opaque-body and clear-cap correction', () => {
    const toner = getProduct('toner')!;
    const prompt = buildH3Prompt({
      product: toner,
      brief: brief({ product: toner.id, workflowMode: 'REF2VA', references: { ...createOptionalH3ReferencePlan(toner), productReference: { source: 'selected-product', description: 'Toner reference', path: toner.imagePath } }, videoIdea: 'A stationary Toner hero shot.' }),
      concept: null
    });
    const lock = productLock(prompt);

    expect(lock).toContain('The orange bottle body is opaque and the protective outer cap is transparent.');
    expect(lock).not.toContain('white spray pump assembly');
    expect(lock).not.toContain('14 cm');
    expect(lock).not.toContain('TONER and 100ml');
  });

  it('emits the Serum coated-body correction without liquid guidance when no liquid is shown', () => {
    const prompt = buildH3Prompt({
      product: serum,
      brief: brief({ product: serum.id, workflowMode: 'REF2VA', references: { ...createOptionalH3ReferencePlan(serum), productReference: { source: 'selected-product', description: 'Serum reference', path: serum.imagePath } }, videoIdea: 'A stationary Serum bottle with its dropper closure.' }),
      concept: null
    });
    const lock = productLock(prompt);

    expect(lock).toContain('The bottle appears opaque/coated.');
    expect(lock).not.toContain('Any visible serum liquid is clear and colorless.');
    expect(prompt).not.toContain('contents_appearance_lock:');
    expect(prompt).not.toContain('golden, amber, yellow, orange');
  });

  it('does not treat a pipette or lighting action as visible Serum liquid', () => {
    const prompt = buildH3Prompt({
      product: serum,
      brief: brief({ product: serum.id, workflowMode: 'REF2VA', references: { ...createOptionalH3ReferencePlan(serum), productReference: { source: 'selected-product', description: 'Serum reference', path: serum.imagePath } }, videoIdea: 'A Serum pipette and orange light ribbon release around the bottle; no liquid is shown.' }),
      concept: null
    });

    expect(productLock(prompt)).not.toContain('Any visible serum liquid is clear and colorless.');
  });

  it('adds the Serum liquid correction only when visible dropper liquid is requested', () => {
    const prompt = buildH3Prompt({
      product: serum,
      brief: brief({ product: serum.id, workflowMode: 'REF2VA', references: { ...createOptionalH3ReferencePlan(serum), productReference: { source: 'selected-product', description: 'Serum reference', path: serum.imagePath } }, videoIdea: 'The dropper lifts and releases visible clear Serum liquid in a macro shot.' }),
      concept: null
    });
    const lock = productLock(prompt);
    const lockText = lock.replace('product_reference_lock: ', '');

    expect(lock).toContain('The bottle appears opaque/coated.');
    expect(lock).toContain('Any visible serum liquid is clear and colorless.');
    expect(lockText.split(/(?<=[.!?])\s+/).filter(Boolean).length).toBeLessThanOrEqual(5);
    expect(prompt).not.toContain('contents_appearance_lock:');
  });

  it('does not emit the Skin Cream detached-lid correction for an unrelated static shot', () => {
    const skinCream = getProduct('skin-cream')!;
    const prompt = buildH3Prompt({
      product: skinCream,
      brief: brief({ product: skinCream.id, workflowMode: 'REF2VA', references: { ...createOptionalH3ReferencePlan(skinCream), productReference: { source: 'selected-product', description: 'Skin Cream reference', path: skinCream.imagePath } }, videoIdea: 'A stationary front-facing Skin Cream hero shot.' }),
      concept: null
    });

    expect(productLock(prompt)).not.toContain('detached lid');
    expect(prompt).not.toContain('same detached lid shown underneath');
  });

  it('adds the Skin Cream detached-lid correction only when lid behavior matters', () => {
    const skinCream = getProduct('skin-cream')!;
    const prompt = buildH3Prompt({
      product: skinCream,
      brief: brief({ product: skinCream.id, references: createH3ReferencePlan(skinCream), videoIdea: 'Close the open Skin Cream jar and move the lid from underneath onto the jar.' }),
      concept: null
    });
    const lock = productLock(prompt);

    expect(prompt).toContain('The white component shown underneath is the detached lid, not part of the jar base.');
    expect(prompt).toContain('Keep the Skin Cream jar identity unchanged; move only the requested lid or closure.');
    expect(lock).not.toContain('broad white base');
    expect(lock).not.toContain('unseen lid design');
  });

  it('emits one concise blank-back sentence only when rear or side surfaces are revealed', () => {
    const toner = getProduct('toner')!;
    const stationaryPrompt = buildH3Prompt({
      product: toner,
      brief: brief({ product: toner.id, references: createH3ReferencePlan(toner), videoIdea: 'A stationary front-facing Toner hero shot with soft rear lighting and no product rotation.' }),
      concept: null
    });
    const rotatingPrompt = buildH3Prompt({
      product: toner,
      brief: brief({ product: toner.id, references: createH3ReferencePlan(toner), videoIdea: 'Rotate the Toner to reveal its rear and side surfaces, then return to front.' }),
      concept: null
    });

    expect(stationaryPrompt).not.toContain('rotation_surface_lock:');
    expect(rotatingPrompt).toContain('If the rear or sides become visible, they are completely blank continuations of the package surface with no printed content.');
    expect(rotatingPrompt.match(/If the rear or sides become visible/g)).toHaveLength(1);
    expect(rotatingPrompt.match(/If the rear or sides become visible[^.]+\./)?.[0].split(/\s+/).length).toBeLessThan(30);
    expect(rotatingPrompt).not.toMatch(/barcode|regulatory|instruction|logo|label|typography|lorem/i);
  });

  it.each(['rotate', 'turn', 'spin', '180 degrees', '360 degrees', 'reveal back', 'reverse', 'rear view', 'side view'] as const)('recognizes %s as a rear/side-revealing choreography cue', (cue) => {
    const toner = getProduct('toner')!;
    const prompt = buildH3Prompt({
      product: toner,
      brief: brief({ product: toner.id, references: createH3ReferencePlan(toner), videoIdea: `The Toner ${cue} to show the package before returning to front.` }),
      concept: null
    });

    expect(prompt.match(/If the rear or sides become visible/g)).toHaveLength(1);
  });

  it('does not repeat the product lock in the chronology or final hero section', () => {
    const cleanser = getProduct('cleanser')!;
    const prompt = buildH3Prompt({
      product: cleanser,
      brief: brief({
        product: cleanser.id,
        workflowMode: 'REF2VA',
        references: { ...createOptionalH3ReferencePlan(cleanser), productReference: { source: 'selected-product', description: 'Cleanser front reference', path: cleanser.imagePath } },
        videoIdea: 'A stationary front-facing Cleanser hero shot.'
      }),
      concept: null
    });

    expect(prompt).not.toContain('product_reference_lock:');
    expect(prompt.match(/<Subject 1> is the PROYA Cleanser shown in <Picture 1>/g)).toHaveLength(1);
    expect(prompt).not.toContain('FIRST VISIBLE APPEARANCE:');
    expect(prompt).not.toContain('final_hero_reference_reminder:');
    expect(prompt).not.toContain('repeat it only if a later hero/product endpoint needs reinforcement');
  });

  it('emits exact dimensions only for scale-critical single-product directions', () => {
    const toner = getProduct('toner')!;
    const ordinaryPrompt = buildH3Prompt({
      product: toner,
      brief: brief({
        product: toner.id,
        workflowMode: 'REF2VA',
        references: { ...createOptionalH3ReferencePlan(toner), productReference: { source: 'selected-product', description: 'Toner front reference', path: toner.imagePath } },
        videoIdea: 'A stationary Toner hero shot.'
      }),
      concept: null
    });
    const scalePrompt = buildH3Prompt({
      product: toner,
      brief: brief({
        product: toner.id,
        workflowMode: 'REF2VA',
        references: { ...createOptionalH3ReferencePlan(toner), productReference: { source: 'selected-product', description: 'Toner front reference', path: toner.imagePath } },
        videoIdea: 'Show the Toner at exact measured scale beside a reference prop.'
      }),
      concept: null
    });

    expect(ordinaryPrompt).not.toContain('dimension_proportion_lock:');
    expect(ordinaryPrompt).not.toMatch(/\b\d+(?:\.\d+)?\s*cm\b/);
    expect(ordinaryPrompt).not.toContain('proportions: Preserve the proportions shown in the supplied reference.');
    expect(scalePrompt).toContain('Authoritative measured proportion lock for Toner');
    expect(scalePrompt).toContain('14 cm tall, 4 cm wide');
  });

  it('preserves exact relative scale for the Full Series composition', () => {
    const fullSeries = getProduct('full-series')!;
    const prompt = buildH3Prompt({
      product: fullSeries,
      brief: brief({ product: fullSeries.id, references: createH3ReferencePlan(fullSeries), videoIdea: 'Arrange the full PROYA lineup together in one accurately scaled hero composition.' }),
      concept: null
    });

    expect(prompt).toContain('Verified relative-scale lock: Toner and Cleanser share the same 14 cm overall height.');
    expect(prompt).toContain('Serum is substantially shorter at 10 cm × 3 cm wide.');
    expect(prompt).toContain("never infer one product's dimensions from another");
  });

  it('keeps product-specific corrections concise in the ChatGPT handoff and concept request', () => {
    const cleanser = getProduct('cleanser')!;
    const rotatingBrief = brief({ product: cleanser.id, references: createH3ReferencePlan(cleanser), videoIdea: 'Rotate the Cleanser through its rear view.' });
    const request = buildH3ChatGPTRequest({ product: cleanser, brief: rotatingBrief });
    const conceptRequest = buildH3ConceptRequest({ product: cleanser, brief: rotatingBrief });

    expect(request).toContain('The tube body is opaque.');
    expect(request).toContain('If the rear or sides become visible, they are completely blank continuations of the package surface with no printed content.');
    expect(request).not.toContain('Verified rear/unprinted-surface property:');
    expect(request).not.toContain('Structured authoritative dimensions:');
    expect(request).not.toMatch(/\b\d+(?:\.\d+)?\s*cm\b/);
    expect(conceptRequest).toContain('The tube body is opaque.');
    expect(conceptRequest).not.toContain('Verified rear/unprinted-surface property:');
    expect(conceptRequest).not.toMatch(/\b\d+(?:\.\d+)?\s*cm\b/);
  });

  it('passes scale-critical dimension guidance to the ChatGPT handoff only when requested', () => {
    const toner = getProduct('toner')!;
    const ordinary = buildH3ChatGPTRequest({ product: toner, brief: brief({ product: toner.id, references: createH3ReferencePlan(toner), videoIdea: 'A stationary Toner hero.' }) });
    const scaleCritical = buildH3ChatGPTRequest({ product: toner, brief: brief({ product: toner.id, references: createH3ReferencePlan(toner), videoIdea: 'Show the Toner at exact measured scale beside a prop.' }) });

    expect(ordinary).not.toContain('Verified proportion guidance:');
    expect(ordinary).not.toMatch(/\b\d+(?:\.\d+)?\s*cm\b/);
    expect(scaleCritical).toContain('Verified proportion guidance: Authoritative measured proportion lock for Toner');
    expect(scaleCritical).toContain('14 cm tall, 4 cm wide');
  });

  it('keeps the opaque Serum bottle separate from clear colorless exposed liquid', () => {
    const current = brief({
      product: serum.id,
      references: createH3ReferencePlan(serum),
      videoIdea: 'The dropper lifts and releases one actual Serum droplet in a texture macro shot.'
    });
    const prompt = buildH3Prompt({ product: serum, brief: current, concept: null });
    const request = buildH3ChatGPTRequest({ product: serum, brief: current });
    const concepts = buildH3Concepts(current, serum);

    expect(prompt).toContain('The bottle appears opaque/coated.');
    expect(prompt).toContain('Any visible serum liquid is clear and colorless.');
    expect(prompt).not.toContain('contents_appearance_lock:');
    expect(request).toContain('Any visible serum liquid is clear and colorless.');
    expect(concepts[1].visualHook).toContain('amber-orange light ribbon and separate clear, colorless, transparent droplets');
    expect(concepts[1].visualHook).toContain('colored brand light remains separate from the actual product liquid');
  });

  it('treats a local product reference as an authoritative image source', () => {
    const localPath = 'C:\\References\\serum.webp';
    const current = brief({
      product: serum.id,
      references: {
        ...createOptionalH3ReferencePlan(serum),
        productReference: { source: 'local-file', description: 'Local product reference: serum.webp', path: localPath }
      }
    });
    const request = buildH3ChatGPTRequest({ product: serum, brief: current });

    expect(request).toContain('Product reference image used: YES');
    expect(request).toContain('local file: C:\\References\\serum.webp');
  });
});
