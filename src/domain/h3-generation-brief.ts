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
import { getProduct } from './data';
import { isNoProductVideo, isSupportBRoll, supportBRollGuardrails, supportBRollReferencePlan, supportBRollTheme } from './support-b-roll';
import { hookAppearanceThemes, hookTransitionIdeas, type HookArchetype } from './hook-archetype';

export interface BuildH3GenerationBriefInput {
  product: Product;
  brief: H3VideoBrief;
  genome?: CreativeGenome | null;
  references?: H3ReferencePlan;
}

/** Deterministic user-brief instruction; it is intentionally not a system-prompt edit. */
export const H3_SINGLE_SHOT_TIMING_CONTRACT = 'TIMING CONTRACT\nThis is one continuous shot. Do not write numeric event times inside shot prose. Do not introduce timestamped events unless explicitly supplied by user. Describe progression chronologically with words such as begins, then, gradually, toward the end, and finally.';

export const H3_REPAIR_CONTRACT = 'When the validator reports an error, repair only the invalid portions of the final prompt. Remove invented quoted text and unauthorized speech; preserve exact literal text only when the source authorized it. For authorized visible dialogue, keep one stable (Sx) ID and an explicit vocal action in the same sentence as each <d> block; never convert visible dialogue to voiceover. As needed, remove numeric event times from shot prose, remove every undeclared reference label, preserve declared labels and their roles, and never create a new label number. Keep the one-shot chronology and all verified product facts.';

export const H3_DETAIL_CONTRACT = 'For REF2VA enhanced production, make the detailed description at least 350 English words (aim for 370–400) using meaningful product-reference fidelity, spatial layout, physical texture behavior, camera path, and lighting continuity. Describe an observable cause, physical response, and settled visual result within the one shot; do not merely say the benefit is implied by lighting. This is a shot-design brief, not spoken copy. Do not pad with dialogue, claims, repeated adjectives, or irrelevant spectacle.';

export const H3_NO_GENERATED_TEXT_CONSTRAINT = 'NO readable text. NO typography, labels, words, letters, subtitles, captions, infographic wording, fake scientific writing, floating formulas, UI screens, or logos created by the model. Existing real packaging text from the authoritative product reference is allowed only when that real product is visible; never invent additional text.';

const productTextureGuidance: Readonly<Record<Product['id'], string>> = {
  cleanser: 'Show actual cleanser texture: a creamy cleanser ribbon, dense soft foam, lather macro, or cleanser spreading with water.',
  toner: 'Show actual toner texture: fine mist, clear watery droplets, hydration droplets on skin, or a lightweight watery texture.',
  serum: 'Show actual serum texture: a translucent clear serum droplet or bead, a dropper releasing liquid, serum spreading across skin, or a glossy lightweight serum texture.',
  'eye-cream': 'Show actual eye-cream texture: a small cream ribbon, silky cream texture, gentle spreading, or under-eye application texture.',
  'skin-cream': 'Show actual skin-cream texture: a rich cream swirl or scoop, a cream smear, nourishing texture macro, or a soft glossy cream surface.',
  mask: 'Show actual mask texture: soaked sheet fabric, clear essence droplets, hydrated fabric macro, or cooling watery essence.',
  'full-series': 'Choose one unmistakable skincare texture such as foam, mist, clear serum, cream, or essence and show its physical behavior clearly.'
};

const hookConcerns: Readonly<Record<Product['id'], string>> = {
  cleanser: 'At a bathroom sink after washing, a person pats their face dry, then touches cheeks that feel dry and tight and visibly reacts to the uncomfortable stripped feeling.',
  toner: 'A person studies tired, dull, dehydrated-looking skin in a mirror after cleansing and wants a refreshing hydration reset before the next skincare step.',
  serum: 'A person notices visible dark spots, uneven-looking tone, or dull skin in a mirror, leans closer, and gently points to the concern.',
  'eye-cream': 'A tired person notices dark under-eyes or eye bags in a mirror and gently checks the eye area with a fingertip.',
  'skin-cream': 'A person feels dry, rough, tight, less supple skin on a cheek and checks it in the mirror, wanting moisture and comfort.',
  mask: 'A tired, stressed, overheated-looking person checks their face in a mirror and pauses for a soothing, cooling moment.',
  'full-series': 'A person checks a familiar skin concern in a bathroom mirror: dullness, dryness, or tired-looking skin. Make the specific concern clear through their expression and gesture.'
};

const benefitVisualGuidance: Readonly<Record<Product['id'], string>> = {
  cleanser: 'Show fresh, comfortable, clean-looking human skin after cleansing, with natural texture and no stripped, tight, irritated, or overly dry appearance.',
  toner: 'Show tired or dehydrated-looking human skin becoming fresher, dewier, hydrated-looking, prepared, and comfortable only within the verified benefit list.',
  serum: 'Show dull or uneven-looking human skin becoming brighter-looking, more radiant-looking, or more even-looking; show improved dark-spot appearance only because that benefit is verified for this serum.',
  'eye-cream': 'Show a tired-looking under-eye area becoming more refreshed-looking, limited strictly to the verified eye-area appearance benefits.',
  'skin-cream': 'Show dry-looking human skin becoming more moisturized-looking, soft, supple, comfortable, or use a restrained moisture-barrier support metaphor only within the verified benefits.',
  mask: 'Show tired or stressed-looking human skin becoming calmer-looking and refreshed-looking, using a soothing, cooling, recovery feeling only where supported by the verified benefits.',
  'full-series': 'Choose one product-specific verified result and show it through human skin or a restrained skincare visual metaphor; never combine or transfer claims between products.'
};

const ingredientVisualGuidance: Readonly<Record<Product['id'], string>> = {
  cleanser: 'Use cleanser formulation and ingredient education imagery: dense soft foam, creamy cleanser macro, water interaction, clean laboratory macro, or active-inspired particles interacting with a simplified skin surface.',
  toner: 'Use toner formulation and ingredient education imagery: fine mist, clear watery droplets, hydration moving toward skin, clean laboratory macro, or active-inspired particles in a watery field.',
  serum: 'Use serum formulation and ingredient education imagery: clear colorless serum droplets, lightweight serum texture, active-inspired particles, antioxidant-style particle interaction, simplified skin layers, or clean laboratory macro.',
  'eye-cream': 'Use eye-cream formulation and ingredient education imagery: silky cream macro, a small cream ribbon, moisture interaction with a simplified skin surface, active-inspired particles, or clean laboratory macro.',
  'skin-cream': 'Use cream formulation and ingredient education imagery: rich cream swirl, cream smear, moisture-barrier layer visualization, active-inspired particles, or clean laboratory macro.',
  mask: 'Use mask formulation and ingredient education imagery: soaked sheet fibers, clear essence droplets, cooling watery texture, verified botanical macro, hydration interaction, or clean laboratory macro.',
  'full-series': 'Choose one verified product-specific ingredient and one matching skincare formulation visualization; do not merge ingredients across products.'
};

function hookDirection(product: Product, brief: H3VideoBrief, archetype: HookArchetype): H3CreativeDirection {
  const theme = hookAppearanceThemes[product.id];
  if (archetype === 'Problem → After') return {
    concept: `A believable before-and-after moment: begin with ${theme.problem}, transition naturally, then show that ${theme.after}.`,
    visualHook: 'Open directly on the same person noticing the clearly readable skin concern; establish the before state immediately without sound.',
    creativeArchetype: archetype,
    environment: 'One ordinary bathroom or vanity setting maintained across the before and after, with empty counters and no toiletries, dispensers, containers, or bottles in view.',
    composition: 'Keep the same person, face, relevant skin area, wardrobe, and framing recognizable across the transition; no product, package, bottle, or dispenser may appear, even blurred in the background or mirror.',
    cameraPath: 'Steady close-up or gentle handheld move, one natural transition, then a stable after-state hold.',
    framing: 'Human face close enough to compare the same skin area before and after, with a consistent mirror or sink context.',
    lightingStyle: 'Soft natural bathroom light with restrained improvement; keep natural texture and avoid a retouched or perfect-skin result.',
    primaryMotion: 'The person checks the concern, transitions naturally, and settles into the believable improved-looking state.',
    secondaryMotion: 'Small facial reaction, breathing, and relaxed expression changes only.',
    materialEffect: 'Real skin and ordinary bathroom surfaces; no face morphing, magic particles, or abstract transformation effects.',
    pacing: 'Use roughly the first 35–50% for the problem, the middle for the transition, and the remaining 40–55% for a readable after state.',
    openingDevice: 'Begin with the face and problem state in the first frame.',
    transitionLanguage: 'Choose one restrained social-video transition from the allowed examples in the content contract.',
    endingDevice: 'Hold the improved-looking state long enough to read; never reduce it to the final half-second.',
    audioCharacter: 'Quiet natural room tone or restrained music; no invented speech.'
  };
  const concern = hookConcerns[product.id];
  return {
    concept: concern,
    visualHook: 'Open directly on the person noticing the skin concern; the expression and small gesture must read without sound.',
    creativeArchetype: archetype,
    environment: 'Ordinary bathroom or vanity in natural light, with empty counters and no toiletries, dispensers, containers, or bottles in view.',
    composition: 'Face and the relevant skin area dominate; keep every product, package, bottle, and dispenser out, including blurred background and mirror reflections.',
    cameraPath: 'Simple steady close-up or gentle handheld move following the person and mirror reflection.',
    framing: 'Human face close enough to recognize the specific concern, with a clear mirror context.',
    lightingStyle: 'Soft natural bathroom light that reveals realistic skin texture without exaggeration.',
    primaryMotion: 'The person notices, checks, and gently touches or points to the concern.',
    secondaryMotion: 'Small natural facial reaction and breathing only.',
    materialEffect: 'Real skin and ordinary bathroom surfaces; no abstract effects.',
    pacing: clean(brief.pacing, 'Immediate, simple, and relatable.'),
    openingDevice: 'Begin with the face and concern in the first frame.',
    transitionLanguage: 'Stay with the same human moment; do not turn into a product reveal.',
    endingDevice: 'Hold the recognizable concern and curiosity with no product visible.',
    audioCharacter: 'Quiet natural room tone or restrained music.'
  };
}

export function h3ContentTypeContract(product: Product, contentType: H3VideoBrief['contentType'], hookArchetype: HookArchetype = 'Problem Only'): string[] {
  if (contentType === 'Hook') return [
    'PERSON AND SKIN-CONCERN HOOK CONTRACT',
    `Internal Hook archetype: ${hookArchetype}.`,
    ...(hookArchetype === 'Problem → After' ? [
      `BEFORE appearance: ${hookAppearanceThemes[product.id].problem}.`,
      `AFTER appearance: ${hookAppearanceThemes[product.id].after}.`,
      'Show both states clearly, using the same person and same general setting. The change is cosmetic-looking and believable: never an instant medical cure, miraculous transformation, different person, heavily altered face, impossible perfect skin, or complete erasure of natural texture.',
      ...(product.id === 'cleanser' ? ['For Cleanser, communicate tight dryness through matte texture, fine dry-looking cheek detail, touch, and expression—not acne, rash, irritation, or strong redness. Make the after state visibly softer and naturally moisture-comfortable.'] : []),
      `Use one natural transition, for example ${hookTransitionIdeas.slice(0, 6).join(', ')}. No explosions, sci-fi, face morph, full-face magic particles, product reveal, or flashy luxury transition.`
    ] : [
      `Product-specific concern: ${hookConcerns[product.id]}`,
      'Focus entirely on the relatable problem. The person and recognizable problem are the primary subject from the first frame through the end. Show a believable mirror or sink moment, natural expression, and one clear gesture. The concern must be understandable on mute.'
    ]),
    'No product at any point: no bottle, pump bottle, dispenser, tube, jar, sachet, toiletries, packaging, logo, product reference, product hero shot, product reveal, or product in the background or mirror. Keep counters visually empty.',
    'No invented dialogue, medical claims, exaggerated skin damage, gimmicky text, or infographic overlays.',
    'NO readable text, captions, subtitles, logos, product labels, UI screens, or packaging of any kind.'
  ];
  if (contentType === 'Benefits' || contentType === 'Ingredients') {
    const facts = verifiedContentFacts(product, contentType);
    const visualGuidance = contentType === 'Benefits' ? benefitVisualGuidance[product.id] : ingredientVisualGuidance[product.id];
    return [
      `PRODUCT-FREE VERIFIED ${contentType.toUpperCase()} CONTRACT`,
      `Authoritative ${contentType.toLowerCase()} for ${product.officialName} ONLY: ${facts.join('; ')}.`,
      `Choose only from these exact product-specific facts. Do not add, expand, exaggerate, or borrow any ${contentType.toLowerCase()} from another product. Visual storytelling only; no medical claims or fake scientific labels.`,
      'The selected product is semantic fact guidance only. ZERO product references and ZERO visible product: no bottle, package, packshot, container, tube, jar, sachet, dispenser, label, logo, product hero, product reveal, product spinning, pedestal shot, packaging-first composition, or product B-roll, including in backgrounds and reflections.',
      visualGuidance,
      contentType === 'Benefits'
        ? 'Show the verified effect, result, experience, or a restrained visual metaphor. Prefer human skin close-ups, a believable before-and-after-style appearance change, hydrated skin macro, brighter-looking complexion, skin comfort, dewy skin, or subtle texture improvement. The visible result must come from observable skin or material change, not merely color grading or lighting.'
        : 'Make the ingredient, formulation texture, beauty-science interaction, or ingredient-to-skin visualization the subject. Prefer macro droplets, foam, mist, cream, serum, particles, simplified skin layers, and clean laboratory beauty imagery. Botanical or citrus imagery is allowed only when genuinely relevant to the verified ingredient list. Never drift into food, beverage, or generic luxury-product advertising.',
      contentType === 'Ingredients'
        ? 'No fake chemical formulas, molecular labels, ingredient labels, diagram wording, scientific UI, or invented scientific symbols.'
        : 'No written benefit claim, comparison label, before/after caption, or in-scene marketing copy.',
      H3_NO_GENERATED_TEXT_CONSTRAINT
    ];
  }
  if (contentType === 'Product') return [
    'CLEAR PRODUCT FOOTAGE FIRST — PRODUCT CONTRACT',
    'The selected product is visible from FRAME 1 and remains the focal point for most of this single continuous shot. In whole-product hero shots, it occupies roughly 35–60% of frame height.',
    'Use practical skincare footage: clean hero, vanity or shelf, macro packaging or dropper detail, natural usage or dispensing, or a simple top-down shot. Keep it clean, believable, premium, and easy to cut into TikTok/Reels.',
    'No wall, door, curtain, darkness, transformation, sci-fi, environment-first, pedestal-rise, or particle reveal. No hidden entrance or product appearing halfway through. No architecture, sports-car, perfume, or luxury-reveal commercial treatment.',
    'Use a static camera, gentle push-in, short lateral slide, subtle handheld move, or small macro/parallax move. No orbit, fast rotation, aggressive sweep, extreme low angle, or depth-of-field hunting.',
    'Keep the product mostly front-facing and still. Preserve reference silhouette, color, closure, label hierarchy, and front-facing identity. Minimize perspective deformation, packaging motion blur, and side/back views.',
    'Packaging print is visual appearance inherited from the verified reference, not text to rewrite. Never invent package wording, extra labels, floating words, or graphics.',
    H3_NO_GENERATED_TEXT_CONSTRAINT
  ];
  if (contentType === 'Product B-Roll') return [
    'PRACTICAL PRODUCT B-ROLL CONTRACT',
    'Create a practical, clean, natural, social-commerce insert designed to cut into a TikTok or Reels edit for one to three seconds. The authoritative product should normally remain visible and reference-faithful.',
    'Prefer a bathroom vanity, skincare shelf, clean countertop, simple sink setting, soft studio tabletop, top-down shot, macro packaging detail, natural pick-up or place-down, cap/pump/dropper detail, or appropriate dispensing action.',
    'Use a tripod, controlled handheld camera, small slider, simple macro move, or gentle push-in. Keep movement restrained and provide a stable edit point.',
    'Reject luxury automotive or perfume-ad language: no sports-car-commercial lighting, black glossy supercar stage, aggressive orbit, huge lens flare, excessive light streaks, sci-fi reveal, dramatic transformation, monumental architecture, or ultra-luxury spectacle.',
    'Preserve the product directly from the authoritative reference; do not redesign, transform, or approximate its packaging.'
  ];
  if (contentType === 'Educational') return [
    'TEXT-FREE EDUCATIONAL CONTRACT',
    'Create a visual explanation that remains understandable with zero text overlay. Product presence is optional when the visual explanation works better without it.',
    'Use only skincare visual cause and effect such as a skin-surface macro, dull-looking skin becoming visually brighter, hydration entering dry-looking skin, a moisture-barrier metaphor, cleansing oil or debris from pores, pigmentation particle dispersion, simplified skin layers, or ingredient particles interacting visually with skin.',
    H3_NO_GENERATED_TEXT_CONSTRAINT,
    'Do not ask H3 to spell anything or draw a written diagram. Any requested caption or subtitle belongs to a deterministic post-generation application overlay if one is available; it must not appear in the model-generated footage.'
  ];
  if (contentType === 'Ingredient / Texture') return [
    'SKINCARE INGREDIENT / TEXTURE CONTRACT',
    productTextureGuidance[product.id],
    'The actual skincare ingredient, texture, dispensing, foam, mist, cream, serum, droplet, or essence is the primary subject. The product may appear as useful context but does not need to dominate every shot.',
    'Ingredient-inspired alternatives may show vitamin-C-inspired citrus macro, translucent active-inspired particles, antioxidant particle visualization, water or hydration, botanical ingredient macro, bright citrus liquid, ingredient droplets, or clean laboratory-style skincare ingredients.',
    'Keep every visual unmistakably skincare/beauty-oriented. Do not drift into a food or beverage advertisement, random unrelated flowers, generic abstract luxury advertising, product transformation, chemistry text labels, fake ingredient names, or floating written formulas.',
    H3_NO_GENERATED_TEXT_CONSTRAINT
  ];
  return [];
}

/** Catalog fields are the sole authority for fact-led categories. */
export function verifiedContentFacts(product: Product, contentType: 'Benefits' | 'Ingredients'): string[] {
  const catalogProduct = getProduct(product.id);
  const facts = contentType === 'Benefits' ? product.benefitTerritories : product.ingredients;
  const catalogFacts = contentType === 'Benefits' ? catalogProduct?.benefitTerritories : catalogProduct?.ingredients;
  if (!Array.isArray(facts) || !facts.length || facts.some(fact => typeof fact !== 'string' || !fact.trim()) ||
      !catalogFacts || JSON.stringify(facts) !== JSON.stringify(catalogFacts)) {
    throw new Error(`Verified ${contentType.toLowerCase()} are missing for ${product.id}; generation was not submitted.`);
  }
  return [...catalogFacts];
}

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

const speechScopedTypes = new Set<H3VideoBrief['contentType']>(['Hook', 'Benefits', 'Ingredients', 'Product', 'Support B-Roll']);

function userSpeechRequest(brief: H3VideoBrief): { mode: 'none' | 'visible-dialogue' | 'voiceover'; request: string } {
  if (brief.musicOnly) return { mode: 'none', request: '' };
  const directions = [brief.videoIdea, brief.specialInstructions];
  for (const direction of directions) {
    for (const sentence of direction.split(/[.!?;\n]+/).map(value => value.trim()).filter(Boolean)) {
      const cue = /\b(voice[ -]?over|narrat(?:ion|or|e|es|ing)|off[ -]?screen voice|dialogue|spoken (?:line|words)|speaks?|says?|talks?)\b/i.exec(sentence);
      if (!cue) continue;
      const before = sentence.slice(0, cue.index);
      if (/\b(?:no|without|avoid|omit|never|do not|don't)\s+(?:(?:any|human|spoken|audible|generated)\s+){0,3}$/i.test(before)) continue;
      const mode = /voice[ -]?over|narrat|off[ -]?screen voice/i.test(cue[0]) ? 'voiceover' : 'visible-dialogue';
      return { mode, request: sentence };
    }
  }
  return { mode: 'none', request: '' };
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

function factDirection(product: Product, factType: 'Benefits' | 'Ingredients', facts: string[], brief: H3VideoBrief, genome: CreativeGenome | null | undefined): H3CreativeDirection {
  const matchingGenome = genome?.contentFamily === factType ? genome : null;
  if (matchingGenome) return directionFromGenome({ ...brief, videoIdea: `Create a product-free visual story using only the verified ${factType.toLowerCase()}: ${facts.join('; ')}.` }, matchingGenome);
  if (factType === 'Benefits') return {
    concept: `Show one believable human skin result using only these verified benefits: ${facts.join('; ')}.`,
    visualHook: 'Open directly on the relevant human skin appearance or experience; no product or packaging is visible.',
    creativeArchetype: 'Human Skin Result',
    environment: 'Simple daylight bathroom or beauty close-up with empty surfaces and no toiletries, containers, labels, or logos.',
    composition: 'The same human skin area remains the primary subject throughout.',
    cameraPath: 'Steady close-up or slow macro glide with no reveal choreography.',
    framing: 'Close enough to read natural skin texture and the verified appearance result.',
    lightingStyle: 'Consistent neutral beauty light; the result must not depend only on color or exposure change.',
    primaryMotion: 'The relevant skin appearance changes gradually and believably within the verified benefit boundaries.',
    secondaryMotion: 'Small natural expression, touch, or moisture-highlight changes only.',
    materialEffect: 'Natural skin texture with a restrained skincare result, never an impossible or medical transformation.',
    pacing: 'Readable starting state, gradual progression, and a stable result hold.',
    openingDevice: 'Begin on the relevant skin state in the first frame.',
    transitionLanguage: 'Use one continuous human or skin-macro progression without a product reveal.',
    endingDevice: 'Hold the verified improved-looking result with natural texture intact.',
    audioCharacter: 'Quiet natural ambience or restrained music without narration.'
  };
  return {
    concept: `Create a product-free ingredient and formulation visualization using only these verified ingredients: ${facts.join('; ')}.`,
    visualHook: 'Open on a skincare formulation macro, texture, or active-inspired interaction; no product or packaging is visible.',
    creativeArchetype: 'Ingredient Education Macro',
    environment: 'Clean laboratory beauty macro space without labels, formulas, UI, branding, containers, or packages.',
    composition: 'The ingredient-inspired particles, formulation texture, or ingredient-to-skin interaction fills the frame.',
    cameraPath: 'Controlled macro glide or microscopic follow move.',
    framing: 'Extreme texture, droplet, foam, mist, cream, particle, or skin-layer detail.',
    lightingStyle: 'Clean diffuse laboratory beauty light with restrained translucent highlights.',
    primaryMotion: 'The verified-ingredient-inspired formulation interaction develops through observable physical stages.',
    secondaryMotion: 'Small droplets, ripples, diffusion, foam, or surface response supports the main action.',
    materialEffect: ingredientVisualGuidance[product.id],
    pacing: 'Simple educational progression with a stable final texture or interaction state.',
    openingDevice: 'Begin directly on the formulation or ingredient-inspired interaction.',
    transitionLanguage: 'Let physical diffusion, spreading, misting, foaming, or absorption carry the continuous shot.',
    endingDevice: 'Hold the settled formulation or beauty-science interaction with no text or product.',
    audioCharacter: 'Subtle liquid, foam, or clean laboratory ambience without narration.'
  };
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

function referencesFromPlan(plan: H3ReferencePlan, allowEmpty = false): H3GenerationBriefReference[] {
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

  if (mapped.length > 0 || allowEmpty) return mapped;
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
export function buildH3ReferenceContract(references: H3GenerationBriefReference[], mode: 'T2VA' | 'REF2VA' = 'REF2VA'): { mediaManifest: string; allowedReferenceLabels: H3AllowedReferenceLabels } {
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
    mode: mode.toLowerCase()
  }, null, 2);
  return { mediaManifest, allowedReferenceLabels };
}

export function buildH3ReferenceContext(brief: H3GenerationBrief): string {
  const referenceLines = brief.references.map((reference) => `${reference.pictureTag} — ${reference.role}: ${reference.description}`);
  const allowedLines = [
    'AUTHORITATIVE REFERENCE CONTRACT',
    `Allowed subject labels: ${brief.allowedReferenceLabels.subjects.join(', ') || 'none'}`,
    `Allowed picture labels: ${brief.allowedReferenceLabels.pictures.join(', ') || 'none'}`,
    isNoProductVideo(brief.contentType)
      ? 'This job has no visible product identity reference. Keep all people, skin, props, particles, and environments in ordinary prose.'
      : 'Only the selected product may receive a reusable subject label; people, hands, props, and environments remain ordinary prose unless separately declared by a connected reference.',
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
  const factType = contentType === 'Benefits' || contentType === 'Ingredients' ? contentType : null;
  const speech = speechScopedTypes.has(contentType) ? userSpeechRequest(brief) : undefined;
  const productIdeaFallback = 'Show the reference-faithful product clearly from the first frame in a practical front-facing skincare shot.';
  const effectiveBrief = contentType === 'Product' && !brief.videoIdea.trim() ? { ...brief, videoIdea: productIdeaFallback } : brief;
  const facts = factType ? verifiedContentFacts(product, factType) : [];
  const supportBRoll = isSupportBRoll(contentType);
  const noProduct = isNoProductVideo(contentType);
  const hookArchetype: HookArchetype | undefined = contentType === 'Hook' ? brief.hookArchetype ?? 'Problem Only' : undefined;
  const suppliedReferencePlan = input.references ?? brief.references;
  const referencePlan = noProduct ? supportBRollReferencePlan(suppliedReferencePlan) : suppliedReferencePlan;
  const references = referencesFromPlan(referencePlan, noProduct);
  const workflowMode = noProduct ? 'T2VA' : 'REF2VA';
  const referenceContract = buildH3ReferenceContract(references, workflowMode);
  const rawCreativeDirection = factType
    ? factDirection(product, factType, facts, brief, input.genome ?? brief.creativeGenome)
    : contentType === 'Hook' ? hookDirection(product, brief, hookArchetype!)
    : directionFromGenome(effectiveBrief, input.genome ?? brief.creativeGenome);
  const creativeDirection = speech?.mode === 'none'
    ? Object.fromEntries(Object.entries(rawCreativeDirection).map(([key, value]) => [key, withoutSpeechDirection(value)])) as unknown as H3CreativeDirection
    : rawCreativeDirection;
  const baseSpecialInstructions = factType
    ? `Only verified ${factType.toLowerCase()} for ${product.officialName}: ${facts.join('; ')}. The product is semantic fact guidance only. Ignore any user or creative direction that implies another claim, ingredient, package, product shot, product reveal, or readable text. Keep the footage entirely product-free.`
    : supportBRoll
    ? `${supportBRollGuardrails(product.id)}${brief.specialInstructions.trim() ? ` User direction: ${clean(brief.specialInstructions, '')}` : ''}`
    : contentType === 'Hook' ? hookArchetype === 'Problem → After'
      ? `Show a clear, believable progression from ${hookAppearanceThemes[product.id].problem} to ${hookAppearanceThemes[product.id].after}. Use the same person and setting. Keep sink and counter surfaces empty: no product, pump bottle, dispenser, toiletries, packaging, branding, or logo anywhere, including reflections.`
      : `${hookConcerns[product.id]} Keep the person and concern dominant through the entire shot. Keep sink and counter surfaces empty: no product, pump bottle, dispenser, toiletries, packaging, branding, or logo anywhere, including reflections.`
    : clean(brief.specialInstructions, 'Preserve product identity and keep the action visually legible.');
  const textOnlyStyleNote = !factType && referencePlan.styleReference.source === 'custom' && referencePlan.styleReference.description.trim()
    ? ` Text-only style direction (not a connected image): ${clean(referencePlan.styleReference.description, 'keep the requested look and lighting direction')}`
    : '';
  return {
    schemaVersion: 1,
    workflowMode,
    product: product.id,
    contentType,
    contentFamily: contentType,
    ...(hookArchetype ? { hookArchetype } : {}),
    duration: brief.duration,
    aspectRatio: brief.aspectRatio === 'Custom' ? '9:16' : brief.aspectRatio,
    language: brief.language,
    videoIdea: factType ? `Create a visual ${factType.toLowerCase()} story for ${product.officialName} using only: ${facts.join('; ')}.` : contentType === 'Hook' ? rawCreativeDirection.concept : clean(effectiveBrief.videoIdea, supportBRoll ? `Create reusable skincare support footage about ${supportBRollTheme(product.id)}.` : 'Create a polished product reveal.'),
    creativeDirection,
    productCorrections: noProduct ? [] : correctionForProduct(product, brief, input.genome ?? brief.creativeGenome),
    references,
    mediaManifest: referenceContract.mediaManifest,
    allowedReferenceLabels: referenceContract.allowedReferenceLabels,
    musicOnly: brief.musicOnly,
    captions: brief.captions,
    subtitles: brief.subtitles,
    sound: brief.sound,
    specialInstructions: `${baseSpecialInstructions}${textOnlyStyleNote}`,
    ...(speech ? { speechMode: speech.mode, speechRequest: factType ? '' : speech.request } : {})
  };
}

function line(label: string, value: string | number | boolean): string {
  return `${label}: ${typeof value === 'boolean' ? (value ? 'yes' : 'no') : value}`;
}

/** Stable, human-readable serialization sent to MiniMaxH3PromptEnhancer. */
export function serializeH3GenerationBrief(brief: H3GenerationBrief): string {
  const direction = brief.creativeDirection;
  const supportBRoll = isSupportBRoll(brief.contentType);
  const noProduct = isNoProductVideo(brief.contentType);
  const factType = brief.contentType === 'Benefits' || brief.contentType === 'Ingredients' ? brief.contentType : null;
  const textFreeContent = brief.contentType === 'Educational' || brief.contentType === 'Ingredient / Texture' || brief.contentType === 'Benefits' || brief.contentType === 'Ingredients' || brief.contentType === 'Hook' || brief.contentType === 'Product';
  const contentTypeContract = h3ContentTypeContract(getProduct(brief.product)!, brief.contentType, brief.hookArchetype);
  const workflowMode = noProduct ? 'T2VA' : 'REF2VA';
  const referenceLines = brief.references.map((reference) => `${reference.pictureTag} | ${reference.role} | ${reference.description}${reference.subjectTag ? ` | authoritative subject ${reference.subjectTag}` : ''}`);
  const correctionLines = brief.productCorrections.length > 0 ? brief.productCorrections : ['No additional product-specific correction is required.'];
  const audioAndTextLines = [
    line('Music only', brief.musicOnly),
    line('Captions', brief.captions),
    line('Subtitles', brief.subtitles),
    line('Sound direction', brief.sound),
    brief.speechMode === 'none'
      ? 'SPEECH MODE: NONE. The user did not request spoken audio. No dialogue, voiceover, narration, speaker IDs, <d> blocks, quoted speech, or invented spoken lines. Dialogue language is metadata only and does not authorize speech.'
      : brief.speechMode === 'visible-dialogue'
        ? 'SPEECH MODE: VISIBLE DIALOGUE. Keep the visible speaker on screen; never replace with voiceover or narration. Each <d> block needs the same stable (Sx) ID for that speaker and an explicit vocal action in the same sentence.'
        : brief.speechMode === 'voiceover'
          ? 'SPEECH MODE: VOICEOVER. Only the explicitly requested off-screen speech is authorized.'
          : brief.musicOnly ? 'No dialogue, voiceover, narration, creator speech, or other human speech.' : 'Human speech is permitted only when explicitly requested by the creative direction.',
    ...(brief.speechRequest ? [`User-authored speech direction: ${brief.speechRequest}`] : []),
    'Quotation marks denote literal source-authorized spoken or written words only. Never quote texture, ingredient, benefit, visual, or camera descriptions; soft fine foam, lightweight watery serum, hydrated skin appearance, and fine mist remain unquoted visual prose.',
    textFreeContent
      ? 'Do not generate captions or any other readable text in the H3 footage. If captions were requested, reserve them for a deterministic post-generation application overlay if available.'
      : brief.captions ? 'Captions may be generated only when they are explicitly requested by the final H3 direction.' : 'No generated captions or marketing text overlays.',
    textFreeContent
      ? 'Do not generate subtitles or speech transcription in the H3 footage. If subtitles were requested, reserve them for a deterministic post-generation application overlay if available.'
      : brief.subtitles ? 'Subtitles may be generated only when they are explicitly requested by the final H3 direction.' : 'No generated subtitles or speech transcription.',
    noProduct ? 'There must be no visible product packaging or product text.' : 'Visible product packaging is not a generated caption or subtitle.'
  ];
  return [
    `WORKFLOW MODE LOCK: ${workflowMode}.`,
    `Format the result as ${workflowMode}.`,
    'Do not switch generation modes.',
    '',
    'H3 GENERATION BRIEF',
    line('Workflow mode', `${workflowMode} (locked)`),
    line(noProduct ? 'Semantic theme source' : 'Product', brief.product),
    line('Content type', brief.contentType),
    ...(brief.hookArchetype ? [line('Internal Hook archetype', brief.hookArchetype)] : []),
    line('Target duration seconds', brief.duration),
    line('Target aspect ratio', brief.aspectRatio),
    line('Dialogue language', brief.language),
    '',
    H3_SINGLE_SHOT_TIMING_CONTRACT,
    brief.contentType === 'Hook'
      ? brief.hookArchetype === 'Problem → After'
        ? 'For T2VA, describe the problem, natural transition, and believable after state in one continuous shot. Keep the same person and setting, natural skin texture, and substantial time for both states; no product, packshot, or reference image.'
        : 'For T2VA production, describe the observable skin concern, human reaction, believable home setting, camera path, and lighting continuity in one continuous shot. Keep the face and problem prominent throughout; no product, packshot, or reference image.'
      : H3_DETAIL_CONTRACT,
    '',
    ...(contentTypeContract.length ? ['CONTENT TYPE CONTRACT', ...contentTypeContract, ''] : []),
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
    noProduct
      ? 'No product or brand subject is declared. People, skin, props, particles, and environments remain ordinary prose.'
      : 'Only the selected product may receive a reusable subject label; people, hands, props, and environments remain ordinary prose unless separately declared by a connected reference.',
    'Only the declared labels above may appear in the final prompt. Do not introduce any new subject or picture labels.',
    '',
    supportBRoll ? 'NON-PRODUCT SUPPORT B-ROLL CONTRACT' : brief.contentType === 'Hook' ? 'PRODUCT-FREE HUMAN HOOK CONTRACT' : factType ? `PRODUCT-FREE VERIFIED ${factType.toUpperCase()} AUTHORITY` : 'PRODUCT / REFERENCE AUTHORITY',
    noProduct ? 'The selected product is metadata for the skin-concern theme only; it must not appear visually.' : 'Reference pixels own the exact silhouette, proportions, cap or lid shape, printed front design, and surface appearance.',
    noProduct ? 'Do not show a product, packaging, packshot, bottle, tube, jar, box, label, PROYA branding, logo, or fake product text.' : 'Qwen owns the scene, action, lighting, camera, pacing, sound, and H3 syntax.',
    supportBRoll ? 'Create reusable human/lifestyle, skin beauty, science-animation, or abstract transition footage matching the selected archetype.' : brief.contentType === 'Hook' ? 'Create a relatable human opening around the visible skin concern. Keep all product and packaging out of the entire shot, including the background.' : factType ? `Use only the authoritative verified ${factType.toLowerCase()} listed in this brief. Show ${factType === 'Benefits' ? 'the visible result or experience' : 'ingredient, formulation, texture, or beauty-science interaction'} without any product or packaging.` : 'Preserve <Subject 1> exactly from <Picture 1>; use only the short product-specific correction below and do not reconstruct package geometry unnecessarily.',
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
