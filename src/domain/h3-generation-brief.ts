import type {
  CreativeGenome,
  H3CreativeDirection,
  H3AllowedReferenceLabels,
  H3GenerationBrief,
  H3GenerationBriefReference,
  H3ReferencePlan,
  H3VideoBrief,
  Product
} from './types';
import { buildH3ReferenceSlotMappings, type H3ReferenceSlotMapping } from './h3';

export interface BuildH3GenerationBriefInput {
  product: Product;
  brief: H3VideoBrief;
  genome?: CreativeGenome | null;
  references?: H3ReferencePlan;
}

/** Deterministic user-brief instruction; it is intentionally not a system-prompt edit. */
export const H3_SINGLE_SHOT_TIMING_CONTRACT = 'TIMING CONTRACT\nThis is one continuous shot. Do not write numeric event times inside shot prose. Do not introduce timestamped events unless explicitly supplied by user. Describe progression chronologically with words such as begins, then, gradually, toward the end, and finally.';

export const H3_REPAIR_CONTRACT = 'When the validator reports an error, repair the final prompt in place: remove numeric event times from shot prose, remove every undeclared reference label, preserve the declared reference labels and their roles, and never create a new label number. Keep the one-shot chronology and all user-supplied constraints.';

function clean(value: string | null | undefined, fallback: string): string {
  const normalized = value?.replace(/\s+/g, ' ').trim();
  return normalized || fallback;
}

function withoutSpeechDirection(value: string): string {
  return value
    .replace(/\bmid-thought\b/gi, 'mid-action')
    .replace(/\bspoken gesture\b/gi, 'visible gesture')
    .replace(/\b(?:creator speech|creator voice|voice[ -]?over|narration|narrator|spoken|speech|dialogue|instructional voice|explanatory voice)\b/gi, 'instrumental cue')
    .replace(/\b(?:speaks?|talks?)\b/gi, 'gestures')
    .replace(/\s+/g, ' ')
    .trim();
}

function directionFromGenome(brief: H3VideoBrief, genome: CreativeGenome | null | undefined): H3CreativeDirection {
  const fallback = clean(brief.videoIdea, 'A controlled cinematic product reveal.');
  const direction = {
    concept: fallback,
    visualHook: clean(genome?.visualHook, 'A tactile opening detail that resolves to the product.'),
    creativeArchetype: clean(genome?.creativeArchetype, 'Cinematic product reveal'),
    environment: clean(genome?.environment, 'A clean, premium studio environment.'),
    composition: clean(genome?.composition, 'The product remains the clear visual anchor.'),
    cameraPath: clean(genome?.cameraPath, 'A deliberate forward camera move with a calm hero hold.'),
    framing: clean(genome?.framing, 'Medium-to-close product framing with safe breathing room.'),
    lightingStyle: clean(genome?.lightingStyle, 'Soft directional light with controlled specular highlights.'),
    primaryMotion: clean(genome?.primaryMotion, 'One legible product-centered motion.'),
    secondaryMotion: clean(genome?.secondaryMotion, 'Subtle environmental motion only.'),
    materialEffect: clean(genome?.materialEffect, 'A restrained material response that supports the product surface.'),
    pacing: clean(genome?.pacing, brief.pacing),
    openingDevice: clean(genome?.openingDevice, 'Open on the visual hook before the full package reveal.'),
    transitionLanguage: clean(genome?.transitionLanguage, 'One smooth transition into the hero composition.'),
    endingDevice: clean(genome?.endingDevice, clean(brief.customEnding, brief.ending)),
    audioCharacter: clean(genome?.audioCharacter, clean(brief.sound, 'Premium, restrained sound design.'))
  };
  if (!brief.musicOnly) return direction;
  return Object.fromEntries(Object.entries(direction).map(([key, value]) => [key, withoutSpeechDirection(value)])) as unknown as H3CreativeDirection;
}

function conceptExposesSurface(brief: H3VideoBrief, genome: CreativeGenome | null | undefined, surface: 'rear' | 'side'): boolean {
  const concept = [
    brief.videoIdea,
    brief.specialInstructions,
    genome?.openingDevice,
    genome?.cameraPath,
    genome?.primaryMotion,
    genome?.secondaryMotion,
    genome?.endingDevice
  ].filter(Boolean).join(' ').toLowerCase();
  if (surface === 'rear') return /\b(rear|back|backside|reverse|turn(?:s|ed|ing)?|rotate|around|360)\b/.test(concept);
  return /\b(side|profile|lateral|turn(?:s|ed|ing)?|rotate|around|360)\b/.test(concept);
}

function correctionForProduct(product: Product, brief: H3VideoBrief, genome: CreativeGenome | null | undefined): string[] {
  const corrections: string[] = [];
  if (product.id === 'cleanser') corrections.push('Preserve the product geometry directly from <Picture 1>. It is a wide, gently tapered squeeze tube with a white base flip-cap and glossy opaque orange finish. Do not simplify it into a cylindrical bottle/tube or matte surface.');
  if (product.id === 'toner') corrections.push('The orange bottle body is opaque; the protective outer cap is the only transparent component.');
  if (product.id === 'serum') corrections.push('The bottle appears opaque/coated; any visible serum liquid is clear and colorless.');
  if (product.physicalIdentity.rearSurfaceAppearance.content === 'blank' && conceptExposesSurface(brief, genome, 'rear')) corrections.push('If the rear surface is revealed, preserve it as a blank continuation with no invented label, logo, barcode, or copy.');
  if (product.physicalIdentity.sideSurfaceAppearance.content === 'blank' && conceptExposesSurface(brief, genome, 'side')) corrections.push('If a side surface is revealed, preserve it as a blank continuation with no invented printed artwork.');
  return corrections;
}

function referencesFromPlan(plan: H3ReferencePlan): H3GenerationBriefReference[] {
  // This is the same ordered, concrete-image mapping used by the renderer to
  // build request.referenceImages. Described custom references stay textual;
  // they are never promoted to a connected Picture label.
  const mapped = buildH3ReferenceSlotMappings(plan).map((mapping) => ({
    pictureTag: mapping.pictureTag,
    slot: mapping.refImageIndex,
    role: referenceRole(mapping),
    description: clean(mapping.asset.description, referenceRole(mapping)),
    source: mapping.asset.source,
    subjectTag: isProductReferenceRole(mapping) ? '<Subject 1>' : undefined
  }));

  if (mapped.length > 0) return mapped;
  return [{
    pictureTag: '<Picture 1>',
    slot: 0,
    role: 'product identity and packaging truth',
    description: 'No product reference was selected. Ref2VA submission will be blocked until one is selected.',
    source: 'none'
  }];
}

function isProductReferenceRole(mapping: H3ReferenceSlotMapping): boolean {
  return mapping.role === 'product-front' || mapping.role === 'product-back' || mapping.role === 'product-side';
}

function referenceRole(mapping: H3ReferenceSlotMapping): string {
  if (isProductReferenceRole(mapping)) return 'product identity and packaging truth';
  if (mapping.role === 'style') return 'optional look and lighting reference';
  return 'additional visual reference';
}

function uniqueLabels(values: string[]): string[] {
  return Array.from(new Set(values));
}

/**
 * Builds the exact legacy-compatible manifest accepted by the pinned node.
 * Its parser assigns Picture/Subject labels from array order, so we keep the
 * accepted `items`/`subjects` shape instead of inventing a v2 schema.
 */
export function buildH3ReferenceContract(references: H3GenerationBriefReference[]): { mediaManifest: string; allowedReferenceLabels: H3AllowedReferenceLabels } {
  const connectedReferences = references.filter((reference) => reference.source !== 'none');
  const subjectGroups = new Map<string, H3GenerationBriefReference[]>();
  for (const reference of connectedReferences) {
    if (!reference.subjectTag) continue;
    const group = subjectGroups.get(reference.subjectTag) ?? [];
    group.push(reference);
    subjectGroups.set(reference.subjectTag, group);
  }
  const subjects = Array.from(subjectGroups.entries());
  const allowedReferenceLabels: H3AllowedReferenceLabels = {
    subjects: uniqueLabels(subjects.map(([subjectTag]) => subjectTag)),
    pictures: uniqueLabels(connectedReferences.map((reference) => reference.pictureTag)),
    videos: [],
    audios: []
  };
  const mediaManifest = JSON.stringify({
    items: connectedReferences.map((reference) => ({
      type: 'picture',
      role: reference.role,
      description: reference.description
    })),
    subjects: subjects.map(([subjectTag, subjectReferences], index) => ({
      id: Number(subjectTag.match(/\d+/)?.[0] ?? index + 1),
      description: `The selected product represented by ${subjectReferences.map((reference) => reference.pictureTag).join(' and ')}; preserve visible product identity from the connected pixels.`,
      sources: subjectReferences.map((reference) => reference.pictureTag)
    })),
    mode: 'ref2va'
  }, null, 2);
  return { mediaManifest, allowedReferenceLabels };
}

export function buildH3ReferenceContext(brief: H3GenerationBrief): string {
  const referenceLines = brief.references.map((reference) => `${reference.pictureTag} — ${reference.role}: ${reference.description}`);
  const allowedLines = [
    'AUTHORITATIVE REFERENCE CONTRACT',
    `Allowed subject labels: ${brief.allowedReferenceLabels.subjects.join(', ') || 'none'}`,
    `Allowed picture labels: ${brief.allowedReferenceLabels.pictures.join(', ') || 'none'}`,
    'Only the selected product may receive a reusable subject label; people, hands, props, and environments remain ordinary prose unless separately declared by a connected reference.',
    'Do not introduce any new subject or picture labels.'
  ];
  const subjectDefinitions = brief.references
    .filter((reference) => reference.subjectTag)
    .map((reference) => `${reference.subjectTag} is the selected product represented by ${reference.pictureTag}; preserve visible product identity from the connected pixels.`);
  return [...referenceLines, ...allowedLines, ...subjectDefinitions].join('\n');
}

/**
 * Builds only the structured intermediate handoff for the remote Qwen node.
 * It intentionally does not produce the final six-section MiniMax prompt.
 */
export function buildH3GenerationBrief(input: BuildH3GenerationBriefInput): H3GenerationBrief {
  const { product, brief } = input;
  const contentType = brief.contentType ?? 'Cinematic Product Ad';
  const referencePlan = input.references ?? brief.references;
  const references = referencesFromPlan(referencePlan);
  const referenceContract = buildH3ReferenceContract(references);
  const baseSpecialInstructions = clean(brief.specialInstructions, 'Preserve product identity and keep the action visually legible.');
  const textOnlyStyleNote = referencePlan.styleReference.source === 'custom' && referencePlan.styleReference.description.trim()
    ? ` Text-only style direction (not a connected image): ${clean(referencePlan.styleReference.description, 'keep the requested look and lighting direction')}`
    : '';
  return {
    schemaVersion: 1,
    workflowMode: 'REF2VA',
    product: product.id,
    contentType,
    contentFamily: contentType,
    duration: brief.duration,
    aspectRatio: brief.aspectRatio === 'Custom' ? '9:16' : brief.aspectRatio,
    language: brief.language,
    videoIdea: clean(brief.videoIdea, 'Create a polished product reveal.'),
    creativeDirection: directionFromGenome(brief, input.genome ?? brief.creativeGenome),
    productCorrections: correctionForProduct(product, brief, input.genome ?? brief.creativeGenome),
    references,
    mediaManifest: referenceContract.mediaManifest,
    allowedReferenceLabels: referenceContract.allowedReferenceLabels,
    musicOnly: brief.musicOnly,
    captions: brief.captions,
    subtitles: brief.subtitles,
    sound: brief.sound,
    specialInstructions: `${baseSpecialInstructions}${textOnlyStyleNote}`
  };
}

function line(label: string, value: string | number | boolean): string {
  return `${label}: ${typeof value === 'boolean' ? (value ? 'yes' : 'no') : value}`;
}

/** Stable, human-readable serialization sent to MiniMaxH3PromptEnhancer. */
export function serializeH3GenerationBrief(brief: H3GenerationBrief): string {
  const direction = brief.creativeDirection;
  const referenceLines = brief.references.map((reference) => `${reference.pictureTag} | ${reference.role} | ${reference.description}${reference.subjectTag ? ` | authoritative subject ${reference.subjectTag}` : ''}`);
  const correctionLines = brief.productCorrections.length > 0 ? brief.productCorrections : ['No additional product-specific correction is required.'];
  const audioAndTextLines = [
    line('Music only', brief.musicOnly),
    line('Captions', brief.captions),
    line('Subtitles', brief.subtitles),
    line('Sound direction', brief.sound),
    brief.musicOnly ? 'No dialogue, voiceover, narration, creator speech, or other human speech.' : 'Human speech is permitted only when explicitly requested by the creative direction.',
    brief.captions ? 'Captions may be generated only when they are explicitly requested by the final H3 direction.' : 'No generated captions or marketing text overlays.',
    brief.subtitles ? 'Subtitles may be generated only when they are explicitly requested by the final H3 direction.' : 'No generated subtitles or speech transcription.',
    'Visible product packaging is not a generated caption or subtitle.'
  ];
  return [
    'WORKFLOW MODE LOCK: REF2VA.',
    'Format the result as REF2VA.',
    'Do not switch generation modes.',
    '',
    'H3 GENERATION BRIEF',
    line('Workflow mode', 'REF2VA (locked)'),
    line('Product', brief.product),
    line('Content type', brief.contentType),
    line('Target duration seconds', brief.duration),
    line('Target aspect ratio', brief.aspectRatio),
    line('Dialogue language', brief.language),
    '',
    H3_SINGLE_SHOT_TIMING_CONTRACT,
    '',
    'CREATIVE DIRECTION',
    line('Concept', direction.concept),
    line('Visual hook', direction.visualHook),
    line('Archetype', direction.creativeArchetype),
    line('Environment', direction.environment),
    line('Composition', direction.composition),
    line('Camera path', direction.cameraPath),
    line('Framing', direction.framing),
    line('Lighting', direction.lightingStyle),
    line('Primary motion', direction.primaryMotion),
    line('Secondary motion', direction.secondaryMotion),
    line('Material response', direction.materialEffect),
    line('Pacing', direction.pacing),
    line('Opening device', direction.openingDevice),
    line('Transition language', direction.transitionLanguage),
    line('Ending device', direction.endingDevice),
    line('Audio character', direction.audioCharacter),
    '',
    'REFERENCE MAP',
    ...referenceLines,
    '',
    'ALLOWED REFERENCE LABELS',
    `Subjects: ${brief.allowedReferenceLabels.subjects.join(', ') || 'none'}`,
    `Pictures: ${brief.allowedReferenceLabels.pictures.join(', ') || 'none'}`,
    'Only the selected product may receive a reusable subject label; people, hands, props, and environments remain ordinary prose unless separately declared by a connected reference.',
    'Only the declared labels above may appear in the final prompt. Do not introduce any new subject or picture labels.',
    '',
    'PRODUCT / REFERENCE AUTHORITY',
    'Reference pixels own the exact silhouette, proportions, cap or lid shape, printed front design, and surface appearance.',
    'Qwen owns the scene, action, lighting, camera, pacing, sound, and H3 syntax.',
    'Preserve <Subject 1> exactly from <Picture 1>; use only the short product-specific correction below and do not reconstruct package geometry unnecessarily.',
    '',
    'PRODUCT CORRECTIONS',
    ...correctionLines.map((correction) => `- ${correction}`),
    '',
    'AUDIO AND TEXT',
    ...audioAndTextLines,
    '',
    'REPAIR CONTRACT',
    H3_REPAIR_CONTRACT,
    '',
    'SPECIAL INSTRUCTIONS',
    brief.specialInstructions
  ].join('\n');
}

export const buildH3GenerationBriefText = serializeH3GenerationBrief;
