import type {
  CreativeFingerprint,
  CreativeDiversityDiagnostics,
  CreativeDiversityFallbackReason,
  CreativeGenome,
  CreativeGenomeAxis,
  CreativePenaltySource,
  CreativeVariety,
  H3ContentType,
  H3GenerationStatus,
  H3PromptRecord,
  Product,
  ProductId
} from './types';
import { h3ContentTypes, legacyH3ContentTypes } from './types';
import { getProduct } from './data';

/**
 * The diversity engine is intentionally deterministic. A seed changes which
 * compatible direction wins; it never changes product truth or invents a
 * product property.
 */
export const CREATIVE_DIVERSITY_SCHEMA_VERSION = 1;
export const DEFAULT_CREATIVE_SEED = 0x5eed_c0de;

export const creativeGenomeAxisWeights: Readonly<Record<CreativeGenomeAxis, number>> = {
  visualHook: 2.2,
  creativeArchetype: 2.2,
  environment: 1.35,
  composition: 1.15,
  cameraPath: 1.35,
  framing: 0.9,
  lightingStyle: 1.1,
  primaryMotion: 1.35,
  secondaryMotion: 0.8,
  materialEffect: 1.1,
  pacing: 0.65,
  openingDevice: 0.8,
  transitionLanguage: 0.75,
  endingDevice: 0.65,
  audioCharacter: 0.45
};

/** Dimensions that count when deciding whether two concepts are meaningfully different. */
export const majorCreativeDimensions: readonly CreativeGenomeAxis[] = [
  'visualHook',
  'creativeArchetype',
  'environment',
  'composition',
  'cameraPath',
  'framing',
  'lightingStyle',
  'primaryMotion',
  'materialEffect',
  'pacing',
  'openingDevice',
  'transitionLanguage',
  'endingDevice'
];

/**
 * Compatibility is a constraint on how a selected plan is realized, not a
 * diversity axis. The planner keeps its deterministic candidate/history
 * behavior; Ref2VA can use these rules to repair a conflicting execution
 * choice without changing the stored CreativeGenome.
 */
export const creativeGenomeCompatibilityRules = [
  {
    id: 'stationary-front-facing-orbit',
    description: 'A stationary front-facing product cannot receive a medium or large orbit that requires a changing product view.'
  },
  {
    id: 'upright-overhead-label-read',
    description: 'An upright product cannot be shown in a true top-down or flat-lay opening while also requiring a normal front-label read.'
  },
  {
    id: 'camera-destination-direction',
    description: 'The camera direction must move toward the destination chamber or platform rather than away from it.'
  }
] as const;

export type CreativeGenomeCompatibilityRuleId = (typeof creativeGenomeCompatibilityRules)[number]['id'];

export interface CreativeGenomeCompatibilityIssue {
  rule: CreativeGenomeCompatibilityRuleId;
  fields: CreativeGenomeAxis[];
  message: string;
}

export interface CreativeGenomeCompatibilityContext {
  /** Product-bearing Ref2VA scenes default to a locked front-facing view. */
  productOrientationLocked?: boolean;
}

export interface CreativeDirection extends Omit<CreativeGenome, 'schemaVersion' | 'contentFamily'> {
  id: string;
  variants?: readonly CreativeDirectionVariant[];
}

export type CreativeDirectionVariant = Partial<Omit<CreativeDirection, 'id' | 'variants'>>;

export interface CreativeFamilyGrammar {
  contentFamily: H3ContentType;
  description: string;
  directions: readonly CreativeDirection[];
}

/** Scheduler-friendly product input; callers may pass an already resolved product or its stable ID. */
export type CreativeProductInput = Product | ProductId;

export interface CreativeUserOverrides {
  axes: Partial<Record<CreativeGenomeAxis, string>>;
  fields: CreativeGenomeAxis[];
  sourcePhrases: string[];
  conflicts?: CreativeConstraintConflict[];
}

export interface CreativeConstraintConflict {
  axis: CreativeGenomeAxis;
  values: string[];
  sourcePhrases: string[];
}

/**
 * A read-only snapshot of the facts the planner is allowed to carry forward.
 * It is intentionally not embedded in CreativeGenome or render prose.
 */
export interface FixedProductTruth {
  product: ProductId;
  officialName: string;
  shortName: string;
  size: string;
  role: string;
  referencePath: string;
  referenceImagePaths: string[];
  packagingDescription: string;
  physicalIdentity: Product['physicalIdentity'];
  verifiedIngredients: string[];
  verifiedClaims: string[];
  safeCopy: string[];
  packagingRestrictions: string[];
  safetyConstraints: string[];
}

export function createFixedProductTruth(product: Product): FixedProductTruth {
  return {
    product: product.id,
    officialName: product.officialName,
    shortName: product.shortName,
    size: product.size,
    role: product.role,
    referencePath: product.imagePath,
    referenceImagePaths: [...new Set([product.imagePath, ...(product.referenceImagePaths ?? [])])],
    packagingDescription: product.packagingDescription,
    physicalIdentity: product.physicalIdentity,
    verifiedIngredients: [...product.ingredients],
    verifiedClaims: [...product.benefitTerritories],
    safeCopy: [...product.safeCopy],
    packagingRestrictions: [...product.packagingRestrictions],
    safetyConstraints: [...product.packagingRestrictions, ...product.physicalIdentity.forbiddenInterpretations]
  };
}

export interface CreativeHistoryEntry {
  id: string;
  product: ProductId;
  contentFamily: H3ContentType;
  genome: CreativeGenome;
  fingerprint?: CreativeFingerprint | null;
  conceptSummary?: string | null;
  createdAt: string;
  generationJobId?: string | null;
  generationStatus?: H3GenerationStatus;
}

export interface CreativeDiversityOptions {
  sameProductFamilyWindow: number;
  sameProductWindow: number;
  globalWindow: number;
  minimumMeaningfulDifferences: number;
  nearDuplicateSimilarity: number;
  maxRerolls: number;
  generationDecay: number;
  dayDecay: number;
  /** Minimum preferred novelty score. This is a preference, never a hard gate. */
  noveltyThreshold: number;
}

export const defaultCreativeDiversityOptions: CreativeDiversityOptions = {
  sameProductFamilyWindow: 24,
  sameProductWindow: 48,
  globalWindow: 96,
  minimumMeaningfulDifferences: 4,
  nearDuplicateSimilarity: 0.82,
  maxRerolls: 12,
  generationDecay: 0.86,
  dayDecay: 0.97,
  noveltyThreshold: 35
};

export interface CreativePlanInput {
  product: CreativeProductInput;
  contentFamily: H3ContentType;
  userIdea?: string;
  specialInstructions?: string;
  recentHistory?: readonly CreativeHistoryEntry[] | readonly H3PromptRecord[];
  variety?: CreativeVariety;
  seed?: number | string;
  generationJobId?: string;
  now?: Date;
  options?: Partial<CreativeDiversityOptions>;
}

export interface CreativeRejection {
  candidateSignature: string;
  creativeArchetype: string;
  visualHook: string;
  reason: string;
  againstGenerationId: string;
  similarity: number;
  meaningfulDifferenceCount: number;
}

export interface CreativeFingerprintComparison {
  similarity: number;
  differentAxes: CreativeGenomeAxis[];
  meaningfulDifferenceCount: number;
  visualHookChanged: boolean;
  creativeArchetypeChanged: boolean;
}

export interface CreativePlan {
  product: ProductId;
  productTruth: FixedProductTruth;
  contentFamily: H3ContentType;
  genome: CreativeGenome;
  fingerprint: CreativeFingerprint;
  conceptSummary: string;
  noveltyScore: number;
  creativeSeed: number;
  generationJobId: string | null;
  repetitionPenaltySources: CreativePenaltySource[];
  rejectedCandidates: CreativeRejection[];
  userOverrides: CreativeUserOverrides;
  diversityFallbackUsed: boolean;
  diversityFallbackReason: CreativeDiversityFallbackReason | null;
  rerollsUsed: number;
  noveltyThresholdMissed: boolean;
  diversityDiagnostics: CreativeDiversityDiagnostics;
}

export interface CreativeSimulationReport {
  product: ProductId;
  contentFamily: H3ContentType;
  count: number;
  seed: number;
  plans: CreativePlan[];
  distribution: Partial<Record<CreativeGenomeAxis, Record<string, number>>>;
  archetypeDistribution: Record<string, number>;
  cameraDistribution: Record<string, number>;
  environmentDistribution: Record<string, number>;
  consecutiveDifferenceCounts: number[];
  rejectedConcepts: CreativeRejection[];
}

/** A real contradiction in explicit user constraints; novelty exhaustion is not one. */
export class CreativeConstraintError extends Error {
  readonly code = 'CREATIVE_CONSTRAINT_CONTRADICTION';
  readonly conflicts: readonly CreativeConstraintConflict[];

  constructor(conflicts: readonly CreativeConstraintConflict[]) {
    const details = conflicts.map((conflict) => `${conflict.axis}: ${conflict.values.join(' vs ')}`).join('; ');
    super(`Contradictory hard creative constraints: ${details}. Resolve the conflicting instruction and try again.`);
    this.name = 'CreativeConstraintError';
    this.conflicts = conflicts;
  }
}

type GenomeChoiceFields = Omit<CreativeGenome, 'schemaVersion' | 'contentFamily'>;

type NormalizedGenomeValues = Record<CreativeGenomeAxis, string>;
const normalizedGenomeCache = new WeakMap<object, NormalizedGenomeValues>();

function normalizedGenomeValues(genome: CreativeGenome | CreativeFingerprint): NormalizedGenomeValues {
  const cached = normalizedGenomeCache.get(genome);
  if (cached) return cached;
  const values = {} as NormalizedGenomeValues;
  for (const axis of Object.keys(creativeGenomeAxisWeights) as CreativeGenomeAxis[]) values[axis] = normalizeText(genome[axis]);
  normalizedGenomeCache.set(genome, values);
  return values;
}

function normalizedAxisValue(genome: CreativeGenome | CreativeFingerprint, axis: CreativeGenomeAxis): string {
  return normalizedGenomeValues(genome)[axis];
}

function compatibilityText(genome: CreativeGenome): string {
  return [
    genome.visualHook,
    genome.environment,
    genome.composition,
    genome.cameraPath,
    genome.framing,
    genome.primaryMotion,
    genome.secondaryMotion,
    genome.materialEffect,
    genome.openingDevice,
    genome.transitionLanguage,
    genome.endingDevice
  ].join(' ').toLowerCase();
}

function orbitTargetIsEnvironmental(cameraPath: string): boolean {
  return /\b(?:environment|atmosphere|material(?:s)?|light source|set|shadow|sheet|frame|prop(?:s)?)\b/i.test(cameraPath);
}

function cameraOrbitConflictsWithLockedProduct(genome: CreativeGenome, productOrientationLocked: boolean): boolean {
  if (!productOrientationLocked) return false;
  const cameraPath = genome.cameraPath.toLowerCase();
  if (!/\b(?:orbit|orbital|circular|circle|arc)\b/.test(cameraPath)) return false;
  const productTarget = /\b(?:around|orbit)\s+(?:the\s+)?(?:product|package|hero|bottle|tube|jar|subject)\b/.test(cameraPath);
  if (productTarget) {
    const smallAmplitude = /\b(?:small|micro|minimal|tight|subtle)\b/.test(cameraPath);
    return !(smallAmplitude && !/\b(?:medium|large|broad|wide|full|complete|substantial|epic)\b/.test(cameraPath));
  }
  const sceneMaterials = `${genome.environment} ${genome.composition} ${genome.materialEffect} ${genome.primaryMotion}`.toLowerCase();
  if (orbitTargetIsEnvironmental(cameraPath) || /\b(?:liquid|water|foam|ripple|material(?:s)?|atmosphere|environment|light source|shadow|sheet|frame|prop(?:s)?)\b/.test(sceneMaterials)) return false;
  const smallAmplitude = /\b(?:small|micro|minimal|tight|subtle)\b/.test(cameraPath);
  if (smallAmplitude && !/\b(?:medium|large|broad|wide|full|complete|substantial|epic)\b/.test(cameraPath)) return false;
  return true;
}

function hasTrueOverheadOpening(genome: CreativeGenome): boolean {
  return /\b(?:flat[- ]lay|top[- ]down|true\s+overhead)\b/i.test([
    genome.composition,
    genome.framing,
    genome.openingDevice,
    genome.cameraPath
  ].join(' '));
}

function hasLockedFrontFacingProduct(genome: CreativeGenome, context: CreativeGenomeCompatibilityContext): boolean {
  if (context.productOrientationLocked === true) return true;
  const text = compatibilityText(genome);
  const facing = /\b(?:front[- ]facing|front face|front label|label read|readable)\b/.test(text);
  const stationary = /\b(?:stationary|unchanged|untouched|stable|fixed|locked|without moving|remains? physically)\b/.test(text);
  return facing && stationary;
}

function cameraDirection(cameraPath: string): 'up' | 'down' | 'other' {
  const text = cameraPath.toLowerCase();
  if (/\b(?:upward|upwards|rise|rises|rising|ascend|ascends|ascending|crane\s+up|climb|climbs)\b/.test(text)) return 'up';
  if (/\b(?:downward|downwards|descend|descends|descending|lower|lowers|crane\s+down|drop|drops)\b/.test(text)) return 'down';
  return 'other';
}

function hasDestination(text: string, direction: 'lower' | 'upper'): boolean {
  const expression = direction === 'lower'
    ? /\b(?:lower|bottom|below|base|ground[- ]level)\b[\s\w-]{0,24}\b(?:hero|product|chamber|platform|pool|stage|position|frame)\b/
    : /\b(?:upper|top|above|elevated|high)\b[\s\w-]{0,24}\b(?:hero|product|chamber|platform|pool|stage|position|frame)\b/;
  return expression.test(text);
}

/**
 * Reports conflicts in a genome's spatial language without altering it. The
 * Ref2VA realization layer owns any repair so selection and history remain
 * reproducible and the stored planning data remains authoritative.
 */
export function assessCreativeGenomeCompatibility(
  genome: CreativeGenome,
  context: CreativeGenomeCompatibilityContext = {}
): CreativeGenomeCompatibilityIssue[] {
  const issues: CreativeGenomeCompatibilityIssue[] = [];
  const productOrientationLocked = context.productOrientationLocked ?? hasLockedFrontFacingProduct(genome, context);
  const text = compatibilityText(genome);

  if (cameraOrbitConflictsWithLockedProduct(genome, productOrientationLocked)) {
    issues.push({
      rule: 'stationary-front-facing-orbit',
      fields: ['cameraPath', 'composition', 'framing', 'primaryMotion'],
      message: 'The locked front-facing product would change viewing sides during a medium or large product orbit.'
    });
  }

  const upright = /\b(?:upright|vertical|standing)\b/.test(text) || productOrientationLocked;
  const frontReadable = /\b(?:front[- ]facing|front face|front label|label|readable)\b/.test(text) || productOrientationLocked;
  if (hasTrueOverheadOpening(genome) && upright && frontReadable) {
    issues.push({
      rule: 'upright-overhead-label-read',
      fields: ['openingDevice', 'composition', 'framing', 'cameraPath'],
      message: 'A true overhead or flat-lay opening cannot show the upright product front face as a normal readable label.'
    });
  }

  const spatialText = [genome.environment, genome.composition, genome.openingDevice, genome.transitionLanguage, genome.endingDevice].join(' ').toLowerCase();
  const direction = cameraDirection(genome.cameraPath);
  if ((hasDestination(spatialText, 'lower') && direction === 'up') || (hasDestination(spatialText, 'upper') && direction === 'down')) {
    issues.push({
      rule: 'camera-destination-direction',
      fields: ['cameraPath', 'environment', 'composition'],
      message: 'The camera direction moves away from the chamber or position named as the destination.'
    });
  }

  return issues;
}

function defineDirection(id: string, values: GenomeChoiceFields, variants: readonly CreativeDirectionVariant[] = []): CreativeDirection {
  return { id, ...values, variants };
}

/*
 * Each direction is a compatible bundle, rather than a bag of independent
 * random axes. Product B-Roll deliberately has a wide visual language because
 * it is the family most likely to be generated repeatedly.
 */
const productBRollDirections: readonly CreativeDirection[] = [
  defineDirection('minimal-luxury', {
    creativeArchetype: 'Minimal Luxury',
    visualHook: 'a single amber reflection crosses a quiet hero in negative space',
    environment: 'ivory gallery cyclorama with one matte stone plinth',
    composition: 'asymmetric hero with generous negative space',
    cameraPath: 'slow lateral slider with a restrained parallax drift',
    framing: 'medium hero, product held off-center',
    lightingStyle: 'soft daylight gradient with one warm edge',
    primaryMotion: 'a narrow amber reflection travels across the scene',
    secondaryMotion: 'the background shadow lengthens almost imperceptibly',
    materialEffect: 'matte stone, silk paper, and a clean specular edge',
    pacing: 'measured slow build',
    openingDevice: 'begin on empty negative space before the reflection enters',
    transitionLanguage: 'the reflection reveals the product as it passes',
    endingDevice: 'quiet logo-facing hero hold',
    audioCharacter: 'restrained glassy pulse with a soft room tone'
  }, [
    { visualHook: 'a clean sun blade isolates the package from an ivory field', environment: 'cream gallery plinth under a high window', composition: 'low horizon with broad breathing room', cameraPath: 'locked-off frame while light performs the move', framing: 'wide three-quarter hero', lightingStyle: 'hard morning beam softened at the edges', primaryMotion: 'the sun blade sweeps from floor to shoulder', transitionLanguage: 'the light cut becomes the reveal', endingDevice: 'graphic still-life hold' },
    { visualHook: 'a black-to-cream gradient opens like a luxury curtain around the hero', environment: 'black velvet void fading into a cream sweep', composition: 'center-weighted silhouette with deliberate empty margins', cameraPath: 'slow vertical crane into the final frame', framing: 'full product with breathing room', lightingStyle: 'controlled two-tone gradient and fine rim light', primaryMotion: 'the gradient rolls behind the product without moving it', materialEffect: 'velvet shadow against a polished mineral surface', transitionLanguage: 'the tonal field opens to the unchanged package', endingDevice: 'precise front-facing lock' }
  ]),
  defineDirection('macro-texture', {
    creativeArchetype: 'Macro Texture',
    visualHook: 'macro droplets resolve through focus before the package comes clear',
    environment: 'wet glass macro stage with a dark citrus-toned backdrop',
    composition: 'extreme crop that moves from surface detail to product context',
    cameraPath: 'precise focus pull with a micro-dolly',
    framing: 'extreme close-up opening, tight product detail finish',
    lightingStyle: 'raking specular light with crisp droplet highlights',
    primaryMotion: 'condensation beads gather, separate, and slide across the foreground',
    secondaryMotion: 'a thin highlight migrates along the package edge',
    materialEffect: 'transparent water beads on glass, never a package material change',
    pacing: 'slow tactile suspense',
    openingDevice: 'open inside an abstract droplet before revealing scale',
    transitionLanguage: 'focus resolves the texture into the product silhouette',
    endingDevice: 'tight readable label hold',
    audioCharacter: 'intimate droplets and a low crystalline tone'
  }, [
    { visualHook: 'a soft-focus water bead becomes a sharp constellation of highlights', environment: 'clear acrylic plane over pale citrus paper', composition: 'diagonal texture field leading into the product', cameraPath: 'rack focus from foreground bead to three-quarter package', framing: 'macro-to-close transition', lightingStyle: 'cool white pin lights with a warm back rim', primaryMotion: 'beads roll down the acrylic in different speeds', materialEffect: 'clear acrylic, water, and a subtle paper grain', transitionLanguage: 'the last bead aligns with the package contour', endingDevice: 'clean three-quarter detail hold' },
    { visualHook: 'a veil of fine mist sharpens into the cap and shoulder through focus', environment: 'black glass macro table with a humid air pocket', composition: 'vertical crop built around a single contour', cameraPath: 'slow focus pull with almost no spatial travel', framing: 'close crop on shoulder and closure area', lightingStyle: 'single hard rim cutting through cool haze', primaryMotion: 'mist disperses as the contour resolves', materialEffect: 'haze and glass foreground, product remains unchanged', transitionLanguage: 'haze clears from abstract line to recognizable package', endingDevice: 'detail hold with a final glint' }
  ]),
  defineDirection('fluid-choreography', {
    creativeArchetype: 'Fluid Choreography',
    visualHook: 'a foam crescent sculpts itself around the product without touching the label',
    environment: 'shallow ivory water basin with a citrus-lit horizon',
    composition: 'product anchored at the edge of a circular fluid path',
    cameraPath: 'slow overhead arc that descends into a three-quarter view',
    framing: 'wide basin geometry resolving to a medium hero',
    lightingStyle: 'warm overhead glow with cool reflected fill',
    primaryMotion: 'a controlled foam crescent travels in a loop around the base',
    secondaryMotion: 'small ripples radiate outward and fade',
    materialEffect: 'airy foam, clean water, and soft reflective ceramic',
    pacing: 'balanced sculptural rhythm',
    openingDevice: 'open on a circular ripple with the product just outside frame',
    transitionLanguage: 'the foam arc completes the visual frame around the hero',
    endingDevice: 'fluid settles into a thin halo around a stable product',
    audioCharacter: 'tactile water ticks over a polished rhythmic bed'
  }, [
    { visualHook: 'a vertical water column rises and parts to reveal the hero', environment: 'deep cream basin with a dark orange back wall', composition: 'centered vertical axis with layered depth', cameraPath: 'controlled push through the falling water', framing: 'medium-wide reveal into a centered hero', lightingStyle: 'backlit translucent water with a citrus rim', primaryMotion: 'one water column rises, splits, and falls behind the package', materialEffect: 'transparent water column and ceramic basin', transitionLanguage: 'the falling curtain opens the final read', endingDevice: 'water settles behind the product', audioCharacter: 'clean splash accents with a bright tonal swell' },
    { visualHook: 'a ribbon of clear liquid traces an orbit and leaves the package untouched', environment: 'black reflective liquid stage with a warm horizon line', composition: 'off-center hero framed by one continuous orbit', cameraPath: 'lateral tracking synchronized to the orbit', framing: 'three-quarter medium shot with negative space', lightingStyle: 'thin warm rim against a cool black field', primaryMotion: 'a clear ribbon loops around the base and exits frame', secondaryMotion: 'micro ripples follow the ribbon path', materialEffect: 'reflective liquid surface and transparent fluid ribbon', transitionLanguage: 'the orbit completes then falls away to the label', endingDevice: 'minimal reflective hero hold', audioCharacter: 'smooth liquid sweep with sparse low percussion' }
  ]),
  defineDirection('architectural-geometric', {
    creativeArchetype: 'Architectural Geometry',
    visualHook: 'moving geometric shadow architecture builds a frame around the package',
    environment: 'sunlit acrylic blocks on a warm concrete set',
    composition: 'wide geometric planes creating a strong diagonal corridor',
    cameraPath: 'controlled lateral tracking parallel to the block faces',
    framing: 'wide establishing geometry into a medium product lock',
    lightingStyle: 'hard graphic shadows with precise orange bounce',
    primaryMotion: 'acrylic blocks slide in measured increments behind the product',
    secondaryMotion: 'shadow rectangles fold across the floor and recede',
    materialEffect: 'frosted acrylic, concrete, and crisp projected shadow',
    pacing: 'architectural measured rhythm',
    openingDevice: 'start on an empty grid of light and hard edges',
    transitionLanguage: 'each block movement adds one layer to the product frame',
    endingDevice: 'final geometric alignment creates a clean hero window',
    audioCharacter: 'dry modular clicks with a precise electronic bed'
  }, [
    { visualHook: 'stacked translucent planes unlock one by one to expose the hero', environment: 'pale orange architectural light box', composition: 'centered vanishing point with nested frames', cameraPath: 'straight controlled dolly through the nested planes', framing: 'wide corridor to medium centered product', lightingStyle: 'cool white plane light with orange seams', primaryMotion: 'three planes retract in sequence behind the package', materialEffect: 'translucent acrylic, brushed aluminum, and clean haze', transitionLanguage: 'the last retracting plane reveals the full silhouette', endingDevice: 'symmetrical architectural hold' },
    { visualHook: 'a tiled shadow grid travels sideways and briefly turns the hero into a graphic cutout', environment: 'black-and-cream grid room with an orange floor plane', composition: 'side profile space with product at a rule-of-thirds anchor', cameraPath: 'slow side-on tracking with no orbit', framing: 'wide graphic side composition', lightingStyle: 'hard venetian shadow grid with a warm edge', primaryMotion: 'the grid of light slides across the set', materialEffect: 'matte tile, black glass, and sharp shadow geometry', transitionLanguage: 'the moving grid dissolves into a readable product frame', endingDevice: 'shadow-free final hero hold' }
  ]),
  defineDirection('graphic-light-shadow', {
    creativeArchetype: 'Graphic Light and Shadow',
    visualHook: 'orange light bars cut across darkness and reveal the package in flashes',
    environment: 'black studio with a suspended orange light grid',
    composition: 'high-contrast silhouette with the product on a diagonal',
    cameraPath: 'slow diagonal slide with a single deliberate reframing',
    framing: 'tight medium hero with graphic negative space',
    lightingStyle: 'hard cut light, deep shadow, and saturated amber rim',
    primaryMotion: 'light bars travel across the set like a scanning sequence',
    secondaryMotion: 'a narrow reflection glides along the closure',
    materialEffect: 'black lacquer surface and crisp volumetric light',
    pacing: 'confident editorial beats',
    openingDevice: 'begin in near-black with one line of light',
    transitionLanguage: 'each light bar reveals another product plane',
    endingDevice: 'all bars align into a clean warm rim around the hero',
    audioCharacter: 'minimal pulse, soft electrical hum, and one final chime'
  }, [
    { visualHook: 'a rotating prism throws a moving orange window across the hero', environment: 'dark mirrored studio with a suspended prism', composition: 'product centered behind a shifting prism window', cameraPath: 'small three-quarter orbit around the light source, not the package', framing: 'medium centered hero', lightingStyle: 'prismatic amber caustics against a deep blue-black field', primaryMotion: 'the prism rotates and sweeps the color window across the set', materialEffect: 'mirror, crystal, and controlled light caustics', transitionLanguage: 'the last color window opens the label area', endingDevice: 'warm prism edge with stable packaging', audioCharacter: 'airy synth shimmer with restrained bass' },
    { visualHook: 'a thin slit of daylight widens from shadow to a precise product portrait', environment: 'charcoal room with a single sliding aperture', composition: 'vertical split with product crossing the light boundary', cameraPath: 'slow push toward the light boundary', framing: 'full-height portrait crop', lightingStyle: 'single hard daylight slit with soft ambient black', primaryMotion: 'the aperture widens by degrees across the package', materialEffect: 'charcoal matte wall and a satin floor reflection', transitionLanguage: 'the light boundary settles exactly on the front face', endingDevice: 'quiet light-box portrait hold' }
  ]),
  defineDirection('atmospheric-mist', {
    creativeArchetype: 'Atmospheric Mist',
    visualHook: 'a vertical mist veil parts in layers while the hero stays physically still',
    environment: 'cool white fog chamber with a distant citrus glow',
    composition: 'deep central corridor with product emerging from atmosphere',
    cameraPath: 'slow forward drift through the mist layers',
    framing: 'wide atmospheric opening into a medium hero',
    lightingStyle: 'diffused backlight with a warm halo and soft bloom',
    primaryMotion: 'mist curtains drift apart from the center outward',
    secondaryMotion: 'fine haze catches a moving shaft of light',
    materialEffect: 'volumetric haze, frosted glass, and matte floor',
    pacing: 'slow breath-like reveal',
    openingDevice: 'open in an abstract white field with no visible horizon',
    transitionLanguage: 'each mist layer reveals more context without changing the product',
    endingDevice: 'haze clears into a stable softly lit hero',
    audioCharacter: 'airy breath, soft sub tone, and distant shimmer'
  }, [
    { visualHook: 'a cool cloud rolls low across the floor and leaves a warm product island', environment: 'low fog over a pale stone platform', composition: 'low-angle island composition with open upper frame', cameraPath: 'low lateral glide parallel to the platform', framing: 'low medium hero with atmospheric foreground', lightingStyle: 'cool floor haze under a warm overhead pool', primaryMotion: 'the fog rolls around the platform and thins', materialEffect: 'low cloud, pale stone, and a warm reflective patch', transitionLanguage: 'the thinning fog sharpens the final silhouette', endingDevice: 'island-like hero hold' },
    { visualHook: 'fine vapor spirals upward and opens a clean column around the package', environment: 'minimal white vapor room with a dark ceiling', composition: 'vertical column framing the product from below', cameraPath: 'gentle upward crane following the vapor', framing: 'full product with vertical breathing room', lightingStyle: 'cool diffuse top light with a narrow amber rim', primaryMotion: 'vapor spirals upward then disperses above the cap', materialEffect: 'fine vapor and clean matte surroundings', transitionLanguage: 'the vapor column becomes a soft halo', endingDevice: 'vertical centered hold' }
  ]),
  defineDirection('fresh-wet-surface', {
    creativeArchetype: 'Fresh Wet Surface',
    visualHook: 'condensation races across a wet stone surface and stops before the readable hero',
    environment: 'freshly wet travertine slab with a pale citrus backdrop',
    composition: 'low tabletop composition with the product beyond a reflective foreground',
    cameraPath: 'slow tabletop push with shallow foreground parallax',
    framing: 'low medium hero with wet foreground detail',
    lightingStyle: 'bright post-rain daylight with a clean warm rim',
    primaryMotion: 'a sheet of water travels across the stone and breaks into beads',
    secondaryMotion: 'droplets tremble at the edge of the slab',
    materialEffect: 'wet stone, transparent water, and clean reflected sky',
    pacing: 'fresh balanced lift',
    openingDevice: 'start on a reflective wet texture before finding the product',
    transitionLanguage: 'the water line draws the eye from texture to product',
    endingDevice: 'fresh dry read with a few controlled droplets remaining',
    audioCharacter: 'bright water detail with a clean percussive tick'
  }, [
    { visualHook: 'a rain line breaks into tiny beads that frame the product from below', environment: 'dark slate ledge after rain with a light cream horizon', composition: 'product high in frame above a bead-filled foreground', cameraPath: 'slow rise from the ledge to the hero', framing: 'low-angle close hero', lightingStyle: 'soft overcast light with one golden break', primaryMotion: 'the rain line runs across slate and fragments into beads', materialEffect: 'slate, water beads, and a restrained reflective highlight', transitionLanguage: 'the bead line becomes an underline for the package', endingDevice: 'clean elevated hero hold' },
    { visualHook: 'a mirror-thin water sheet recedes to reveal an untouched product island', environment: 'white ceramic plane with a shallow water film', composition: 'centered island surrounded by a receding reflective field', cameraPath: 'overhead descent into a shallow three-quarter angle', framing: 'wide overhead to medium hero', lightingStyle: 'high-key white with a citrus reflection', primaryMotion: 'the water film retracts in a smooth ring', materialEffect: 'ceramic, transparent water film, and soft reflection', transitionLanguage: 'the receding ring defines the final product boundary', endingDevice: 'clean island tableau' }
  ]),
  defineDirection('scientific-clean', {
    creativeArchetype: 'Scientific Clean',
    visualHook: 'calibrated light sweeps through a clear lab field and resolves the hero with precision',
    environment: 'bright materials laboratory with clear glass cylinders',
    composition: 'orthographic-like grid with measured spacing and a single hero anchor',
    cameraPath: 'controlled overhead descent into a straight-on product view',
    framing: 'wide lab grid into a precise medium close-up',
    lightingStyle: 'cool clinical white with a measured amber calibration line',
    primaryMotion: 'a light scan passes across the lab plane and glass forms',
    secondaryMotion: 'tiny air bubbles rise inside background glass only',
    materialEffect: 'clear lab glass, brushed metal, and clean white acrylic',
    pacing: 'precise calm progression',
    openingDevice: 'open on a clean measurement grid without a product',
    transitionLanguage: 'the scan completes the grid and reveals the product position',
    endingDevice: 'calibrated front-facing hero with uncluttered white space',
    audioCharacter: 'quiet laboratory hum with precise glass taps'
  }, [
    { visualHook: 'an overhead calibration ring sweeps across a sterile field and leaves a sharp hero', environment: 'white lab table with transparent calibration discs', composition: 'top-down radial layout with the product at the center', cameraPath: 'fixed overhead camera with a rotating light scan', framing: 'orthographic full layout', lightingStyle: 'high-key white with a narrow amber scan line', primaryMotion: 'the calibration ring rotates across the table', materialEffect: 'clear discs, white acrylic, and a soft glass reflection', transitionLanguage: 'the final ring tightens around the product footprint', endingDevice: 'top-down measured hold' },
    { visualHook: 'glass columns rise in the background as a clean focus plane locks onto the hero', environment: 'cool translucent lab wall with modular glass columns', composition: 'product foregrounded against a rhythmic vertical grid', cameraPath: 'straight rack focus with minimal forward travel', framing: 'medium close hero against verticals', lightingStyle: 'cool edge light with one warm product-side reflection', primaryMotion: 'background glass columns elevate in staggered timing', materialEffect: 'transparent glass, white polymer, and a soft haze layer', transitionLanguage: 'the final column aligns with the product axis', endingDevice: 'sharp laboratory portrait' }
  ]),
  defineDirection('kinetic-commercial', {
    creativeArchetype: 'Kinetic Commercial',
    visualHook: 'fast diagonal light passes create a new product frame on every beat',
    environment: 'high-energy citrus set with angled reflective fins',
    composition: 'diagonal hero staging with layered foreground passes',
    cameraPath: 'energetic lateral track with two motivated speed ramps',
    framing: 'medium hero with punchy close detail accents',
    lightingStyle: 'bright commercial key with saturated orange streaks',
    primaryMotion: 'reflective fins sweep past in a clean rhythmic sequence',
    secondaryMotion: 'light streaks pulse across the floor and background',
    materialEffect: 'mirror fins, glossy acrylic, and controlled motion blur',
    pacing: 'fast confident cadence',
    openingDevice: 'start with a sharp diagonal streak crossing an empty set',
    transitionLanguage: 'each pass wipes into a new angle without losing geography',
    endingDevice: 'all motion clears for a crisp product lock',
    audioCharacter: 'tight commercial percussion with syncopated whooshes'
  }, [
    { visualHook: 'three bright passes snap into a triangular frame around the hero', environment: 'orange and white studio with rotating reflector blades', composition: 'triangular geometry with the product at the apex', cameraPath: 'fast controlled push-in with a final micro-lock', framing: 'medium-wide to tight hero', lightingStyle: 'high-key commercial light with bright edge streaks', primaryMotion: 'reflector blades rotate through three timed passes', materialEffect: 'satin reflector, glossy floor, and clean flare', transitionLanguage: 'the third pass closes the triangle around the package', endingDevice: 'tight product lock after the energy peak' },
    { visualHook: 'a diagonal ribbon of light races around the set and brakes at the hero', environment: 'deep orange gradient cyclorama with a polished floor', composition: 'off-center hero on a strong diagonal axis', cameraPath: 'lateral tracking move with a controlled brake', framing: 'wide diagonal composition into medium hero', lightingStyle: 'saturated orange sweep over a neutral key', primaryMotion: 'one light ribbon circles the environment and decelerates', materialEffect: 'polished floor, volumetric streak, and soft bloom', transitionLanguage: 'the braking ribbon becomes the final contour highlight', endingDevice: 'energetic but readable hold' }
  ]),
  defineDirection('abstract-material-world', {
    creativeArchetype: 'Abstract Material World',
    visualHook: 'translucent membranes fold into an impossible orange landscape around the hero',
    environment: 'surreal translucent orange material world with no visible horizon',
    composition: 'product as a small stable island inside layered abstract forms',
    cameraPath: 'slow floating orbit through the material layers',
    framing: 'wide surreal scale shot resolving to a medium hero',
    lightingStyle: 'internal amber glow with cool translucent shadows',
    primaryMotion: 'soft membranes fold and peel away in visible layers',
    secondaryMotion: 'fine particles drift between the layers',
    materialEffect: 'translucent film, soft silicone-like folds, and atmospheric particles',
    pacing: 'dreamlike deliberate drift',
    openingDevice: 'open inside an abstract translucent fold',
    transitionLanguage: 'the folds widen to reveal the unchanged package as an anchor',
    endingDevice: 'abstract layers freeze into a sculptural frame',
    audioCharacter: 'airy granular texture with a warm sustained note'
  }, [
    { visualHook: 'a soft orange paper canyon opens around the product like a miniature landscape', environment: 'folded paper canyon in a cream-and-orange void', composition: 'low product island surrounded by folded walls', cameraPath: 'slow forward expedition through the paper canyon', framing: 'low wide landscape to medium hero', lightingStyle: 'sunrise gradient with deep folded shadows', primaryMotion: 'paper planes unfold and create a path toward the hero', materialEffect: 'folded paper, soft dust, and matte mineral floor', transitionLanguage: 'the last plane folds flat behind the product', endingDevice: 'miniature landscape hold' },
    { visualHook: 'a cloud of amber threads braids itself into a luminous frame around the package', environment: 'dark void with suspended amber fibers', composition: 'centered product inside a slowly woven oval', cameraPath: 'gentle vertical drift with a small parallax arc', framing: 'medium centered hero with deep black space', lightingStyle: 'self-lit amber fibers with a quiet cool rim', primaryMotion: 'threads weave from opposite sides into a frame', materialEffect: 'glowing fibers, soft haze, and black depth', transitionLanguage: 'the braid tightens then stops around the silhouette', endingDevice: 'luminous woven frame hold' }
  ]),
  defineDirection('botanical-structure', {
    creativeArchetype: 'Botanical Structure',
    visualHook: 'dry translucent leaf ribs unfold into an elegant frame around the product',
    environment: 'sunlit botanical study with pale leaves and a warm stone surface',
    composition: 'product centered inside a natural radial structure',
    cameraPath: 'gentle overhead arc into a calm front-facing view',
    framing: 'wide botanical context to medium hero',
    lightingStyle: 'soft morning light with translucent leaf shadows',
    primaryMotion: 'leaf ribs unfurl outward in a measured radial sequence',
    secondaryMotion: 'small dust motes drift through the sunbeam',
    materialEffect: 'translucent leaf membrane, stone, and fine pollen-like dust',
    pacing: 'organic measured bloom',
    openingDevice: 'open on a close abstract leaf vein',
    transitionLanguage: 'the radial structure opens a clean product window',
    endingDevice: 'natural frame settles around a readable hero',
    audioCharacter: 'soft botanical rustle with a warm acoustic pulse'
  }, [
    { visualHook: 'a single translucent leaf shadow travels from background to foreground and frames the hero', environment: 'cream botanical studio with one sculptural leaf', composition: 'off-center still life with a long shadow path', cameraPath: 'locked-off still life with only shadow travel', framing: 'wide editorial still life', lightingStyle: 'hard low morning sun through a leaf', primaryMotion: 'the leaf shadow drifts across the floor and stops at the base', materialEffect: 'matte stone, translucent leaf, and crisp shadow', transitionLanguage: 'the shadow line becomes a visual underline', endingDevice: 'editorial still-life hold' },
    { visualHook: 'fine orange pollen-like particles spiral into a halo while the package remains untouched', environment: 'bright cream greenhouse haze with a warm backlight', composition: 'centered halo around a stable product island', cameraPath: 'slow circular drift around the atmosphere', framing: 'medium hero with airy upper space', lightingStyle: 'high-key greenhouse glow with amber particles', primaryMotion: 'fine particles spiral upward and form a loose halo', materialEffect: 'soft haze, controlled particles, and pale ceramic', transitionLanguage: 'the halo opens at the label axis', endingDevice: 'airy centered hold' }
  ])
];

const productCinematicAdDirections: readonly CreativeDirection[] = [
  defineDirection('cinematic-arrival', {
    creativeArchetype: 'Cinematic Arrival',
    visualHook: 'a distant horizon light travels forward until it lands on the hero',
    environment: 'large-scale dawn landscape with a polished platform',
    composition: 'wide horizon establishing frame that compresses into a product portrait',
    cameraPath: 'slow forward dolly with a motivated rise',
    framing: 'epic wide opening to a close hero',
    lightingStyle: 'sunrise gradient with a controlled citrus flare',
    primaryMotion: 'the horizon glow advances across the platform',
    secondaryMotion: 'fine atmospheric dust catches the advancing light',
    materialEffect: 'polished platform, atmospheric depth, and soft lens flare',
    pacing: 'cinematic escalation and settle',
    openingDevice: 'begin on a nearly empty horizon',
    transitionLanguage: 'the traveling light pulls the viewer into the product close-up',
    endingDevice: 'hero holds at the peak of the sunrise',
    audioCharacter: 'wide cinematic swell with a restrained final resolve'
  }, [
    { visualHook: 'a sunset line crosses a vast set and turns a distant silhouette into the hero', environment: 'warm desert-like studio horizon with a reflective floor', composition: 'wide low horizon with product arriving from depth', cameraPath: 'long-lens push through atmospheric layers', framing: 'wide silhouette to medium hero', lightingStyle: 'low golden sun with orange atmospheric haze', primaryMotion: 'the silhouette advances as the horizon brightens', materialEffect: 'reflective floor, haze, and warm dust', transitionLanguage: 'the horizon line becomes the product rim light', endingDevice: 'low heroic hold' }
  ]),
  defineDirection('ritual-sunrise', {
    creativeArchetype: 'Ritual Sunrise',
    visualHook: 'morning light moves through a quiet ritual and ends in a product still life',
    environment: 'sunlit vanity with linen, ceramic, and a quiet window',
    composition: 'intimate layered tabletop with a clear hero center',
    cameraPath: 'gentle handheld-like drift with a final stillness',
    framing: 'close tactile details into a medium lifestyle hero',
    lightingStyle: 'natural morning light with warm reflected fill',
    primaryMotion: 'a linen fold opens to reveal the product position',
    secondaryMotion: 'window light shifts across ceramic and glass props',
    materialEffect: 'linen, ceramic, clear glass, and soft reflected light',
    pacing: 'warm intimate build',
    openingDevice: 'start on the first light touching the tabletop',
    transitionLanguage: 'each ritual detail leads to the product without a hard cut',
    endingDevice: 'lived-in but polished vanity hold',
    audioCharacter: 'quiet morning room tone with light tactile foley'
  }, [
    { visualHook: 'a folded towel and a rising sun patch create a calm ritual path to the hero', environment: 'bright bathroom shelf with stone and folded cotton', composition: 'diagonal ritual path ending at the package', cameraPath: 'slow slider following the path', framing: 'detail-led medium hero', lightingStyle: 'soft bathroom daylight with a warm reflected wall', primaryMotion: 'the light patch moves along the shelf toward the product', materialEffect: 'cotton, stone, glass, and gentle condensation', transitionLanguage: 'the final light patch lands behind the label', endingDevice: 'calm morning shelf hold' }
  ]),
  defineDirection('shadow-theatre', {
    creativeArchetype: 'Shadow Theatre',
    visualHook: 'a moving silhouette story plays across the set before the product enters the light',
    environment: 'minimal black stage with a translucent screen',
    composition: 'layered foreground screen, shadow plane, and product reveal zone',
    cameraPath: 'measured side track across the theatrical layers',
    framing: 'wide stage view into a sharp product portrait',
    lightingStyle: 'directional spotlight with sculptural hard shadows',
    primaryMotion: 'abstract silhouettes cross the screen and clear the hero zone',
    secondaryMotion: 'a warm edge grows behind the product position',
    materialEffect: 'translucent screen, black stage, and controlled haze',
    pacing: 'dramatic reveal with a quiet landing',
    openingDevice: 'begin with only a moving shadow on the screen',
    transitionLanguage: 'the shadow exits to reveal the real package',
    endingDevice: 'spotlight locks into a clean final portrait',
    audioCharacter: 'cinematic low pulse with soft theatrical impacts'
  }, [
    { visualHook: 'a paper-cut silhouette folds away to reveal the real hero in one continuous move', environment: 'warm amber stage with a paper-cut screen', composition: 'profile theatre with a deep product reveal pocket', cameraPath: 'slow orbit around the screen edge', framing: 'wide stage to close portrait', lightingStyle: 'warm spotlight with black negative space', primaryMotion: 'the paper-cut plane folds away in visible sections', materialEffect: 'paper cutout, matte floor, and soft haze', transitionLanguage: 'the folding screen becomes the final backdrop', endingDevice: 'theatrical product portrait' }
  ]),
  defineDirection('light-pilgrimage', {
    creativeArchetype: 'Light Pilgrimage',
    visualHook: 'one traveling beam crosses changing worlds and finds the product at the end',
    environment: 'sequence-like corridor of cream, orange, and black light fields',
    composition: 'product revealed from depth on a strong central path',
    cameraPath: 'continuous forward tracking through motivated light zones',
    framing: 'wide corridor to close product lock',
    lightingStyle: 'successive pools of light with a consistent warm thread',
    primaryMotion: 'the camera and beam travel together through each field',
    secondaryMotion: 'dust and soft reflections mark the beam path',
    materialEffect: 'acrylic partitions, haze, and reflective floor',
    pacing: 'purposeful cinematic journey',
    openingDevice: 'begin in darkness with a single moving beam',
    transitionLanguage: 'each light field motivates the next spatial move',
    endingDevice: 'beam stops as the product reaches the final pool',
    audioCharacter: 'ascending tonal journey with tactile transitions'
  }, [
    { visualHook: 'a warm line of light descends through suspended frames until it lands on the hero', environment: 'vertical gallery of floating frames', composition: 'central axis with nested depth', cameraPath: 'controlled upward crane through the frames', framing: 'wide vertical scale to medium hero', lightingStyle: 'single warm beam with cool ambient void', primaryMotion: 'frames lower in sequence as the beam descends', materialEffect: 'suspended acrylic, haze, and black depth', transitionLanguage: 'the last frame opens directly onto the product', endingDevice: 'vertical gallery lock' }
  ]),
  defineDirection('editorial-still-life', {
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
  }, [
    { visualHook: 'a single sculptural sheet curves into a magazine-cover frame around the hero', environment: 'cream paper studio with a black mineral slab', composition: 'strong negative space and one sweeping curve', cameraPath: 'slow three-quarter arc around the sheet', framing: 'wide still life into medium close', lightingStyle: 'softbox key with a crisp curve shadow', primaryMotion: 'the sheet rolls into its final sculptural curve', materialEffect: 'heavy paper, mineral, and controlled matte reflection', transitionLanguage: 'the curve settles as a graphic border', endingDevice: 'editorial cover hold' }
  ]),
  defineDirection('scale-shift', {
    creativeArchetype: 'Scale Shift',
    visualHook: 'a tiny texture world expands into a grand product landscape',
    environment: 'surreal citrus terrain built from layered mineral textures',
    composition: 'macro terrain foreground leading to a distant product hero',
    cameraPath: 'accelerated pull-back from macro detail to wide reveal',
    framing: 'extreme macro to epic wide product landscape',
    lightingStyle: 'low warm sun across ridged texture with a clean rim',
    primaryMotion: 'the camera pulls back as terrain lines organize around the product',
    secondaryMotion: 'fine grains slide down the ridges',
    materialEffect: 'mineral ridges, dry grains, and atmospheric depth',
    pacing: 'surprise expansion and settle',
    openingDevice: 'open so close to texture that scale is ambiguous',
    transitionLanguage: 'the pull-back reveals the product as the scale anchor',
    endingDevice: 'wide landscape hero with stable package read',
    audioCharacter: 'deep reveal swell with granular texture accents'
  }, [
    { visualHook: 'a microscopic orange crystal grows into a luminous platform beneath the hero', environment: 'abstract crystal field with a black horizon', composition: 'product elevated on a newly formed platform', cameraPath: 'macro pull-back followed by a slow rise', framing: 'macro crystal to wide platform hero', lightingStyle: 'internal orange crystal glow with cool rim', primaryMotion: 'crystal facets extend outward into a platform', materialEffect: 'translucent crystal, haze, and matte black depth', transitionLanguage: 'the final facet locks under the product position', endingDevice: 'elevated cinematic hold' }
  ]),
  defineDirection('material-metamorphosis', {
    creativeArchetype: 'Material Metamorphosis',
    visualHook: 'soft fabric, liquid light, and hard mineral planes trade places around the hero',
    environment: 'abstract studio with fabric, reflective liquid, and mineral planes',
    composition: 'product stable at center while materials orbit in layers',
    cameraPath: 'controlled orbit around the environmental materials',
    framing: 'medium product portrait with layered foreground',
    lightingStyle: 'warm key with changing material reflections',
    primaryMotion: 'fabric folds become reflected light, then settle into mineral planes',
    secondaryMotion: 'liquid reflections travel across the floor',
    materialEffect: 'fabric, reflective liquid light, and matte mineral',
    pacing: 'rich tactile progression',
    openingDevice: 'start inside a soft fabric fold',
    transitionLanguage: 'each material hands the frame to the next',
    endingDevice: 'all materials settle into a restrained hero environment',
    audioCharacter: 'textural foley layered with a warm cinematic pad'
  }, [
    { visualHook: 'a translucent orange film peels back to expose a mineral frame around the product', environment: 'warm translucent film chamber over dark stone', composition: 'centered hero behind a layered foreground veil', cameraPath: 'slow push through the peeling film', framing: 'tight veil opening into medium hero', lightingStyle: 'backlit amber film with cool stone fill', primaryMotion: 'the film peels in sections and reveals the stone plane', materialEffect: 'translucent film, dark stone, and soft reflected light', transitionLanguage: 'the last film edge becomes the product rim light', endingDevice: 'material contrast hold' }
  ]),
  defineDirection('color-field-story', {
    creativeArchetype: 'Color Field Story',
    visualHook: 'three color fields pass through one another and leave a warm final product world',
    environment: 'seamless color-field studio shifting from cream to orange to black',
    composition: 'product held on a clean central axis through changing fields',
    cameraPath: 'slow straight push with no perspective jump',
    framing: 'medium portrait with expansive color around it',
    lightingStyle: 'soft gradient fields with a precise product rim',
    primaryMotion: 'large color fields glide behind the stable product',
    secondaryMotion: 'a soft shadow maintains continuity across each field',
    materialEffect: 'matte color planes and a controlled satin floor reflection',
    pacing: 'bold but calm color progression',
    openingDevice: 'begin in a pale field with the hero barely separated',
    transitionLanguage: 'the color change carries the story without a cut',
    endingDevice: 'warm PROYA-aligned color field and clean hold',
    audioCharacter: 'minimal tonal color changes with a gentle final chord'
  }, [
    { visualHook: 'a cool blue shadow is gradually overtaken by a warm orange field around the hero', environment: 'dual-color studio split by a moving shadow', composition: 'product at the boundary between cool and warm', cameraPath: 'slow lateral move following the boundary', framing: 'wide color split into medium hero', lightingStyle: 'cool ambient field with a warm advancing key', primaryMotion: 'the warm field crosses the set and replaces the cool shadow', materialEffect: 'matte color field and a soft floor gradient', transitionLanguage: 'the boundary settles just behind the package', endingDevice: 'warm balanced portrait hold' }
  ])
];

const benefitResultDirections: readonly CreativeDirection[] = [
  defineDirection('benefit-human-before-after', { creativeArchetype: 'Human Before and After', visualHook: 'the same natural skin area begins visibly dull, dry, tired, or uncomfortable and changes gradually toward the verified improved-looking result', environment: 'simple bathroom or daylight vanity with empty surfaces and no skincare containers', composition: 'matched close-up of the same person and skin area throughout', cameraPath: 'steady close-up with one gentle move and no product reveal', framing: 'human skin and expression fill the frame', lightingStyle: 'consistent soft natural light that does not manufacture the result', primaryMotion: 'the visible skin appearance changes gradually and believably', secondaryMotion: 'a small expression relaxes as comfort or freshness becomes visible', materialEffect: 'real skin texture with a restrained moisture sheen', pacing: 'clear before, gradual transition, readable after', openingDevice: 'begin directly on the relevant skin concern', transitionLanguage: 'the same continuous human moment carries the appearance change', endingDevice: 'hold the verified improved-looking result without perfecting natural skin', audioCharacter: 'quiet natural ambience with a restrained tonal lift' }),
  defineDirection('benefit-skin-macro', { creativeArchetype: 'Skin Macro Result', visualHook: 'a realistic skin macro makes the verified texture, moisture, freshness, or radiance result visibly legible', environment: 'clean abstract skin-macro space with no packaging or interface', composition: 'one uninterrupted skin surface fills the frame', cameraPath: 'slow parallel macro glide', framing: 'extreme skin-surface close-up', lightingStyle: 'neutral diffuse beauty light held consistent across the change', primaryMotion: 'the surface becomes visibly fresher, smoother-looking, softer-looking, brighter-looking, or more hydrated-looking as authorized', secondaryMotion: 'natural micro-highlights settle evenly', materialEffect: 'realistic pores, fine texture, and subtle moisture', pacing: 'measured cause-to-result progression', openingDevice: 'open on the relevant visible concern', transitionLanguage: 'the appearance change travels continuously across the skin surface', endingDevice: 'calm natural-texture result hold', audioCharacter: 'soft tactile ambience' }),
  defineDirection('benefit-hydration-result', { creativeArchetype: 'Hydration Result', visualHook: 'dry-looking skin gains a clear moisture sheen and a softer more supple appearance', environment: 'minimal human skin close-up with no bathroom products or containers', composition: 'cheek or hand-skin detail remains the sole subject', cameraPath: 'gentle macro push-in', framing: 'tight moisture-result close-up', lightingStyle: 'soft neutral daylight with controlled highlights', primaryMotion: 'moisture visibly spreads and the dry-looking surface relaxes', secondaryMotion: 'fine texture remains natural while highlights become dewier', materialEffect: 'clear hydration and realistic skin, never plastic gloss', pacing: 'slow readable hydration progression', openingDevice: 'begin on the dry-looking texture', transitionLanguage: 'the moisture front motivates the visible result', endingDevice: 'supple comfortable-looking skin hold', audioCharacter: 'delicate water texture and quiet room tone' }),
  defineDirection('benefit-radiance-result', { creativeArchetype: 'Radiance Result', visualHook: 'a dull or uneven-looking complexion gradually becomes fresher, brighter-looking, and naturally radiant', environment: 'plain daylight portrait setting with no products, logos, or written props', composition: 'the same face and complexion remain centered for an honest comparison', cameraPath: 'locked portrait with a slight final push', framing: 'close beauty portrait that preserves natural skin detail', lightingStyle: 'stable daylight exposure; the complexion change must be visible beyond lighting', primaryMotion: 'tone appearance becomes more even-looking and radiance emerges gradually', secondaryMotion: 'the person makes a small natural turn into the final view', materialEffect: 'natural skin and a subtle healthy-looking sheen', pacing: 'restrained visible progression', openingDevice: 'begin on the dull or uneven-looking complexion', transitionLanguage: 'a continuous facial movement bridges the states without a cut', endingDevice: 'natural radiant-looking complexion hold', audioCharacter: 'clean gentle tonal rise' }),
  defineDirection('benefit-comfort-result', { creativeArchetype: 'Comfort Result', visualHook: 'a person touching tight or uncomfortable-looking skin gradually relaxes as the skin appears calm and comfortable', environment: 'quiet home mirror setting with an empty counter', composition: 'fingertips, expression, and the relevant skin area tell the result', cameraPath: 'steady intimate handheld close-up', framing: 'close human detail with no product in frame or reflection', lightingStyle: 'soft window light with realistic texture', primaryMotion: 'the gesture changes from checking discomfort to a light relaxed touch', secondaryMotion: 'expression and breathing settle naturally', materialEffect: 'real skin with restrained softness and no retouching effect', pacing: 'relatable problem-to-comfort beat', openingDevice: 'open on the discomfort-checking gesture', transitionLanguage: 'the same gesture softens as comfort becomes visible', endingDevice: 'relaxed comfortable-looking skin and expression hold', audioCharacter: 'quiet room tone and soft fabric movement' }),
  defineDirection('benefit-barrier-metaphor', { creativeArchetype: 'Barrier Support Metaphor', visualHook: 'a dry uneven skin-like surface becomes orderly and holds clear moisture beneath it', environment: 'minimal beauty-science macro space without text, diagrams, or packaging', composition: 'one simplified skin-like layer remains visually clear', cameraPath: 'slow shallow glide along the surface', framing: 'macro layer detail', lightingStyle: 'clean diffuse scientific beauty light', primaryMotion: 'gaps settle into a continuous calm surface while moisture remains contained', secondaryMotion: 'small clear hydration highlights stabilize', materialEffect: 'soft translucent biological forms and clear moisture', pacing: 'simple restrained metaphor', openingDevice: 'begin on the visibly uneven skin-like layer', transitionLanguage: 'physical alignment creates the supported-looking final state', endingDevice: 'calm continuous moisturized-looking layer hold', audioCharacter: 'soft assembling texture without narration' })
];

const ingredientEducationDirections: readonly CreativeDirection[] = [
  defineDirection('ingredient-macro-droplets', { creativeArchetype: 'Ingredient Macro', visualHook: 'one clear skincare droplet gathers and reveals suspended active-inspired particles with no symbols or labels', environment: 'clean laboratory beauty macro setup without products', composition: 'droplet and formulation texture fill the frame', cameraPath: 'locked macro with a precise focus pull', framing: 'extreme formulation close-up', lightingStyle: 'high-key translucent beauty light', primaryMotion: 'the droplet forms, elongates, and settles on clean glass or skin', secondaryMotion: 'tiny particles diffuse naturally inside the droplet', materialEffect: 'clear skincare liquid with realistic viscosity', pacing: 'slow educational texture study', openingDevice: 'begin inside the forming droplet', transitionLanguage: 'focus reveals the formulation interaction', endingDevice: 'calm settled droplet hold', audioCharacter: 'tiny liquid detail and clean ambience' }),
  defineDirection('ingredient-foam-formulation', { creativeArchetype: 'Foam Formulation', visualHook: 'dense fine skincare foam develops from creamy cleanser and water in macro detail', environment: 'clean laboratory sink-side macro with no packaging', composition: 'foam structure, water, and hands dominate the frame', cameraPath: 'controlled macro tracking move', framing: 'tight foam and bubble structure', lightingStyle: 'fresh diffuse laboratory light', primaryMotion: 'cream and water build into a fine dense lather', secondaryMotion: 'small bubbles expand and settle realistically', materialEffect: 'soft cosmetic foam and clear water, never food', pacing: 'clear formulation progression', openingDevice: 'open where creamy cleanser meets water', transitionLanguage: 'mixing action visibly builds the foam', endingDevice: 'stable fine-lather macro hold', audioCharacter: 'gentle water and foam foley' }),
  defineDirection('ingredient-mist-formulation', { creativeArchetype: 'Mist Formulation', visualHook: 'a fine watery skincare mist blooms through backlight and resolves into tiny clear droplets', environment: 'clean bright beauty-science space with no bottle or dispenser visible', composition: 'mist plume crosses a simple skin or glass background', cameraPath: 'static high-speed-style close-up', framing: 'macro mist and microdroplet detail', lightingStyle: 'soft backlight with no flare or text', primaryMotion: 'the fine mist travels, disperses, and lands as hydration droplets', secondaryMotion: 'microdroplets merge and settle naturally', materialEffect: 'clear watery formulation and realistic surface tension', pacing: 'fresh single-action ingredient study', openingDevice: 'begin just before mist enters the frame', transitionLanguage: 'the plume connects airborne texture to settled droplets', endingDevice: 'tiny clear droplets resting on the surface', audioCharacter: 'soft airy spray and quiet laboratory ambience' }),
  defineDirection('ingredient-cream-formulation', { creativeArchetype: 'Cream Formulation', visualHook: 'a silky skincare cream ribbon folds into a smooth macro swirl', environment: 'bright neutral formulation laboratory with no jar, tube, or branding', composition: 'cream body and surface structure fill the frame', cameraPath: 'slow shallow macro slide', framing: 'extreme cream-texture close-up', lightingStyle: 'broad soft light revealing density and gloss', primaryMotion: 'the cosmetic cream folds and settles under its own weight', secondaryMotion: 'one smooth ridge relaxes naturally', materialEffect: 'silky cosmetic cream, never frosting or food', pacing: 'calm tactile formulation study', openingDevice: 'open on the forming cream fold', transitionLanguage: 'the fold reveals viscosity and structure', endingDevice: 'clean settled cream swirl hold', audioCharacter: 'subtle tactile formulation sound' }),
  defineDirection('ingredient-active-particles', { creativeArchetype: 'Active Particle Interaction', visualHook: 'translucent active-inspired particles enter a clear hydration field and move toward a simplified skin surface', environment: 'minimal beauty-science macro world without formulas, labels, or interface', composition: 'one particle pathway makes the interaction legible', cameraPath: 'gentle microscopic follow move', framing: 'particle macro into skin-layer detail', lightingStyle: 'clean high-key illumination with restrained warm accents', primaryMotion: 'particles approach, diffuse, and settle through observable physical stages', secondaryMotion: 'the hydration field responds with subtle ripples', materialEffect: 'translucent particles, clear water, and soft skin-like layers', pacing: 'simple visual explanation', openingDevice: 'open close on one active-inspired particle', transitionLanguage: 'particle movement reveals the skin context', endingDevice: 'calm evenly dispersed interaction state', audioCharacter: 'soft scientific shimmer without narration' }),
  defineDirection('ingredient-skin-layer', { creativeArchetype: 'Skin Layer Visualization', visualHook: 'clear hydration and verified-ingredient-inspired particles travel through a simplified translucent skin layer', environment: 'clean biological beauty visualization without diagram text', composition: 'one readable layer pathway occupies the frame', cameraPath: 'smooth microscopic tracking move', framing: 'macro cross-section view', lightingStyle: 'soft clinical beauty light', primaryMotion: 'droplets and particles enter, spread, and settle through the layer', secondaryMotion: 'surface moisture highlights respond gently', materialEffect: 'clear water, translucent biological layers, and soft particles', pacing: 'stepwise educational progression', openingDevice: 'begin above the simplified surface', transitionLanguage: 'the ingredient path motivates the camera travel', endingDevice: 'balanced hydrated-looking layer state', audioCharacter: 'delicate water texture and soft pulse' }),
  defineDirection('ingredient-clean-lab', { creativeArchetype: 'Clean Lab Aesthetic', visualHook: 'a glass sample dish receives a precise skincare formulation droplet in pristine macro detail', environment: 'bright clean laboratory bench with anonymous glassware and no labels', composition: 'sample dish, droplet, and formulation texture form a sparse beauty still life', cameraPath: 'small controlled lateral macro slide', framing: 'close laboratory formulation study', lightingStyle: 'clean daylight with restrained warm accents', primaryMotion: 'one droplet enters the dish and spreads into a thin formulation layer', secondaryMotion: 'a soft glass reflection shifts with the camera', materialEffect: 'laboratory glass and skincare liquid or cream appropriate to the selected product', pacing: 'precise calm study', openingDevice: 'open on the empty sample dish and incoming droplet', transitionLanguage: 'the dispense action reveals formulation behavior', endingDevice: 'settled sample texture hold', audioCharacter: 'quiet glass and liquid detail' }),
  defineDirection('ingredient-antioxidant-metaphor', { creativeArchetype: 'Antioxidant Particle Metaphor', visualHook: 'bright active-inspired particles calmly intercept harsh reactive-looking particles before a skin-like surface', environment: 'clean microscopic beauty-science space without formulas or written science', composition: 'two particle paths make the interaction immediately visible', cameraPath: 'smooth tracking alongside the particle paths', framing: 'macro particle interaction', lightingStyle: 'luminous white with restrained citrus accents', primaryMotion: 'the active-inspired particles meet and disperse the visual disturbance', secondaryMotion: 'the skin-like surface remains calm and intact', materialEffect: 'translucent particles, soft light, and simplified skin texture', pacing: 'legible restrained metaphor', openingDevice: 'start on the approaching visual disturbance', transitionLanguage: 'the interaction resolves into calm dispersed light', endingDevice: 'undisturbed skin-like surface hold', audioCharacter: 'clean microscopic pulse without narration' })
];

const familyGrammars: Record<H3ContentType, CreativeFamilyGrammar> = {
  Hook: { contentFamily: 'Hook', description: 'Attention-grabbing, relatable skincare opening in the first one to three seconds.', directions: productBRollDirections },
  Benefits: { contentFamily: 'Benefits', description: 'Product-free human skin results and restrained visual metaphors using only the selected product’s verified benefits.', directions: benefitResultDirections },
  Ingredients: { contentFamily: 'Ingredients', description: 'Product-free ingredient education, formulation macro, texture, and beauty-science visualization using only verified ingredients.', directions: ingredientEducationDirections },
  Product: { contentFamily: 'Product', description: 'Clear, practical, reference-faithful product footage from the first frame.', directions: [
    defineDirection('product-clean-hero', { creativeArchetype: 'Clean Hero', visualHook: 'the front-facing product is already clear in the first frame', environment: 'simple cream studio tabletop or believable bathroom counter', composition: 'product is the focal point, occupying about half the frame height', cameraPath: 'static tripod or very gentle push-in', framing: 'medium front-facing product portrait', lightingStyle: 'soft even skincare light', primaryMotion: 'product remains still while the camera moves slightly', secondaryMotion: 'small natural reflection only', materialEffect: 'realistic package gloss and clean countertop', pacing: 'direct and edit-friendly', openingDevice: 'begin with the whole front-facing product visible', transitionLanguage: 'one continuous restrained product shot', endingDevice: 'stable front-facing product hold', audioCharacter: 'quiet natural room tone' }),
    defineDirection('product-vanity-shelf', { creativeArchetype: 'Vanity or Shelf', visualHook: 'the front-facing product is already visible on a real skincare vanity', environment: 'clean bathroom vanity or tidy skincare shelf', composition: 'product clearly separated from neutral everyday props', cameraPath: 'short lateral slide or subtle handheld drift', framing: 'medium close-up with the product prominent', lightingStyle: 'soft natural daylight', primaryMotion: 'camera moves gently while the product remains still', secondaryMotion: 'minor natural background movement', materialEffect: 'ceramic, cotton towel, and realistic packaging', pacing: 'practical social-commerce insert', openingDevice: 'begin with the product plainly visible on the vanity or shelf', transitionLanguage: 'continuous small camera move', endingDevice: 'front-readable product hold', audioCharacter: 'quiet bathroom ambience' }),
    defineDirection('product-macro-detail', { creativeArchetype: 'Macro Packaging Detail', visualHook: 'the verified dropper, cap, or front package detail is visible immediately', environment: 'clean skincare macro setup', composition: 'one authentic packaging detail fills the close frame', cameraPath: 'locked macro with a very small slide', framing: 'tight packaging detail without losing product identity', lightingStyle: 'soft light that keeps the package print legible', primaryMotion: 'one small focus adjustment on the existing detail', secondaryMotion: 'none', materialEffect: 'reference-accurate package surface', pacing: 'short edit-ready detail', openingDevice: 'begin already framed on the real package detail', transitionLanguage: 'continuous detail shot with no reveal', endingDevice: 'steady detail hold', audioCharacter: 'subtle handling sound' }),
    defineDirection('product-usage-dispensing', { creativeArchetype: 'Usage or Dispensing', visualHook: 'the front-facing product and its dispenser are visible from the start', environment: 'natural sink-side or vanity setting', composition: 'product and hand remain clear in a close skincare frame', cameraPath: 'stable tripod close-up', framing: 'close product and dropper or texture view', lightingStyle: 'soft daylight', primaryMotion: 'one natural product-specific dispensing or application action', secondaryMotion: 'clear serum texture settles naturally when shown', materialEffect: 'real packaging, natural skin, and verified product texture', pacing: 'simple practical demonstration', openingDevice: 'begin with product already visible beside the hand', transitionLanguage: 'the usage action carries one continuous shot', endingDevice: 'front-readable product and texture hold', audioCharacter: 'gentle dispensing foley' }),
    defineDirection('product-top-down', { creativeArchetype: 'Top-Down Product', visualHook: 'the entire reference-faithful product is already visible in a clean flat lay', environment: 'light bathroom counter with one neutral towel or tray', composition: 'product dominates an uncluttered top-down arrangement', cameraPath: 'locked overhead tripod or tiny lateral slide', framing: 'full product with safe margins', lightingStyle: 'large soft daylight source', primaryMotion: 'product stays still as the camera moves minimally', secondaryMotion: 'none', materialEffect: 'clean stone, cotton, and real package finish', pacing: 'restrained edit-ready insert', openingDevice: 'begin on the complete product flat lay', transitionLanguage: 'continuous top-down product shot', endingDevice: 'stable full-product hold', audioCharacter: 'soft room tone' })
  ] },
  'CTA / End Card': {
    contentFamily: 'CTA / End Card',
    description: 'Local premium product end cards; the selected direction is metadata only and never sent to a model.',
    directions: productBRollDirections
  },
  'Product B-Roll': {
    contentFamily: 'Product B-Roll',
    description: 'Practical, clean social-commerce inserts with a visible, reference-faithful product, restrained camera movement, and natural skincare settings.',
    directions: [
      defineDirection('vanity-daylight', { creativeArchetype: 'Bathroom Vanity Daylight', visualHook: 'the product sits naturally beside a clean sink as soft window light moves across it', environment: 'believable bright bathroom vanity with ceramic, mirror, and folded towel', composition: 'simple off-center product placement with useful edit space', cameraPath: 'gentle short push-in from a stable tripod', framing: 'medium product context into a clean close-up', lightingStyle: 'natural daylight with soft bathroom fill', primaryMotion: 'a hand places the product down naturally and leaves frame', secondaryMotion: 'small water highlights move on the sink', materialEffect: 'clean ceramic, mirror glass, cotton, and a few realistic water droplets', pacing: 'restrained two-second insert rhythm', openingDevice: 'begin on the empty vanity position', transitionLanguage: 'the placement motivates the small push-in', endingDevice: 'stable front-readable product hold', audioCharacter: 'quiet room tone and a soft placement sound' }),
      defineDirection('skincare-shelf', { creativeArchetype: 'Skincare Shelf Insert', visualHook: 'a hand reaches to a tidy skincare shelf and selects the product', environment: 'realistic bathroom skincare shelf in soft morning light', composition: 'product clearly separated from a few unbranded neutral objects', cameraPath: 'controlled handheld move with minimal drift', framing: 'shelf-level medium close-up', lightingStyle: 'soft natural window light', primaryMotion: 'the product is picked up once at a readable pace', secondaryMotion: 'minor natural hand and sleeve movement', materialEffect: 'painted shelf, glass, and cotton towel', pacing: 'quick practical insert with a clean cut point', openingDevice: 'open with the product already visible on the shelf', transitionLanguage: 'the hand movement carries the frame', endingDevice: 'brief readable product-in-hand hold', audioCharacter: 'natural shelf and handling foley' }),
      defineDirection('countertop-slider', { creativeArchetype: 'Clean Countertop Slide', visualHook: 'the product rests on a clean countertop with an immediately readable front', environment: 'bright uncluttered skincare countertop', composition: 'simple product-first composition with negative space', cameraPath: 'small lateral slider move of only a few centimeters', framing: 'close product shot suitable for a one-to-three-second edit', lightingStyle: 'soft studio daylight without dramatic contrast', primaryMotion: 'the product remains still while the camera makes one restrained slide', secondaryMotion: 'a subtle natural reflection shifts on the counter', materialEffect: 'matte stone, soft reflection, and clean glass', pacing: 'calm and edit-friendly', openingDevice: 'start on a clear three-quarter product view', transitionLanguage: 'continuous short lateral motion', endingDevice: 'stable front package read', audioCharacter: 'minimal clean room tone' }),
      defineDirection('handheld-closeup', { creativeArchetype: 'Social Handheld Close-Up', visualHook: 'a natural hand-held close-up shows the product at believable human scale', environment: 'simple sink-side bathroom environment', composition: 'product centered loosely with phone-like breathing room', cameraPath: 'controlled handheld approach with tiny natural movement', framing: 'tight social-commerce product close-up', lightingStyle: 'honest diffuse daylight', primaryMotion: 'the hand turns the product only enough to settle the front toward camera', secondaryMotion: 'minor focus correction and natural wrist movement', materialEffect: 'natural skin, ceramic, and soft towel texture', pacing: 'direct and useful short-form insert', openingDevice: 'enter with the product already in hand', transitionLanguage: 'one natural reframe creates the detail shot', endingDevice: 'front-facing product hold', audioCharacter: 'subtle handling foley' }),
      defineDirection('top-down-counter', { creativeArchetype: 'Top-Down Counter Shot', visualHook: 'the product is placed into a clean top-down skincare arrangement', environment: 'light stone countertop with one towel and one simple tray', composition: 'uncluttered flat arrangement with the package silhouette fully visible', cameraPath: 'locked overhead tripod', framing: 'top-down close shot with crop-safe margins', lightingStyle: 'large soft source with gentle natural shadow', primaryMotion: 'a hand places the product once and withdraws', secondaryMotion: 'none beyond the soft settling shadow', materialEffect: 'stone, cotton, and ceramic', pacing: 'precise one-to-two-second insert', openingDevice: 'open on the receiving surface', transitionLanguage: 'the placement supplies the entire action', endingDevice: 'clean overhead hold', audioCharacter: 'soft placement tap' }),
      defineDirection('pump-detail', { creativeArchetype: 'Pump and Cap Detail', visualHook: 'a simple macro isolates the real cap, pump, or dropper detail from the reference product', environment: 'clean bright vanity detail setup', composition: 'package mechanism fills the frame without losing product identity', cameraPath: 'static macro with a small focus pull', framing: 'extreme packaging detail to close product context', lightingStyle: 'soft controlled light with realistic highlights', primaryMotion: 'a hand performs one natural cap, pump, or dropper action appropriate to the product', secondaryMotion: 'a restrained highlight tracks the movement', materialEffect: 'reference-accurate packaging surfaces and clean skin', pacing: 'clear functional detail', openingDevice: 'open already focused on the mechanism', transitionLanguage: 'focus shifts gently from mechanism to package', endingDevice: 'mechanism and product settle unchanged', audioCharacter: 'close tactile click or pump foley' }),
      defineDirection('macro-packaging', { creativeArchetype: 'Packaging Macro Insert', visualHook: 'a macro view travels across the real package finish and front design', environment: 'soft neutral tabletop studio', composition: 'tight crop keeps reference-visible package details dominant', cameraPath: 'very small parallel macro slide', framing: 'extreme close-up with shallow but usable focus', lightingStyle: 'broad softbox reflection without flare or light streaks', primaryMotion: 'camera movement reveals one packaging detail while the product stays still', secondaryMotion: 'soft reflection moves naturally across the finish', materialEffect: 'reference-accurate package finish on a neutral surface', pacing: 'slow enough to read within a short insert', openingDevice: 'start on a recognizable package contour', transitionLanguage: 'the slide resolves toward the front design', endingDevice: 'brief sharp detail hold', audioCharacter: 'quiet tactile texture' }),
      defineDirection('water-droplet-sink', { creativeArchetype: 'Sink-Side Water Detail', visualHook: 'a few clean water droplets catch daylight beside the naturally placed product', environment: 'simple clean sink or shower ledge', composition: 'product remains the readable anchor with droplets as secondary detail', cameraPath: 'tripod close-up with a gentle push-in', framing: 'close product and surface detail', lightingStyle: 'natural bathroom daylight with soft highlights', primaryMotion: 'small droplets slide across the surface without touching or altering the package', secondaryMotion: 'a quiet sink reflection shifts', materialEffect: 'clean water, ceramic, and reference-faithful packaging', pacing: 'fresh restrained insert', openingDevice: 'open on one droplet beside the product', transitionLanguage: 'focus moves from droplet to product', endingDevice: 'clean readable product hold', audioCharacter: 'subtle water detail and room tone' }),
      defineDirection('soft-studio', { creativeArchetype: 'Soft Studio Product Insert', visualHook: 'the product stands plainly on a light neutral surface in soft studio light', environment: 'minimal cream or white tabletop setup', composition: 'straightforward product framing with practical negative space', cameraPath: 'locked tripod or very gentle push-in', framing: 'medium close product shot', lightingStyle: 'soft even studio illumination with low contrast', primaryMotion: 'the product remains stationary and unchanged', secondaryMotion: 'only a slight natural shadow shift', materialEffect: 'matte neutral surface and accurate packaging finish', pacing: 'simple reusable insert', openingDevice: 'begin directly on the product', transitionLanguage: 'one restrained move preserves continuity', endingDevice: 'steady front-facing hold', audioCharacter: 'minimal neutral sound bed' }),
      defineDirection('natural-pickup', { creativeArchetype: 'Natural Pick-Up and Place-Down', visualHook: 'a hand naturally picks up the product from a vanity and returns it to the same spot', environment: 'lived-in but tidy morning bathroom', composition: 'human hand establishes scale while the product stays unobstructed', cameraPath: 'stable shoulder-level handheld close-up', framing: 'medium-close interaction shot', lightingStyle: 'soft morning daylight', primaryMotion: 'one believable pick-up or place-down action', secondaryMotion: 'small towel and sleeve movement', materialEffect: 'skin, cotton, ceramic, and accurate packaging', pacing: 'natural social-commerce timing', openingDevice: 'start with the product already present', transitionLanguage: 'the hand action creates obvious edit points', endingDevice: 'product upright and readable in context', audioCharacter: 'natural handling and bathroom ambience' }),
      defineDirection('mirror-side-static', { creativeArchetype: 'Mirror-Side Static Insert', visualHook: 'the product stands beside a clean mirror with a soft realistic reflection', environment: 'simple daylight bathroom mirror ledge', composition: 'front-readable product and partial reflection with open edit space', cameraPath: 'locked tripod with no orbit', framing: 'clean medium close-up', lightingStyle: 'soft side daylight with natural mirror fill', primaryMotion: 'the product remains still while a hand briefly straightens it', secondaryMotion: 'a faint reflected towel movement stays secondary', materialEffect: 'mirror glass, ceramic ledge, cotton, and accurate packaging', pacing: 'quiet one-to-three-second insert', openingDevice: 'begin on the product already in context', transitionLanguage: 'one small hand adjustment supplies the edit beat', endingDevice: 'stable product and reflection hold', audioCharacter: 'natural bathroom room tone' }),
      defineDirection('dispense-counter-detail', { creativeArchetype: 'Simple Dispensing Detail', visualHook: 'one appropriate skincare dose is dispensed beside the reference-faithful product', environment: 'bright clean sink-side demonstration surface', composition: 'dispensing action is clear while the real product stays visible at the edge', cameraPath: 'static close-up with a tiny focus shift', framing: 'functional macro insert', lightingStyle: 'soft daylight with low contrast', primaryMotion: 'one pump, dropper release, squeeze, or scoop appropriate to the selected product', secondaryMotion: 'the texture settles naturally on skin or a clean surface', materialEffect: 'realistic skincare texture, natural skin, and accurate packaging', pacing: 'short practical demonstration', openingDevice: 'start on the package mechanism and receiving surface', transitionLanguage: 'the single dispense action carries the shot', endingDevice: 'clean texture detail with product context', audioCharacter: 'close tactile dispensing foley' })
    ]
  },
  'Support B-Roll': {
    contentFamily: 'Support B-Roll',
    description: 'Reusable non-product beauty footage guided by the selected product theme without showing products, packaging, labels, or branding.',
    directions: [
      defineDirection('problem-hook', { creativeArchetype: 'Problem Hook', visualHook: 'a relatable skincare concern is immediately visible in a natural human moment', environment: 'a believable clean bathroom or bedroom mirror setting with no branded objects', composition: 'the person and concern area remain the visual focus with uncluttered negative space', cameraPath: 'a subtle handheld approach or restrained mirror-side push', framing: 'human close-up that reads clearly as reusable hook footage', lightingStyle: 'honest soft morning light with skin-friendly fill', primaryMotion: 'the person notices the concern and reacts through a small natural gesture', secondaryMotion: 'quiet room detail and reflected daylight move gently', materialEffect: 'natural skin, mirror glass, clean water, and soft fabric', pacing: 'quick relatable opening that settles cleanly', openingDevice: 'begin directly on the recognizable concern or reaction', transitionLanguage: 'the gesture creates a clean cutaway point without introducing a product', endingDevice: 'hold on a neutral thoughtful expression or clean concern detail', audioCharacter: 'natural room tone with restrained nonverbal sound' }),
      defineDirection('skin-beauty-close-up', { creativeArchetype: 'Skin Beauty Close-Up', visualHook: 'light glides across healthy-looking skin texture and catches a fresh hydrated glow', environment: 'minimal skin-beauty portrait space with no products or branded props', composition: 'cheek, eye area, or facial skin texture fills the frame with elegant negative space', cameraPath: 'slow macro slide with a precise focus pull across skin texture', framing: 'extreme beauty close-up suitable for a clean cutaway', lightingStyle: 'soft luminous beauty light with controlled warm highlights', primaryMotion: 'a gentle head turn changes how hydration and texture catch the light', secondaryMotion: 'fine hair and soft background highlights move subtly', materialEffect: 'natural skin texture, soft moisture sheen, and airy light', pacing: 'calm tactile progression', openingDevice: 'open on an abstract skin highlight before texture resolves', transitionLanguage: 'focus and light reveal the beauty detail continuously', endingDevice: 'clean luminous skin hold with room for an edit', audioCharacter: 'soft airy texture with subtle water-like accents' }),
      defineDirection('science-animation', { creativeArchetype: 'Science Animation', visualHook: 'luminous active particles enter a stylized skin-layer world and begin a clear visual journey', environment: 'abstract scientific skin-layer animation with no packaging, branding, or product shapes', composition: 'layered cross-section with one clear particle pathway and readable depth', cameraPath: 'smooth microscopic tracking move through the stylized layers', framing: 'macro scientific view that remains visually simple', lightingStyle: 'clean white light with restrained warm vitamin-inspired accents', primaryMotion: 'particles travel, diffuse, or organize through the layers in an observable sequence', secondaryMotion: 'soft cellular pulses and tiny suspended particles support the main pathway', materialEffect: 'translucent biological layers, clean light, and abstract particles', pacing: 'clear educational progression without text labels', openingDevice: 'begin close on one particle before the surrounding layers appear', transitionLanguage: 'the particle movement motivates travel from one layer to the next', endingDevice: 'settle on a calm balanced layer state without making a medical claim', audioCharacter: 'clean scientific pulse with delicate microscopic texture' }),
      defineDirection('aesthetic-transition', { creativeArchetype: 'Aesthetic Transition', visualHook: 'soft orange-white beauty light bends through a clean water ripple and fills the frame', environment: 'abstract cream, white, water, glass, and warm-light beauty space with no objects resembling packaging', composition: 'simple flowing forms create a full-frame transition plate', cameraPath: 'floating forward move through light, ripple, or translucent material', framing: 'abstract full-frame composition designed for flexible editing', lightingStyle: 'luminous white with restrained warm orange gradients', primaryMotion: 'one ripple, light sweep, or translucent veil crosses the frame continuously', secondaryMotion: 'small caustics and suspended highlights echo the main movement', materialEffect: 'clear water, soft glass distortion, satin light, and airy haze', pacing: 'smooth loop-friendly transition rhythm', openingDevice: 'begin on a clean visual field with motion entering from one edge', transitionLanguage: 'the moving material briefly fills the lens to create a natural edit point', endingDevice: 'resolve to a clean bright field or loopable ripple state', audioCharacter: 'soft liquid sweep with a light tonal shimmer' })
    ]
  },
  'Cinematic Product Ad': {
    contentFamily: 'Cinematic Product Ad',
    description: 'Narrative campaign films with a motivated journey, emotional escalation, and a deliberate final brand image.',
    directions: productCinematicAdDirections
  },
  'UGC Content': {
    contentFamily: 'UGC Content',
    description: 'Believable creator-led short-form executions with natural interaction and everyday spatial grammar.',
    directions: [
      defineDirection('creator-bathroom-check-in', { creativeArchetype: 'Creator Bathroom Check-In', visualHook: 'a casual morning check-in turns the product toward a window-lit bathroom mirror', environment: 'realistic bright bathroom vanity', composition: 'handheld off-center selfie-to-product framing', cameraPath: 'natural handheld move with one deliberate reframe', framing: 'medium creator frame to close product detail', lightingStyle: 'soft window daylight and practical bathroom fill', primaryMotion: 'creator hand brings the product into the mirror-side light', secondaryMotion: 'small natural hand and towel movement', materialEffect: 'ceramic, towel, glass, and believable room texture', pacing: 'conversational and quick', openingDevice: 'creator enters mid-thought with the product just out of frame', transitionLanguage: 'spoken gesture leads naturally to the product close-up', endingDevice: 'casual product-to-camera hold', audioCharacter: 'natural room tone with light creator speech' }, [{ visualHook: 'a quick mirror glance reveals the product in a believable morning routine', environment: 'small lived-in bathroom with a fogged mirror edge', composition: 'creator reflection on one side, product on the other', cameraPath: 'handheld mirror pan into a close product detail', framing: 'phone-like medium to close-up', lightingStyle: 'mixed window and warm vanity light', primaryMotion: 'the creator wipes a small mirror patch and lifts the product', materialEffect: 'glass condensation, ceramic, and soft fabric', transitionLanguage: 'the cleared mirror patch becomes the product window', endingDevice: 'friendly close-up hold' }]),
      defineDirection('creator-vanity-demo', { creativeArchetype: 'Creator Vanity Demo', visualHook: 'a hand-held product recommendation lands in a tight, honest vanity close-up', environment: 'lived-in bedroom vanity with cosmetics kept secondary', composition: 'natural desk-level framing with product entering from the edge', cameraPath: 'small handheld push-in and focus correction', framing: 'medium creator shot into close product detail', lightingStyle: 'soft practical lamp mixed with cool window fill', primaryMotion: 'creator picks up and rotates the package toward camera', secondaryMotion: 'hair, sleeve, and vanity reflections move naturally', materialEffect: 'wood, fabric, ceramic, and subtle mirror reflection', pacing: 'quick conversational beats', openingDevice: 'start with a spoken problem and an empty hand gesture', transitionLanguage: 'the gesture introduces the product at the exact moment of relevance', endingDevice: 'authentic recommendation hold', audioCharacter: 'clean spoken creator audio with light room tone' }),
      defineDirection('creator-texture-reaction', { creativeArchetype: 'Creator Texture Reaction', visualHook: 'a genuine reaction cuts from face to a macro product detail without losing the room', environment: 'bright home vanity with a clean counter', composition: 'face-to-hand visual rhythm with product close to lens', cameraPath: 'handheld rack focus between creator and product', framing: 'portrait close-up with a brief macro insert', lightingStyle: 'natural daylight with soft skin-friendly fill', primaryMotion: 'creator brings the product close, then gestures back to camera', secondaryMotion: 'subtle focus breathing and natural hand motion', materialEffect: 'clean counter, soft daylight, and shallow depth', pacing: 'natural quick reaction', openingDevice: 'open on the creator reaction before the product is shown', transitionLanguage: 'focus transfers from reaction to package detail', endingDevice: 'creator and product share the final frame', audioCharacter: 'natural speech with a small tactile product sound' }),
      defineDirection('creator-day-in-life', { creativeArchetype: 'Creator Day-in-the-Life', visualHook: 'the product appears as one believable beat inside a moving everyday routine', environment: 'sunlit bedroom-to-bathroom daily routine', composition: 'observational side framing with product crossing the foreground', cameraPath: 'lightly stabilized walk-and-follow movement', framing: 'medium lifestyle frame with close product insert', lightingStyle: 'natural mixed daylight that changes with the room', primaryMotion: 'creator carries the product from one routine station to another', secondaryMotion: 'background routine movement continues naturally', materialEffect: 'linen, tile, glass, and real room surfaces', pacing: 'unhurried but native to short-form video', openingDevice: 'begin mid-routine with a natural environmental action', transitionLanguage: 'the product appears as part of the routine rather than a reveal stunt', endingDevice: 'product left in use-position with a brief glance to camera', audioCharacter: 'natural room tone, footsteps, and optional speech' })
    ]
  },
  'Product Demo': {
    contentFamily: 'Product Demo',
    description: 'Instructional demonstrations that make one product action observable and useful.',
    directions: [
      defineDirection('demo-precision-dispense', { creativeArchetype: 'Precision Dispense', visualHook: 'one measured dispense lands cleanly in a controlled macro demonstration', environment: 'clean bathroom counter with a neutral tray', composition: 'overhead action zone with product and receiving surface aligned', cameraPath: 'fixed overhead with a small controlled descent', framing: 'overhead wide to tight action close-up', lightingStyle: 'bright softbox with a precise highlight on the action', primaryMotion: 'the product is positioned and one measured dispense is shown', secondaryMotion: 'small controlled reflection moves across the counter', materialEffect: 'ceramic tray, clear glass, and clean counter', pacing: 'clear instructional rhythm', openingDevice: 'open on the receiving surface and the product entering frame', transitionLanguage: 'the camera follows the action from setup to result', endingDevice: 'clean result hold with product readable', audioCharacter: 'tactile dispense sound with light instructional voice' }),
      defineDirection('demo-routine-sequence', { creativeArchetype: 'Routine Sequence', visualHook: 'three clean routine beats connect the product to a believable use moment', environment: 'bright vanity with a calm morning window', composition: 'repeating stations create a left-to-right action path', cameraPath: 'smooth lateral track across the routine stations', framing: 'medium product-and-hand frames with detail inserts', lightingStyle: 'consistent daylight across each station', primaryMotion: 'hand, product, and surface move through three observable steps', secondaryMotion: 'soft curtain light changes across the background', materialEffect: 'stone, towel, ceramic, and glass', pacing: 'balanced instructional progression', openingDevice: 'start on the first routine surface before product enters', transitionLanguage: 'each handoff motivates the next station', endingDevice: 'product returns to a tidy final position', audioCharacter: 'clean foley with a calm explanatory voice' }),
      defineDirection('demo-surface-reveal', { creativeArchetype: 'Surface Reveal Demo', visualHook: 'a controlled close-up shows the product action against a bright, legible surface', environment: 'high-key white demonstration table', composition: 'product and action occupy opposite thirds with clear negative space', cameraPath: 'slow push-in that stays parallel to the demonstration plane', framing: 'medium close-up with a precise action crop', lightingStyle: 'clinical high-key light with soft shadow control', primaryMotion: 'the requested product action progresses across the surface', secondaryMotion: 'a measured highlight tracks the motion', materialEffect: 'white acrylic, clear vessel, and soft shadow', pacing: 'deliberate and legible', openingDevice: 'open on the empty surface and tool position', transitionLanguage: 'the action creates a visible before-to-after path', endingDevice: 'stable product and result hold', audioCharacter: 'clean instructional foley and optional narration' }),
      defineDirection('demo-human-scale', { creativeArchetype: 'Human-Scale Demonstration', visualHook: 'a hand and product share the frame so scale and action remain immediately understandable', environment: 'warm neutral bathroom shelf', composition: 'human hand establishes scale beside an upright product', cameraPath: 'gentle shoulder-level slide with a close action insert', framing: 'human-scale medium shot to close detail', lightingStyle: 'soft warm daylight with natural fill', primaryMotion: 'the hand performs the requested action at a readable pace', secondaryMotion: 'background towel and light move subtly', materialEffect: 'wood, ceramic, soft cotton, and glass', pacing: 'calm practical instruction', openingDevice: 'begin with the hand reaching into the shelf', transitionLanguage: 'hand motion guides the viewer through the action', endingDevice: 'product returned upright in context', audioCharacter: 'close tactile foley with concise voice guidance' })
    ]
  },
  'Product Transformation': {
    contentFamily: 'Product Transformation',
    description: 'Cause-and-effect transformation films where materials, structures, or spaces visibly change into a product-led final state.',
    directions: [
      defineDirection('mechanical-assembly', { creativeArchetype: 'Mechanical Assembly', visualHook: 'separate structural parts unlock, fold, and align into a product silhouette', environment: 'monumental mechanical chamber with warm industrial light', composition: 'wide machine geometry with a central transformation axis', cameraPath: 'cinematic forward dolly with a controlled arc', framing: 'epic wide to exact final hero', lightingStyle: 'hard industrial shafts with warm citrus edge', primaryMotion: 'panels unlock, sections retract, and components align in sequence', secondaryMotion: 'dust and light respond to each mechanical step', materialEffect: 'metal, acrylic, shadow, and controlled atmosphere', pacing: 'escalating mechanical rhythm', openingDevice: 'open on an active structure before the product is recognizable', transitionLanguage: 'each mechanical cause visibly produces the next form', endingDevice: 'final seams close into a stable product hold', audioCharacter: 'detailed mechanical foley with cinematic music' }),
      defineDirection('liquid-to-form', { creativeArchetype: 'Liquid to Form', visualHook: 'a flowing liquid path gathers into a stable product-bearing form', environment: 'dark reflective basin under a warm horizon', composition: 'fluid path enters from depth and converges at the hero', cameraPath: 'low tracking move following the flow into the final form', framing: 'wide fluid landscape to close product silhouette', lightingStyle: 'low warm rim with cool reflective fill', primaryMotion: 'the fluid stream divides, gathers, and leaves a stable final form', secondaryMotion: 'ripples transmit the change through the basin', materialEffect: 'reflective liquid, glass, and soft vapor', pacing: 'smooth build with a clear convergence', openingDevice: 'start inside the moving fluid with scale unresolved', transitionLanguage: 'the flow narrows until the product becomes legible', endingDevice: 'fluid calms around the product', audioCharacter: 'liquid movement, low swell, and a clean final tone' }),
      defineDirection('architectural-collapse', { creativeArchetype: 'Architectural Collapse', visualHook: 'a clean architectural volume compresses in visible stages and reveals the hero', environment: 'bright geometric building interior with a deep horizon', composition: 'symmetrical architectural axis opening into a product space', cameraPath: 'steady central push with a precise final lock', framing: 'large architectural wide to medium hero', lightingStyle: 'graphic daylight with moving structural shadows', primaryMotion: 'floors compress, columns retract, and facades fold inward', secondaryMotion: 'light bands shift as the volume changes', materialEffect: 'concrete, glass, acrylic, and dust motes', pacing: 'monumental then precise', openingDevice: 'open on the complete structure before collapse begins', transitionLanguage: 'each compression step exposes another layer of the product destination', endingDevice: 'architecture settles behind the exact product', audioCharacter: 'deep structural impacts with controlled cinematic score' }),
      defineDirection('material-weave', { creativeArchetype: 'Material Weave', visualHook: 'threads, film, and light weave together until the product is the only stable anchor', environment: 'abstract fiber chamber with a cream-to-orange gradient', composition: 'central anchor inside converging material diagonals', cameraPath: 'floating orbit through the weaving materials', framing: 'medium-wide material world to close hero', lightingStyle: 'backlit fibers with a soft warm key', primaryMotion: 'threads cross, knot, and separate into an open frame', secondaryMotion: 'light particles follow the weave direction', materialEffect: 'fiber, translucent film, and atmospheric glow', pacing: 'rhythmic transformation', openingDevice: 'start on a single thread crossing the lens', transitionLanguage: 'the weave opens progressively around the product', endingDevice: 'woven frame settles without covering the package', audioCharacter: 'textural thread sounds with a rising tonal bed' })
    ]
  },
  'Educational': {
    contentFamily: 'Educational',
    description: 'Text-free visual skincare explanations using skin, hydration, barrier, cleansing, pigmentation, and ingredient-action metaphors that work without labels.',
    directions: [
      defineDirection('skin-brightening', { creativeArchetype: 'Visual Brightening', visualHook: 'a macro skin surface gradually changes from dull uneven light to a fresh even glow', environment: 'clean abstract skin macro world with no interface or text', composition: 'one continuous skin surface fills the frame', cameraPath: 'slow parallel macro glide', framing: 'extreme skin-surface close-up', lightingStyle: 'soft neutral light becoming gently brighter', primaryMotion: 'light and surface appearance improve gradually without a written comparison', secondaryMotion: 'tiny natural highlights become more even', materialEffect: 'realistic skin texture and soft moisture sheen', pacing: 'clear visual cause and effect', openingDevice: 'begin on the dull-looking surface', transitionLanguage: 'the visible change travels continuously across the surface', endingDevice: 'calm brighter-looking skin hold', audioCharacter: 'clean gentle tonal lift' }),
      defineDirection('hydration-entry', { creativeArchetype: 'Hydration Journey', visualHook: 'clear moisture droplets enter a dry-looking stylized skin surface and visibly soften it', environment: 'simplified translucent skin-layer world without labels', composition: 'one clear moisture path through readable layers', cameraPath: 'smooth microscopic tracking move', framing: 'macro cross-section view', lightingStyle: 'clean soft light with watery highlights', primaryMotion: 'droplets absorb and spread through the dry-looking layer', secondaryMotion: 'the surface becomes smoother and more supple', materialEffect: 'clear water, translucent skin layers, and soft cellular forms', pacing: 'simple stepwise visual explanation', openingDevice: 'open on one droplet above the dry surface', transitionLanguage: 'droplet movement motivates travel into the layer', endingDevice: 'balanced hydrated-looking layer state', audioCharacter: 'delicate water texture and soft pulse' }),
      defineDirection('barrier-metaphor', { creativeArchetype: 'Moisture Barrier Metaphor', visualHook: 'loose translucent skin-like tiles organize into a calm continuous protective surface', environment: 'minimal biological macro space with no symbols or wording', composition: 'layered surface viewed at a clear shallow angle', cameraPath: 'gentle push along the surface', framing: 'macro layer detail', lightingStyle: 'clean diffuse scientific light', primaryMotion: 'gaps close as the visual barrier becomes orderly and continuous', secondaryMotion: 'moisture remains visibly contained beneath the surface', materialEffect: 'soft translucent biological tiles and clear moisture', pacing: 'measured and understandable', openingDevice: 'begin on the visibly uneven barrier', transitionLanguage: 'each physical alignment supports the next', endingDevice: 'intact calm surface hold', audioCharacter: 'soft assembling textures' }),
      defineDirection('cleansing-pores', { creativeArchetype: 'Visual Cleansing', visualHook: 'water and soft cleansing foam lift visible oil-like debris from a simplified pore surface', environment: 'clean stylized skin macro environment without diagrams or labels', composition: 'one pore region remains the visual focus', cameraPath: 'controlled macro push-in', framing: 'close skin-surface cutaway', lightingStyle: 'bright clinical-soft illumination', primaryMotion: 'foam surrounds and carries debris away with water', secondaryMotion: 'the surface settles cleanly without becoming artificial', materialEffect: 'soft foam, clear water, realistic skin texture', pacing: 'direct cleansing progression', openingDevice: 'open on the visible debris at the pore surface', transitionLanguage: 'the foam movement explains the action visually', endingDevice: 'clean calm surface hold', audioCharacter: 'light foam and water foley' }),
      defineDirection('pigmentation-concept', { creativeArchetype: 'Dark-Spot Visual Concept', visualHook: 'clustered dark pigment-like particles within a stylized skin layer gradually disperse into a more even pattern', environment: 'abstract skin-layer macro with no medical labels', composition: 'particle cluster and surrounding layer share a simple frame', cameraPath: 'slow lateral macro track', framing: 'cross-section detail', lightingStyle: 'neutral clean light with warm skin tones', primaryMotion: 'the dense cluster separates and redistributes visually', secondaryMotion: 'the surface illumination becomes more even', materialEffect: 'translucent layers and soft pigment-like particles', pacing: 'clear restrained progression', openingDevice: 'begin on the concentrated particle cluster', transitionLanguage: 'particle dispersion carries the explanation', endingDevice: 'more even-looking visual state', audioCharacter: 'subtle particle shimmer' }),
      defineDirection('antioxidant-metaphor', { creativeArchetype: 'Antioxidant Visual Metaphor', visualHook: 'bright active-inspired particles calmly intercept harsh reactive particles before they reach a skin-like surface', environment: 'clean microscopic beauty-science space without formulas or writing', composition: 'two particle paths make the interaction immediately visible', cameraPath: 'smooth tracking alongside the particles', framing: 'macro particle interaction', lightingStyle: 'luminous white with restrained citrus accents', primaryMotion: 'active-inspired particles meet and neutralize the incoming visual disturbance', secondaryMotion: 'the skin-like surface remains calm', materialEffect: 'translucent particles, soft light, and a simplified skin surface', pacing: 'legible visual metaphor', openingDevice: 'start on the approaching reactive particles', transitionLanguage: 'the collision resolves into calm light', endingDevice: 'undisturbed surface hold', audioCharacter: 'clean microscopic pulse' }),
      defineDirection('ingredient-action', { creativeArchetype: 'Ingredient Action Visualization', visualHook: 'translucent active-inspired particles travel toward and interact with a simplified skin surface', environment: 'minimal beauty-science macro world with no text or interface', composition: 'one clear particle pathway leads into the skin surface', cameraPath: 'gentle microscopic follow move', framing: 'particle macro into skin-layer detail', lightingStyle: 'clean high-key light with warm citrus accents', primaryMotion: 'particles approach, diffuse, and settle through visible physical stages', secondaryMotion: 'soft moisture highlights respond at the surface', materialEffect: 'clear particles, water, and translucent biological layers', pacing: 'simple visual explanation', openingDevice: 'open close on one particle', transitionLanguage: 'particle movement reveals the surrounding skin context', endingDevice: 'calm balanced skin-layer state', audioCharacter: 'soft scientific shimmer without narration' })
    ]
  },
  'Ingredient / Texture': {
    contentFamily: 'Ingredient / Texture',
    description: 'Skincare-specific product textures, dispensing actions, and ingredient-inspired macro visuals; product presence is optional and generic luxury advertising is excluded.',
    directions: [
      defineDirection('serum-droplet', { creativeArchetype: 'Serum Droplet Macro', visualHook: 'one translucent skincare serum droplet gathers at a dropper tip and releases cleanly', environment: 'bright clean skincare macro setup', composition: 'dropper tip and serum bead fill the frame', cameraPath: 'static macro with a precise focus pull', framing: 'extreme droplet close-up', lightingStyle: 'soft high-key beauty light', primaryMotion: 'the serum bead forms, elongates, and drops onto clean skin or glass', secondaryMotion: 'a small glossy highlight moves through the droplet', materialEffect: 'clear colorless lightweight serum with realistic viscosity', pacing: 'slow tactile dispensing detail', openingDevice: 'begin on the forming bead', transitionLanguage: 'the release leads naturally to the receiving surface', endingDevice: 'droplet settles and begins to spread', audioCharacter: 'tiny liquid release and soft clean ambience' }),
      defineDirection('serum-spread', { creativeArchetype: 'Lightweight Serum Spread', visualHook: 'a translucent serum bead spreads smoothly across clean skin in macro view', environment: 'minimal skincare application close-up', composition: 'skin texture and the clear serum remain the only visual subjects', cameraPath: 'small parallel macro slide', framing: 'extreme skin-and-serum detail', lightingStyle: 'soft diffuse light with a clean moisture highlight', primaryMotion: 'one fingertip gently spreads the serum into a thin glossy layer', secondaryMotion: 'the wet edge thins and absorbs naturally', materialEffect: 'clear lightweight serum and realistic skin texture', pacing: 'gentle application progression', openingDevice: 'open on the intact serum bead', transitionLanguage: 'the fingertip movement creates a continuous spread', endingDevice: 'fresh hydrated-looking skin detail', audioCharacter: 'soft tactile application foley' }),
      defineDirection('cream-ribbon', { creativeArchetype: 'Cream Ribbon Macro', visualHook: 'a small skincare cream ribbon is dispensed onto a clean surface', environment: 'bright neutral beauty macro setup', composition: 'the ribbon texture fills the frame with optional package context at the edge', cameraPath: 'locked macro tripod', framing: 'extreme texture detail', lightingStyle: 'broad soft light that reveals cream body and gloss', primaryMotion: 'the cream extrudes in one smooth controlled ribbon', secondaryMotion: 'the ribbon settles under its own weight', materialEffect: 'silky dense skincare cream, never food or frosting', pacing: 'clear tactile dispense', openingDevice: 'begin at the nozzle or receiving surface', transitionLanguage: 'the extrusion itself carries the shot', endingDevice: 'clean cream ribbon hold', audioCharacter: 'subtle dispense texture' }),
      defineDirection('foam-lather', { creativeArchetype: 'Cleanser Foam Macro', visualHook: 'dense soft skincare foam builds between wet hands in close macro detail', environment: 'clean sink-side skincare context', composition: 'foam and natural hand movement dominate the frame', cameraPath: 'controlled handheld macro close-up', framing: 'tight foam and lather detail', lightingStyle: 'fresh bathroom daylight', primaryMotion: 'cleanser and water work into a fine dense lather', secondaryMotion: 'small bubbles expand and settle realistically', materialEffect: 'soft cleansing foam, clear water, and natural skin', pacing: 'practical texture demonstration', openingDevice: 'open on the creamy cleanser meeting water', transitionLanguage: 'rubbing action visibly builds the foam', endingDevice: 'dense soft lather hold', audioCharacter: 'gentle water and foam foley' }),
      defineDirection('fine-mist', { creativeArchetype: 'Fine Hydration Mist', visualHook: 'a fine skincare mist blooms across skin and resolves into tiny clear droplets', environment: 'clean bright beauty close-up', composition: 'mist plume crosses a simple skin background', cameraPath: 'static high-speed-style close-up', framing: 'macro mist and droplet detail', lightingStyle: 'soft backlight that makes the mist visible without flare', primaryMotion: 'one controlled mist spray travels and lands on skin', secondaryMotion: 'microdroplets settle naturally', materialEffect: 'clear watery skincare mist and realistic skin', pacing: 'fresh single-action insert', openingDevice: 'begin just before the mist enters frame', transitionLanguage: 'the plume connects the spray to the droplets', endingDevice: 'tiny hydration droplets resting on skin', audioCharacter: 'soft spray and airy room tone' }),
      defineDirection('essence-fabric', { creativeArchetype: 'Sheet Mask Essence Macro', visualHook: 'clear essence beads across hydrated sheet-mask fabric in extreme close-up', environment: 'clean cooling skincare macro setup', composition: 'wet fabric fibers and essence droplets fill the frame', cameraPath: 'slow shallow macro slide', framing: 'extreme fabric and essence detail', lightingStyle: 'cool soft beauty light', primaryMotion: 'one essence droplet travels along the soaked fabric fibers', secondaryMotion: 'the fabric shifts subtly with moisture', materialEffect: 'hydrated cosmetic sheet fabric and clear watery essence', pacing: 'calm tactile detail', openingDevice: 'open on the soaked fiber pattern', transitionLanguage: 'the droplet path reveals the material structure', endingDevice: 'fresh saturated fabric hold', audioCharacter: 'soft water texture' }),
      defineDirection('citrus-ingredient', { creativeArchetype: 'Vitamin-C-Inspired Citrus Macro', visualHook: 'fresh citrus peel and translucent bright citrus liquid create a clean vitamin-C-inspired skincare visual', environment: 'bright laboratory-clean macro surface', composition: 'citrus texture, liquid, and glass remain sparse and beauty-oriented', cameraPath: 'small controlled macro slide', framing: 'ingredient extreme close-up', lightingStyle: 'clean daylight with restrained orange warmth', primaryMotion: 'a clear bright droplet moves from citrus peel toward a glass skincare sample dish', secondaryMotion: 'tiny natural liquid highlights shift', materialEffect: 'fresh citrus peel, clear bright liquid, and laboratory glass', pacing: 'clean ingredient study, not a beverage or food advertisement', openingDevice: 'open on the citrus peel texture', transitionLanguage: 'the droplet path connects botanical source to skincare context', endingDevice: 'droplet resting in a clean sample dish', audioCharacter: 'fresh liquid detail and subtle laboratory ambience' }),
      defineDirection('active-particles', { creativeArchetype: 'Active Ingredient Particle Macro', visualHook: 'translucent skincare active-inspired particles move through clear hydration droplets', environment: 'minimal clean laboratory-style beauty macro world', composition: 'particles and water form one simple interaction with no formulas or labels', cameraPath: 'gentle microscopic follow move', framing: 'extreme particle-and-droplet close-up', lightingStyle: 'high-key translucent illumination with restrained citrus accents', primaryMotion: 'particles enter, diffuse through, and settle inside the hydration field', secondaryMotion: 'small water ripples respond physically', materialEffect: 'translucent active-inspired particles, clear water, and clean glass', pacing: 'legible skincare ingredient visualization', openingDevice: 'begin on one particle entering a droplet', transitionLanguage: 'diffusion reveals the surrounding hydration field', endingDevice: 'calm evenly dispersed particles', audioCharacter: 'clean microscopic shimmer' })
    ]
  },
  'Custom': {
    contentFamily: 'Custom',
    description: 'A flexible but still art-directed grammar used when the user supplies a specific creative world.',
    directions: [
      defineDirection('user-led-tableau', { creativeArchetype: 'User-Led Tableau', visualHook: 'the requested world builds one deliberate visual frame around the product', environment: 'user-specified environment interpreted as an art-directed set', composition: 'composition follows the strongest user-specified spatial cue', cameraPath: 'camera path follows the user request with restrained continuity', framing: 'framing chosen to preserve the requested subject relationship', lightingStyle: 'lighting motivated by the requested world', primaryMotion: 'the user-specified action develops in observable steps', secondaryMotion: 'supporting environmental motion stays subordinate', materialEffect: 'environmental materials only; product truth remains locked', pacing: 'balanced unless the user requests another pace', openingDevice: 'open on the user-specified establishing cue', transitionLanguage: 'continuous transition motivated by the requested action', endingDevice: 'requested final state with a readable product', audioCharacter: 'audio follows the requested tone and remains secondary to the visual idea' }),
      defineDirection('user-led-portrait', { creativeArchetype: 'User-Led Portrait', visualHook: 'one strong user-specified visual cue turns the product into a distinct portrait', environment: 'user-specified portrait environment', composition: 'deliberate portrait composition with clear product priority', cameraPath: 'single motivated portrait move', framing: 'portrait framing selected from the user cue', lightingStyle: 'portrait light shaped by the specified atmosphere', primaryMotion: 'one central action carries the portrait', secondaryMotion: 'minimal environmental motion supports the action', materialEffect: 'set materials follow the user world, never package identity', pacing: 'measured portrait timing', openingDevice: 'strong portrait opening image', transitionLanguage: 'visual cue evolves into the product read', endingDevice: 'distinct final portrait hold', audioCharacter: 'sparse sound character shaped by the user idea' }),
      defineDirection('user-led-world-build', { creativeArchetype: 'User-Led World Build', visualHook: 'the specified world assembles around a stable product anchor through visible cause and effect', environment: 'user-specified world with a clear spatial anchor', composition: 'layered environment that keeps the product geography legible', cameraPath: 'continuous tracking through the world build', framing: 'wide world context to stable hero', lightingStyle: 'motivated world light with a product-safe key', primaryMotion: 'environmental structures or materials assemble in sequence', secondaryMotion: 'small effects echo the main build', materialEffect: 'world-building materials remain separate from the package', pacing: 'progressive build and settle', openingDevice: 'open on the world before the product action begins', transitionLanguage: 'the world build naturally reveals the hero', endingDevice: 'finished world with an unchanged product hold', audioCharacter: 'world-specific texture with a clean final resolve' })
    ]
  }
};

export const creativeFamilyGrammars: Readonly<Record<H3ContentType, CreativeFamilyGrammar>> = familyGrammars;

export function getCreativeFamilyGrammar(contentFamily: H3ContentType): CreativeFamilyGrammar {
  return familyGrammars[contentFamily] ?? familyGrammars['Cinematic Product Ad'];
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function normalizeSeed(seed: number | string | undefined): number {
  if (typeof seed === 'number' && Number.isFinite(seed)) return Math.trunc(seed) >>> 0;
  if (typeof seed === 'string' && seed.trim()) return hashString(seed.trim());
  return DEFAULT_CREATIVE_SEED;
}

function resolveCreativeProduct(product: CreativeProductInput): Product {
  if (typeof product !== 'string') return product;
  const resolved = getProduct(product);
  if (!resolved) throw new Error(`Unknown product '${product}' supplied to the Creative Diversity Engine.`);
  return resolved;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function stableSignature(genome: CreativeGenome): string {
  const normalized = normalizedGenomeValues(genome);
  const source = [normalizeText(genome.contentFamily), ...majorCreativeDimensions.map((axis) => normalized[axis]), normalized.audioCharacter].join('|');
  return `creative-v${CREATIVE_DIVERSITY_SCHEMA_VERSION}-${hashString(source).toString(16).padStart(8, '0')}`;
}

export function buildCreativeFingerprint(genome: CreativeGenome): CreativeFingerprint {
  return {
    ...genome,
    signature: stableSignature(genome),
    majorDimensions: [...majorCreativeDimensions]
  };
}

export function compareCreativeFingerprints(a: CreativeFingerprint | CreativeGenome, b: CreativeFingerprint | CreativeGenome): CreativeFingerprintComparison {
  const normalizedA = normalizedGenomeValues(a);
  const normalizedB = normalizedGenomeValues(b);
  const differentAxes = (Object.keys(creativeGenomeAxisWeights) as CreativeGenomeAxis[]).filter((axis) => normalizedA[axis] !== normalizedB[axis]);
  const totalWeight = Object.values(creativeGenomeAxisWeights).reduce((sum, weight) => sum + weight, 0);
  const sameWeight = (Object.keys(creativeGenomeAxisWeights) as CreativeGenomeAxis[])
    .filter((axis) => normalizedA[axis] === normalizedB[axis])
    .reduce((sum, axis) => sum + creativeGenomeAxisWeights[axis], 0);
  const majorDifferences = differentAxes.filter((axis) => majorCreativeDimensions.includes(axis));
  return {
    similarity: Number((sameWeight / totalWeight).toFixed(4)),
    differentAxes,
    meaningfulDifferenceCount: majorDifferences.length,
    visualHookChanged: differentAxes.includes('visualHook'),
    creativeArchetypeChanged: differentAxes.includes('creativeArchetype')
  };
}

export interface NearDuplicateOptions {
  minimumMeaningfulDifferences?: number;
  nearDuplicateSimilarity?: number;
  overriddenAxes?: readonly CreativeGenomeAxis[];
}

export function isNearDuplicate(
  candidate: CreativeFingerprint | CreativeGenome,
  previous: CreativeFingerprint | CreativeGenome,
  options: NearDuplicateOptions = {}
): boolean {
  const comparison = compareCreativeFingerprints(candidate, previous);
  if ('signature' in candidate && 'signature' in previous && candidate.signature === previous.signature) return true;
  const overridden = new Set(options.overriddenAxes ?? []);
  const availableMajorAxes = majorCreativeDimensions.filter((axis) => !overridden.has(axis));
  const effectiveDifferenceCount = comparison.differentAxes.filter((axis) => majorCreativeDimensions.includes(axis) && !overridden.has(axis)).length;
  const minimumDifferences = Math.min(options.minimumMeaningfulDifferences ?? 4, availableMajorAxes.length);
  const availableHookOrArchetype = !overridden.has('visualHook') || !overridden.has('creativeArchetype');
  const hookOrArchetypeChanged = (!overridden.has('visualHook') && comparison.visualHookChanged)
    || (!overridden.has('creativeArchetype') && comparison.creativeArchetypeChanged);
  if (comparison.similarity >= (options.nearDuplicateSimilarity ?? 0.82)) return true;
  if (effectiveDifferenceCount < minimumDifferences) return true;
  if (availableHookOrArchetype && !hookOrArchetypeChanged) return true;
  return false;
}

function normalizeContentFamily(value: string | undefined): H3ContentType {
  return [...h3ContentTypes, ...legacyH3ContentTypes].includes(value as H3ContentType) ? value as H3ContentType : 'Product';
}

/**
 * H3 video type and Creative Diversity family are the same routing key. Keep
 * this boundary explicit so an unrelated family can never be selected as a
 * fallback for a valid UI content type.
 */
export function resolveCreativeFamilyForH3VideoType(value: H3ContentType | string | undefined): H3ContentType {
  if (value === undefined || value === null || value.trim() === '') return 'Product';
  if (![...h3ContentTypes, ...legacyH3ContentTypes].includes(value as H3ContentType)) {
    throw new Error(`Unsupported H3 video type '${value}' supplied to Creative Diversity.`);
  }
  return value as H3ContentType;
}

function creativeHistoryRecord(record: H3PromptRecord): CreativeHistoryEntry | null {
  const genome = record.creativeGenome ?? record.brief.creativeGenome ?? null;
  if (!genome) return null;
  return {
    id: record.generationJobId ?? `h3-record-${record.id}`,
    product: record.product,
    contentFamily: normalizeContentFamily(record.contentType ?? record.brief.contentType),
    genome,
    fingerprint: record.creativeFingerprint ?? buildCreativeFingerprint(genome),
    conceptSummary: record.conceptSummary ?? record.brief.videoIdea ?? null,
    createdAt: record.createdAt,
    generationJobId: record.generationJobId,
    generationStatus: record.generationStatus
  };
}

export function toCreativeHistoryEntries(records: readonly H3PromptRecord[]): CreativeHistoryEntry[] {
  return records.map(creativeHistoryRecord).filter((record): record is CreativeHistoryEntry => record !== null);
}

function asCreativeHistoryEntries(history: readonly CreativeHistoryEntry[] | readonly H3PromptRecord[] | undefined): CreativeHistoryEntry[] {
  if (!history?.length) return [];
  if ('genome' in history[0]) return history as readonly CreativeHistoryEntry[] as CreativeHistoryEntry[];
  return toCreativeHistoryEntries(history as readonly H3PromptRecord[]);
}

function matchPhrase(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match?.[0]?.trim() || null;
}

/**
 * Recognizes only explicit, high-confidence creative constraints. The full
 * user idea is still retained verbatim in the ChatGPT handoff, so unknown
 * language is never silently discarded.
 */
export function extractCreativeOverrides(userIdea = '', specialInstructions = ''): CreativeUserOverrides {
  const text = `${userIdea} ${specialInstructions}`.trim();
  const axes: Partial<Record<CreativeGenomeAxis, string>> = {};
  const sourcePhrases: string[] = [];
  const conflicts: CreativeConstraintConflict[] = [];
  const setAxis = (axis: CreativeGenomeAxis, value: string, source?: string) => {
    if (!value.trim() || axes[axis]) return;
    axes[axis] = value.trim();
    if (source?.trim()) sourcePhrases.push(source.trim());
  };

  const labeledHook = text.match(/(?:visual\s+hook|primary\s+hook|hook)\s*[:=-]\s*([^.;\n]+)/i);
  if (labeledHook?.[1]) setAxis('visualHook', labeledHook[1], labeledHook[0]);
  const labeledArchetype = text.match(/(?:creative\s+archetype|archetype)\s*[:=-]\s*([^.;\n]+)/i);
  if (labeledArchetype?.[1]) setAxis('creativeArchetype', labeledArchetype[1], labeledArchetype[0]);

  const environmentPatterns: readonly RegExp[] = [
    /\b(?:an?\s+)?orange\s+(?:laboratory|lab)\b/i,
    /\b(?:an?\s+)?(?:white|black|clean|clinical|futuristic)\s+(?:laboratory|lab)\b/i,
    /\b(?:in|inside|within)\s+(?:an?\s+)?[a-z-]+\s+(?:laboratory|lab|bathroom|bedroom|vanity|greenhouse|studio|gallery|kitchen)\b/i,
    /\b(?:bathroom|bedroom|vanity|laboratory|lab|greenhouse|gallery|kitchen|desert|forest|black studio|white studio)\b/i
  ];
  for (const pattern of environmentPatterns) {
    const phrase = matchPhrase(text, pattern);
    if (phrase) {
      const cleaned = phrase.replace(/^(?:in|inside|within)\s+/i, '').replace(/^(?:an?|the)\s+/i, '');
      setAxis('environment', cleaned, phrase);
      break;
    }
  }

  const normalizeCameraLock = (value: string): string => {
    const normalized = value.trim().toLowerCase();
    if (/\b(?:static|locked[- ]off|fixed)\b/.test(normalized)) return 'locked-off static camera';
    if (/\b(?:orbit|orbital|circular)\b/.test(normalized)) return 'controlled orbital camera';
    if (/\boverhead|top[- ]?down\b/.test(normalized)) return 'overhead top-down camera';
    if (/\bhandheld\b/.test(normalized)) return 'natural handheld camera';
    if (/\b(?:lateral|sideways)\b/.test(normalized)) return 'controlled lateral tracking camera';
    if (/\b(?:macro|extreme close[- ]?up)\b/.test(normalized)) return 'macro close camera';
    return value.trim();
  };
  const explicitCameraLocks = [...text.matchAll(/\bcamera(?:\s+path)?\s*(?::|=|\bis\b|\blocked\s+to\b)\s*([^.;,\n]+?)(?=\s+(?:(?:and|then|also)\s+)?(?:separately\s+)?camera(?:\s+path)?\s*(?::|=|\bis\b|\blocked\s+to\b)|$)/gi)]
    .map((match) => ({ value: normalizeCameraLock(match[1]), source: match[0].trim() }))
    .filter((lock) => lock.value.length > 0);
  if (explicitCameraLocks.length > 0) {
    setAxis('cameraPath', explicitCameraLocks[0].value, explicitCameraLocks[0].source);
    const values = [...new Set(explicitCameraLocks.map((lock) => normalizeText(lock.value)))];
    if (values.length > 1) {
      conflicts.push({
        axis: 'cameraPath',
        values: explicitCameraLocks.map((lock) => lock.value),
        sourcePhrases: explicitCameraLocks.map((lock) => lock.source)
      });
    }
  }

  const cameraPatterns: readonly [RegExp, string][] = [
    [/\boverhead\s+(?:camera|view|shot|angle)\b|\btop[- ]?down\s+(?:camera|view|shot|angle)?\b/i, 'overhead top-down camera'],
    [/\b(?:locked[- ]off|static)\s+camera\b/i, 'locked-off static camera'],
    [/\bhandheld\s+(?:camera|framing|shot)\b/i, 'natural handheld camera'],
    [/\b(?:macro|extreme close[- ]up)\s+(?:camera|shot|view|framing)\b/i, 'macro close camera'],
    [/\b(?:lateral|sideways)\s+(?:tracking|track|slider)\b/i, 'controlled lateral tracking camera'],
    [/\b(?:orbit|orbital)\s+camera\b/i, 'controlled orbital camera']
  ];
  for (const [pattern, value] of cameraPatterns) {
    const phrase = matchPhrase(text, pattern);
    if (phrase) {
      setAxis('cameraPath', value, phrase);
      break;
    }
  }

  const compositionPatterns: readonly [RegExp, string][] = [
    [/\b(?:extreme\s+)?macro\s+(?:composition|framing|shot|close[- ]?up)\b/i, 'extreme macro composition'],
    [/\b(?:wide|wide[- ]angle)\s+(?:composition|shot|framing|view)\b/i, 'wide environmental composition'],
    [/\boff[- ]center|asymmetric\s+(?:composition|framing)?\b/i, 'asymmetric off-center composition'],
    [/\bcentered\s+(?:composition|framing|hero|product)\b/i, 'centered hero composition']
  ];
  for (const [pattern, value] of compositionPatterns) {
    const phrase = matchPhrase(text, pattern);
    if (phrase) {
      setAxis('composition', value, phrase);
      break;
    }
  }

  const lightingPatterns: readonly [RegExp, string][] = [
    [/\bhard\s+(?:graphic\s+)?shadows?\b/i, 'hard graphic shadow lighting'],
    [/\bsoft\s+(?:diffused|diffuse)\s+light(?:ing)?\b/i, 'soft diffused lighting'],
    [/\b(?:warm|golden)\s+(?:studio\s+)?light(?:ing)?\b/i, 'warm studio lighting'],
    [/\b(?:cool|clinical)\s+(?:studio\s+)?light(?:ing)?\b/i, 'cool clean lighting'],
    [/\bneon\s+light(?:ing)?\b/i, 'neon graphic lighting']
  ];
  for (const [pattern, value] of lightingPatterns) {
    const phrase = matchPhrase(text, pattern);
    if (phrase) {
      setAxis('lightingStyle', value, phrase);
      break;
    }
  }

  const pacing = matchPhrase(text, /\b(?:very\s+)?(?:slow|fast|rapid|quick|balanced)\s+(?:paced|pace|rhythm|tempo)\b/i);
  if (pacing) setAxis('pacing', pacing.toLowerCase().includes('fast') || pacing.toLowerCase().includes('rapid') || pacing.toLowerCase().includes('quick') ? 'fast' : pacing.toLowerCase().includes('slow') ? 'slow' : 'balanced', pacing);

  const motion = matchPhrase(text, /\b(?:slow\s+push[- ]?in|straight\s+push[- ]?in|lateral\s+track(?:ing)?|controlled\s+orbit|vertical\s+water[- ]column|foam\s+crescent|moving\s+geometric\s+shadow(?:s)?|focus\s+pull)\b/i);
  if (motion) setAxis('primaryMotion', motion, motion);

  return { axes, fields: Object.keys(axes) as CreativeGenomeAxis[], sourcePhrases, conflicts };
}

function materializeGenome(contentFamily: H3ContentType, direction: CreativeDirection, variantIndex: number): CreativeGenome {
  const variant = variantIndex > 0 ? direction.variants?.[variantIndex - 1] ?? {} : {};
  const { id: _id, variants: _variants, ...base } = direction;
  void _id;
  void _variants;
  return {
    schemaVersion: CREATIVE_DIVERSITY_SCHEMA_VERSION,
    contentFamily,
    ...base,
    ...variant
  };
}

function candidateGenomes(grammar: CreativeFamilyGrammar): CreativeGenome[] {
  const candidates: CreativeGenome[] = [];
  for (const direction of grammar.directions) {
    candidates.push(materializeGenome(grammar.contentFamily, direction, 0));
    for (let variantIndex = 1; variantIndex <= (direction.variants?.length ?? 0); variantIndex += 1) {
      candidates.push(materializeGenome(grammar.contentFamily, direction, variantIndex));
    }
  }
  return candidates;
}

function applyOverrides(genome: CreativeGenome, overrides: CreativeUserOverrides): CreativeGenome {
  const next = { ...genome };
  for (const [axis, value] of Object.entries(overrides.axes) as Array<[CreativeGenomeAxis, string | undefined]>) {
    if (value?.trim()) next[axis] = value.trim();
  }
  return next;
}

function activeHistory(history: readonly CreativeHistoryEntry[]): CreativeHistoryEntry[] {
  return history.filter((entry) => entry.generationStatus !== 'rejected' && entry.generationStatus !== 'archived');
}

function daysSince(createdAt: string, now: Date): number {
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, (now.getTime() - timestamp) / 86_400_000);
}

function historyAgeFactor(entry: CreativeHistoryEntry, index: number, now: Date, options: CreativeDiversityOptions): number {
  const generationFactor = Math.pow(options.generationDecay, index);
  const dayFactor = Math.pow(options.dayDecay, daysSince(entry.createdAt, now));
  return generationFactor * dayFactor;
}

function sameProductFamilyHistory(product: ProductId, contentFamily: H3ContentType, history: readonly CreativeHistoryEntry[], options: CreativeDiversityOptions): CreativeHistoryEntry[] {
  return activeHistory(history).filter((entry) => entry.product === product && entry.contentFamily === contentFamily).slice(0, options.sameProductFamilyWindow);
}

function selectedValuePenaltySources(
  genome: CreativeGenome,
  product: ProductId,
  contentFamily: H3ContentType,
  history: readonly CreativeHistoryEntry[],
  overrides: CreativeUserOverrides,
  now: Date,
  options: CreativeDiversityOptions
): CreativePenaltySource[] {
  const relevant = sameProductFamilyHistory(product, contentFamily, history, options);
  const sources: CreativePenaltySource[] = [];
  const overridden = new Set(overrides.fields);
  const relevantValues = new Map<string, Array<{ entry: CreativeHistoryEntry; index: number }>>();
  for (const [index, entry] of relevant.entries()) {
    for (const axis of Object.keys(creativeGenomeAxisWeights) as CreativeGenomeAxis[]) {
      const key = `${axis}\u0000${normalizedAxisValue(entry.fingerprint ?? entry.genome, axis)}`;
      const matches = relevantValues.get(key) ?? [];
      matches.push({ entry, index });
      relevantValues.set(key, matches);
    }
  }
  for (const axis of Object.keys(creativeGenomeAxisWeights) as CreativeGenomeAxis[]) {
    if (overridden.has(axis)) continue;
    const value = genome[axis];
    const matches = relevantValues.get(`${axis}\u0000${normalizedAxisValue(genome, axis)}`) ?? [];
    if (!matches.length) continue;
    const weighted = matches.reduce((sum, item) => sum + historyAgeFactor(item.entry, item.index, now, options), 0);
    const penalty = Number((weighted * creativeGenomeAxisWeights[axis] * 5).toFixed(2));
    sources.push({
      axis,
      value,
      occurrences: matches.length,
      penalty,
      recentGenerationIds: matches.slice(0, 5).map(({ entry }) => entry.generationJobId ?? entry.id)
    });
  }
  return sources.sort((a, b) => b.penalty - a.penalty || a.axis.localeCompare(b.axis));
}

export function calculateCreativePenaltySources(
  genome: CreativeGenome,
  input: Pick<CreativePlanInput, 'product' | 'contentFamily' | 'recentHistory' | 'specialInstructions' | 'userIdea' | 'now'> & { overrides?: CreativeUserOverrides },
  options: Partial<CreativeDiversityOptions> = {}
): CreativePenaltySource[] {
  const resolved = { ...defaultCreativeDiversityOptions, ...options };
  const history = asCreativeHistoryEntries(input.recentHistory);
  const overrides = input.overrides ?? extractCreativeOverrides(input.userIdea, input.specialInstructions);
  const product = resolveCreativeProduct(input.product);
  return selectedValuePenaltySources(genome, product.id, input.contentFamily, history, overrides, input.now ?? new Date(), resolved);
}

function noveltyScoreFor(
  genome: CreativeGenome,
  product: ProductId,
  contentFamily: H3ContentType,
  history: readonly CreativeHistoryEntry[],
  now: Date,
  options: CreativeDiversityOptions
): number {
  const usable = activeHistory(history);
  if (!usable.length) return 100;
  const sameFamily = usable.filter((entry) => entry.product === product && entry.contentFamily === contentFamily).slice(0, options.sameProductFamilyWindow);
  const sameProduct = usable.filter((entry) => entry.product === product).slice(0, options.sameProductWindow);
  const comparisonSet = sameFamily.length ? sameFamily : sameProduct.length ? sameProduct : usable.slice(0, options.globalWindow);
  if (!comparisonSet.length) return 100;
  const weightedSimilarities = comparisonSet.map((entry, index) => {
    const comparison = compareCreativeFingerprints(genome, entry.fingerprint ?? entry.genome);
    const scopeWeight = sameFamily.includes(entry) ? 1 : sameProduct.includes(entry) ? 0.55 : 0.2;
    return comparison.similarity * scopeWeight * historyAgeFactor(entry, index, now, options);
  });
  const strongest = Math.max(...weightedSimilarities, 0);
  return Math.round(Math.max(0, Math.min(100, (1 - strongest) * 100)));
}

function summarizeConcept(product: Product, genome: CreativeGenome): string {
  return `${product.shortName}: ${genome.visualHook}. ${genome.primaryMotion}; ${genome.cameraPath}; finish with ${genome.endingDevice}.`;
}

interface ScoredCandidate {
  genome: CreativeGenome;
  fingerprint: CreativeFingerprint;
  noveltyScore: number;
  penalties: CreativePenaltySource[];
  score: number;
  randomRank: number;
  historyRejection: CreativeRejection | null;
  lastUsedAt: number | null;
  historicalUsageCount: number;
}

function rejectionFor(candidate: ScoredCandidate, entry: CreativeHistoryEntry, options: CreativeDiversityOptions, overrides: CreativeUserOverrides): CreativeRejection | null {
  const comparison = compareCreativeFingerprints(candidate.fingerprint, entry.fingerprint ?? entry.genome);
  if (!isNearDuplicate(candidate.fingerprint, entry.fingerprint ?? entry.genome, {
    minimumMeaningfulDifferences: options.minimumMeaningfulDifferences,
    nearDuplicateSimilarity: options.nearDuplicateSimilarity,
    overriddenAxes: overrides.fields
  })) return null;
  const reason = candidate.fingerprint.signature === (entry.fingerprint ?? buildCreativeFingerprint(entry.genome)).signature
    ? 'exact fingerprint duplicate'
    : comparison.meaningfulDifferenceCount < options.minimumMeaningfulDifferences
      ? `only ${comparison.meaningfulDifferenceCount} meaningful dimensions changed`
      : !comparison.visualHookChanged && !comparison.creativeArchetypeChanged
        ? 'visual hook and creative archetype both repeated'
        : `weighted similarity ${Math.round(comparison.similarity * 100)}% exceeds the near-duplicate threshold`;
  return {
    candidateSignature: candidate.fingerprint.signature,
    creativeArchetype: candidate.genome.creativeArchetype,
    visualHook: candidate.genome.visualHook,
    reason,
    againstGenerationId: entry.generationJobId ?? entry.id,
    similarity: comparison.similarity,
    meaningfulDifferenceCount: comparison.meaningfulDifferenceCount
  };
}

function candidateHistoryStats(candidate: ScoredCandidate, history: readonly CreativeHistoryEntry[]): { lastUsedAt: number | null; historicalUsageCount: number } {
  const matches = history.filter((entry) => (entry.fingerprint ?? buildCreativeFingerprint(entry.genome)).signature === candidate.fingerprint.signature);
  if (!matches.length) return { lastUsedAt: null, historicalUsageCount: 0 };
  const timestamps = matches.map((entry) => Date.parse(entry.createdAt)).filter((timestamp) => Number.isFinite(timestamp));
  return {
    lastUsedAt: timestamps.length ? Math.max(...timestamps) : 0,
    historicalUsageCount: matches.length
  };
}

/** Fallback ordering is intentionally independent of the novelty threshold and reroll budget. */
function compareFallbackCandidates(a: ScoredCandidate, b: ScoredCandidate): number {
  if (a.noveltyScore !== b.noveltyScore) return b.noveltyScore - a.noveltyScore;
  const aLastUsedAt = a.lastUsedAt ?? Number.NEGATIVE_INFINITY;
  const bLastUsedAt = b.lastUsedAt ?? Number.NEGATIVE_INFINITY;
  if (aLastUsedAt !== bLastUsedAt) return aLastUsedAt - bLastUsedAt;
  if (a.historicalUsageCount !== b.historicalUsageCount) return a.historicalUsageCount - b.historicalUsageCount;
  if (a.randomRank !== b.randomRank) return b.randomRank - a.randomRank;
  return a.fingerprint.signature.localeCompare(b.fingerprint.signature);
}

const benefitArchetypesByProduct: Readonly<Record<ProductId, readonly string[]>> = {
  cleanser: ['Human Before and After', 'Skin Macro Result', 'Comfort Result'],
  toner: ['Human Before and After', 'Skin Macro Result', 'Hydration Result', 'Radiance Result', 'Comfort Result'],
  serum: ['Human Before and After', 'Skin Macro Result', 'Radiance Result'],
  'eye-cream': ['Human Before and After', 'Skin Macro Result', 'Comfort Result'],
  'skin-cream': ['Human Before and After', 'Skin Macro Result', 'Hydration Result', 'Comfort Result', 'Barrier Support Metaphor'],
  mask: ['Human Before and After', 'Skin Macro Result', 'Hydration Result', 'Comfort Result'],
  'full-series': ['Human Before and After', 'Skin Macro Result']
};

const ingredientArchetypesByProduct: Readonly<Record<ProductId, readonly string[]>> = {
  cleanser: ['Ingredient Macro', 'Foam Formulation', 'Active Particle Interaction', 'Skin Layer Visualization', 'Clean Lab Aesthetic', 'Antioxidant Particle Metaphor'],
  toner: ['Ingredient Macro', 'Mist Formulation', 'Active Particle Interaction', 'Skin Layer Visualization', 'Clean Lab Aesthetic', 'Antioxidant Particle Metaphor'],
  serum: ['Ingredient Macro', 'Active Particle Interaction', 'Skin Layer Visualization', 'Clean Lab Aesthetic', 'Antioxidant Particle Metaphor'],
  'eye-cream': ['Ingredient Macro', 'Cream Formulation', 'Active Particle Interaction', 'Skin Layer Visualization', 'Clean Lab Aesthetic', 'Antioxidant Particle Metaphor'],
  'skin-cream': ['Ingredient Macro', 'Cream Formulation', 'Active Particle Interaction', 'Skin Layer Visualization', 'Clean Lab Aesthetic', 'Antioxidant Particle Metaphor'],
  mask: ['Ingredient Macro', 'Active Particle Interaction', 'Skin Layer Visualization', 'Clean Lab Aesthetic'],
  'full-series': ['Ingredient Macro', 'Active Particle Interaction', 'Skin Layer Visualization', 'Clean Lab Aesthetic']
};

function isProductContentCompatible(genome: CreativeGenome, product: Product): boolean {
  if (genome.contentFamily === 'Benefits') return benefitArchetypesByProduct[product.id].includes(genome.creativeArchetype);
  if (genome.contentFamily === 'Ingredients') return ingredientArchetypesByProduct[product.id].includes(genome.creativeArchetype);
  return true;
}

function isHardCompatible(genome: CreativeGenome, product: Product, contentFamily: H3ContentType, overrides: CreativeUserOverrides): boolean {
  if (genome.contentFamily !== contentFamily) return false;
  if (!isProductContentCompatible(genome, product)) return false;
  return overrides.fields.every((axis) => {
    const required = overrides.axes[axis];
    return !required || normalizeText(genome[axis]) === normalizeText(required);
  });
}

function boundedNoveltyThreshold(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : defaultCreativeDiversityOptions.noveltyThreshold;
}

function varietyProfile(variety: CreativeVariety): { novelty: number; penalty: number; rarity: number; jitter: number } {
  if (variety === 'Consistent') return { novelty: 0.7, penalty: 0.85, rarity: 0.45, jitter: 2.5 };
  if (variety === 'Exploratory') return { novelty: 1.35, penalty: 1.35, rarity: 1.1, jitter: 5.5 };
  return { novelty: 1, penalty: 1, rarity: 0.8, jitter: 4 };
}

export class CreativeDiversityEngine {
  private readonly options: CreativeDiversityOptions;

  constructor(options: Partial<CreativeDiversityOptions> = {}) {
    this.options = {
      ...defaultCreativeDiversityOptions,
      ...options,
      noveltyThreshold: boundedNoveltyThreshold(options.noveltyThreshold ?? defaultCreativeDiversityOptions.noveltyThreshold)
    };
  }

  plan(input: CreativePlanInput): CreativePlan {
    const product = resolveCreativeProduct(input.product);
    const contentFamily = resolveCreativeFamilyForH3VideoType(input.contentFamily);
    const grammar = getCreativeFamilyGrammar(contentFamily);
    const history = asCreativeHistoryEntries(input.recentHistory);
    const overrides = extractCreativeOverrides(input.userIdea, input.specialInstructions);
    if (overrides.conflicts?.length) throw new CreativeConstraintError(overrides.conflicts);
    const seed = normalizeSeed(input.seed);
    const random = seededRandom(seed);
    const now = input.now ?? new Date();
    const variety = input.variety ?? 'Balanced';
    const profile = varietyProfile(variety);
    const candidates = candidateGenomes(grammar).map((genome) => applyOverrides(genome, overrides));
    const hardCompatibleCandidates = candidates.filter((genome) => isHardCompatible(genome, product, contentFamily, overrides));
    if (!hardCompatibleCandidates.length) {
      throw new Error(`No Creative Diversity direction satisfies the explicit hard constraints for ${contentFamily}.`);
    }
    const recentFamily = sameProductFamilyHistory(product.id, contentFamily, history, this.options);
    const archetypeCounts = new Map<string, number>();
    for (const entry of recentFamily) archetypeCounts.set(normalizeText(entry.genome.creativeArchetype), (archetypeCounts.get(normalizeText(entry.genome.creativeArchetype)) ?? 0) + 1);

    const scored: ScoredCandidate[] = hardCompatibleCandidates.map((genome) => {
      const fingerprint = buildCreativeFingerprint(genome);
      const penalties = selectedValuePenaltySources(genome, product.id, contentFamily, history, overrides, now, this.options);
      const noveltyScore = noveltyScoreFor(genome, product.id, contentFamily, history, now, this.options);
      const penalty = penalties.reduce((sum, source) => sum + source.penalty, 0);
      const archetypeCount = archetypeCounts.get(normalizeText(genome.creativeArchetype)) ?? 0;
      const rarity = 18 / (1 + archetypeCount);
      const randomRank = random();
      const score = noveltyScore * profile.novelty - penalty * profile.penalty + rarity * profile.rarity + randomRank * profile.jitter;
      const historyRejection = recentFamily
        .map((entry) => rejectionFor({ genome, fingerprint, noveltyScore, penalties, score, randomRank, historyRejection: null, lastUsedAt: null, historicalUsageCount: 0 }, entry, this.options, overrides))
        .find((rejection): rejection is CreativeRejection => rejection !== null) ?? null;
      const historyStats = candidateHistoryStats({ genome, fingerprint, noveltyScore, penalties, score, randomRank, historyRejection, lastUsedAt: null, historicalUsageCount: 0 }, recentFamily);
      return { genome, fingerprint, noveltyScore, penalties, score, randomRank, historyRejection, ...historyStats };
    }).sort((a, b) => b.score - a.score || a.randomRank - b.randomRank || a.fingerprint.signature.localeCompare(b.fingerprint.signature));

    const rejections: CreativeRejection[] = [];
    const maxRerolls = Math.max(0, this.options.maxRerolls);
    const noveltyThreshold = boundedNoveltyThreshold(this.options.noveltyThreshold);
    const fallbackCandidate = [...scored].sort(compareFallbackCandidates)[0];
    if (!fallbackCandidate) throw new Error(`No Creative Diversity direction satisfies the explicit hard constraints for ${contentFamily}.`);
    let selected: ScoredCandidate | undefined;
    let rerollsUsed = 0;
    let historyRejectionsEncountered = 0;
    for (const candidate of scored) {
      const belowNoveltyThreshold = candidate.noveltyScore < noveltyThreshold;
      if (!candidate.historyRejection && !belowNoveltyThreshold) {
        selected = candidate;
        break;
      }
      if (rerollsUsed >= maxRerolls) break;
      if (candidate.historyRejection) {
        historyRejectionsEncountered += 1;
        rejections.push(candidate.historyRejection);
      }
      rerollsUsed += 1;
    }

    const diversityFallbackUsed = !selected;
    if (!selected) selected = fallbackCandidate;
    const noveltyThresholdMissed = selected.noveltyScore < noveltyThreshold;
    const historyFilteredCandidateCount = scored.filter((candidate) => candidate.historyRejection !== null).length;
    const diversityFallbackReason: CreativeDiversityFallbackReason | null = diversityFallbackUsed
      ? historyRejectionsEncountered > 0 || historyFilteredCandidateCount > 0 ? 'compatible_pool_exhausted' : 'novelty_threshold_missed'
      : null;
    const diversityDiagnostics: CreativeDiversityDiagnostics = {
      selectedContentType: contentFamily,
      resolvedCreativeFamily: contentFamily,
      candidateFamilySearched: contentFamily,
      candidateCount: candidates.length,
      hardCompatibleCandidateCount: hardCompatibleCandidates.length,
      historyFilteredCandidateCount,
      noveltyThreshold,
      noveltyThresholdMissed,
      diversityFallbackUsed,
      diversityFallbackReason,
      rerollsUsed,
      noveltyScore: selected.noveltyScore
    };

    return {
      product: product.id,
      productTruth: createFixedProductTruth(product),
      contentFamily,
      genome: selected.genome,
      fingerprint: selected.fingerprint,
      conceptSummary: summarizeConcept(product, selected.genome),
      noveltyScore: selected.noveltyScore,
      creativeSeed: seed,
      generationJobId: input.generationJobId ?? null,
      repetitionPenaltySources: selected.penalties,
      rejectedCandidates: rejections,
      userOverrides: overrides,
      diversityFallbackUsed,
      diversityFallbackReason,
      rerollsUsed,
      noveltyThresholdMissed,
      diversityDiagnostics
    };
  }

  simulate(input: Omit<CreativePlanInput, 'recentHistory' | 'seed' | 'generationJobId'> & { count?: number; seed?: number | string }): CreativeSimulationReport {
    const product = resolveCreativeProduct(input.product);
    const count = Math.max(1, Math.floor(input.count ?? 100));
    const seed = normalizeSeed(input.seed);
    const history: CreativeHistoryEntry[] = [];
    const plans: CreativePlan[] = [];
    const rejectedConcepts: CreativeRejection[] = [];
    const distribution: Partial<Record<CreativeGenomeAxis, Record<string, number>>> = {};
    const simulationStart = input.now ?? new Date(Date.UTC(2026, 0, 1, 12, 0, 0));
    const addDistribution = (axis: CreativeGenomeAxis, value: string) => {
      const axisDistribution = distribution[axis] ?? {};
      axisDistribution[value] = (axisDistribution[value] ?? 0) + 1;
      distribution[axis] = axisDistribution;
    };
    for (let index = 0; index < count; index += 1) {
      const planTime = new Date(simulationStart.getTime() + index * 60_000);
      const plan = this.plan({ ...input, product, recentHistory: history, now: planTime, seed: (seed + index * 7919) >>> 0, generationJobId: `simulation-${String(index + 1).padStart(3, '0')}` });
      plans.push(plan);
      rejectedConcepts.push(...plan.rejectedCandidates);
      for (const axis of Object.keys(creativeGenomeAxisWeights) as CreativeGenomeAxis[]) addDistribution(axis, plan.genome[axis]);
      history.unshift({ id: plan.generationJobId ?? `simulation-${index + 1}`, generationJobId: plan.generationJobId, product: plan.product, contentFamily: plan.contentFamily, genome: plan.genome, fingerprint: plan.fingerprint, conceptSummary: plan.conceptSummary, createdAt: planTime.toISOString(), generationStatus: 'planned' });
    }
    const consecutiveDifferenceCounts = plans.slice(1).map((plan, index) => compareCreativeFingerprints(plan.fingerprint, plans[index].fingerprint).meaningfulDifferenceCount);
    return {
      product: product.id,
      contentFamily: input.contentFamily,
      count,
      seed,
      plans,
      distribution,
      archetypeDistribution: distribution.creativeArchetype ?? {},
      cameraDistribution: distribution.cameraPath ?? {},
      environmentDistribution: distribution.environment ?? {},
      consecutiveDifferenceCounts,
      rejectedConcepts
    };
  }
}

export function planCreativeGenome(input: CreativePlanInput): CreativePlan {
  return new CreativeDiversityEngine(input.options).plan(input);
}

export function simulateCreativeDiversity(input: Omit<CreativePlanInput, 'recentHistory' | 'seed' | 'generationJobId'> & { count?: number; seed?: number | string }): CreativeSimulationReport {
  return new CreativeDiversityEngine(input.options).simulate(input);
}

export function reproduceCreativeGenome(genome: CreativeGenome): CreativeFingerprint {
  return buildCreativeFingerprint({ ...genome, schemaVersion: CREATIVE_DIVERSITY_SCHEMA_VERSION });
}

export function creativeGenomePromptGuidance(genome: CreativeGenome): string[] {
  return [
    `Primary visual hook: ${genome.visualHook}.`,
    `Creative execution: ${genome.creativeArchetype}; ${genome.environment}; ${genome.composition}; ${genome.framing}.`,
    `Camera and light: ${genome.cameraPath}; ${genome.lightingStyle}.`,
    `Motion and material: ${genome.primaryMotion}; ${genome.materialEffect}.`,
    `Pacing and finish: ${genome.pacing}; ${genome.openingDevice}; ${genome.endingDevice}.`
  ];
}

export function creativeGenomeInspectorFields(genome: CreativeGenome): Array<{ label: string; value: string }> {
  return [
    { label: 'Visual hook', value: genome.visualHook },
    { label: 'Archetype', value: genome.creativeArchetype },
    { label: 'Composition', value: genome.composition },
    { label: 'Camera', value: genome.cameraPath },
    { label: 'Environment', value: genome.environment },
    { label: 'Lighting', value: genome.lightingStyle },
    { label: 'Motion', value: genome.primaryMotion },
    { label: 'Material effect', value: genome.materialEffect }
  ];
}
