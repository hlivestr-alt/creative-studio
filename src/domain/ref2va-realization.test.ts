import { describe, expect, it } from 'vitest';
import {
  buildH3Prompt,
  createOptionalH3ReferencePlan,
  repairRef2VACreativeGenome
} from './h3';
import { getProduct } from './data';
import { assessCreativeGenomeCompatibility } from './creative-diversity';
import type { CreativeGenome, H3VideoBrief, Product } from './types';

const eyeCream = getProduct('eye-cream')!;
const cleanser = getProduct('cleanser')!;
const serum = getProduct('serum')!;

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

const cleanserBotanicalGenome: CreativeGenome = {
  schemaVersion: 1,
  contentFamily: 'Product B-Roll',
  creativeArchetype: 'Botanical Structure',
  visualHook: 'fine orange pollen-like particles spiral into a halo while the package remains untouched',
  environment: 'bright cream greenhouse haze with a warm backlight',
  composition: 'centered halo around a stable product island',
  cameraPath: 'slow circular drift around the atmosphere',
  framing: 'medium hero with airy upper space',
  lightingStyle: 'high-key greenhouse glow with amber particles',
  primaryMotion: 'fine particles spiral upward and form a loose halo',
  secondaryMotion: 'small dust motes drift through the sunbeam',
  materialEffect: 'soft haze, controlled particles, and pale ceramic',
  pacing: 'organic measured bloom',
  openingDevice: 'open on a close abstract leaf vein',
  transitionLanguage: 'the halo opens at the label axis',
  endingDevice: 'airy centered hold',
  audioCharacter: 'soft botanical rustle with a warm acoustic pulse'
};

const serumEditorialGenome: CreativeGenome = {
  schemaVersion: 1,
  contentFamily: 'Cinematic Product Ad',
  creativeArchetype: 'Editorial Still Life',
  visualHook: 'an editorial tabletop rearranges itself into a refined product portrait',
  environment: 'fashion-editorial tabletop with sculptural paper and mineral props',
  composition: 'asymmetric magazine-cover arrangement with one clear hero',
  cameraPath: 'slow overhead-to-front transition with precise stop',
  framing: 'flat-lay detail into polished medium portrait',
  lightingStyle: 'soft directional key with deliberate graphic falloff',
  primaryMotion: 'paper and mineral forms slide into a balanced arrangement',
  secondaryMotion: 'a small reflective accent rotates into the light',
  materialEffect: 'paper, mineral, brushed metal, and silk shadow',
  pacing: 'composed editorial rhythm',
  openingDevice: 'begin with a partial flat-lay composition',
  transitionLanguage: 'each object slides into place around the product',
  endingDevice: 'finished cover-like still frame',
  audioCharacter: 'subtle editorial ticks with a clean modern bed'
};

function ref2vaBrief(product: Product, genome: CreativeGenome, sound: H3VideoBrief['sound'] = 'Sound + Music'): H3VideoBrief {
  return {
    product: product.id,
    contentType: genome.contentFamily,
    creativeVariety: 'Balanced',
    creativeGenome: genome,
    videoIdea: `One continuous ${genome.creativeArchetype} direction with no cuts.`,
    language: 'English',
    musicOnly: sound === 'Music Only',
    captions: false,
    subtitles: false,
    goal: 'Product reveal',
    customGoal: '',
    duration: 12,
    aspectRatio: '9:16',
    customAspectRatio: '',
    qualityPreset: 'Final',
    megapixels: 0.98,
    multiple: 32,
    fps: 24,
    workflowMode: 'REF2VA',
    cameraMotion: 'Cinematic',
    actionIntensity: 'Medium',
    pacing: 'Balanced',
    productFidelity: 'Exact',
    ending: 'Hero Shot',
    customEnding: '',
    sound,
    promptDetail: 'Production',
    specialInstructions: '',
    references: {
      ...createOptionalH3ReferencePlan(product),
      productReference: { source: 'selected-product', description: `${product.shortName} front reference`, path: product.imagePath }
    }
  };
}

function section(prompt: string, startLabel: string, endLabel: string): string {
  const start = prompt.indexOf(`${startLabel}:`);
  const end = prompt.indexOf(`${endLabel}:`, start + 1);
  return prompt.slice(start, end < 0 ? prompt.length : end);
}

function words(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

describe('Ref2VA prompt realization', () => {
  it('repairs the three current fixture genomes without mutating planning data', () => {
    const eye = repairRef2VACreativeGenome(eyeCream, eyeCreamGalleryGenome);
    const clean = repairRef2VACreativeGenome(cleanser, {
      ...cleanserBotanicalGenome,
      cameraPath: 'medium-amplitude orbit around the product'
    });
    const serumResult = repairRef2VACreativeGenome(serum, serumEditorialGenome);

    expect(eyeCreamGalleryGenome.cameraPath).toContain('upward');
    expect(eye.genome?.cameraPath).toContain('downward');
    expect(eye.repairs).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'camera-destination-direction' })]));
    expect(eye.unresolvedIssues).toHaveLength(0);

    expect(clean.genome?.cameraPath).toContain('small lateral truck');
    expect(clean.repairs).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'stationary-front-facing-orbit' })]));

    expect(serumResult.genome?.openingDevice).not.toMatch(/flat[- ]lay|top[- ]down|overhead/i);
    expect(serumResult.genome?.framing).toContain('shallow tabletop');
    expect(serumResult.genome?.cameraPath).toContain('shallow-tabletop-to-front');
    expect(serumResult.repairs).toEqual(expect.arrayContaining([expect.objectContaining({ rule: 'upright-overhead-label-read' })]));
    expect(serumResult.unresolvedIssues).toHaveLength(0);
    expect(serumEditorialGenome.openingDevice).toContain('flat-lay');
  });

  it('reports the compatibility rules without changing diversity selection or history data', () => {
    const orbitGenome = {
      ...cleanserBotanicalGenome,
      cameraPath: 'medium-amplitude orbit around the product'
    };
    const issues = assessCreativeGenomeCompatibility(orbitGenome, { productOrientationLocked: true });
    expect(issues.map((issue) => issue.rule)).toContain('stationary-front-facing-orbit');
    expect(issues.map((issue) => issue.rule)).not.toContain('upright-overhead-label-read');
  });

  it('keeps the six official sections, concise references, and a short summary', () => {
    const prompt = buildH3Prompt({ product: eyeCream, brief: ref2vaBrief(eyeCream, eyeCreamGalleryGenome, 'Music Only'), concept: null, resolvedMode: 'REF2VA' });
    const fields = ['subject_definitions:', 'summary:', 'retention_analysis:', 'detailed_description:', 'overall_soundscape:', 'non_diegetic_music:'];
    const indexes = fields.map((field) => prompt.indexOf(field));

    expect(indexes.every((index, position) => position === 0 || index > indexes[position - 1])).toBe(true);
    expect(words(section(prompt, 'summary', 'retention_analysis'))).toBeLessThanOrEqual(65);
    expect(section(prompt, 'summary', 'retention_analysis')).not.toContain(eyeCreamGalleryGenome.composition);
    expect(section(prompt, 'summary', 'retention_analysis')).not.toContain(eyeCreamGalleryGenome.cameraPath);
    expect(section(prompt, 'subject_definitions', 'summary')).toMatch(/<Subject 1> is the PROYA Eye Cream shown in <Picture 1>/);
    expect(words(section(prompt, 'subject_definitions', 'summary'))).toBeLessThan(55);
  });

  it('writes distinct chronological prose for gallery, botanical, and editorial scenes', () => {
    const eyePrompt = buildH3Prompt({ product: eyeCream, brief: ref2vaBrief(eyeCream, eyeCreamGalleryGenome, 'Music Only'), concept: null, resolvedMode: 'REF2VA' });
    const cleanserPrompt = buildH3Prompt({ product: cleanser, brief: ref2vaBrief(cleanser, cleanserBotanicalGenome), concept: null, resolvedMode: 'REF2VA' });
    const serumPrompt = buildH3Prompt({ product: serum, brief: ref2vaBrief(serum, serumEditorialGenome), concept: null, resolvedMode: 'REF2VA' });
    const details = [
      section(eyePrompt, 'detailed_description', 'overall_soundscape'),
      section(cleanserPrompt, 'detailed_description', 'overall_soundscape'),
      section(serumPrompt, 'detailed_description', 'overall_soundscape')
    ];

    expect(new Set(details).size).toBe(3);
    expect(details.every((detail) => !detail.includes('During the opening seconds')
      && !detail.includes('As that movement takes effect')
      && !detail.includes('Through the middle of the take')
      && !detail.includes('In the final seconds')
      && !detail.includes('Place <Subject 1> at the product anchor')
      && !detail.includes('Hold <Subject 1> until the end'))).toBe(true);
    expect(details.every((detail) => !detail.includes('creativeArchetype:') && !detail.includes('cameraPath:'))).toBe(true);
    expect(details[0]).toContain('lower hero chamber');
    expect(details[1]).toContain('pollen-like particles');
    expect(details[2]).toContain('shallow tabletop');
    expect(details[0]).not.toMatch(/upward crane|camera cranes upward/i);
    expect(details[2]).not.toMatch(/flat[- ]lay|top[- ]down|true overhead/i);
  });

  it('keeps each soundscape tied to visible scene events', () => {
    const eyePrompt = buildH3Prompt({ product: eyeCream, brief: ref2vaBrief(eyeCream, eyeCreamGalleryGenome, 'Music Only'), concept: null, resolvedMode: 'REF2VA' });
    const cleanserPrompt = buildH3Prompt({ product: cleanser, brief: ref2vaBrief(cleanser, cleanserBotanicalGenome), concept: null, resolvedMode: 'REF2VA' });
    const serumPrompt = buildH3Prompt({ product: serum, brief: ref2vaBrief(serum, serumEditorialGenome), concept: null, resolvedMode: 'REF2VA' });
    const eyeSound = section(eyePrompt, 'overall_soundscape', 'non_diegetic_music');
    const cleanserSound = section(cleanserPrompt, 'overall_soundscape', 'non_diegetic_music');
    const serumSound = section(serumPrompt, 'overall_soundscape', 'non_diegetic_music');

    expect(eyeSound).toContain('mechanical slides');
    expect(eyeSound).toContain('air resonance');
    expect(eyeSound).not.toMatch(/fluid|reflective chimes|electrical shimmer/i);
    expect(cleanserSound).toContain('airy particle movement');
    expect(cleanserSound).toContain('greenhouse ambience');
    expect(cleanserSound).not.toMatch(/fluid|electrical shimmer|reflective chimes/i);
    expect(serumSound).toContain('paper slides');
    expect(serumSound).toContain('mineral contact');
    expect(serumSound).toContain('brushed-metal movement');
    expect(serumSound).not.toMatch(/fluid|electrical shimmer|reflective chimes/i);
  });

  it('keeps the Eye Cream realization materially below the previous 679-word output', () => {
    const prompt = buildH3Prompt({ product: eyeCream, brief: ref2vaBrief(eyeCream, eyeCreamGalleryGenome, 'Music Only'), concept: null, resolvedMode: 'REF2VA' });
    expect(words(prompt)).toBeLessThan(679);
    expect(words(section(prompt, 'detailed_description', 'overall_soundscape'))).toBeLessThan(260);
  });

  it('does not mechanically emit every genome field as a serialized prompt block', () => {
    const prompt = buildH3Prompt({ product: eyeCream, brief: ref2vaBrief(eyeCream, eyeCreamGalleryGenome, 'Music Only'), concept: null, resolvedMode: 'REF2VA' });
    const fields = Object.entries(eyeCreamGalleryGenome)
      .filter(([field]) => field !== 'schemaVersion' && field !== 'contentFamily')
      .map(([, value]) => value);
    const exactFieldOccurrences = fields.filter((value) => prompt.includes(value)).length;

    expect(exactFieldOccurrences).toBeLessThan(fields.length);
    expect(prompt).not.toContain('creativeArchetype:');
    expect(prompt).not.toContain('cameraPath:');
    expect(prompt).not.toContain('primaryMotion:');
  });

});
