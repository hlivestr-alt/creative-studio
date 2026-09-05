import h3InstructionPackage from '../../prompts/chatgpt-h3-video.md?raw';
import { brand, claimRules, getProduct, getProductReferencePaths } from './data';
import type {
  CreativeGenome,
  CreativeGenomeAxis,
  H3ActionIntensity,
  H3ContentType,
  H3CameraMotion,
  H3Concept,
  H3Ending,
  H3Pacing,
  H3ProductFidelity,
  H3PromptDetail,
  H3PromptRecord,
  H3RecommendedSettings,
  H3ReferenceAsset,
  H3ReferenceFidelity,
  H3ReferenceImageSlot,
  H3ReferenceImageSize,
  H3ReferencePlan,
  H3ReferenceRole,
  H3ResolvedWorkflowMode,
  H3Scheduler,
  H3Sound,
  H3TimelineSegment,
  H3WorkflowAspectRatio,
  H3WorkflowSettings,
  H3VideoBrief,
  H3WorkflowMode,
  Language,
  Product
} from './types';
import { h3ContentTypes, h3SeedModeOptions as h3SeedModeValues, h3WorkflowAspectRatioValues } from './types';
import { buildH3LockedProductPlatePlan, lockedProductPlatePromptBlock } from './locked-product-plate';
import { assessCreativeGenomeCompatibility, creativeGenomePromptGuidance } from './creative-diversity';
import type { CreativeGenomeCompatibilityIssue, CreativeGenomeCompatibilityRuleId } from './creative-diversity';

export const H3_FPS = 24;
export const H3_MIN_DURATION = 4;
export const H3_MAX_DURATION = 15;

export const h3ContentTypeOptions = h3ContentTypes;
export const h3LanguageOptions: readonly Language[] = ['Indonesian', 'English'];
export const h3WorkflowOptions: ReadonlyArray<{ value: H3WorkflowMode; label: string; description: string }> = [
  { value: 'AUTO', label: 'Auto', description: 'Recommend the H3 workflow from the planned reference frames.' },
  { value: 'T2VA', label: 'T2VA · Text Only', description: 'Start from the written brief with no reference image.' },
  { value: 'I2VA', label: 'I2VA · Start From Image', description: 'Use one image as the exact first frame.' },
  { value: 'FL2VA', label: 'FL2VA · Start + End Images', description: 'Connect one exact first frame to one exact final frame.' },
  { value: 'L2VA', label: 'L2VA · End At Image', description: 'Infer the opening and land on one exact final image.' },
  { value: 'REF2VA', label: 'Ref2VA · Reference Assets', description: 'Use product or other references without locking both endpoints.' }
];

export const h3GoalOptions = ['Product awareness', 'Product reveal', 'Product benefit', 'Ingredient story', 'Texture', 'Transformation', 'Social ad', 'Other'] as const;
export const h3AspectRatioOptions: readonly H3WorkflowAspectRatio[] = h3WorkflowAspectRatioValues;
export const h3QualityPresets: Readonly<Record<'Draft' | 'Preview' | 'Final', { megapixels: number; multiple: number }>> = {
  Draft: { megapixels: 0.4, multiple: 32 },
  Preview: { megapixels: 0.7, multiple: 32 },
  Final: { megapixels: 0.98, multiple: 32 }
};
export const h3CameraMotionOptions: readonly H3CameraMotion[] = ['Static', 'Low', 'Medium', 'High', 'Cinematic'];
export const h3ActionIntensityOptions: readonly H3ActionIntensity[] = ['Low', 'Medium', 'High', 'Extreme'];
export const h3PacingOptions: readonly H3Pacing[] = ['Slow', 'Balanced', 'Fast'];
export const h3ProductFidelityOptions: readonly H3ProductFidelity[] = ['Auto', 'High', 'Exact'];
export const h3EndingOptions: readonly H3Ending[] = ['Hero Shot', 'Close-Up', 'Hold', 'Loopable', 'Custom'];
export const h3SoundOptions: readonly H3Sound[] = ['Auto', 'Sound + Music', 'Sound Only', 'Music Only', 'Silent'];
export const h3PromptDetailOptions: readonly H3PromptDetail[] = ['Simple', 'Production', 'Maximum Detail'];
export const h3ReferenceFidelityOptions: readonly H3ReferenceFidelity[] = ['Standard', 'High'];
export const h3SchedulerOptions: readonly H3Scheduler[] = ['simple', 'normal', 'beta'];
export const h3SeedModeOptions = h3SeedModeValues;
export const h3RefImageSizeOptions: readonly H3ReferenceImageSize[] = ['match', 'max'];

export function referenceImageSizeForFidelity(fidelity: H3ReferenceFidelity): H3ReferenceImageSize {
  return fidelity === 'High' ? 'max' : 'match';
}

export function h3ReferenceFidelity(brief: Pick<H3VideoBrief, 'referenceFidelity' | 'refImageSize' | 'productFidelity' | 'references'>): H3ReferenceFidelity {
  if (brief.refImageSize === 'max') return 'High';
  if (brief.refImageSize === 'match') return 'Standard';
  if (brief.referenceFidelity === 'Standard' || brief.referenceFidelity === 'High') return brief.referenceFidelity;
  const hasConcreteReference = brief.references.productReference.source === 'selected-product'
    || brief.references.productReference.source === 'local-file'
    || brief.references.referenceImages?.some((slot) => slot.asset.source === 'selected-product' || slot.asset.source === 'local-file') === true;
  return brief.productFidelity === 'Exact' || hasConcreteReference ? 'High' : 'Standard';
}

export function h3RefImageSize(brief: Pick<H3VideoBrief, 'referenceFidelity' | 'refImageSize' | 'productFidelity' | 'references'>): H3ReferenceImageSize {
  if (brief.refImageSize === 'match' || brief.refImageSize === 'max') return brief.refImageSize;
  return referenceImageSizeForFidelity(h3ReferenceFidelity(brief));
}

export function h3Scheduler(brief: Pick<H3VideoBrief, 'scheduler'>): H3Scheduler {
  return brief.scheduler === 'normal' || brief.scheduler === 'beta' ? brief.scheduler : 'simple';
}

/** Convert the brief's editable controls into the exact workflow-settings model. */
export function h3WorkflowSettingsFromBrief(brief: Pick<H3VideoBrief, 'duration' | 'aspectRatio' | 'customAspectRatio' | 'megapixels' | 'multiple' | 'fps' | 'steps' | 'scheduler' | 'seedMode' | 'seed' | 'refImageSize' | 'referenceFidelity' | 'productFidelity' | 'references'>): H3WorkflowSettings {
  const aspectRatio = brief.aspectRatio === 'Custom' ? brief.customAspectRatio.trim() : brief.aspectRatio;
  return {
    durationSeconds: brief.duration,
    aspectRatio: aspectRatio as H3WorkflowAspectRatio,
    megapixels: brief.megapixels,
    multiple: brief.multiple,
    fps: brief.fps,
    steps: brief.steps ?? 20,
    scheduler: h3Scheduler(brief),
    seedMode: brief.seedMode === 'fixed' ? 'fixed' : 'random',
    seed: brief.seed ?? 0,
    refImageSize: h3RefImageSize(brief)
  };
}

/** Apply persisted direct workflow settings without recreating legacy aliases. */
export function applyH3WorkflowSettings(brief: H3VideoBrief, settings: H3WorkflowSettings): H3VideoBrief {
  return {
    ...brief,
    duration: settings.durationSeconds,
    aspectRatio: settings.aspectRatio,
    customAspectRatio: '',
    megapixels: settings.megapixels,
    multiple: settings.multiple,
    fps: settings.fps,
    steps: settings.steps,
    scheduler: settings.scheduler,
    seedMode: settings.seedMode,
    seed: settings.seed,
    refImageSize: settings.refImageSize
  };
}

export const h3ProductReferenceAuthorityInstruction = 'The supplied product reference is the sole authoritative visual identity reference. It owns visible product appearance; written metadata only corrects verified ambiguities or prevents demonstrated failures.';
export const h3ProductFidelityChecklist = 'reference-visible product appearance and verified product-specific corrections';
export const h3ProductScopedIdentityRule = 'Keep each product\'s identity scoped to that product; never transfer traits between products.';
export const h3ReferencePresentationRule = 'Keep package components separate from their photographed arrangement.';
const h3ProductReferenceRules = 'Use verified unseen-surface metadata only when choreography reveals it; do not add generic packaging copy.';

export const minimaxH3SystemInstruction = [
  'Act as a MiniMax H3 video prompt director. Think chronologically from initial state to motion/action onset to continuous development to final state/settle.',
  'Keep spatial continuity understandable, describe observable intermediate physical actions, and use reference images only for their stated roles.',
  'When a product image is supplied, let its pixels control visible packaging; written data adds only a relevant verified correction and never reconstructs front artwork.',
  h3ProductScopedIdentityRule,
  'Use one concise 3–5 sentence product lock at the first product-bearing beat; do not repeat it in later beats.',
  h3ProductReferenceRules,
  'Add one short blank-surface sentence only when choreography reveals a rear or side surface; otherwise keep product motion minimal and use environmental motion.'
].join(' ');

export type H3PromptRevision = 'improve' | 'shorten' | 'more-motion' | 'more-cinematic' | 'stronger-product-accuracy';

export interface H3PromptBuildInput {
  product: Product;
  brief: H3VideoBrief;
  concept: H3Concept | null;
  resolvedMode?: H3ResolvedWorkflowMode;
  timeline?: H3TimelineSegment[];
}

export interface H3ConceptRequestInput {
  product: Product;
  brief: H3VideoBrief;
}

export interface H3ChatGPTRequestInput {
  product: Product;
  brief: H3VideoBrief;
}

export function clampH3Duration(value: number): number {
  if (!Number.isFinite(value)) return H3_MIN_DURATION;
  return Math.min(H3_MAX_DURATION, Math.max(H3_MIN_DURATION, Math.round(value)));
}

/**
 * H3 uses the native ComfyUI 17k+5 frame grid. Keep this isolated so a later
 * workflow revision can change the grid without touching the UI.
 */
export function calculateH3FrameLength(durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds < H3_MIN_DURATION || durationSeconds > H3_MAX_DURATION) {
    throw new RangeError(`H3 duration must be between ${H3_MIN_DURATION} and ${H3_MAX_DURATION} seconds`);
  }
  const targetFrames = durationSeconds * H3_FPS;
  return 5 + 17 * Math.ceil((targetFrames - 5) / 17);
}

export function createH3ReferencePlan(product: Product): H3ReferencePlan {
  return {
    firstFrame: { source: 'none', description: '', path: null },
    lastFrame: { source: 'selected-product', description: `Exact ${product.shortName} final hero frame`, path: product.imagePath },
    productReference: { source: 'selected-product', description: `${product.officialName} packaging reference`, path: product.imagePath },
    styleReference: { source: 'none', description: '', path: null }
  };
}

/**
 * The simplified H3 setup starts with no planned endpoint or style references.
 * Product knowledge and the local master asset are still included in the
 * ChatGPT context; users can add a reference role only when it helps.
 */
export function createOptionalH3ReferencePlan(_product: Product): H3ReferencePlan {
  void _product;
  return {
    firstFrame: { source: 'none', description: '', path: null },
    lastFrame: { source: 'none', description: '', path: null },
    productReference: { source: 'none', description: '', path: null },
    styleReference: { source: 'none', description: '', path: null }
  };
}

export function isH3ReferenceSelected(asset: H3ReferenceAsset): boolean {
  return asset.source !== 'none';
}

export function resolveH3Workflow(selection: H3WorkflowMode, references: H3ReferencePlan): { mode: H3ResolvedWorkflowMode; reason: string } {
  if (selection !== 'AUTO') {
    return { mode: selection, reason: `${selection} is selected manually; the generator will honor that workflow.` };
  }

  const hasFirstFrame = isH3ReferenceSelected(references.firstFrame);
  const hasLastFrame = isH3ReferenceSelected(references.lastFrame);
  const hasProductReference = isH3ReferenceSelected(references.productReference);
  const hasStyleReference = isH3ReferenceSelected(references.styleReference);

  if (hasFirstFrame && hasLastFrame) {
    return { mode: 'FL2VA', reason: 'Both endpoint references are planned, so FL2VA preserves the controlled opening and exact final landing.' };
  }
  if (hasLastFrame) {
    return { mode: 'L2VA', reason: 'An exact ending is planned without a controlled opening, so L2VA can progressively converge on it.' };
  }
  if (hasFirstFrame) {
    return { mode: 'I2VA', reason: 'A controlled starting image is planned, so I2VA anchors the first frame and develops forward.' };
  }
  if (hasProductReference || hasStyleReference) {
    return { mode: 'REF2VA', reason: 'Reference assets are planned without fixed endpoints, so Ref2VA keeps their identity and style guidance available.' };
  }
  return { mode: 'T2VA', reason: 'No reference image is planned, so T2VA keeps the direction text-led.' };
}

export function requiredH3ReferenceInputs(mode: H3ResolvedWorkflowMode, references: H3ReferencePlan): string[] {
  switch (mode) {
    case 'I2VA': return [`First Frame: ${references.firstFrame.description || 'one exact first-frame image'}`];
    case 'FL2VA': return [
      `First Frame: ${references.firstFrame.description || 'one exact first-frame image'}`,
      `Last Frame: ${references.lastFrame.description || 'one exact final-frame image'}`
    ];
    case 'L2VA': return [`Last Frame: ${references.lastFrame.description || 'one exact final-frame image'}`];
    case 'REF2VA': {
      const mappings = buildH3ReferenceSlotMappings(references);
      if (mappings.length) return mappings.map((mapping) => `Picture ${mapping.pictureNumber}: ${mapping.role} — ${mapping.asset.description || 'connected reference image'}`);
      const inputs: string[] = [];
      if (isH3ReferenceSelected(references.productReference)) inputs.push(`Product Reference: ${references.productReference.description || 'one product reference image'}`);
      if (isH3ReferenceSelected(references.styleReference)) inputs.push(`Style Reference: ${references.styleReference.description || 'one style reference image'}`);
      return inputs.length ? inputs : ['Reference asset(s) as available'];
    }
    case 'T2VA': return [];
  }
}

export interface H3ReferenceSlotMapping {
  pictureNumber: number;
  pictureTag: string;
  refImageIndex: number;
  refInput: string;
  nodeId: string | null;
  role: H3ReferenceRole;
  asset: H3ReferenceAsset;
}

const h3ReferenceSlotNodeIds = ['137', '139'] as const;

function isConcreteH3Reference(asset: H3ReferenceAsset): boolean {
  return asset.source === 'selected-product' || asset.source === 'local-file';
}

function referenceAssetIdentity(asset: H3ReferenceAsset): string {
  return asset.path?.trim().toLowerCase() || `${asset.source}:${cleanText(asset.description).toLowerCase()}`;
}

function defaultRef2VAReferenceSlots(references: H3ReferencePlan): H3ReferenceImageSlot[] {
  if (references.referenceImages?.length) return references.referenceImages;
  const slots: H3ReferenceImageSlot[] = [];
  if (isConcreteH3Reference(references.productReference)) slots.push({ role: 'product-front', asset: references.productReference });
  if (isConcreteH3Reference(references.styleReference)) slots.push({ role: 'style', asset: references.styleReference });
  return slots;
}

/**
 * Resolves stable prompt Picture labels to the ordered image connections that
 * the Ref2VA workflow receives. Duplicate files are collapsed unless callers
 * provide distinct assets, so a single product image never fills two slots.
 */
export function buildH3ReferenceSlotMappings(references: H3ReferencePlan): H3ReferenceSlotMapping[] {
  const seen = new Set<string>();
  return defaultRef2VAReferenceSlots(references)
    .filter((slot) => isConcreteH3Reference(slot.asset))
    .filter((slot) => {
      const identity = referenceAssetIdentity(slot.asset);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    })
    .map((slot, index) => ({
      pictureNumber: index + 1,
      pictureTag: `<Picture ${index + 1}>`,
      refImageIndex: index,
      refInput: `ref_images.ref_image_${index}`,
      nodeId: h3ReferenceSlotNodeIds[index] ?? null,
      role: slot.role,
      asset: slot.asset
    }));
}

function referenceRoleDescription(role: H3ReferenceRole, product: Product, asset: H3ReferenceAsset): string {
  switch (role) {
    case 'product-front': return `${product.shortName} front product identity reference`;
    case 'product-back': return `${product.shortName} rear product identity reference`;
    case 'product-side': return `${product.shortName} side product identity reference`;
    case 'style': return asset.description || 'gallery lighting, palette, and atmosphere reference';
    case 'other': return asset.description || 'additional visual reference';
  }
}

function isProductReferenceRole(role: H3ReferenceRole): boolean {
  return role === 'product-front' || role === 'product-back' || role === 'product-side';
}

function ref2vaSubjectNumber(mapping: H3ReferenceSlotMapping, mappings: H3ReferenceSlotMapping[]): number {
  if (isProductReferenceRole(mapping.role)) return 1;
  const nonProductIndex = mappings.filter((candidate) => !isProductReferenceRole(candidate.role)).indexOf(mapping);
  return nonProductIndex >= 0 ? nonProductIndex + 2 : 1;
}

function cleanText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function sentenceFragment(value: string): string {
  return cleanText(value).replace(/[.!?]+$/, '');
}

function capitalizedSentenceFragment(value: string): string {
  const fragment = sentenceFragment(value);
  return fragment ? `${fragment.charAt(0).toUpperCase()}${fragment.slice(1)}` : fragment;
}

function selectedProductImageReferenceRoles(references: H3ReferencePlan): string[] {
  const roles: string[] = [];
  if (references.productReference.source === 'selected-product' || references.productReference.source === 'local-file') roles.push('Product Reference');
  if (references.firstFrame.source === 'selected-product') roles.push('First Frame');
  if (references.lastFrame.source === 'selected-product') roles.push('Last Frame');
  return roles;
}

function hasProductReferenceContext(references: H3ReferencePlan): boolean {
  return references.productReference.source === 'selected-product'
    || references.productReference.source === 'local-file'
    || references.firstFrame.source === 'selected-product'
    || references.lastFrame.source === 'selected-product';
}

function formatCm(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value).replace(/0+$/, '').replace(/\.$/, '');
}

function fullSeriesRelativeScaleLock(): string {
  const toner = getProduct('toner')!;
  const eyeCream = getProduct('eye-cream')!;
  const serumProduct = getProduct('serum')!;
  const skinCream = getProduct('skin-cream')!;
  const mask = getProduct('mask')!;
  const height = (item: Product) => formatCm(item.physicalIdentity.dimensions.overallHeightCm!);
  const width = (item: Product) => formatCm((item.physicalIdentity.dimensions.widthCm ?? item.physicalIdentity.dimensions.diameterCm)!);
  return `Verified relative-scale lock: Toner and Cleanser share the same ${height(toner)} cm overall height. Eye Cream is slightly shorter at ${height(eyeCream)} cm and dramatically narrower through its 1.5 cm lower body, widening to 3 cm at the top. Serum is substantially shorter at ${height(serumProduct)} cm × ${width(serumProduct)} cm wide. Skin Cream is very low and wide at ${height(skinCream)} cm tall × ${width(skinCream)} cm diameter. Face Mask is the tallest package at ${height(mask)} cm × ${width(mask)} cm. Preserve these measured relationships; never infer one product's dimensions from another or resize products merely to make the composition symmetrical.`;
}

function dimensionProportionLock(product: Product): string {
  if (product.id === 'full-series') return fullSeriesRelativeScaleLock();
  const dimensions = product.physicalIdentity.dimensions;
  const measurements: string[] = [];
  if (dimensions.overallHeightCm !== undefined) measurements.push(`${formatCm(dimensions.overallHeightCm)} cm tall`);
  if (dimensions.diameterCm !== undefined) measurements.push(`${formatCm(dimensions.diameterCm)} cm diameter`);
  else if (dimensions.widthCm !== undefined) measurements.push(`${formatCm(dimensions.widthCm)} cm wide`);
  if (dimensions.widthBottomCm !== undefined) measurements.push(`${formatCm(dimensions.widthBottomCm)} cm wide at bottom`);
  if (dimensions.widthTopCm !== undefined) measurements.push(`${formatCm(dimensions.widthTopCm)} cm wide at top`);
  const components = dimensions.componentMeasurements
    .map((component) => `${component.component}${component.heightCm !== undefined ? ` ${formatCm(component.heightCm)} cm tall` : ''}${component.widthCm !== undefined ? ` × ${formatCm(component.widthCm)} cm wide` : ''}`)
    .join('; ');
  const componentGuidance = components ? ` Component proportion cues: ${components}. Component measurements are non-additive and must not be summed or subtracted to derive unverified dimensions.` : '';
  return `Authoritative measured proportion lock for ${product.shortName}: ${product.physicalIdentity.proportions}; ${measurements.join(', ')}.${componentGuidance} Verified constraints: ${dimensions.notes.join('; ')}.`;
}

function contentsIdentity(product: Product): { owner: Product; contents: NonNullable<Product['physicalIdentity']['contentsAppearance']> } | null {
  if (product.physicalIdentity.contentsAppearance) return { owner: product, contents: product.physicalIdentity.contentsAppearance };
  if (product.id === 'full-series') {
    const serumProduct = getProduct('serum')!;
    if (serumProduct.physicalIdentity.contentsAppearance) return { owner: serumProduct, contents: serumProduct.physicalIdentity.contentsAppearance };
  }
  return null;
}

function revealsProductContents(product: Product, directions: string[]): boolean {
  if (!contentsIdentity(product)) return false;
  const contentNoun = /\b(?:liquid|droplet|droplets|serum\s+texture|texture\s+macro|liquid\s+expos\w*)\b/i;
  const visibleCue = /\b(?:actual|clear|colorless|display\w*|expos\w*|macro|shown|visible|visibly)\b/i;
  const exposureAction = /\b(?:dispens\w*|drip\w*|fall\w*|form\w*|pour\w*|releas\w*|drop\w*|show\w*)\b/i;
  const hiddenContents = /\b(?:no|without|not|never|do\s+not|don't|avoid)\b[\s\S]{0,24}\b(?:actual\s+)?(?:liquid|droplet|droplets|pipette)\b|\b(?:liquid|droplet|droplets|pipette)\b[\s\S]{0,20}\b(?:not\s+(?:shown|visible|exposed)|hidden|concealed)\b/i;
  const showsContents = (direction: string) => contentNoun.test(direction)
    && (visibleCue.test(direction) || exposureAction.test(direction))
    && !hiddenContents.test(direction);
  if (product.id !== 'full-series') return directions.some(showsContents);
  return directions.some((direction) => /\bserum\b/i.test(direction) && showsContents(direction));
}

function revealsRearOrUnprintedSurface(product: Product, directions: string[]): boolean {
  const directSurfaceReveal = /\b(?:rear\s+(?:view|face|surface|side)|back(?:side|\s+(?:view|face|surface|side)|\s+to\s+front)|reverse\s+(?:side|face|view)|unprinted\s+(?:surface|face)|side\s+(?:view|surface|face|profile)|from\s+(?:the\s+)?side|(?:left|right)\s+side)\b/i;
  const revealSurfaceAction = /\b(?:reveal\w*|show\w*|expos\w*|display\w*)\b[\s\S]{0,30}\b(?:rear|back|reverse|side)\b/i;
  const rotationIntent = /\b(?:rotat\w*|turn\w*|spin\w*|orbit\w*|revers\w*|180(?:°|\s*degrees?)?|360(?:°|\s*degrees?)?|full rotation|turntable)\b/i;
  const negatedRotation = /\b(?:no|without|not|never)\b(?:\s+\w+){0,2}\s+\b(?:rotat\w*|turn\w*|spin\w*|orbit\w*|revers\w*|180(?:°|\s*degrees?)?|360(?:°|\s*degrees?)?|full rotation|turntable)\b/i;
  const suppressedSurface = /\b(?:no|without|not|never|do\s+not|don't|avoid)\b[\s\S]{0,32}\b(?:rear|back|reverse|side)\b|\b(?:rear|back|reverse|side)\b[\s\S]{0,20}\b(?:not\s+(?:shown|visible)|hidden|concealed)\b/i;
  const productMention = new RegExp(`\\b(?:product|package|bottle|tube|jar|${product.shortName.replace(/[-\\s]+/g, '[-\\s]+')})\\b`, 'i');
  return directions.some((direction) => !suppressedSurface.test(direction)
    && (directSurfaceReveal.test(direction)
    || revealSurfaceAction.test(direction)
    || (rotationIntent.test(direction) && productMention.test(direction) && !negatedRotation.test(direction))));
}

function rotationSurfaceLock(product: Product): string {
  const { rearSurfaceAppearance, sideSurfaceAppearance } = product.physicalIdentity;
  const verifiedBlank = rearSurfaceAppearance.content.trim().toLowerCase() === 'blank'
    && sideSurfaceAppearance.content.trim().toLowerCase() === 'blank';
  return verifiedBlank
    ? 'If the rear or sides become visible, they are completely blank continuations of the package surface with no printed content.'
    : 'If the rear or sides become visible, follow the verified rear and side surface metadata without inventing printed content.';
}

function frontFacingProductLock(product: Product): string {
  return `Keep the ${product.shortName} front-facing; move light, atmosphere, or the camera around it instead of rotating the product.`;
}

function detachableClosureChoreography(product: Product): string {
  const identity = product.physicalIdentity;
  const hasDetachedLid = identity.packageComponents.some((component) => /detachable lid/i.test(component))
    && identity.referencePresentationState.some((state) => /lid is removed/i.test(state));
  if (!hasDetachedLid) return '';
  return 'Use the same detached lid shown underneath; if the choreography closes the jar, move that lid onto the jar without duplicating it.';
}

function skinCreamLidBehaviorRelevant(product: Product, directions: string[]): boolean {
  if (product.id !== 'skin-cream') return false;
  const lidCue = /\b(?:lid|detached|detach\w*|underneath|removed|remove\w*|open\w*|close\w*|attach\w*|component|closure|jar\s+(?:top|base))\b/i;
  const absentLid = /\b(?:no|without|not|never|do\s+not|don't|avoid)\b[\s\S]{0,20}\b(?:lid|detached|underneath|removed|component|closure)\b/i;
  return directions.some((direction) => lidCue.test(direction) && !absentLid.test(direction));
}

function productSpecificCorrections(product: Product, directions: string[]): string[] {
  const corrections: string[] = [];
  if (product.id === 'cleanser') corrections.push('The tube body is opaque.');
  if (product.id === 'toner') corrections.push('The orange bottle body is opaque and the protective outer cap is transparent.');
  if (product.id === 'serum') {
    corrections.push('The bottle appears opaque/coated.');
    if (revealsProductContents(product, directions)) corrections.push('Any visible serum liquid is clear and colorless.');
  }
  if (skinCreamLidBehaviorRelevant(product, directions)) {
    corrections.push('The white component shown underneath is the detached lid, not part of the jar base.');
  }
  return corrections;
}

function requiresDimensionGuidance(product: Product, directions: string[]): boolean {
  if (product.id === 'full-series') return true;
  const dimensionCue = /\b(?:multiple\s+products?|(?:two|three|four|five|six|several)\s+products?|products?\s+(?:together|side[- ]by[- ]side)|product\s+(?:lineup|collection|series|range)|side[- ]by[- ]side|relative\s+scale|scale\s+accuracy|accurate(?:ly)?\s+(?:scale|scaled|size|sized)|true[- ]to[- ]scale|exact\s+(?:scale|dimensions?)|measured|centimet(?:er|re)|\d+(?:\.\d+)?\s*cm|proportion(?:s)?\s+(?:defect|correction|accuracy)|(?:too|incorrect(?:ly)?)\s+(?:tall|short|wide|narrow)|distort\w*)\b/i;
  return directions.some((direction) => dimensionCue.test(direction));
}

function productAppearanceLock(product: Product, references: H3ReferencePlan, directions: string[] = []): string {
  const corrections = productSpecificCorrections(product, directions);
  if (!hasProductReferenceContext(references)) {
    return [
      `No Product Reference is assigned for ${product.shortName}; do not invent front artwork or other unsupported visible details.`,
      ...corrections,
      'Use only relevant verified product corrections until a reference is supplied.',
      'Do not redesign or replace the product.'
    ].join(' ');
  }

  const base = corrections.length > 1
    ? [
      `Use the supplied Product Reference as the authoritative appearance of ${product.shortName}.`,
      'Keep the referenced product visually consistent throughout the video; preserve its packaging identity, proportions, front artwork and overall appearance.'
    ]
    : [
      `Use the supplied Product Reference as the authoritative appearance of ${product.shortName}.`,
      'Keep the referenced product visually consistent throughout the video.',
      'Preserve its packaging identity, proportions, front artwork and overall appearance.'
    ];
  return [...base, ...corrections, 'Do not redesign or replace the product.'].join(' ');
}

function productReferenceAuthorityContext(product: Product, references: H3ReferencePlan, directions: string[] = []): string[] {
  const selectedImageRoles = selectedProductImageReferenceRoles(references);
  const customProductReference = references.productReference.source === 'custom';
  if (selectedImageRoles.length) {
    const imageDescription = references.productReference.source === 'local-file' ? 'the selected local product image' : 'the selected product master image';
    return [
      `Product reference image used: YES — ${imageDescription} is assigned to ${selectedImageRoles.join(', ')}.`,
      h3ProductReferenceAuthorityInstruction,
      `Product reference lock: ${productAppearanceLock(product, references, directions)}`
    ];
  }

  if (customProductReference) {
    return [
      'Product reference image used: NO local product image is assigned; the Product Reference role contains a custom description only.',
      'If the user attaches a product image during the handoff, that image immediately becomes the authoritative source for visible appearance and overrides generic material assumptions.',
      `Product guidance until an image is attached: ${productAppearanceLock(product, references, directions)}`
    ];
  }

  return [
    'Product reference image used: NO — no selected product image is assigned to a product-bearing reference role in this request.',
    'If a product image is supplied later, it becomes authoritative immediately; do not reconstruct front artwork from text.',
    `Product guidance until an image is supplied: ${productAppearanceLock(product, references, directions)}`
  ];
}

function displaySeconds(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
}

function displayRange(start: number, end: number): string {
  return `${displaySeconds(start)}–${displaySeconds(end)} sec`;
}

export function buildH3Timeline(durationSeconds: number, product: Product, concept: H3Concept | null, mode: H3ResolvedWorkflowMode, ending: H3Ending, customEnding = '', actionDescription = ''): H3TimelineSegment[] {
  const duration = clampH3Duration(durationSeconds);
  const points = [
    0,
    Number((duration / 6).toFixed(1)),
    Number((duration * 0.7).toFixed(1)),
    Number((duration * 13 / 15).toFixed(1)),
    duration
  ];
  const finalState = ending === 'Custom' ? cleanText(customEnding) || 'a clean final product state' : ending.toLowerCase();
  const referenceOpening = mode === 'I2VA' || mode === 'FL2VA' ? 'the exact supplied first frame' : 'the opening state';
  const referenceEnding = mode === 'L2VA' || mode === 'FL2VA' ? 'the exact supplied final reference' : `the ${finalState}`;
  return [
    { start: points[0], end: points[1], label: 'Establish the opening', detail: `Begin on ${referenceOpening}; establish ${product.shortName} context, scale, light, and readable spatial orientation.` },
    { start: points[1], end: points[2], label: 'Action onset', detail: `Introduce the first physical movement with a clear cause and direction; the camera begins its planned motion without losing the subject.` },
    { start: points[2], end: points[3], label: 'Continuous development', detail: concept?.mainAction || cleanText(actionDescription) || 'Develop the central action through visible intermediate steps while maintaining spatial continuity.' },
    { start: points[3], end: points[4], label: 'Settle and hold', detail: `Resolve into ${referenceEnding}; hold the ${finalState} long enough for a clean, stable read.` }
  ];
}

function cameraApproach(motion: H3CameraMotion): string {
  switch (motion) {
    case 'Static': return 'Locked-off camera; no travel, no orbit, no sudden reframing; subject motion carries the shot.';
    case 'Low': return 'Slow forward dolly, approximately 10% frame-width travel, low amplitude, with a gentle shift from medium framing to a closer view.';
    case 'Medium': return 'Controlled three-quarter dolly-orbit, approximately 20% frame-width travel, moderate amplitude, widening briefly to reveal the action before returning to the product.';
    case 'High': return 'Energetic but legible tracking move with a broad 35% frame-width arc, higher amplitude, and a deliberate push toward the final product.';
    case 'Cinematic': return 'Measured cinematic push-in with a smooth 20–25% arc, low-to-medium amplitude, subtle parallax, and a precise final framing lock.';
  }
}

function choreographyFor(idea: string, product: Product, intensity: H3ActionIntensity): string {
  const architectural = /building|architecture|facade|mecha|mechanical|structure|transform|transformation/i.test(idea);
  const detachableClosure = skinCreamLidBehaviorRelevant(product, [idea]) ? detachableClosureChoreography(product) : '';
  if (architectural) {
    return `The central action is observable and sequential: facade panels unlock and separate; structural sections slide inward; columns retract; floors compress; components rotate around the vertical axis; the new ${product.shortName} silhouette emerges; ${detachableClosure ? 'its components align without duplication' : 'the package settles into place'}; surfaces align; final seams close; the exact product locks into place. Use ${intensity.toLowerCase()} action intensity while keeping every intermediate step readable, physically motivated, and continuous rather than using a vague morph or dissolve.${detachableClosure ? ` ${detachableClosure}` : ''}`;
  }
  return `Stage the main action as visible cause and effect: the opening subject moves first; separate surfaces or particles gather in a controlled direction; the material resolves through at least three observable intermediate steps; the ${product.shortName} silhouette becomes clear; its components settle and align; final seams close before the product holds. Use ${intensity.toLowerCase()} action intensity and do not summarize the action as simply “transform.”${detachableClosure ? ` ${detachableClosure}` : ''}`;
}

function productReferenceDescription(asset: H3ReferenceAsset, product: Product, fallback: string): string {
  if (asset.source === 'selected-product' && (!asset.description || asset.description === `${product.officialName} packaging reference`)) {
    return `the supplied ${product.shortName} product reference`;
  }
  return asset.description || fallback;
}

function referenceAlignment(mode: H3ResolvedWorkflowMode, references: H3ReferencePlan, product: Product): string[] {
  switch (mode) {
    case 'T2VA': return [
      '  no_reference_images: true',
      '  instruction: Build the scene and action from the written description only; do not invent unsupported visible product packaging or material behavior.'
    ];
    case 'I2VA': return [
      `  <Picture 1>: exact first-frame image; place it at the start of the target video without changing its subject identity or geometry${references.firstFrame.source === 'selected-product' ? ' or reference-visible appearance' : ''}.`,
      `  progression: ${references.firstFrame.source === 'selected-product' ? 'The first-frame product image is the visual anchor; develop motion forward from <Picture 1> while preserving its exact product appearance' : 'Use <Picture 1> as the visual anchor and develop motion forward while preserving its subject identity'} and maintaining understandable spatial continuity.`
    ];
    case 'FL2VA': return [
      '  <Picture 1>: exact first-frame image; begin the target video on this image without changing its subject identity or geometry.',
      `  <Picture 2>: exact final-frame image; land accurately on this image at the end${references.lastFrame.source === 'selected-product' ? ', preserving its exact reference-visible product appearance rather than recreating an approximation' : ''}.`,
      '  progression: Prefer one continuous transformation shot and describe the observable physical path from <Picture 1> to <Picture 2>; if the final frame is a product image, the action must converge onto that exact product appearance and must not cut away from endpoint continuity.'
    ];
    case 'L2VA': return [
      `  <Picture 1>: exact final-frame image; use it as the immutable ending target${references.lastFrame.source === 'selected-product' ? ', including its unchanged reference-visible product appearance' : ''}.`,
      `  progression: Infer a plausible earlier state, develop progressively toward <Picture 1>, and converge accurately${references.lastFrame.source === 'selected-product' ? ' without inventing a different package or changing the final product appearance' : ' without changing the final reference appearance'}.`
    ];
    case 'REF2VA': {
      const lines: string[] = [];
      let index = 1;
      if (isH3ReferenceSelected(references.productReference)) {
        lines.push(`  <Picture ${index}>: PRODUCT IDENTITY reference — ${productReferenceDescription(references.productReference, product, 'one view of the supplied product')}. It is the sole authoritative source for the visible product; do not use it as a style reference.`);
        index += 1;
      }
      if (isH3ReferenceSelected(references.styleReference)) lines.push(`  <Picture ${index}>: STYLE reference only — ${references.styleReference.description || 'use for lighting, palette, and atmosphere only'}; it cannot change product identity.`);
      lines.push('  progression: Keep all product references as views of one physical product. Use the product identity reference for packaging appearance and any style reference only for lighting, palette, or atmosphere.');
      return lines;
    }
  }
}

function productKnowledge(product: Product, includeDimensionGuidance: boolean, hasReference: boolean): string[] {
  const references = getProductReferencePaths(product).join(', ');
  return [
    `  product: ${product.shortName}`,
    ...(includeDimensionGuidance
      ? [`  dimension_proportion_lock: ${dimensionProportionLock(product)}`]
      : hasReference ? ['  dimension_guidance: Preserve the proportions shown in the supplied reference.'] : []),
    `  reference_files: ${references}`,
    `  verified_benefit_territory: ${product.benefitTerritories.slice(0, 3).join('; ')}.`,
    `  claim_safety: ${claimRules.rule}`
  ];
}

function endingLabel(brief: H3VideoBrief): string {
  return brief.ending === 'Custom' ? cleanText(brief.customEnding) || 'custom final state' : brief.ending;
}

function goalLabel(brief: H3VideoBrief): string {
  return brief.goal === 'Other' ? cleanText(brief.customGoal) || 'Product-focused creative film' : cleanText(brief.goal) || 'Product-focused creative film';
}

interface H3TextAudioOptions {
  language: Language;
  musicOnly: boolean;
  captions: boolean;
  subtitles: boolean;
  sound: H3Sound;
}

/**
 * New H3 records always carry these values. The fallbacks keep older saved
 * records and callers that still use the legacy sound field understandable.
 */
function h3TextAudioOptions(brief: H3VideoBrief): H3TextAudioOptions {
  const musicOnly = typeof brief.musicOnly === 'boolean' ? brief.musicOnly : brief.sound === 'Music Only';
  return {
    language: brief.language === 'English' ? 'English' : 'Indonesian',
    musicOnly,
    captions: brief.captions === true,
    subtitles: musicOnly ? false : brief.subtitles === true,
    sound: musicOnly ? 'Music Only' : brief.sound === 'Music Only' ? 'Auto' : brief.sound
  };
}

function yesNo(value: boolean): 'Yes' | 'No' {
  return value ? 'Yes' : 'No';
}

function h3LanguageAndTextAudioGuidance(brief: H3VideoBrief): string[] {
  const options = h3TextAudioOptions(brief);
  const captionsGuidance = options.captions
    ? `When captions are enabled, choose concise creative copy for this concept, keep it readable and sparse, specify approximately when each caption appears, respect verified claims, preserve negative space, and do not cover the hero product unnecessarily. UGC captions may feel native to TikTok/Reels; cinematic advertising captions should be more minimal and polished.`
    : 'When captions are disabled, do not add marketing text or caption overlays unless the user explicitly requests them in the Idea / Instructions field. Naturally visible packaging text remains part of the real product.';
  const subtitlesGuidance = options.subtitles
    ? `When subtitles are enabled, use text matching the spoken dialogue, narration, or voiceover in ${options.language}; Indonesian speech gets Indonesian subtitles and English speech gets English subtitles, match the spoken script, include the spoken script and corresponding subtitle wording in the H3 direction when useful, keep it readable and synchronized where supported, use a consistent lower safe-area placement, avoid covering the product, and do not create bilingual subtitles.`
    : options.musicOnly
      ? 'Subtitles are unavailable because Music Only has no speech to transcribe.'
      : 'When subtitles are disabled, do not add subtitles or transcription unless the user explicitly requests them.';

  return [
    `Language: ${options.language}`,
    `Music Only: ${yesNo(options.musicOnly)}`,
    `Captions: ${yesNo(options.captions)}`,
    `Subtitles: ${yesNo(options.subtitles)}`,
    `Language rule: All newly generated human-facing language in the video must be in ${options.language}, including spoken dialogue, voiceover, UGC creator speech, captions, subtitles, hooks, CTA wording, and any intentional on-screen copy.`,
    'Locked branding rule: Do not translate official product names, logos, packaging text, ingredient names, or other locked branding unless the verified brand/product data explicitly allows it. Preserve official names exactly as supplied.',
    options.musicOnly
      ? 'Music Only: No spoken dialogue, voiceover, creator speech, narration, or other speech. Include music or a soundtrack; sound effects may still be used where appropriate unless the user explicitly asks for music with no sound effects. Music Only does not mean no visual text; Captions may remain enabled because intentional on-screen copy does not require speech.'
      : 'Music Only: No — spoken dialogue, voiceover, narration, and sound direction may be used when appropriate for the concept and user instructions.',
    `Captions: Creative on-screen text/headlines selected for the video concept. ${captionsGuidance}`,
    `Subtitles: Text that follows spoken dialogue/voiceover. They are speech transcription, not additional marketing headlines. ${subtitlesGuidance}`
  ];
}

type H3RenderSceneMode = 'stationary' | 'rotation' | 'product-action' | 'transformation';

function requestsExplicitTransformation(directions: string[]): boolean {
  const text = directions.filter(Boolean).join(' ');
  const negated = /\b(?:no|without|not|never|do\s+not|don't|avoid)\b[\s\S]{0,24}\b(?:transform\w*|morph\w*|assembl\w*|build\w*|construct\w*|reconfig\w*|materiali[sz]\w*)\b/i;
  if (negated.test(text)) return false;
  return /\b(?:transform\w*|morph\w*|assembl\w*|build\w*|construct\w*|reconfig\w*|materiali[sz]\w*)\b/i.test(text)
    || /\b(?:reveal\w*|unveil\w*)\b[\s\S]{0,48}\b(?:from|out of|behind|through|particles?|structure|assembly|material|opening)\b/i.test(text)
    || /\b(?:building|facade|structure)\b[\s\S]{0,48}\b(?:become\w*|turn\w*|collapse\w*|resolve\w*|reconfigur\w*)\b/i.test(text);
}

function renderSceneMode(product: Product, directions: string[]): H3RenderSceneMode {
  if (requestsExplicitTransformation(directions)) return 'transformation';
  if (revealsRearOrUnprintedSurface(product, directions)) return 'rotation';
  if (revealsProductContents(product, directions) || skinCreamLidBehaviorRelevant(product, directions)) return 'product-action';
  return 'stationary';
}

function renderLockedProductPlateInstruction(product: Product, brief: H3VideoBrief): string {
  const plan = buildH3LockedProductPlatePlan(product, brief);
  return plan.enabled
    ? 'locked_product_plate: Use the supplied product image as an unmodified foreground plate; animate only the surrounding environment and never repaint source pixels.'
    : '';
}

interface H3RenderNarrative {
  idea: string;
  visualHook: string;
  creativeArchetype: string;
  environment: string;
  composition: string;
  framing: string;
  lightingStyle: string;
  primaryMotion: string;
  secondaryMotion: string;
  pacing: string;
  audioCharacter: string;
  directions: string[];
  sceneMode: H3RenderSceneMode;
  action: string;
  directedAction: string | null;
  setting: string;
  camera: string;
  finalState: string;
  style: string;
  material: string;
  transition: string;
  opening: string;
}

function buildH3RenderNarrative(product: Product, brief: H3VideoBrief, concept: H3Concept | null): H3RenderNarrative {
  const genome = brief.creativeGenome;
  const idea = cleanText(brief.videoIdea) || cleanText(genome?.visualHook ?? '') || `A premium ${product.shortName} product film.`;
  const visualHook = cleanText(genome?.visualHook ?? '') || idea;
  const creativeArchetype = cleanText(genome?.creativeArchetype ?? '') || 'Premium live-action skincare advertising';
  const environment = cleanText(genome?.environment ?? '') || 'a premium warm-lit skincare studio';
  const composition = cleanText(genome?.composition ?? '') || 'a clean product-priority composition with clear negative space';
  const framing = cleanText(genome?.framing ?? '') || 'a readable medium hero frame';
  const lightingStyle = cleanText(genome?.lightingStyle ?? '') || 'controlled warm light with a clean editorial finish';
  const pacing = cleanText(genome?.pacing ?? '') || brief.pacing.toLowerCase();
  const audioCharacter = cleanText(genome?.audioCharacter ?? '') || 'sparse electronic pulses and sustained tones';
  const directions = [brief.videoIdea, brief.specialInstructions, concept?.mainAction ?? '', genome?.primaryMotion ?? '', genome?.secondaryMotion ?? ''];
  const sceneMode = renderSceneMode(product, directions);
  const primaryMotion = cleanText(genome?.primaryMotion ?? '') || cleanText(concept?.mainAction ?? '') || (sceneMode === 'stationary'
    ? `the environment shifts around the ${product.shortName} without moving the product`
    : sceneMode === 'rotation'
      ? `the ${product.shortName} rotates through the requested view and returns to front`
      : sceneMode === 'product-action'
        ? idea
        : choreographyFor(idea, product, brief.actionIntensity));
  const secondaryMotion = cleanText(genome?.secondaryMotion ?? '') || 'subtle environmental movement supports the main action';
  const directedAction = concept?.mainAction || genome?.primaryMotion || null;
  const action = directedAction || choreographyFor(idea, product, brief.actionIntensity);
  return {
    idea,
    visualHook,
    creativeArchetype,
    environment,
    composition,
    framing,
    lightingStyle,
    primaryMotion,
    secondaryMotion,
    pacing,
    audioCharacter,
    directions,
    sceneMode,
    action,
    directedAction,
    setting: `Set it in ${environment}; use ${composition} and ${framing}.`,
    style: `${creativeArchetype} beauty-film language with ${lightingStyle}.`,
    camera: genome ? genome.cameraPath : cameraApproach(brief.cameraMotion),
    material: genome?.materialEffect || 'controlled light, atmosphere, and restrained material motion around the product',
    transition: genome?.transitionLanguage || 'the action develops continuously into the final product hold',
    opening: genome?.openingDevice || 'begin with the scene already established and the subject clearly readable',
    finalState: genome?.endingDevice || (brief.ending === 'Custom' ? cleanText(brief.customEnding) || 'the requested final state' : brief.ending.toLowerCase())
  };
}

function h3CutTime(duration: number, fraction: number): number {
  const candidate = Number((duration * fraction).toFixed(3));
  return Math.min(duration - 0.001, Math.max(0.001, candidate));
}

function h3ShotTimestamp(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = (seconds - minutes * 60).toFixed(3).padStart(6, '0');
  return `${String(minutes).padStart(2, '0')}:${remainder}`;
}

function h3ReferenceAnchor(mode: H3ResolvedWorkflowMode, references: H3ReferencePlan, finalShotNumber: number): string {
  switch (mode) {
    case 'I2VA':
      return isH3ReferenceSelected(references.firstFrame) ? 'The shot begins from <Picture 1>, which is fully referenced at 0.00 seconds.' : 'Begin from the written opening state.';
    case 'FL2VA':
      return `${isH3ReferenceSelected(references.firstFrame) ? 'Begin from <Picture 1> as the exact first-frame composition.' : 'Establish the opening composition.'} ${isH3ReferenceSelected(references.lastFrame) ? `Converge continuously toward <Picture 2> in [Shot ${finalShotNumber}].` : ''}`.trim();
    case 'L2VA':
      return isH3ReferenceSelected(references.lastFrame) ? `Infer a plausible preceding state, then converge toward <Picture 1> in [Shot ${finalShotNumber}] as the exact final frame.` : 'Infer a plausible preceding state from the written direction.';
    case 'REF2VA': return '';
    case 'T2VA': return 'Build the audiovisual timeline from the written direction only.';
  }
}

function h3ProductIdentityAnchor(mode: H3ResolvedWorkflowMode, references: H3ReferencePlan, product: Product): string {
  if (mode === 'I2VA' && isH3ReferenceSelected(references.firstFrame)) return `<Picture 1> is the exact first-frame source for the ${product.shortName}; keep its visible identity and geometry unchanged.`;
  if (mode === 'FL2VA' && isH3ReferenceSelected(references.firstFrame)) return `<Picture 1> establishes the ${product.shortName} starting appearance; preserve it while the action develops.`;
  if ((mode === 'FL2VA' || mode === 'L2VA') && isH3ReferenceSelected(references.lastFrame)) return `The final product appearance must converge onto ${mode === 'FL2VA' ? '<Picture 2>' : '<Picture 1>'} without redesign.`;
  if (mode === 'T2VA') return `No image reference is attached for the ${product.shortName}; do not invent unsupported package artwork.`;
  return '';
}

function h3MotionDescription(product: Product, narrative: H3RenderNarrative): string {
  if (narrative.sceneMode === 'stationary') {
    const directedMotion = narrative.directedAction ? ` The environment first moves as ${sentenceFragment(narrative.directedAction)}.` : '';
    return `Keep the ${product.shortName} physically unchanged; animate only the environment.${directedMotion}`;
  }
  if (narrative.sceneMode === 'rotation') return `Rotate the ${product.shortName} slowly through the requested rear and side surfaces, then return to front; preserve its reference appearance and proportions. ${rotationSurfaceLock(product)}`;
  if (narrative.sceneMode === 'product-action') {
    if (product.id === 'serum' && revealsProductContents(product, narrative.directions)) return 'Lift the Serum dropper and release one visible clear, colorless liquid droplet; keep the opaque/coated bottle front-facing and unchanged.';
    if (product.id === 'skin-cream' && skinCreamLidBehaviorRelevant(product, narrative.directions)) return `${sentenceFragment(narrative.idea)}. Keep the Skin Cream jar identity unchanged; move only the requested lid or closure.`;
    return `${sentenceFragment(narrative.idea)}. Preserve the referenced product appearance while carrying out only the requested product action.`;
  }
  return narrative.action;
}

function h3CameraDescription(product: Product, brief: H3VideoBrief, sceneMode: H3RenderSceneMode, cameraOverride: string): string {
  if (sceneMode === 'stationary' || sceneMode === 'product-action') {
    return brief.cameraMotion === 'Static'
      ? 'Use a locked-off straight-on camera.'
      : 'Use a slow straight push-in; no orbit or meaningful perspective change across the product.';
  }
  if (sceneMode === 'rotation') return `Keep the camera steady while the ${product.shortName} rotates through the requested rear/side view; preserve readable scale.`;
  return `Use ${sentenceFragment(cameraOverride)}.`;
}

function h3FinalStateDescription(product: Product, narrative: H3RenderNarrative, mode: H3ResolvedWorkflowMode, references: H3ReferencePlan): string {
  if (mode === 'FL2VA' && isH3ReferenceSelected(references.lastFrame)) return 'End on <Picture 2> as the exact final-frame composition and hold it clearly.';
  if (mode === 'L2VA' && isH3ReferenceSelected(references.lastFrame)) return 'End on <Picture 1> as the exact final-frame composition and hold it clearly.';
  if (narrative.sceneMode === 'rotation') return `End front-facing after the rotation and hold a readable ${product.shortName} hero shot.`;
  if (narrative.sceneMode === 'product-action' && product.id === 'serum') return 'Let the droplet finish, then hold on the unchanged front-facing Serum bottle.';
  return `Hold the unchanged, front-facing ${product.shortName} in the ${narrative.finalState} state with the product readable.`;
}

function lowerInitial(value: string): string {
  const fragment = sentenceFragment(value);
  return fragment ? `${fragment.charAt(0).toLowerCase()}${fragment.slice(1)}` : fragment;
}

export interface Ref2VAFieldRepair {
  field: CreativeGenomeAxis;
  before: string;
  after: string;
}

export interface Ref2VACoherenceRepair {
  rule: CreativeGenomeCompatibilityRuleId;
  changedFields: Ref2VAFieldRepair[];
  rationale: string;
}

export interface Ref2VACoherenceResult {
  genome: CreativeGenome | null;
  /** Conflicts found in the selected planning genome before realization. */
  issues: CreativeGenomeCompatibilityIssue[];
  /** Conflicts still present after the minimal realization repairs. */
  unresolvedIssues: CreativeGenomeCompatibilityIssue[];
  repairs: Ref2VACoherenceRepair[];
}

function ref2vaProductName(product: Product): string {
  return `PROYA ${product.shortName}`;
}

function addRef2VARepair(repairs: Ref2VACoherenceRepair[], rule: CreativeGenomeCompatibilityRuleId, rationale: string, field: CreativeGenomeAxis, before: string, after: string): void {
  if (before === after) return;
  const repair = repairs.find((candidate) => candidate.rule === rule);
  if (repair) {
    repair.changedFields.push({ field, before, after });
    return;
  }
  repairs.push({ rule, changedFields: [{ field, before, after }], rationale });
}

function lowerDestinationCameraPath(path: string): string {
  return sentenceFragment(path)
    .replace(/\bupwards?\b/gi, 'downward')
    .replace(/\brises?\b/gi, 'descends')
    .replace(/\brising\b/gi, 'descending')
    .replace(/\bascends?\b/gi, 'descends')
    .replace(/\bascending\b/gi, 'descending')
    .replace(/\bcrane\s+up\b/gi, 'crane downward');
}

function upperDestinationCameraPath(path: string): string {
  return sentenceFragment(path)
    .replace(/\bdownwards?\b/gi, 'upward')
    .replace(/\bdescends?\b/gi, 'rises')
    .replace(/\bdescending\b/gi, 'rising')
    .replace(/\blowers?\b/gi, 'raises')
    .replace(/\blowering\b/gi, 'rising')
    .replace(/\bcrane\s+down\b/gi, 'crane upward');
}

function ref2vaOrbitRepairPath(product: Product, genome: CreativeGenome): string {
  const text = `${genome.visualHook} ${genome.environment} ${genome.composition} ${genome.primaryMotion}`.toLowerCase();
  if (product.id === 'cleanser' || /botanical|greenhouse|pollen|particle|halo|leaf/.test(text)) {
    return 'small lateral truck alongside the atmospheric halo with minimal parallax';
  }
  if (/editorial|tabletop|paper|mineral|magazine/.test(text)) {
    return 'controlled lateral track across the set with minimal perspective change';
  }
  return 'controlled push-in with minimal perspective change across the product';
}

function repairOverheadAxis(value: string): string {
  return sentenceFragment(value)
    .replace(/\boverhead[- ]to[- ]front\b/gi, 'shallow-tabletop-to-front')
    .replace(/\bflat[- ]lay\b/gi, 'shallow tabletop')
    .replace(/\btop[- ]down\b/gi, 'shallow tabletop')
    .replace(/\btrue\s+overhead\b/gi, 'shallow tabletop')
    .replace(/\boverhead\b/gi, 'shallow tabletop');
}

function ref2vaRepairDirections(product: Product, genome: CreativeGenome, directions: readonly string[]): { productOrientationLocked: boolean } {
  const sceneDirections = [
    ...directions,
    genome.primaryMotion
  ];
  const mode = renderSceneMode(product, sceneDirections);
  return { productOrientationLocked: mode !== 'rotation' && mode !== 'transformation' };
}

/**
 * Validate and minimally repair only the realized Ref2VA copy of a genome.
 * Product truth and the selected planning genome remain unchanged.
 */
export function repairRef2VACreativeGenome(product: Product, genome: CreativeGenome | null | undefined, directions: readonly string[] = []): Ref2VACoherenceResult {
  if (!genome) return { genome: null, issues: [], unresolvedIssues: [], repairs: [] };

  const { productOrientationLocked } = ref2vaRepairDirections(product, genome, directions);
  const realized = { ...genome };
  const issues = assessCreativeGenomeCompatibility(realized, { productOrientationLocked });
  const repairs: Ref2VACoherenceRepair[] = [];

  for (const issue of issues) {
    if (issue.rule === 'stationary-front-facing-orbit') {
      const before = realized.cameraPath;
      const after = ref2vaOrbitRepairPath(product, realized);
      realized.cameraPath = after;
      addRef2VARepair(repairs, issue.rule, 'Preserve the product orientation and the visual hook; replace the conflicting product orbit with a low-parallax environmental move.', 'cameraPath', before, after);
    } else if (issue.rule === 'upright-overhead-label-read') {
      for (const field of ['openingDevice', 'composition', 'framing', 'cameraPath'] as CreativeGenomeAxis[]) {
        const before = realized[field];
        const after = repairOverheadAxis(before);
        realized[field] = after;
        addRef2VARepair(repairs, issue.rule, 'Keep the editorial/tabletop concept and front-label truth; change the viewing geometry from true overhead to a shallow tabletop angle.', field, before, after);
      }
    } else if (issue.rule === 'camera-destination-direction') {
      const spatialText = [realized.environment, realized.composition, realized.openingDevice, realized.transitionLanguage, realized.endingDevice].join(' ').toLowerCase();
      const before = realized.cameraPath;
      const after = /\b(?:lower|bottom|below|base|ground[- ]level)\b[\s\w-]{0,24}\b(?:hero|product|chamber|platform|pool|stage|position|frame)\b/.test(spatialText)
        ? lowerDestinationCameraPath(before)
        : upperDestinationCameraPath(before);
      realized.cameraPath = after;
      addRef2VARepair(repairs, issue.rule, 'Aim the camera toward the named destination so the shot reaches the hero position rather than moving away from it.', 'cameraPath', before, after);
    }
  }

  return {
    genome: realized,
    issues,
    unresolvedIssues: assessCreativeGenomeCompatibility(realized, { productOrientationLocked }),
    repairs
  };
}

function ref2vaIndefiniteArticle(value: string): string {
  return /^[aeiou]/i.test(sentenceFragment(value)) ? 'an' : 'a';
}

function ref2vaNounPhrase(value: string): string {
  const fragment = lowerInitial(value);
  if (!fragment || /^(?:a|an|the|this|that|one|two|three|four|five|six|several)\b/i.test(fragment)) return fragment;
  return `${ref2vaIndefiniteArticle(fragment)} ${fragment}`;
}

function ref2vaOpeningClause(value: string): string {
  const fragment = sentenceFragment(value);
  if (!fragment) return 'The film begins with the environment already established.';
  if (/^begin\s+in\b/i.test(fragment)) return `The film begins in ${lowerInitial(fragment.replace(/^begin\s+in\s+/i, ''))}.`;
  if (/^(?:begin|start)\s+with\b/i.test(fragment)) return `It begins with ${lowerInitial(fragment.replace(/^(?:begin|start)\s+with\s+/i, ''))}.`;
  if (/^open\s+on\b/i.test(fragment)) return `The first image is ${lowerInitial(fragment.replace(/^open\s+on\s+/i, ''))}.`;
  if (/^open\s+inside\b/i.test(fragment)) return `The first image is inside ${lowerInitial(fragment.replace(/^open\s+inside\s+/i, ''))}.`;
  if (/^start\s+on\b/i.test(fragment)) return `The first image rests on ${lowerInitial(fragment.replace(/^start\s+on\s+/i, ''))}.`;
  return `The first image shows ${lowerInitial(fragment)}.`;
}

function ref2vaFinalFraming(narrative: H3RenderNarrative): string {
  const framing = sentenceFragment(narrative.framing);
  const stages = framing.split(/\s+to\s+|\s+into\s+/i).map((stage) => lowerInitial(stage.trim())).filter(Boolean);
  return ref2vaNounPhrase(stages.at(-1) || lowerInitial(framing) || 'a readable hero composition');
}

function ref2vaPoseSentence(product: Product, narrative: H3RenderNarrative): string {
  if (narrative.sceneMode === 'rotation') return `<Subject 1> turns only through the requested view, retaining the reference proportions and visible finish.`;
  if (narrative.sceneMode === 'transformation') return `<Subject 1> remains the visual identity anchor as the surrounding forms reorganize around it.`;
  if (narrative.sceneMode === 'product-action') return `<Subject 1> stays readable and reference-consistent while only the requested ${product.shortName.toLowerCase()} action occurs.`;
  return `<Subject 1> stands upright and front-facing at the hero position; its geometry stays unchanged while the environment does the moving.`;
}

function ref2vaActionSentence(product: Product, narrative: H3RenderNarrative): string {
  if (narrative.sceneMode === 'rotation' || narrative.sceneMode === 'product-action' || narrative.sceneMode === 'transformation') {
    return h3MotionDescription(product, narrative);
  }
  const primary = lowerInitial(narrative.primaryMotion);
  const secondary = lowerInitial(narrative.secondaryMotion);
  if (!primary) return 'The visible environment moves in one continuous, legible direction.';
  if (!secondary) return `${capitalizedSentenceFragment(primary)}.`;
  return `As ${primary}, ${secondary}.`;
}

function ref2vaMaterialSentence(narrative: H3RenderNarrative): string {
  const material = lowerInitial(narrative.material);
  if (!material) return '';
  return `The visible texture comes from ${material}.`;
}

function ref2vaPacingSentence(narrative: H3RenderNarrative): string {
  const pacing = narrative.pacing.toLowerCase();
  if (/organic|bloom/.test(pacing)) return 'The scene unfolds in measured beats, like a controlled bloom.';
  if (/editorial|composed/.test(pacing)) return 'The rhythm remains composed, allowing each object to land cleanly.';
  if (/slow|dreamlike|deliberate|measured|calm/.test(pacing)) return 'The reveal takes an unhurried path, reserving the clearest product read for the settle.';
  if (/fast|rapid|energetic|bold|confident/.test(pacing)) return 'The movement stays brisk but controlled, with each change readable before the next begins.';
  return '';
}

function ref2vaLightingSentence(narrative: H3RenderNarrative): string {
  const lighting = lowerInitial(narrative.lightingStyle);
  return lighting ? `The light is ${lighting}, keeping the product surface controlled and legible.` : '';
}

function ref2vaCameraSentence(narrative: H3RenderNarrative): string {
  const path = sentenceFragment(narrative.camera);
  const lowerPath = path.toLowerCase();
  const framing = ref2vaFinalFraming(narrative);
  if (/shallow[- ]tabletop[- ]to[- ]front/.test(lowerPath)) {
    return `The camera glides from a shallow tabletop detail into ${framing}, stopping at a clean front-facing read rather than looking straight down.`;
  }
  if (/downward|descend|lower/.test(lowerPath)) {
    const destination = /lower hero chamber|lower chamber/.test(`${narrative.environment} ${narrative.composition}`.toLowerCase()) ? 'toward the lower hero chamber' : 'through the composition';
    return `The camera descends with a controlled, ${/slow|gentle|measured/.test(lowerPath) ? 'slow' : 'measured'} move ${destination}, settling into ${framing}.`;
  }
  if (/upward|rise|crane/.test(lowerPath)) return `The camera cranes upward through the composition and settles into ${framing}.`;
  if (/focus pull|rack focus|focus plane/.test(lowerPath)) return `The camera stays nearly still while focus moves onto the product, finishing in ${framing}.`;
  if (/lateral|sideways|slider|track|truck/.test(lowerPath)) return `A restrained lateral move follows the environmental action with minimal parallax, finishing in ${framing}.`;
  if (/orbit|orbital|circular|circle|arc/.test(lowerPath)) return `The camera makes a small environmental arc with the product kept nearly frontal, then settles into ${framing}.`;
  if (/push|dolly|forward|drift|glide/.test(lowerPath)) return `The camera moves forward with measured restraint, arriving at ${framing}.`;
  if (/locked[- ]?off|static|no travel/.test(lowerPath)) return `The camera remains still, holding ${framing}.`;
  return path ? `The camera follows ${lowerInitial(path)} and ends in ${framing}.` : `The camera holds a clear ${framing}.`;
}

function ref2vaTransitionClause(narrative: H3RenderNarrative): string {
  const transition = lowerInitial(narrative.transition);
  return transition ? `The transition lands when ${transition}.` : '';
}

function ref2vaEndingClause(narrative: H3RenderNarrative): string {
  const ending = lowerInitial(narrative.finalState);
  if (!ending) return 'The final frame settles on a readable hero.';
  const transition = ending.match(/^transition\s+into\s+(.+)/i);
  if (transition) return `The closing beat transitions into ${ref2vaNounPhrase(transition[1])}, then holds a readable hero frame.`;
  if (/\bhold\b/i.test(ending)) return `The closing image is ${ref2vaNounPhrase(ending)}, with the product left clear and stable.`;
  return `The set settles into ${ref2vaNounPhrase(ending)}, leaving the product clear for the final beat.`;
}

type Ref2VAWritingMode = 'gallery' | 'botanical' | 'editorial' | 'fluid' | 'architectural' | 'light' | 'generic';

function ref2vaWritingMode(narrative: H3RenderNarrative): Ref2VAWritingMode {
  const text = [
    narrative.creativeArchetype,
    narrative.visualHook,
    narrative.environment,
    narrative.composition,
    narrative.material
  ].join(' ').toLowerCase();
  if (/gallery|chamber|suspended frame|vertical frame|nested depth/.test(text)) return 'gallery';
  if (/botanical|greenhouse|pollen|leaf|plant|particle|halo/.test(text)) return 'botanical';
  if (/editorial|tabletop|magazine|paper|mineral|cover/.test(text)) return 'editorial';
  if (/liquid|water|foam|ripple|droplet|wet surface/.test(text)) return 'fluid';
  if (/architectural|facade|panel|column|structure|geometric/.test(text)) return 'architectural';
  if (/shadow|prism|light bar|aperture|beam|caustic/.test(text)) return 'light';
  return 'generic';
}

function ref2vaStableVariant(narrative: H3RenderNarrative): number {
  const text = `${narrative.creativeArchetype}|${narrative.visualHook}`;
  let value = 0;
  for (let index = 0; index < text.length; index += 1) value = (value * 31 + text.charCodeAt(index)) >>> 0;
  return value % 3;
}

function ref2vaGalleryDescription(product: Product, narrative: H3RenderNarrative): string {
  const opening = ref2vaOpeningClause(narrative.opening);
  const world = `The gallery hangs in ${ref2vaNounPhrase(narrative.environment)}, organized as ${ref2vaNounPhrase(narrative.composition)}.`;
  const action = /frame/i.test(narrative.primaryMotion) && /beam/i.test(narrative.primaryMotion)
    ? 'The floating frames descend one by one as the citrus-gold beam travels down; reflections skim their edges and the haze responds.'
    : ref2vaActionSentence(product, narrative);
  const camera = ref2vaCameraSentence(narrative);
  const material = ref2vaMaterialSentence(narrative);
  const transition = ref2vaTransitionClause(narrative);
  const ending = ref2vaEndingClause(narrative);
  const light = ref2vaLightingSentence(narrative);
  const pacing = ref2vaPacingSentence(narrative);
  const pose = ref2vaPoseSentence(product, narrative);
  if (ref2vaStableVariant(narrative) === 1) {
    return `${opening} ${world} ${camera} ${pose} ${pacing} ${action} ${light} ${material} ${transition} ${ending}`;
  }
  return `${opening} ${world} ${pose} ${pacing} ${action} ${camera} ${light} ${material} ${transition} ${ending}`;
}

function ref2vaBotanicalDescription(product: Product, narrative: H3RenderNarrative): string {
  const opening = ref2vaOpeningClause(narrative.opening);
  const world = `The botanical set opens in ${ref2vaNounPhrase(narrative.environment)}, with ${ref2vaNounPhrase(narrative.composition)}.`;
  const hook = /pollen/i.test(narrative.visualHook) ? 'The orange pollen-like particles form the visual halo around the product.' : '';
  const action = /pollen|particle/i.test(narrative.primaryMotion) && /dust|mote/i.test(narrative.secondaryMotion)
    ? 'Fine particles spiral upward into a loose halo while small dust motes drift through the sunbeam.'
    : ref2vaActionSentence(product, narrative);
  const camera = ref2vaCameraSentence(narrative);
  const light = ref2vaLightingSentence(narrative);
  const ending = ref2vaEndingClause(narrative);
  const material = ref2vaMaterialSentence(narrative);
  const transition = ref2vaTransitionClause(narrative);
  const pacing = ref2vaPacingSentence(narrative);
  const pose = ref2vaPoseSentence(product, narrative);
  if (ref2vaStableVariant(narrative) === 2) {
    return `${world} ${opening} ${hook} ${pose} ${pacing} ${light} ${action} ${camera} ${transition} ${material} ${ending}`;
  }
  return `${opening} ${world} ${hook} ${pose} ${pacing} ${action} ${light} ${camera} ${material} ${transition} ${ending}`;
}

function ref2vaEditorialDescription(product: Product, narrative: H3RenderNarrative): string {
  const opening = ref2vaOpeningClause(narrative.opening);
  const world = `The still life is set on ${ref2vaNounPhrase(narrative.environment)}, arranged as ${ref2vaNounPhrase(narrative.composition)}.`;
  const pose = ref2vaPoseSentence(product, narrative);
  const action = /paper/i.test(narrative.primaryMotion) && /mineral/i.test(narrative.primaryMotion)
    ? 'Paper and mineral forms slide into balance as the reflective accent turns into the light.'
    : ref2vaActionSentence(product, narrative);
  const camera = ref2vaCameraSentence(narrative);
  const light = ref2vaLightingSentence(narrative);
  const material = ref2vaMaterialSentence(narrative);
  const transition = ref2vaTransitionClause(narrative);
  const ending = ref2vaEndingClause(narrative);
  const pacing = ref2vaPacingSentence(narrative);
  return `${opening} ${world} ${pose} ${pacing} ${action} ${camera} ${material} ${light} ${transition} ${ending}`;
}

function ref2vaFluidDescription(product: Product, narrative: H3RenderNarrative): string {
  const opening = ref2vaOpeningClause(narrative.opening);
  const pose = ref2vaPoseSentence(product, narrative);
  const action = ref2vaActionSentence(product, narrative);
  const world = `The fluid world is ${ref2vaNounPhrase(narrative.environment)}, with ${ref2vaNounPhrase(narrative.composition)}.`;
  const camera = ref2vaCameraSentence(narrative);
  const transition = ref2vaTransitionClause(narrative);
  const light = ref2vaLightingSentence(narrative);
  const ending = ref2vaEndingClause(narrative);
  const pacing = ref2vaPacingSentence(narrative);
  return `${opening} ${world} ${pose} ${pacing} ${action} ${camera} ${light} ${transition} ${ending}`;
}

function ref2vaGenericDescription(product: Product, narrative: H3RenderNarrative): string {
  const opening = ref2vaOpeningClause(narrative.opening);
  const world = `The scene occupies ${ref2vaNounPhrase(narrative.environment)}; its composition is ${ref2vaNounPhrase(narrative.composition)}.`;
  const pose = ref2vaPoseSentence(product, narrative);
  const action = ref2vaActionSentence(product, narrative);
  const camera = ref2vaCameraSentence(narrative);
  const light = ref2vaLightingSentence(narrative);
  const transition = ref2vaTransitionClause(narrative);
  const ending = ref2vaEndingClause(narrative);
  const material = ref2vaMaterialSentence(narrative);
  const pacing = ref2vaPacingSentence(narrative);
  switch (ref2vaStableVariant(narrative)) {
    case 1: return `${camera} ${opening} ${action} ${world} ${material} ${pose} ${pacing} ${ending} ${transition}`;
    case 2: return `${world} ${light} ${opening} ${camera} ${pose} ${pacing} ${action} ${transition} ${ending}`;
    default: return `${opening} ${world} ${pose} ${pacing} ${action} ${camera} ${light} ${material} ${transition} ${ending}`;
  }
}

function ref2vaDetailedScene(product: Product, narrative: H3RenderNarrative): string {
  switch (ref2vaWritingMode(narrative)) {
    case 'gallery': return ref2vaGalleryDescription(product, narrative);
    case 'botanical': return ref2vaBotanicalDescription(product, narrative);
    case 'editorial': return ref2vaEditorialDescription(product, narrative);
    case 'fluid': return ref2vaFluidDescription(product, narrative);
    case 'architectural': return ref2vaGenericDescription(product, narrative);
    case 'light': return ref2vaGenericDescription(product, narrative);
    case 'generic': return ref2vaGenericDescription(product, narrative);
  }
}

function ref2vaPhysicalSound(motion: string, secondaryMotion: string, material: string, environment = ''): string {
  const motionText = `${motion} ${secondaryMotion}`.toLowerCase();
  const text = `${motionText} ${material} ${environment}`.toLowerCase();
  const sounds: string[] = [];
  const visibleWater = /\b(?:water|liquid|droplets?|foam|ripples?|wet|condensation|beads?)\b/.test(motionText);
  const structuralAction = /\b(?:frames?|panels?|planes?|blocks?|columns?|structures?|mechanical|grids?|apertures?|retract)\b/.test(motionText);
  const botanicalAction = /\b(?:leaves?|botanical|pollen|particles?|dust motes?|plants?)\b/.test(motionText);
  if (visibleWater) sounds.push('gentle water movement and close liquid detail');
  if (structuralAction) sounds.push('subtle mechanical slides and restrained structural clicks');
  if (botanicalAction) sounds.push('faint airy particle movement');
  if (/\b(?:paper|sheet|linen|fabric|silk|leaf|thread|rustle)\b/.test(motionText)) sounds.push('soft material rustle');
  if (/\b(?:paper|sheet|card|magazine)\b/.test(motionText)) sounds.push('soft paper slides');
  if (/\b(?:mineral|stone|ceramic|slab)\b/.test(motionText)
    || (/\b(?:mineral|stone|ceramic|slab)\b/.test(text) && /\b(?:slide|roll|move|contact|rotate|shift|settle)\w*\b/.test(motionText))) sounds.push('muted mineral contact');
  if (/\b(?:metal|aluminum|aluminium|brushed)\b/.test(motionText)
    || (/\b(?:metal|aluminum|aluminium|brushed)\b/.test(text) && /\b(?:accent|rotate|slide|move|contact|shift|settle)\w*\b/.test(motionText))) sounds.push('subtle brushed-metal movement');
  if (!sounds.length && /\b(?:haze|air|vapor|mist|fog|cloud|drift|glide|beam)\b/.test(text)) sounds.push('soft air resonance');
  if (!sounds.length) sounds.push('quiet tactile movement from the visible action');
  return [...new Set(sounds)].slice(0, 4).join(' and ');
}

function ref2vaAmbientSound(environment: string, material: string): string {
  const text = `${environment} ${material}`.toLowerCase();
  if (/gallery|void|chamber|architectural|black depth/.test(text)) return 'Soft void air resonance keeps the suspended space present';
  if (/greenhouse|botanical|leaf|pollen|plant/.test(text)) return 'Quiet greenhouse ambience surrounds the scene';
  if (/tabletop|editorial|paper|mineral|magazine/.test(text)) return 'A quiet editorial room tone sits beneath the arrangement';
  if (/water|liquid|foam|ripple|wet/.test(text)) return 'Close water resonance anchors the material world';
  if (/fog|mist|vapor|haze|cloud/.test(text)) return 'A soft atmospheric air bed supports the open space';
  return 'A restrained room tone keeps the environment present';
}

function ref2vaUsesExplicitCuts(brief: H3VideoBrief, narrative: H3RenderNarrative): boolean {
  const text = [brief.videoIdea, brief.specialInstructions, ...narrative.directions].filter(Boolean).join(' ');
  if (/\b(?:one|single)[- ]shot\b|\bcontinuous(?:ly)?\b|\bunbroken\b|\bwithout\s+(?:a\s+)?(?:hard\s+)?cut\b|\bno\s+(?:hard\s+)?cuts?\b/i.test(text)) return false;
  return /\b(?:hard\s+cut|match\s+cut|jump\s+cut|cut\s+to|cuts?\s+between|montage|multiple\s+shots?|separate\s+shots?|new\s+shot|\[?shot\s+[23]\]?)/i.test(text);
}

interface Ref2VAShotPlan {
  shotCount: 1 | 3;
  secondCut: number | null;
  finalCut: number | null;
}

function buildRef2VAShotPlan(brief: H3VideoBrief, narrative: H3RenderNarrative): Ref2VAShotPlan {
  if (!ref2vaUsesExplicitCuts(brief, narrative)) return { shotCount: 1, secondCut: null, finalCut: null };
  return { shotCount: 3, secondCut: h3CutTime(brief.duration, 0.35), finalCut: h3CutTime(brief.duration, 0.7) };
}

function ref2vaShotLabels(shotCount: 1 | 3): string {
  return shotCount === 1 ? '[Shot 1]' : '[Shot 1], [Shot 2], [Shot 3]';
}

function h3CaptionAndSpeechNotes(brief: H3VideoBrief): string {
  const options = h3TextAudioOptions(brief);
  const notes: string[] = [];
  if (options.musicOnly) notes.push('No spoken dialogue, voiceover, creator speech, narration, or other speech.');
  if (options.captions) notes.push(`Add sparse creative captions in ${options.language} only where they support the concept.`);
  if (options.subtitles) notes.push(`Match spoken dialogue or voiceover in ${options.language} in the lower safe area.`);
  if (!options.captions && !options.subtitles) notes.push('No added captions, subtitles, or on-screen copy.');
  return notes.join(' ');
}

function h3OverallSoundscape(brief: H3VideoBrief, narrative?: H3RenderNarrative): string {
  const options = h3TextAudioOptions(brief);
  if (options.sound === 'Silent' && !options.musicOnly) return 'N/A';
  if (!narrative) {
    if (options.musicOnly) return 'Restrained studio ambience and tactile effects; no speech.';
    if (options.sound === 'Sound Only' || options.sound === 'Sound Design Only') return 'Clean studio ambience and tactile effects; no music.';
    if (options.sound === 'Sound + Music' || options.sound === 'Sound Design + Music') return 'Clean studio ambience and tactile effects around the final hold.';
    return 'Clean premium studio ambience with restrained tactile effects.';
  }
  const ambient = ref2vaAmbientSound(narrative.environment, narrative.material);
  const physical = ref2vaPhysicalSound(narrative.primaryMotion, narrative.secondaryMotion, narrative.material, narrative.environment);
  const noSpeech = options.musicOnly ? ' No dialogue, voiceover, or narration.' : '';
  const noMusic = options.sound === 'Sound Only' || options.sound === 'Sound Design Only' ? ' No music.' : '';
  return `${ambient}; the sound of ${physical} follows the visible movement and softens during the final hold.${noSpeech}${noMusic}`;
}

function h3NonDiegeticMusic(brief: H3VideoBrief, narrative?: H3RenderNarrative): string {
  const options = h3TextAudioOptions(brief);
  if (options.sound === 'Silent' && !options.musicOnly) return 'N/A';
  if (options.sound === 'Sound Only' || options.sound === 'Sound Design Only') return 'N/A';
  if (!narrative) return 'A restrained premium score rising with the action and resolving on the final hold.';
  const audioCharacter = sentenceFragment(narrative.audioCharacter || 'sparse electronic pulses and sustained tones')
    .replace(/\b(?:voice|spoken|speech|dialogue|narration)\b/gi, 'instrumental texture');
  const tempo = /fast|rapid|energetic/i.test(narrative.pacing) ? 'moderate-to-fast' : /slow|dreamlike|measured/i.test(narrative.pacing) ? 'slow' : 'slow-to-moderate';
  return `A restrained instrumental score built from ${lowerInitial(audioCharacter)} at a ${tempo} tempo, beginning with sparse pulses, adding a new layer as the main action develops, and resolving into a sustained final chord.`;
}

function baseAlignmentInstruction(mode: H3ResolvedWorkflowMode, brief: H3VideoBrief, references: H3ReferencePlan, finalShotNumber: number): string {
  const duration = brief.duration.toFixed(2);
  if (mode === 'I2VA') return 'For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.';
  if (mode === 'FL2VA') return `How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot ${finalShotNumber}) aligns with the ${duration}-second mark of the target video.`;
  if (mode === 'L2VA') return `How the reference pictures align with the target video — <Picture 1> (from [Shot ${finalShotNumber}]) aligns with the ${duration}-second mark of the target video.`;
  void references;
  return '';
}

function buildBaseIntegratedDescription(product: Product, brief: H3VideoBrief, narrative: H3RenderNarrative, mode: H3ResolvedWorkflowMode, references: H3ReferencePlan): string {
  const secondCut = h3CutTime(brief.duration, 0.35);
  const finalCut = h3CutTime(brief.duration, 0.7);
  const finalShotNumber = 3;
  const identity = h3ProductIdentityAnchor(mode, references, product);
  const anchor = h3ReferenceAnchor(mode, references, finalShotNumber);
  const correction = hasProductReferenceContext(references) ? productSpecificCorrections(product, narrative.directions).join(' ') : '';
  const motion = h3MotionDescription(product, narrative);
  const camera = h3CameraDescription(product, brief, narrative.sceneMode, narrative.camera);
  const finalState = h3FinalStateDescription(product, narrative, mode, references);
  const special = brief.specialInstructions.trim() ? ` ${cleanText(brief.specialInstructions)}` : '';
  const textNotes = h3CaptionAndSpeechNotes(brief);
  const lockedProductPlate = renderLockedProductPlateInstruction(product, brief);
  const scaleGuidance = requiresDimensionGuidance(product, narrative.directions) ? dimensionProportionLock(product) : '';
  const opening = [narrative.style, narrative.setting, `${sentenceFragment(narrative.opening)}.`, anchor, identity, correction, scaleGuidance].filter(Boolean).join(' ');
  const middle = [
    `The action develops chronologically from the established state. ${motion}`,
    `The camera movement is deliberate: ${camera}`,
    `The transition is ${sentenceFragment(narrative.transition)}.`
  ].join(' ');
  const closing = [`The final composition resolves cleanly. ${finalState}`, special.trim(), lockedProductPlate, textNotes].filter(Boolean).join(' ');
  return [
    `[Shot 1] ${opening}`,
    `[Shot 2] At ${h3ShotTimestamp(secondCut)}, the shot continues without losing subject geography. ${middle}`,
    `[Shot ${finalShotNumber}] At ${h3ShotTimestamp(finalCut)}, the camera and composition narrow into the final read. ${closing}`
  ].join('\n');
}

function buildRef2VASubjectDefinitions(product: Product, brief: H3VideoBrief, mappings: H3ReferenceSlotMapping[], narrative: H3RenderNarrative): string[] {
  const productMappings = mappings.filter((mapping) => isProductReferenceRole(mapping.role));
  const nonProductMappings = mappings.filter((mapping) => !isProductReferenceRole(mapping.role));
  const lines: string[] = [];
  if (productMappings.length) {
    const sources = productMappings.length === 1
      ? productMappings[0].pictureTag
      : productMappings.map((mapping) => `${mapping.pictureTag} (${mapping.role})`).join(' and ');
    const corrections = productSpecificCorrections(product, narrative.directions);
    const scaleGuidance = requiresDimensionGuidance(product, narrative.directions)
      ? ` Verified proportion guidance: ${dimensionProportionLock(product)}`
      : '';
    lines.push(`<Subject 1> is the ${ref2vaProductName(product)} shown in ${sources}, which defines its visible identity, proportions, packaging appearance, and finish.${corrections.length ? ` ${corrections.join(' ')}` : ''}${scaleGuidance}`);
  } else {
    lines.push(`<Subject 1> is the ${ref2vaProductName(product)} described by the brief, kept visually consistent without inventing unsupported package artwork.`);
  }
  nonProductMappings.forEach((mapping) => {
    const subjectNumber = ref2vaSubjectNumber(mapping, mappings);
    const referenceDescription = mapping.role === 'style' ? 'lighting, palette, and atmosphere' : referenceRoleDescription(mapping.role, product, mapping.asset);
    lines.push(`<Subject ${subjectNumber}> is the reference in ${mapping.pictureTag}; use it only for ${referenceDescription}, never product identity.`);
  });
  if (brief.references.productReference.source === 'custom' && !productMappings.length) lines.push(`The custom product reference role is descriptive only until a concrete image is connected: ${cleanText(brief.references.productReference.description) || 'use the selected product category without reconstructing packaging text'}.`);
  if (brief.references.styleReference.source === 'custom') lines.push(`The custom style direction is descriptive only: ${cleanText(brief.references.styleReference.description) || 'use restrained premium lighting and atmosphere'}.`);
  return lines;
}

function buildRef2VASummary(product: Product, mappings: H3ReferenceSlotMapping[], narrative: H3RenderNarrative): string {
  const productSubject = '<Subject 1>';
  const productMappings = mappings.filter((mapping) => isProductReferenceRole(mapping.role));
  const styleMappings = mappings.filter((mapping) => mapping.role === 'style');
  const archetype = sentenceFragment(narrative.creativeArchetype) || 'cinematic';
  const hook = lowerInitial(narrative.visualHook) || `a premium ${product.shortName} product film`;
  const referenceSource = productMappings.length
    ? productMappings.map((mapping) => mapping.pictureTag).join(' and ')
    : 'the written product direction';
  const styleClause = styleMappings.length
    ? ` ${styleMappings.map((mapping) => mapping.pictureTag).join(' and ')} guide atmosphere only.`
    : '';
  const archetypePhrase = `${ref2vaIndefiniteArticle(archetype)} ${archetype}`;
  return `[reference generation] Using ${referenceSource} to preserve ${productSubject}'s reference-visible identity, the target video presents ${productSubject} in ${archetypePhrase}: ${hook}.${styleClause}`;
}

function buildRef2VARetentionAnalysis(product: Product, mappings: H3ReferenceSlotMapping[], shotCount: 1 | 3): string[] {
  const lines: string[] = [];
  const shots = ref2vaShotLabels(shotCount);
  const productMappings = mappings.filter((mapping) => isProductReferenceRole(mapping.role));
  if (productMappings.length) {
    const sources = productMappings.map((mapping) => mapping.pictureTag).join(' and ');
    lines.push(`<Subject 1> (appears in ${shots}): fully_preserved - the ${ref2vaProductName(product)} retains the visible identity, proportions, packaging appearance, and finish defined by ${sources} while the environment, lighting, and camera movement change.`);
  } else {
    lines.push(`<Subject 1> (appears in ${shots}): fully_preserved - the written ${ref2vaProductName(product)} subject remains consistent without unsupported package details while the environment, lighting, and camera movement change.`);
  }
  mappings.filter((mapping) => !isProductReferenceRole(mapping.role)).forEach((mapping) => {
    const subjectNumber = ref2vaSubjectNumber(mapping, mappings);
    const relationship = mapping.role === 'style' ? 'weak_reference' : 'partially_preserved';
    const subject = `<Subject ${subjectNumber}>`;
    lines.push(`${subject} (appears in ${shots}): ${relationship} - retain only ${mapping.role === 'style' ? 'lighting, palette, and atmosphere' : 'defined visual guidance'} from ${mapping.pictureTag}; it does not alter ${ref2vaProductName(product)} identity.`);
  });
  return lines;
}

function buildRef2VADetailedDescription(product: Product, brief: H3VideoBrief, narrative: H3RenderNarrative, mappings: H3ReferenceSlotMapping[], shotPlan: Ref2VAShotPlan): string {
  const styleMappings = mappings.filter((mapping) => mapping.role === 'style');
  const styleSubject = styleMappings.length
    ? `${styleMappings.map((mapping) => `<Subject ${ref2vaSubjectNumber(mapping, mappings)}>`).join(' and ')} supplies only the referenced lighting and atmosphere.`
    : '';
  const lockedProductPlate = renderLockedProductPlateInstruction(product, brief);
  const scene = ref2vaDetailedScene(product, narrative);
  const special = brief.specialInstructions.trim() ? ` ${cleanText(brief.specialInstructions)}` : '';
  const textNotes = h3CaptionAndSpeechNotes(brief);
  const suffix = [styleSubject, special.trim(), lockedProductPlate, textNotes].filter(Boolean).join(' ');
  if (shotPlan.shotCount === 1) {
    return `[Shot 1] ${scene}${suffix ? ` ${suffix}` : ''}`;
  }
  return [
    `[Shot 1] ${scene}`,
    `[Shot 2] At ${h3ShotTimestamp(shotPlan.secondCut ?? h3CutTime(brief.duration, 0.35))}, Cut to the continuing composition as the same physical action develops. ${ref2vaCameraSentence(narrative)} ${ref2vaTransitionClause(narrative)}`,
    `[Shot 3] At ${h3ShotTimestamp(shotPlan.finalCut ?? h3CutTime(brief.duration, 0.7))}, Cut to the closing read. ${ref2vaEndingClause(narrative)}${suffix ? ` ${suffix}` : ''}`
  ].join('\n');
}

function buildRef2VAPrompt(product: Product, brief: H3VideoBrief, concept: H3Concept | null): string {
  const coherence = repairRef2VACreativeGenome(product, brief.creativeGenome, [brief.videoIdea, brief.specialInstructions, concept?.mainAction ?? '']);
  const realizedBrief = coherence.genome ? { ...brief, creativeGenome: coherence.genome } : brief;
  const narrative = buildH3RenderNarrative(product, realizedBrief, concept);
  const mappings = buildH3ReferenceSlotMappings(realizedBrief.references);
  const shotPlan = buildRef2VAShotPlan(realizedBrief, narrative);
  return [
    'subject_definitions:',
    ...buildRef2VASubjectDefinitions(product, realizedBrief, mappings, narrative),
    '',
    'summary:',
    buildRef2VASummary(product, mappings, narrative),
    '',
    'retention_analysis:',
    ...buildRef2VARetentionAnalysis(product, mappings, shotPlan.shotCount),
    '',
    'detailed_description:',
    buildRef2VADetailedDescription(product, realizedBrief, narrative, mappings, shotPlan),
    '',
    `overall_soundscape: ${h3OverallSoundscape(realizedBrief, narrative)}`,
    `non_diegetic_music: ${h3NonDiegeticMusic(realizedBrief, narrative)}`
  ].join('\n').trim();
}

function buildBaseH3Prompt(product: Product, brief: H3VideoBrief, concept: H3Concept | null, mode: H3ResolvedWorkflowMode): string {
  const narrative = buildH3RenderNarrative(product, brief, concept);
  const finalShotNumber = 3;
  const alignment = baseAlignmentInstruction(mode, brief, brief.references, finalShotNumber);
  const fields = [
    'integrated_multimodal_description:',
    buildBaseIntegratedDescription(product, brief, narrative, mode, brief.references),
    '',
    `overall_soundscape: ${h3OverallSoundscape(brief)}`,
    `non_diegetic_music: ${h3NonDiegeticMusic(brief)}`
  ];
  return (alignment ? [alignment, '', ...fields] : fields).join('\n').trim();
}

export function buildH3RenderPrompt({ product, brief, concept, resolvedMode }: H3PromptBuildInput): string {
  const resolved = resolvedMode ?? resolveH3Workflow(brief.workflowMode, brief.references).mode;
  return resolved === 'REF2VA'
    ? buildRef2VAPrompt(product, brief, concept)
    : buildBaseH3Prompt(product, brief, concept, resolved);
}

/** The prompt passed to the H3 render graph; planning context stays separate. */
export function buildH3Prompt(input: H3PromptBuildInput): string {
  return buildH3RenderPrompt(input);
}

export function buildH3PlanningPackage({ product, brief, concept, resolvedMode, timeline }: H3PromptBuildInput): string {
  const resolved = resolvedMode ?? resolveH3Workflow(brief.workflowMode, brief.references).mode;
  const segments = timeline ?? buildH3Timeline(brief.duration, product, concept, resolved, brief.ending, brief.customEnding, brief.videoIdea);
  const lockedProductPlatePlan = buildH3LockedProductPlatePlan(product, brief);
  const idea = cleanText(brief.videoIdea) || `A premium ${product.shortName} product film.`;
  const textAudio = h3TextAudioOptions(brief);
  const conceptTitle = concept ? cleanText(concept.title) : 'Direct creative direction';
  const detailInstruction = brief.promptDetail === 'Maximum Detail'
    ? 'Maximum Detail: explicitly choreograph every intermediate physical action; never rely on a single vague transformation verb.'
    : brief.promptDetail === 'Production'
      ? 'Production: prioritize a concise, shootable sequence with clear action beats, camera behavior, and an accurate final product.'
      : 'Simple: keep the wording compact while preserving the chronological action, reference alignment, and product lock.';
  const action = concept?.mainAction || choreographyFor(idea, product, brief.actionIntensity);
  const directionInputs = [
    brief.videoIdea,
    brief.specialInstructions,
    concept?.mainAction ?? ''
  ];
  const revealsUnprintedSurface = revealsRearOrUnprintedSurface(product, directionInputs);
  const includeDimensionGuidance = requiresDimensionGuidance(product, directionInputs);
  const timelineLines = segments.map((segment) => `  ${displayRange(segment.start, segment.end)} — ${segment.label}: ${segment.detail}`);
  const promptLines = [
    'planning_package: internal context only; do not inject this package into {{H3_PROMPT}}.',
    'system_instruction:',
    `  ${minimaxH3SystemInstruction}`,
    '',
    `h3_workflow: ${resolved}`,
    `duration: ${brief.duration} seconds`,
    `aspect_ratio: ${brief.aspectRatio === 'Custom' ? cleanText(brief.customAspectRatio) || 'custom' : brief.aspectRatio}`,
    `fps: ${brief.fps} FPS (informational; keep H3 at 24 FPS)`,
    `frame_length: ${calculateH3FrameLength(brief.duration)} H3 frames`,
    `steps: ${brief.steps ?? 20}`,
    `scheduler: ${h3Scheduler(brief)}`,
    `seed: ${brief.seedMode === 'fixed' ? `fixed (${brief.seed ?? 0})` : 'random (new seed per submitted job)'}`,
    `ref_image_size: ${h3RefImageSize(brief)}`,
    `prompt_detail: ${brief.promptDetail}`,
    `creative_goal: ${goalLabel(brief)}`,
    `concept: ${conceptTitle}`,
    ...(brief.creativeGenome ? [
      '',
      'creative_diversity_direction:',
      `  ${creativeGenomePromptGuidance(brief.creativeGenome).join(' ')}`,
      ...(brief.creativeSeed === undefined ? [] : [`  selection_seed: ${brief.creativeSeed}`])
    ] : []),
    '',
    'language_and_text_audio:',
    ...h3LanguageAndTextAudioGuidance(brief).map((line) => `  ${line}`),
    '',
    `product_reference_image_used: ${hasProductReferenceContext(brief.references) ? 'yes' : 'no'}`,
    'reference_alignment:',
    ...referenceAlignment(resolved, brief.references, product),
    '',
    'product_reference_lock:',
    `  ${productAppearanceLock(product, brief.references, directionInputs)}`,
    ...(lockedProductPlatePlan.enabled ? ['', 'locked_product_plate:', `  ${lockedProductPlatePromptBlock(product, brief)}`] : []),
    '',
    'verified_product_identity:',
    ...productKnowledge(product, includeDimensionGuidance, hasProductReferenceContext(brief.references)),
    '',
    'integrated_multimodal_description:',
    `  premise: ${idea}`,
    `  visual_direction: ${brand.visualDirection.join(', ')}; ${brand.defaultPromptKeywords.slice(0, 6).join(', ')}.`,
    `  chronology: initial state → motion/action onset → continuous development → final state / settle.`,
    `  action_choreography: ${action}`,
    ...(revealsUnprintedSurface ? [`  rotation_surface_lock: ${rotationSurfaceLock(product)}`] : []),
    ...(!revealsUnprintedSurface ? [`  product_motion: ${frontFacingProductLock(product)}`] : []),
    `  pacing: ${brief.pacing}; action intensity: ${brief.actionIntensity}.`,
    ...timelineLines,
    '',
    'camera_behavior:',
    `  camera_motion: ${brief.cameraMotion}`,
    `  direction_speed_amplitude_framing: ${cameraApproach(brief.cameraMotion)}`,
    '  continuity: Maintain clear subject geography, consistent scale, and a single understandable path through the action.',
    '',
    'product_fidelity:',
    `  level: ${brief.productFidelity}`,
    `  final_state: ${endingLabel(brief)}; keep ${product.shortName} stable and readable for the final hold when this ending calls for it.`
  ];

  if (brief.specialInstructions.trim()) {
    promptLines.push('', 'special_instructions:', `  ${cleanText(brief.specialInstructions)}`);
  }
  promptLines.push('', 'production_constraints:', `  ${detailInstruction}`, '  no_unplanned_cuts: Prefer one continuous shot for FL2VA unless the chosen concept specifically requires a cut.', '  manual_handoff: This is a prompt-and-settings package for manual ComfyUI entry; do not render video, download a model, or manage a queue.');

  if (textAudio.musicOnly) {
    promptLines.push(
      '',
      'music_only_audio:',
      '  no_spoken_audio: No spoken dialogue, voiceover, creator speech, narration, or other speech.',
      '  non_diegetic_music: Include music or a soundtrack with a clear, concept-appropriate arc.',
      '  sound_effects: Sound effects may be used where appropriate unless the user explicitly requests music with no sound effects.'
    );
  } else if (textAudio.sound !== 'Silent') {
    if (textAudio.sound === 'Sound Design + Music' || textAudio.sound === 'Sound Design Only') {
      promptLines.push('', 'overall_soundscape:', `  ${textAudio.sound === 'Sound Design + Music' ? 'Detailed tactile sound design synchronized to each mechanical or material action; keep the mix clean around the final product hold.' : 'Detailed tactile sound design synchronized to each physical action; no music.'}`);
    }
    if (textAudio.sound === 'Sound Design + Music' || textAudio.sound === 'Music Only') {
      promptLines.push('', 'non_diegetic_music:', `  ${textAudio.sound === 'Music Only' ? 'A restrained premium cinematic score with a clear rise into the final product lock; no diegetic sound.' : 'A restrained premium cinematic score that rises with the action and resolves cleanly during the final product hold.'}`);
    }
  }

  return promptLines.join('\n').trim();
}

function displayAspectRatio(brief: H3VideoBrief): string {
  return brief.aspectRatio === 'Custom' ? cleanText(brief.customAspectRatio) || 'Custom' : brief.aspectRatio;
}

function displayAudio(value: H3Sound): H3Sound {
  if (value === 'Sound Design + Music') return 'Sound + Music';
  if (value === 'Sound Design Only') return 'Sound Only';
  return value;
}

export function buildH3RecommendedSettings(brief: H3VideoBrief): H3RecommendedSettings {
  const resolution = resolveH3Workflow(brief.workflowMode, brief.references);
  const textAudio = h3TextAudioOptions(brief);
  const workflowSettings = h3WorkflowSettingsFromBrief(brief);
  return {
    mode: resolution.mode,
    modeReason: resolution.reason,
    duration: brief.duration,
    aspectRatio: displayAspectRatio(brief),
    megapixels: brief.megapixels,
    multiple: brief.multiple,
    fps: brief.fps,
    frames: calculateH3FrameLength(brief.duration),
    productFidelity: brief.productFidelity,
    audio: displayAudio(textAudio.sound),
    references: requiredH3ReferenceInputs(resolution.mode, brief.references),
    refImageSize: h3RefImageSize(brief),
    scheduler: workflowSettings.scheduler,
    steps: workflowSettings.steps,
    seedMode: workflowSettings.seedMode,
    seed: workflowSettings.seed
  };
}

function h3ReferenceContext(slot: 'firstFrame' | 'lastFrame' | 'productReference' | 'styleReference', asset: H3ReferenceAsset, product: Product): string {
  const label = slot === 'firstFrame' ? 'First Frame' : slot === 'lastFrame' ? 'Last Frame' : slot === 'productReference' ? 'Product Reference' : 'Other Reference';
  if (!isH3ReferenceSelected(asset)) return `${label}: Not provided`;
  const description = asset.source === 'selected-product' && (!asset.description || asset.description === `${product.officialName} packaging reference`)
    ? `Supplied ${product.shortName} product reference image`
    : asset.description || (asset.source === 'local-file' ? 'Selected local product reference image' : 'Custom reference description');
  const path = asset.path || (asset.source === 'selected-product' ? product.imagePath : '');
  return `${label}: ${description}${path ? ` (local file: ${path})` : ''}`;
}

function h3ContentGuidance(contentType: H3ContentType): string {
  if (contentType !== 'UGC Content') return `Content-type direction: Let the ${contentType.toLowerCase()} brief and the user's explicit instructions determine the filming language.`;
  return 'UGC defaults: favor natural smartphone-style framing, an authentic creator/content feel, believable everyday environments such as a bedroom, bathroom, or vanity, natural human interaction when requested, realistic pacing, close-up product demonstration, and TikTok/Reels/short-form language. Use handheld or naturally stabilized movement and less polished commercial choreography unless the user asks for it. Do not force people, a phone look, or UGC styling when the user explicitly requests something else.';
}

/**
 * Build the human-in-the-loop request used by the embedded ChatGPT browser.
 * This is context packaging only; ChatGPT remains responsible for the actual
 * creative concept, H3 prompt, revisions, and final settings recommendation.
 */
export function buildH3ChatGPTRequest({ product, brief }: H3ChatGPTRequestInput): string {
  const contentType = brief.contentType ?? 'Cinematic Product Ad';
  const recommendation = buildH3RecommendedSettings(brief);
  const lockedProductPlatePlan = buildH3LockedProductPlatePlan(product, brief);
  const textAudio = h3TextAudioOptions(brief);
  const idea = brief.videoIdea.trim() || 'No specific idea supplied. Make a strong product-led creative decision from the selected content type and verified context.';
  const productDirections = [brief.videoIdea, brief.specialInstructions];
  const includeDimensionGuidance = requiresDimensionGuidance(product, productDirections);
  const revealsRearSurface = revealsRearOrUnprintedSurface(product, productDirections);
  const revealsContents = revealsProductContents(product, productDirections);
  const includeUsageGuidance = brief.contentType === 'Product Demo'
    || /\b(?:apply|application|use|routine|mist|spray|dispens\w*|dropper)\b/i.test(productDirections.join(' '));
  const references = (['firstFrame', 'lastFrame', 'productReference', 'styleReference'] as const)
    .map((slot) => `- ${h3ReferenceContext(slot, brief.references[slot], product)}`);
  const ref2vaMappings = buildH3ReferenceSlotMappings(brief.references);
  const ref2vaReferenceLines = ref2vaMappings.length
    ? ref2vaMappings.map((mapping) => `- ${mapping.pictureTag} → ${mapping.refInput} → ${mapping.role}${mapping.asset.path ? ` (${mapping.asset.path})` : ''}`)
    : ['- No concrete Ref2VA image slots are connected.'];
  const verifiedProduct = [
    `Product identity: ${product.shortName}`,
    `Role: ${product.role}`,
    ...(includeDimensionGuidance ? [`Verified proportion guidance: ${dimensionProportionLock(product)}`] : []),
    `Product-scoped traits: ${h3ProductScopedIdentityRule}`,
    `Verified ingredients: ${product.ingredients.join(', ')}`,
    `Verified benefit territories: ${product.benefitTerritories.join('; ')}`,
    ...(includeUsageGuidance ? [`Usage position: ${product.usagePosition}`] : []),
    `Local master reference file(s): ${getProductReferencePaths(product).join(', ')}`
  ];
  const brandContext = [
    `Brand: ${brand.brand}`,
    `Series: ${brand.series}`,
    `Core idea: ${brand.coreIdea}`,
    `Personality: ${brand.personality.join(', ')}`,
    `Visual direction: ${brand.visualDirection.join(', ')}`,
    `Palette: orange ${brand.palette.orange}, citrus glow ${brand.palette.citrusGlow}, cream ${brand.palette.cream}, white ${brand.palette.white}, black ${brand.palette.black}.`,
    `Useful visual language: ${brand.defaultPromptKeywords.join(', ')}`,
    'Packaging reference rule: The supplied product reference controls visible packaging; change only the environment, light, camera, props, and composition.',
    `Claim safety: ${claimRules.rule}`,
    `Avoid unless separately approved: ${claimRules.avoidUnlessApproved.join('; ')}`
  ];
  const advancedSettings = [
    `H3 Mode: ${brief.workflowMode}`,
    `Auto suggestion: ${recommendation.mode} — ${recommendation.modeReason}`,
    `Megapixels: ${brief.megapixels.toFixed(2)} MP`,
    `Multiple: ${brief.multiple}`,
    `Product Fidelity: ${brief.productFidelity}`,
    `ref_image_size: ${recommendation.refImageSize ?? h3RefImageSize(brief)}`,
    `Scheduler: ${recommendation.scheduler ?? h3Scheduler(brief)}`,
    `Steps: ${recommendation.steps ?? brief.steps ?? 20}`,
    `Seed: ${(recommendation.seedMode ?? brief.seedMode ?? 'random') === 'fixed' ? `Fixed (${recommendation.seed ?? brief.seed ?? 0})` : 'Random (new seed per submitted job)'}`,
    `Audio: ${displayAudio(textAudio.sound)}`,
    `FPS: ${brief.fps} FPS`,
    `Valid H3 frame length: ${recommendation.frames} frames`
  ];
  const extraInstructions = [
    brief.goal && brief.goal !== 'Product reveal' ? `Legacy goal hint: ${brief.goal}${brief.customGoal ? ` — ${brief.customGoal}` : ''}` : '',
    brief.specialInstructions.trim() ? `Additional user instructions: ${brief.specialInstructions.trim()}` : ''
  ].filter(Boolean);
  const creativeDirection = brief.creativeGenome
    ? [
      `Primary visual hook: ${brief.creativeGenome.visualHook}`,
      `Creative archetype: ${brief.creativeGenome.creativeArchetype}`,
      `Execution: ${brief.creativeGenome.environment}; ${brief.creativeGenome.composition}; ${brief.creativeGenome.framing}.`,
      `Camera / light: ${brief.creativeGenome.cameraPath}; ${brief.creativeGenome.lightingStyle}.`,
      `Motion / finish: ${brief.creativeGenome.primaryMotion}; ${brief.creativeGenome.endingDevice}.`,
      'Treat this as the selected execution direction. Preserve the user\'s explicit creative constraints and keep product identity/reference truth separate and unchanged.'
    ]
    : [];

  return [
    h3InstructionPackage.trim(),
    '',
    '## SELECTED H3 BRIEF',
    `Product: ${product.shortName}`,
    `Content type: ${contentType}`,
    `Creative variety: ${brief.creativeVariety ?? 'Balanced'}`,
    `Duration: ${brief.duration} seconds`,
    `Aspect ratio: ${displayAspectRatio(brief)}`,
    '',
    '## LANGUAGE AND AUDIO / TEXT OPTIONS',
    ...h3LanguageAndTextAudioGuidance(brief).map((line) => `- ${line}`),
    '',
    `User idea / instructions: ${idea}`,
    h3ContentGuidance(contentType),
    ...extraInstructions,
    ...(creativeDirection.length ? ['', '## CREATIVE DIVERSITY DIRECTION', ...creativeDirection.map((line) => `- ${line}`)] : []),
    ...(lockedProductPlatePlan.enabled ? ['', '## LOCKED PRODUCT PLATE', lockedProductPlatePromptBlock(product, brief)] : []),
    '',
    '## PRODUCT REFERENCE AUTHORITY',
    ...productReferenceAuthorityContext(product, brief.references, productDirections).map((line) => `- ${line}`),
    '',
    '## VERIFIED PRODUCT DATA',
    ...verifiedProduct.map((line) => `- ${line}`),
    '',
    '## VERIFIED BRAND RULES',
    ...brandContext.map((line) => `- ${line}`),
    '',
    '## PLANNED REFERENCES',
    ...references,
    '- Ref2VA ordered reference slots:',
    ...ref2vaReferenceLines,
    `- Auto should use the available reference roles to recommend the appropriate H3 mode. Current app suggestion: ${recommendation.mode}.`,
    '',
    '## H3 WORKFLOW SETTINGS',
    ...advancedSettings.map((line) => `- ${line}`),
    '',
    '## WHAT TO RETURN',
    '- Make the creative decision yourself when the idea is vague; briefly explain the concept when that helps the user.',
    '- Recommend or confirm the H3 mode based on the request and references, even when the selected mode is Auto.',
    '- Separate the internal planning package from the final H3_RENDER_PROMPT. Only the text under H3_RENDER_PROMPT is intended for the {{H3_PROMPT}} value.',
    '- Write the actual complete production-ready MiniMax H3_RENDER_PROMPT in the official mode-specific format: T2VA uses the three base fields; I2VA/FL2VA/L2VA prepend their exact alignment instruction; Ref2VA uses all six full-reference fields.',
    '- Keep H3_RENDER_PROMPT limited to mode-appropriate reference roles, the concise product identity, the actual shot-by-shot scene, requested motion, camera behavior, final state, and audio/text directions only when needed.',
    '- Keep H3_RENDER_PROMPT free of system instructions, workflow/settings metadata, FPS or frame-length information, filenames, claim-safety boilerplate, and manual-handoff notes.',
    '- For concrete Ref2VA references, use the exact ordered tags <Picture 1>, <Picture 2>, and so on, define their semantic roles through stable <Subject N> definitions, and never duplicate a Picture tag for an unconnected slot.',
    ...(lockedProductPlatePlan.enabled
      ? [`- Preserve the selected ${lockedProductPlatePlan.mode} Locked Product Plate plan exactly: use the original product asset as the foreground plate, generate only the surrounding environment, and finish with the described composite.`]
      : ['- Do not introduce Locked Product Plate compositing unless the product remains front-facing and the original product asset is available.']),
    '- For base-guide modes, keep product identity concise and place it in the integrated multimodal description. For Ref2VA, define the reusable product as <Subject 1>, record its retention once, and keep the detailed description focused on composition, environment, action, camera, physical state changes, and sound.',
    revealsRearSurface
      ? `- This brief reveals a rear or side surface. Add exactly one concise sentence: ${rotationSurfaceLock(product)}`
      : '- Add no rear/side-surface instruction unless the choreography actually reveals it.',
    revealsContents
      ? '- This brief shows the Serum liquid. Add only the verified clear-and-colorless liquid correction; keep it separate from the opaque/coated bottle appearance.'
      : '- Do not add a liquid-appearance correction unless liquid is actually shown.',
    includeDimensionGuidance
      ? '- This request needs scale guidance; use the verified proportion guidance once and do not derive new measurements.'
      : '- For an ordinary single-product shot, do not include centimeter measurements or written package descriptions.',
    '- For I2VA, develop forward from the exact first-frame product image; for FL2VA, converge onto an exact product final frame; for Ref2VA, retain visible material finish and opacity, not only category or shape.',
    '- Include recommended H3 settings, updating the starting values when your creative decision requires it.',
    '- Keep the response flexible. A short Concept, Recommended H3 Setup, and H3 Prompt are useful defaults, but adapt the structure to the chosen H3 mode and the conversation.',
    '- If the user asks for a revision, revise the actual H3 prompt and settings in the conversation instead of returning a new generic template.',
    '- For a transformation, describe visible mechanical/material cause and effect and a chronological path. The guidance in your system package is not a rigid template; choose the best choreography for this idea.',
    `- Use ${textAudio.language} for all newly generated human-facing spoken and visual language, while preserving official product names, logos, packaging text, ingredient names, and other locked branding exactly unless verified data allows translation.`,
    `- Music Only is ${yesNo(textAudio.musicOnly)}. ${textAudio.musicOnly ? 'If Yes, the H3 direction must explicitly contain no spoken dialogue, voiceover, creator speech, narration, or other speech, while still allowing music and appropriate sound effects.' : 'If No, choose speech or no speech according to the concept and the user’s instructions.'}`,
    `- Captions are ${yesNo(textAudio.captions)} and mean creative on-screen copy, not transcription. Subtitles are ${yesNo(textAudio.subtitles)} and mean text matching spoken dialogue or voiceover, not extra marketing headlines.`,
    '- Always prioritize the user’s explicit creative instructions while preserving verified product identity, duration, aspect ratio, and claim safety.'
  ].join('\n').trim();
}

export function buildH3SettingsText(brief: H3VideoBrief, resolvedMode: H3ResolvedWorkflowMode): string {
  const required = requiredH3ReferenceInputs(resolvedMode, brief.references);
  const textAudio = h3TextAudioOptions(brief);
  const lockedProductPlateMode = brief.lockedProductPlateMode ?? 'Off';
  return [
    'MiniMax H3 / ComfyUI Settings',
    `H3 Mode: ${resolvedMode}`,
    `Duration: ${brief.duration} sec`,
    `Aspect Ratio: ${displayAspectRatio(brief)}`,
    `Language: ${textAudio.language}`,
    `Music Only: ${yesNo(textAudio.musicOnly)}`,
    `Captions: ${yesNo(textAudio.captions)}`,
    `Subtitles: ${yesNo(textAudio.subtitles)}`,
    `Megapixels: ${brief.megapixels.toFixed(2)} MP`,
    `Multiple: ${brief.multiple}`,
    `FPS: ${brief.fps} FPS`,
    `Steps: ${brief.steps ?? 20}`,
    `Scheduler: ${h3Scheduler(brief)}`,
    `Seed: ${(brief.seedMode ?? 'random') === 'fixed' ? `Fixed (${brief.seed ?? 0})` : 'Random (new seed per submitted job)'}`,
    `Calculated H3 Frame Length: ${calculateH3FrameLength(brief.duration)} frames`,
    `Product Fidelity: ${brief.productFidelity}`,
    `Ref Image Size: ${h3RefImageSize(brief)}`,
    `Locked Product Plate: ${lockedProductPlateMode}`,
    `Audio: ${displayAudio(textAudio.sound)}`,
    `Required Reference Inputs: ${required.length ? required.join(' | ') : 'None'}`,
    'Manual handoff: Paste the H3 prompt and these values into ComfyUI yourself.'
  ].join('\n');
}

export function buildH3ConceptRequest({ product, brief }: H3ConceptRequestInput): string {
  const resolution = resolveH3Workflow(brief.workflowMode, brief.references);
  const references = requiredH3ReferenceInputs(resolution.mode, brief.references).map((reference) => reference.replace(
    `Product Reference: ${product.officialName} packaging reference`,
    `Product Reference: Supplied ${product.shortName} product reference image`
  ));
  const lockedProductPlatePlan = buildH3LockedProductPlatePlan(product, brief);
  const productDirections = [brief.videoIdea, brief.specialInstructions];
  const includeDimensionGuidance = requiresDimensionGuidance(product, productDirections);
  return [
    '# MINIMAX H3 CONCEPT REQUEST',
    'Act as a senior creative director and MiniMax H3 prompt planner for PROYA. Create exactly three meaningfully different video concepts; do not return minor variations of the same idea.',
    '',
    '## BRIEF',
    `Product: ${product.shortName}`,
    `Rough idea: ${cleanText(brief.videoIdea) || 'No rough idea supplied; propose a strong product-led direction.'}`,
    `Goal: ${goalLabel(brief)}`,
    `Duration: ${brief.duration} seconds`,
    `Aspect ratio: ${brief.aspectRatio === 'Custom' ? cleanText(brief.customAspectRatio) || 'Custom' : brief.aspectRatio}`,
    `Creative variety: ${brief.creativeVariety ?? 'Balanced'}`,
    ...h3LanguageAndTextAudioGuidance(brief),
    `Selected H3 workflow: ${brief.workflowMode}; Auto currently recommends ${resolution.mode}.`,
    `Selected style controls: camera ${brief.cameraMotion}; action ${brief.actionIntensity}; pacing ${brief.pacing}; product fidelity ${brief.productFidelity}; ending ${endingLabel(brief)}; prompt detail ${brief.promptDetail}.`,
    `Reference plan: ${references.length ? references.join(' | ') : 'No reference images.'}`,
    ...(brief.creativeGenome ? ['', '## LOCAL CREATIVE DIVERSITY DIRECTION', ...creativeGenomePromptGuidance(brief.creativeGenome).map((line) => `- ${line}`), '- Preserve explicit user instructions; use the direction to avoid recent same-family repetition.'] : []),
    ...(lockedProductPlatePlan.enabled ? ['', '## LOCKED PRODUCT PLATE', lockedProductPlatePromptBlock(product, brief)] : []),
    '',
    '## PRODUCT REFERENCE GUIDANCE',
    ...productReferenceAuthorityContext(product, brief.references, productDirections).map((line) => `- ${line}`),
    '',
    '## VERIFIED PRODUCT CONTEXT',
    ...(includeDimensionGuidance ? [`- Verified proportion guidance: ${dimensionProportionLock(product)}`] : ['- Ordinary single-product concept: do not write centimeter measurements or reconstruct packaging from text.']),
    ...(revealsProductContents(product, productDirections) ? ['- Verified liquid correction for this brief: The serum liquid itself is clear and colorless.'] : []),
    `Use only these verified benefit territories where relevant: ${product.benefitTerritories.join('; ')}.`,
    `Claim safety: ${claimRules.rule}`,
    '',
    '## REQUIRED RESPONSE SHAPE',
    'For each concept provide: concept title; 1–3 sentence concept; visual hook; main action; recommended H3 mode; recommended duration; reference-frame recommendation; camera approach.',
    `Dedicated H3 instruction: ${minimaxH3SystemInstruction}`,
    'Return concept text only. Do not render video, call ComfyUI, download models, or add GPU/queue settings.'
  ].join('\n');
}

export function buildH3Concepts(brief: H3VideoBrief, product: Product): H3Concept[] {
  const idea = cleanText(brief.videoIdea) || `A premium ${product.shortName} reveal with a clear physical transformation.`;
  const resolution = resolveH3Workflow(brief.workflowMode, brief.references).mode;
  const firstAndLast = isH3ReferenceSelected(brief.references.firstFrame) && isH3ReferenceSelected(brief.references.lastFrame);
  const frameMode: H3ResolvedWorkflowMode = firstAndLast
    ? 'FL2VA'
    : isH3ReferenceSelected(brief.references.firstFrame)
      ? 'I2VA'
      : isH3ReferenceSelected(brief.references.lastFrame)
        ? 'L2VA'
        : resolution;
  const referenceMode: H3ResolvedWorkflowMode = isH3ReferenceSelected(brief.references.productReference) || isH3ReferenceSelected(brief.references.styleReference) ? 'REF2VA' : 'T2VA';
  const finalFrame = brief.references.lastFrame.description || `exact ${product.shortName} hero frame`;
  const dropletVisualHook = contentsIdentity(product)
    ? 'A thin amber-orange light ribbon and separate clear, colorless, transparent droplets travel around the package without obscuring its label; the colored brand light remains separate from the actual product liquid.'
    : 'A thin amber-orange light ribbon and controlled droplets travel around the package without obscuring its label.';

  return [
    {
      id: 'architecture-to-product',
      title: 'Mechanical Brightness Reveal',
      description: `Use the rough premise “${idea}” as a monumental single-shot reveal for ${product.shortName}. A futuristic structure resolves through visible mechanical stages and lands on the exact final product for a readable hero hold.`,
      visualHook: 'Warm citrus light travels through a monumental architectural silhouette before the package appears from inside the structure.',
      mainAction: choreographyFor(idea, product, brief.actionIntensity),
      recommendedMode: frameMode,
      recommendedDuration: brief.duration,
      referenceRecommendation: firstAndLast ? 'First Frame: controlled futuristic building. Last Frame: exact selected product hero image. Use FL2VA for the endpoint lock.' : `Last Frame: ${finalFrame}. Add a controlled building first frame to make Auto prefer FL2VA.`,
      cameraApproach: cameraApproach(brief.cameraMotion)
    },
    {
      id: 'citrus-current',
      title: 'Citrus Current',
      description: `Turn ${product.shortName} into the destination of a clean, tactile light-and-material journey rather than an architectural morph. A luminous citrus current traces the verified package contours, gathers at the closure, and settles into a premium product tableau.`,
      visualHook: dropletVisualHook,
      mainAction: `A narrow light ribbon enters from frame edge, wraps the ${product.shortName} silhouette, separates into three clean arcs, gathers into the verified closure area, then recedes to reveal the stable product and its readable label.`,
      recommendedMode: referenceMode,
      recommendedDuration: brief.duration,
      referenceRecommendation: `Product Reference: supplied ${product.shortName} packaging image. Use a style reference only for light quality and atmosphere; keep the package reference authoritative.`,
      cameraApproach: 'A slow lateral slider with a small parallax arc; keep label-facing framing stable as the light moves around the product.'
    },
    {
      id: 'precision-lock-in',
      title: 'Precision Lock-In',
      description: `Build a focused product reveal around one deliberate camera approach and a final accuracy lock. The sequence begins with an abstract, uncluttered field, introduces material components one at a time, and finishes with ${product.shortName} centered and stable.`,
      visualHook: 'Floating geometric surfaces align like a precision instrument, revealing the package only when the final seam closes.',
      mainAction: `Three material planes rotate into alignment, a soft product-colored glow passes behind them, the ${product.shortName} body rises into the opening, its verified lid/cap/dropper seats into place, and the surfaces settle without covering the logo or label.`,
      recommendedMode: isH3ReferenceSelected(brief.references.lastFrame) ? 'L2VA' : referenceMode,
      recommendedDuration: brief.duration,
      referenceRecommendation: `End at ${finalFrame} for a clean product lock; L2VA is appropriate when the opening remains intentionally abstract.`,
      cameraApproach: 'A restrained cinematic push-in with a small vertical lift, low amplitude during assembly, then a precise lock-off for the final product read.'
    }
  ];
}

export function reviseH3Prompt(prompt: string, revision: H3PromptRevision, product: Product): string {
  if (!prompt.trim()) return prompt;
  if (revision === 'shorten') {
    const removable = /^(quality_preset|megapixels|multiple|reference_files|verified_benefit_territory):/;
    const compact = prompt
      .split('\n')
      .filter((line) => !removable.test(line.trim()))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return `${compact}\n\nrevision_notes:\n  Condensed wording while retaining H3 workflow, chronology, reference alignment, camera behavior, and exact ${product.shortName} identity.`;
  }

  const revisionNotes: Record<Exclude<H3PromptRevision, 'shorten'>, string> = {
    improve: 'Clarify cause-and-effect between each beat, remove ambiguous wording, and keep the final product readable.',
    'more-motion': 'Increase the number and visibility of intermediate physical actions; show what unlocks, separates, retracts, rotates, aligns, and settles.',
    'more-cinematic': 'Add controlled parallax, motivated light progression, purposeful depth changes, and a deliberate cinematic final framing lock.',
    'stronger-product-accuracy': `${h3ProductReferenceAuthorityInstruction} Use the supplied ${product.shortName} Product Reference as the immutable source of visible appearance. ${productSpecificCorrections(product, []).join(' ')} Do not redesign or replace the product.`
  };
  return `${prompt}\n\nrevision_notes:\n  ${revisionNotes[revision]}`;
}

export function getH3Product(productId: string): Product | undefined {
  return getProduct(productId);
}

export interface H3PromptSnapshot {
  record: H3PromptRecord;
  settingsText: string;
}
