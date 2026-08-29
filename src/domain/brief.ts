import { brand, claimRules, getProduct, getProductReferencePaths } from './data';
import type { CaptionMode, Creativity, CreativeSettings, HistoryRecord, ProductId } from './types';

export interface BriefInput { settings: CreativeSettings; resolvedProductId: ProductId; recentHistory: HistoryRecord[]; template: string; }

const bullets = (items: string[]) => items.map((item) => `- ${item}`).join('\n');

const creativityGuidance: Record<Creativity, string> = {
  Safe: 'Prefer clear commercial skincare photography and conventional Instagram compositions.',
  Balanced: 'Use distinctive premium campaign concepts while remaining strongly recognizable as PROYA.',
  Experimental: 'Allow surreal and AI-native visual ideas such as architectural transformations, giant-scale skincare environments, abstract Vitamin C worlds, molecular landscapes, and unusual glass/light constructions.'
};

const workflowLabel = (mode: CreativeSettings['workflowMode']) => mode === 'DIRECT_IMAGE' ? 'Direct Image Prompt' : 'Explore 3 Ideas';
const structureLabel = (structure: CreativeSettings['postStructure']) => structure === 'CAROUSEL' ? 'Carousel' : 'Single Image';
const slideCountLabel = (settings: CreativeSettings) => settings.postStructure === 'CAROUSEL' ? settings.requestedSlideCount === 'AUTO' ? 'Auto' : String(settings.requestedSlideCount ?? 'Auto') : 'Not applicable (Single Image)';
const carouselSlideGuidance = 'If Slides is Auto, choose the smallest useful number based on the actual topic and supported information: 3–4 for a simple product story, single benefit, texture, or lifestyle; 4–5 for problem → solution, product knowledge, or product benefit; 5–7 for ingredient education, 5X technology, routine, myth vs fact, or comparison; up to 8 only when genuinely required. Prefer approximately 4–6 slides, give every slide a clear purpose, and never add filler or repeat the same message.';
const captionLabels: Record<CaptionMode, string> = { SHORT: 'Short', STANDARD: 'Standard', DETAILED: 'Detailed', NONE: 'None' };
const captionRanges: Record<Exclude<CaptionMode, 'NONE'>, string> = { SHORT: 'about 30–70 words', STANDARD: 'about 80–150 words', DETAILED: 'about 150–250 words' };

function captionSections(settings: CreativeSettings): string {
  if (settings.workflowMode !== 'DIRECT_IMAGE' || settings.captionMode === 'NONE') return '';
  const carouselGuidance = settings.postStructure === 'CAROUSEL'
    ? 'Write exactly one cohesive caption for the entire carousel. Do not write separate captions for individual slides, say “slide 1” or “slide 2”, repeat every slide’s visible text, or turn the caption into a transcript of the carousel.'
    : 'Write one cohesive caption for the complete single-image post.';
  return [
    '# INSTAGRAM CAPTION',
    'Write one finished, ready-to-post caption for the official PROYA Indonesia Instagram account.',
    `Caption mode: ${captionLabels[settings.captionMode]} — ${captionRanges[settings.captionMode]} as guidance, not a rigid limit.`,
    'Base it on the selected product, topic, post type, final creative concept, verified product knowledge, approved claim territory, selected language, and this caption mode.',
    'The caption should complement the image rather than simply repeat its visible copy. Use a flexible structure suited to the post: an opening hook, useful value or education, product relevance, and a soft call to action. Do not force the same structure every time.',
    'Adapt the structure to the post type: Product Hero can be shorter and aspirational, Ingredient Education can be more informative, Problem → Solution can begin with the consumer concern, Routine can be instructional, and an educational carousel can extend the story without repeating its slide text.',
    carouselGuidance,
    'For Indonesian, use natural modern Indonesian—not stiff translated wording—with a premium but approachable tone and light emoji use only when appropriate. Vary the opening sentence, CTA, emoji pattern, structure, and exact hashtag set from recent Used history where practical.',
    'Use only verified ingredients, sizes, product roles, and approved cosmetic benefit territory. Do not infer unsupported product features from a visual metaphor. Do not invent percentages, clinical studies, certifications, awards, dermatology claims, medical treatment claims, guaranteed timelines or results, or permanent whitening claims.',
    '# HASHTAGS',
    'Provide approximately 5–10 relevant hashtags. Use a balanced mix of brand, product category, ingredient or category, and skincare relevance. Avoid 20–30 hashtag spam, irrelevant trending tags, unsupported medical or claim hashtags, and blindly repeating the exact same set.'
  ].join('\n\n');
}

export function buildCreativeBrief({ settings, resolvedProductId, recentHistory, template }: BriefInput): string {
  const product = getProduct(resolvedProductId);
  if (!product) throw new Error(`Unknown product: ${resolvedProductId}`);
  const isDirectCarousel = settings.workflowMode === 'DIRECT_IMAGE' && settings.postStructure === 'CAROUSEL';
  const recentUsed = recentHistory.filter((item) => item.status === 'Used').slice(0, 20);
  const carouselHistoryGuidance = settings.postStructure === 'CAROUSEL'
    ? ' For carousel planning, also avoid unnecessarily repeating the same opening hook, slide narrative, educational sequence, hero composition, or visual metaphor. Vary the concept, not only the product.'
    : '';
  const recentGuidance = settings.workflowMode === 'DIRECT_IMAGE'
    ? `In Direct Image Prompt mode, avoid unnecessarily repeating the recently used topic, headline structure, visual hook, environment, composition, props, or art direction when possible. Do not force novelty when it would conflict with the requested campaign. Do not merely rename them.${carouselHistoryGuidance}`
    : `Use the history as a guardrail while making the three directions meaningfully different. Do not merely rename them.${carouselHistoryGuidance}`;
  const recentContext = recentUsed.length
    ? `${bullets(recentUsed.map((item) => `${item.product} | ${item.postType} | ${item.topic} | ${item.visualStyle} | ${item.postStructure === 'CAROUSEL' ? `Carousel · ${item.requestedSlideCount === 'AUTO' ? 'Auto' : item.requestedSlideCount ?? 'Auto'} slides` : 'Single Image'}${item.conceptTitle ? ` | ${item.conceptTitle}` : ''}${item.headline ? ` | “${item.headline}”` : ''}`))}\n\n${recentGuidance}`
    : `No Used posts are recorded yet. Establish a strong first concept${settings.workflowMode === 'EXPLORE_IDEAS' ? ' set' : ''} without inventing campaign history. ${recentGuidance}`;
  const knowledge = [
    `Official name: ${product.officialName}`, `Size: ${product.size}`, `Role: ${product.role}`,
    `Verified ingredients:\n${bullets(product.ingredients)}`, `Safe benefit territories:\n${bullets(product.benefitTerritories)}`,
    `Safe copy examples:\n${bullets(product.safeCopy)}`, `Texture cues: ${product.textureCues.join(', ')}`,
    `Usage position: ${product.usagePosition}`
  ].join('\n\n');
  const packaging = isDirectCarousel ? [
    'The planning brief may be sent before the product PNG is attached. For generation, attach the official product reference PNG(s) together with APPROVE.',
    'Use the attached PROYA product image as the exact packaging reference.',
    'For every slide that contains a product, use the official PROYA product image attached to the APPROVE message as the primary and authoritative visual reference.',
    'The attached image overrides textual packaging descriptions. Do not reconstruct a generic PROYA package from written instructions.',
    'Do not redesign or reinterpret the product. If textual packaging instructions conflict with the attached image: FOLLOW THE ATTACHED IMAGE.',
    'Match the supplied reference in silhouette, proportions, shoulders, closure/dropper/pump/cap, orange body appearance, packaging material, label structure, PROYA logo position, and front-facing visual hierarchy.',
    'Keep per-slide packaging wording concise; after the reference lock describe only product position, scale, camera angle, lighting interaction, and environment.',
    `Reference file(s): ${getProductReferencePaths(product).join(', ')}`
  ] : [
    'Use the attached PROYA product image as the exact packaging reference.',
    'Preserve silhouette, dimensions/proportions, cap, pump, dropper, tube/jar/bottle/sachet format, packaging material appearance, orange/white color identity, PROYA logo position, front-label structure, and VITAMIN C visual emphasis.',
    'Do not redesign the packaging. Do not add, remove, or swap package components; only change the environment, camera angle, lighting, props, and composition.',
    brand.productReferenceInstruction,
    product.packagingDescription,
    ...product.packagingRestrictions,
    `Reference file(s): ${getProductReferencePaths(product).join(', ')}`
  ];
  const brandDirection = [
    `Core idea: ${brand.coreIdea}`, `Personality: ${brand.personality.join(', ')}`, `Visual direction: ${brand.visualDirection.join(' + ')}`,
    `Palette: orange ${brand.palette.orange}, citrus glow ${brand.palette.citrusGlow}, cream ${brand.palette.cream}, white ${brand.palette.white}, black ${brand.palette.black}.`,
    `Prompt language: ${brand.defaultPromptKeywords.join(', ')}.`,
    `Never loosen factual, packaging, brand, or claim accuracy because of the creativity setting.`,
    `Avoid these claims unless separately approved:\n${bullets(claimRules.avoidUnlessApproved)}`
  ].join('\n\n');
  const postSettings = [
    `Workflow mode: ${workflowLabel(settings.workflowMode)}`, `POST STRUCTURE: ${structureLabel(settings.postStructure)}`, `SLIDE COUNT: ${slideCountLabel(settings)}`, `Post type: ${settings.postType}`, `Topic: ${settings.topic}`, `Visual style: ${settings.visualStyle}`,
    `Text amount: ${settings.textAmount}`, `Caption: ${captionLabels[settings.captionMode]}${settings.workflowMode === 'EXPLORE_IDEAS' ? ' (Explore mode: remain concept-focused; do not generate full captions or hashtags.)' : settings.captionMode === 'NONE' ? ' (Do not generate a caption or hashtags.)' : ''}`, `Language: ${settings.language}`, `Format: ${settings.format}`,
    `Creativity: ${settings.creativity} (visual and concept freedom only)`, `Creativity guardrail: ${creativityGuidance[settings.creativity]}`,
    ...(settings.postStructure === 'CAROUSEL' ? [
      `Carousel slide-count guidance: ${carouselSlideGuidance}`,
      `FINAL SLIDE COUNT: ${settings.requestedSlideCount === 'AUTO' ? 'Choose one exact integer first, state it as “Final approved slide count: N”, and reuse that same N in the approval line.' : `${settings.requestedSlideCount} (must be used exactly in the response and approval line).`}`,
      ...(isDirectCarousel ? ['PRODUCT REFERENCE TIMING: The planning brief may be sent without the product PNG. For strongest packaging fidelity, attach the official product reference PNG(s) together with the APPROVE message for generation.'] : [])
    ] : [])
  ].join('\n');

  const approvalSlideCount = settings.postStructure === 'CAROUSEL'
    ? settings.requestedSlideCount === 'AUTO' ? 'N' : String(settings.requestedSlideCount)
    : '';
  const generatedCaptionSections = captionSections(settings);

  return template
    .replace('{{PRODUCT}}', `${product.officialName}${settings.product === 'auto' ? ' (selected by local Smart Rotation)' : ''}`)
    .replace('{{PRODUCT_KNOWLEDGE}}', knowledge)
    .replace('{{APPROVED_CLAIMS}}', `${claimRules.rule}\n\n${bullets([...claimRules.approved, ...product.benefitTerritories])}`)
    .replace('{{PACKAGING_RULES}}', bullets(packaging))
    .replace('{{BRAND_DIRECTION}}', brandDirection)
    .replace('{{POST_SETTINGS}}', postSettings)
    .replace('{{RECENT_CONTEXT}}', recentContext)
    .replaceAll('{{APPROVAL_SLIDE_COUNT}}', approvalSlideCount)
    .replaceAll('{{CAPTION_SECTIONS}}', generatedCaptionSections)
    .trim();
}
