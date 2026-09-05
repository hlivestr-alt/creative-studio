import { getProductReferencePaths } from './data';
import type { H3LockedProductPlateMode, H3VideoBrief, Product } from './types';
import { h3LockedProductPlateModes } from './types';

export type H3LockedProductPlateCoverage = 'full-shot' | 'opening-hero' | 'final-hero';

export interface H3LockedProductPlatePlan {
  mode: H3LockedProductPlateMode;
  enabled: boolean;
  coverage: H3LockedProductPlateCoverage | null;
  sourceAssetPaths: string[];
  referenceAttached: boolean;
  sourcePlate: string;
  generatedLayer: string;
  compositing: string;
  motion: string;
  warnings: string[];
}

export interface H3LockedProductPlateRecommendation {
  recommended: boolean;
  suggestedMode: Exclude<H3LockedProductPlateMode, 'Off'>;
  packagingExact: boolean;
  reason: string;
  blockers: string[];
}

const rotationCue = /\b(?:rotat\w*|turn\w*|spin\w*|orbit\w*|revers\w*|180(?:°|\s*degrees?)?|360(?:°|\s*degrees?)?|full rotation|turntable|rear view|back view|side view)\b/i;
const negatedRotationCue = /\b(?:no|without|not|never)\b(?:\s+\w+){0,3}\s+\b(?:rotat\w*|turn\w*|spin\w*|orbit\w*|revers\w*|180(?:°|\s*degrees?)?|360(?:°|\s*degrees?)?|full rotation|turntable|rear view|back view|side view)\b/i;
const frontFacingCue = /\b(?:front[- ]facing|front[- ]view|hero(?: shot| product)?|pack[- ]?shot|beauty shot|center(?:ed|ing)|readable|stable|static)\b/i;
const environmentMotionCue = /\b(?:environment|background|foam|water|light|reflection|shadow|atmosphere|particle|steam|mist|droplet|glow|camera push|push[- ]in|parallax)\b/i;
const fullShotCue = /\b(?:full[- ]shot|throughout|entire shot|whole shot|remains? static|stays? still|from first frame to (?:the )?last)\b/i;
const openingHeroCue = /\b(?:opening|start|begin|first)\b[\s\S]{0,24}\b(?:hero|product|plate)\b/i;
const finalHeroCue = /\b(?:final|ending|end|last|settle|hold)\b[\s\S]{0,24}\b(?:hero|product|plate|shot)\b/i;

export function normalizeH3LockedProductPlateMode(value: unknown): H3LockedProductPlateMode {
  return h3LockedProductPlateModes.includes(value as H3LockedProductPlateMode)
    ? value as H3LockedProductPlateMode
    : 'Off';
}

function directionText(brief: H3VideoBrief): string {
  return `${brief.videoIdea} ${brief.specialInstructions}`.trim();
}

function requestsProductRotation(text: string): boolean {
  return rotationCue.test(text) && !negatedRotationCue.test(text);
}

function productReferenceIsAttached(brief: H3VideoBrief): boolean {
  const reference = brief.references.productReference;
  return reference.source === 'selected-product' || reference.source === 'local-file';
}

function coverageForMode(mode: H3LockedProductPlateMode): H3LockedProductPlateCoverage | null {
  if (mode === 'Full Shot') return 'full-shot';
  if (mode === 'Opening Hero') return 'opening-hero';
  if (mode === 'Final Hero') return 'final-hero';
  return null;
}

function scopeForCoverage(coverage: H3LockedProductPlateCoverage): string {
  switch (coverage) {
    case 'full-shot': return 'Keep the original product plate locked from the first frame through the final frame.';
    case 'opening-hero': return 'Keep the original product plate locked during the opening hero beat; animate only the surrounding scene during that beat.';
    case 'final-hero': return 'Keep the original product plate locked during the final hero beat; animate only the surrounding scene during that beat.';
  }
}

function suggestedMode(text: string, brief: H3VideoBrief): Exclude<H3LockedProductPlateMode, 'Off'> {
  if (openingHeroCue.test(text)) return 'Opening Hero';
  if (fullShotCue.test(text)) return 'Full Shot';
  if (brief.ending === 'Hero Shot' || finalHeroCue.test(text)) return 'Final Hero';
  return 'Full Shot';
}

export function recommendH3LockedProductPlate(product: Product, brief: H3VideoBrief): H3LockedProductPlateRecommendation {
  const text = directionText(brief);
  const blockers: string[] = [];
  if (requestsProductRotation(text)) blockers.push('The brief requests meaningful product rotation or a rear/side reveal.');

  const frontFacing = frontFacingCue.test(text) || (brief.ending === 'Hero Shot' && brief.contentType !== 'UGC Content');
  const minimalProductMotion = brief.cameraMotion === 'Static'
    || brief.cameraMotion === 'Low'
    || brief.actionIntensity === 'Low'
    || environmentMotionCue.test(text);
  const packagingExact = brief.productFidelity === 'Exact' || productReferenceIsAttached(brief);
  if (!frontFacing) blockers.push('The brief does not clearly establish a front-facing hero product.');
  if (!minimalProductMotion) blockers.push('The selected motion controls do not indicate minimal product movement.');
  if (!packagingExact) blockers.push('Set Product Fidelity to Exact or attach the product reference when packaging pixels must remain exact.');

  const suggested = suggestedMode(text, brief);
  const recommended = blockers.length === 0;
  if (recommended) {
    return {
      recommended,
      suggestedMode: suggested,
      packagingExact,
      reason: `${product.shortName} is front-facing with minimal package motion; preserve the original product asset and animate the environment around it.`,
      blockers
    };
  }
  return {
    recommended,
    suggestedMode: suggested,
    packagingExact,
    reason: `Use Locked Product Plate only when ${product.shortName} stays front-facing and readable while the environment carries the motion.`,
    blockers
  };
}

function sourceAssetPaths(product: Product, brief: H3VideoBrief): string[] {
  const reference = brief.references.productReference;
  if ((reference.source === 'selected-product' || reference.source === 'local-file') && reference.path?.trim()) return [reference.path.trim()];
  return getProductReferencePaths(product);
}

export function buildH3LockedProductPlatePlan(product: Product, brief: H3VideoBrief): H3LockedProductPlatePlan {
  const mode = normalizeH3LockedProductPlateMode(brief.lockedProductPlateMode);
  const coverage = coverageForMode(mode);
  const referenceAttached = productReferenceIsAttached(brief);
  if (!coverage) {
    return {
      mode,
      enabled: false,
      coverage: null,
      sourceAssetPaths: sourceAssetPaths(product, brief),
      referenceAttached,
      sourcePlate: '',
      generatedLayer: '',
      compositing: '',
      motion: '',
      warnings: []
    };
  }

  const warnings = requestsProductRotation(directionText(brief))
    ? ['This plate is front-facing only; use generated or multi-angle product coverage for any required rotation.']
    : [];
  if (!referenceAttached) warnings.push('Attach the selected product image or a local product reference before running the plate-aware H3/compositing workflow.');

  return {
    mode,
    enabled: true,
    coverage,
    sourceAssetPaths: sourceAssetPaths(product, brief),
    referenceAttached,
    sourcePlate: `Use the supplied ${product.shortName} product image as the original foreground plate. Preserve its source pixels, printed artwork, edges, proportions, closure, material appearance, and opacity exactly; H3 must not redraw or regenerate the package.`,
    generatedLayer: 'Generate only the animated background/environment, light, foam, water, particles, and atmosphere around a reserved product footprint; keep generated elements from repainting or replacing the plate.',
    compositing: 'Composite the original plate over the generated environment. Optional contact shadow and reflection passes may be integrated beneath or around the plate, but never paint over source product pixels.',
    motion: `${scopeForCoverage(coverage)} Keep the plate front-facing and use camera, light, and environment motion for animation.`,
    warnings
  };
}

export function lockedProductPlatePromptBlock(product: Product, brief: H3VideoBrief): string {
  const plan = buildH3LockedProductPlatePlan(product, brief);
  if (!plan.enabled) return '';
  return [
    `mode: ${plan.mode}`,
    `plate_scope: ${plan.motion}`,
    `source_plate: ${plan.sourcePlate}`,
    `generated_layer: ${plan.generatedLayer}`,
    `compositing: ${plan.compositing}`,
    ...plan.warnings.map((warning) => `warning: ${warning}`)
  ].join(' ');
}
