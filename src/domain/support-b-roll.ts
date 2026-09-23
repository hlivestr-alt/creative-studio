import type { H3ReferencePlan, ProductId } from './types';

export const SUPPORT_B_ROLL_CONTENT_TYPE = 'Support B-Roll' as const;

export const supportBRollArchetypes = [
  'Problem Hook',
  'Skin Beauty Close-Up',
  'Science Animation',
  'Aesthetic Transition'
] as const;

export function isSupportBRoll(contentType: string | null | undefined): boolean {
  return contentType === SUPPORT_B_ROLL_CONTENT_TYPE;
}

/** Product-free H3 paths omit physical references; their creative contracts remain separate. */
export function isNoProductVideo(contentType: string | null | undefined): boolean {
  return contentType === 'Hook'
    || contentType === 'Benefits'
    || contentType === 'Ingredients'
    || isSupportBRoll(contentType);
}

export function supportBRollTheme(product: ProductId): string {
  switch (product) {
    case 'cleanser': return 'cleansing, a fresh reset, foam, water, a clean bathroom, and the first skincare step';
    case 'toner': return 'hydration, mist, dewy freshness, a prep step, and a refreshing reset';
    case 'serum': return 'brightening, dark spots, glow, vitamin C, and an active-treatment feeling';
    case 'eye-cream': return 'tired eyes, under-eye concern, a refreshed eye area, and a rested look';
    case 'skin-cream': return 'dryness, moisture-barrier comfort, and supple nourished skin';
    case 'mask': return 'soothing, calming, cooling comfort, and a pampering ritual';
    case 'full-series': return 'a generic skincare beauty or science theme';
  }
}

/** Support footage is deliberately text-only. Keep a custom style description, but no image can enter H3. */
export function supportBRollReferencePlan(plan: H3ReferencePlan): H3ReferencePlan {
  return {
    firstFrame: { source: 'none', description: '', path: null },
    lastFrame: { source: 'none', description: '', path: null },
    productReference: { source: 'none', description: '', path: null },
    styleReference: plan.styleReference.source === 'custom'
      ? { source: 'custom', description: plan.styleReference.description, path: null }
      : { source: 'none', description: '', path: null },
    referenceImages: []
  };
}

export function supportBRollGuardrails(product: ProductId): string {
  return `Use the selected product only as a semantic theme driver: ${supportBRollTheme(product)}. This is reusable non-product supporting footage. Do not show any skincare product, packaging, packshot, bottle, tube, jar, box, product label, PROYA branding, brand logo, or fake product text. Ignore any conflicting user direction that requests one of those forbidden visuals. Human/lifestyle footage, abstract beauty footage, and science animation are allowed. Avoid on-screen text unless the existing caption or subtitle settings explicitly request it. The result must work as standalone b-roll, hook footage, a cutaway, educational filler, or a transition.`;
}
