import { describe, expect, it } from 'vitest';
import directCarouselTemplate from '../../prompts/chatgpt-direct-carousel.md?raw';
import directTemplate from '../../prompts/chatgpt-direct-image.md?raw';
import exploreCarouselTemplate from '../../prompts/chatgpt-explore-carousel.md?raw';
import exploreTemplate from '../../prompts/chatgpt-creative-director.md?raw';
import { buildCreativeBrief } from './brief';
import type { CreativeSettings, HistoryRecord } from './types';

const template = '# PRODUCT\n{{PRODUCT}}\n# VERIFIED\n{{PRODUCT_KNOWLEDGE}}\n# CLAIMS\n{{APPROVED_CLAIMS}}\n# PACKAGING\n{{PACKAGING_RULES}}\n# BRAND\n{{BRAND_DIRECTION}}\n# SETTINGS\n{{POST_SETTINGS}}\n# RECENT\n{{RECENT_CONTEXT}}';
const settings: CreativeSettings = { product: 'serum', workflowMode: 'EXPLORE_IDEAS', postStructure: 'SINGLE_IMAGE', requestedSlideCount: 'AUTO', postType: 'Product Hero', topic: 'Brightening hero', visualStyle: 'Citrus Light', textAmount: 'Minimal', captionMode: 'STANDARD', language: 'Indonesian', format: 'Instagram Feed 4:5', creativity: 'Experimental' };

const record = (overrides: Partial<HistoryRecord> = {}): HistoryRecord => ({
  id: 1, createdAt: '2026-08-20T08:00:00.000Z', product: 'serum', workflowMode: 'EXPLORE_IDEAS', postStructure: 'SINGLE_IMAGE', requestedSlideCount: null, postType: 'Texture', topic: 'Golden Drop', visualStyle: 'Texture Macro', creativityLevel: 'Balanced', format: 'Instagram Feed 4:5', language: 'Indonesian', preparedBrief: 'brief', conceptTitle: 'Liquid Sunrise', headline: 'DROP INTO GLOW', status: 'Used', notes: null, ...overrides, captionMode: overrides.captionMode ?? 'STANDARD'
});

describe('creative brief generation', () => {
  it('injects verified product knowledge, claim rules, and packaging constraints', () => {
    const brief = buildCreativeBrief({ settings, resolvedProductId: 'serum', recentHistory: [], template });
    expect(brief).toContain('30ml');
    expect(brief).toContain('Tranexamic Acid');
    expect(brief).toContain('membantu mencerahkan tampilan kulit');
    expect(brief).toContain('Do not add a pump');
    expect(brief).toContain('Never loosen factual, packaging, brand, or claim accuracy');
  });

  it('adds anti-repetition context from Used posts only', () => {
    const brief = buildCreativeBrief({ settings, resolvedProductId: 'serum', recentHistory: [record(), record({ id: 2, status: 'Rejected', conceptTitle: 'Ignore Me' })], template });
    expect(brief).toContain('Liquid Sunrise');
    expect(brief).toContain('DROP INTO GLOW');
    expect(brief).not.toContain('Ignore Me');
    expect(brief).toContain('Do not merely rename them');
  });

  it('builds the Direct Image Prompt brief around one approval-ready prompt', () => {
    const brief = buildCreativeBrief({ settings: { ...settings, workflowMode: 'DIRECT_IMAGE' }, resolvedProductId: 'serum', recentHistory: [record()], template: directTemplate });
    expect(brief).toContain('Create ONE finished Instagram image concept and ONE production-ready image-generation prompt');
    expect(brief).toContain('Do not generate three concepts.');
    expect(brief).toContain('DO NOT generate the image yet.');
    expect(brief).toContain('If my next message is exactly:');
    expect(brief).toContain('APPROVE');
    expect(brief).toContain('Use the attached PROYA product image as the exact packaging reference.');
    expect(brief).toContain('environment, composition, props, or art direction');
    expect(brief).toMatch(/Reply APPROVE to generate this image\.$/);
  });

  it('adds one ready-to-post caption and hashtags to Direct Single Image in the selected language', () => {
    const brief = buildCreativeBrief({ settings: { ...settings, workflowMode: 'DIRECT_IMAGE', language: 'English', captionMode: 'STANDARD' }, resolvedProductId: 'serum', recentHistory: [], template: directTemplate });
    const captionIndex = brief.indexOf('# INSTAGRAM CAPTION');
    const hashtagIndex = brief.indexOf('# HASHTAGS');
    const approvalIndex = brief.indexOf('Reply APPROVE to generate this image.');
    expect(captionIndex).toBeGreaterThan(-1);
    expect(hashtagIndex).toBeGreaterThan(captionIndex);
    expect(approvalIndex).toBeGreaterThan(hashtagIndex);
    expect(brief).toContain('Caption: Standard');
    expect(brief).toContain('Caption mode: Standard — about 80–150 words');
    expect(brief).toContain('ready-to-post caption for the official PROYA Indonesia Instagram account');
    expect(brief).toContain('Language: English');
    expect(brief).toContain('approved cosmetic benefit territory');
    expect(brief).toContain('Do not invent percentages, clinical studies, certifications, awards, dermatology claims, medical treatment claims');
  });

  it('keeps the Explore 3 Ideas brief explicitly three-directional', () => {
    const brief = buildCreativeBrief({ settings, resolvedProductId: 'serum', recentHistory: [], template: exploreTemplate });
    expect(brief).toContain('Create exactly three meaningfully different Instagram creative concepts.');
    expect(brief).not.toContain('Do not generate three concepts.');
    expect(brief).toContain('Workflow mode: Explore 3 Ideas');
  });

  it('includes every Full Series reference path in a prepared brief', () => {
    const brief = buildCreativeBrief({ settings: { ...settings, product: 'full-series', workflowMode: 'DIRECT_IMAGE' }, resolvedProductId: 'full-series', recentHistory: [], template: directTemplate });
    expect(brief).toContain('product-assets/cleanser.png');
    expect(brief).toContain('product-assets/toner.png');
    expect(brief).toContain('product-assets/eye-cream.png');
    expect(brief).toContain('product-assets/serum.png');
    expect(brief).toContain('product-assets/skin-cream.png');
    expect(brief).toContain('product-assets/mask.png');
  });

  it('builds a Direct Carousel brief with Auto slide selection and approval gating', () => {
    const brief = buildCreativeBrief({ settings: { ...settings, workflowMode: 'DIRECT_IMAGE', postStructure: 'CAROUSEL', requestedSlideCount: 'AUTO' }, resolvedProductId: 'serum', recentHistory: [record({ postStructure: 'CAROUSEL', requestedSlideCount: 5 })], template: directCarouselTemplate });
    expect(brief).toContain('POST STRUCTURE: Carousel');
    expect(brief).toContain('SLIDE COUNT: Auto');
    expect(brief).toContain('Create ONE cohesive Instagram carousel campaign.');
    expect(brief).toContain('choose the smallest useful number');
    expect(brief).toContain('individual slide prompts');
    expect(brief).toContain('Do not generate three different concepts.');
    expect(brief).toContain('DO NOT generate any images yet.');
    expect(brief).toContain('Final approved slide count: N');
    expect(brief).toContain('N independent image generations');
    expect(brief).toContain('one slide prompt per independent generation');
    expect(brief).toContain('Do not submit all slide prompts together as one image-generation request.');
    expect(brief).toContain('Treat each slide prompt as an independent image-generation task.');
    expect(brief).toContain('Finish one standalone image generation for each slide within this same response.');
    expect(brief).toContain('The number of independent image generations must equal the final approved slide count exactly.');
    expect(brief).toContain('a five-slide carousel means five independent 4:5 image outputs');
    expect(brief).toContain('contact sheet');
    expect(brief).toContain('collage');
    expect(brief).toContain('montage');
    expect(brief).toContain('Generate no extra variants');
    expect(brief).toContain('Do not output fewer than N images');
    expect(brief).toContain('Use the attached PROYA product image as the exact packaging reference.');
    expect(brief).toContain('official PROYA product image attached to the APPROVE message as the primary and authoritative visual reference');
    expect(brief).toContain('The attached image overrides textual packaging descriptions.');
    expect(brief).toContain('Do not reconstruct a generic PROYA package from written instructions.');
    expect(brief).toContain('FOLLOW THE ATTACHED IMAGE.');
    expect(brief).toContain('PRODUCT REFERENCE TIMING');
    expect(brief).toContain('Slide 1, Slide 2, Slide 3');
    expect(brief).toContain('Reply APPROVE and attach the official product reference PNG to generate exactly N independent standalone carousel images. ChatGPT must perform N separate image generations in the same response—one generation using only each slide\'s prompt, one slide per image, with no collage or extra variants. Never combine multiple slides into one image.');
  });

  it('passes a manual carousel slide count through the brief unchanged', () => {
    const brief = buildCreativeBrief({ settings: { ...settings, workflowMode: 'DIRECT_IMAGE', postStructure: 'CAROUSEL', requestedSlideCount: 5 }, resolvedProductId: 'serum', recentHistory: [], template: directCarouselTemplate });
    expect(brief).toContain('SLIDE COUNT: 5');
    expect(brief).toContain('Final approved slide count: 5');
    expect(brief).toContain('Reply APPROVE and attach the official product reference PNG to generate exactly 5 independent standalone carousel images. ChatGPT must perform 5 separate image generations in the same response—one generation using only each slide\'s prompt, one slide per image, with no collage or extra variants. Never combine multiple slides into one image.');
    expect(brief).not.toContain('{{APPROVAL_SLIDE_COUNT}}');
    expect(brief).toContain('Respect a manual slide count exactly.');
  });

  it('adds one overall caption to Direct Carousel without changing generation safeguards', () => {
    const brief = buildCreativeBrief({ settings: { ...settings, workflowMode: 'DIRECT_IMAGE', postStructure: 'CAROUSEL', requestedSlideCount: 4, captionMode: 'DETAILED' }, resolvedProductId: 'serum', recentHistory: [], template: directCarouselTemplate });
    expect(brief).toContain('# INSTAGRAM CAPTION');
    expect(brief).toContain('Caption mode: Detailed — about 150–250 words');
    expect(brief).toContain('Write exactly one cohesive caption for the entire carousel.');
    expect(brief).toContain('Do not write separate captions for individual slides');
    expect(brief).toContain('Do not write separate captions for individual slides, say “slide 1” or “slide 2”, repeat every slide’s visible text, or turn the caption into a transcript of the carousel.');
    expect(brief).toContain('# HASHTAGS');
    expect(brief).toContain('generate exactly 4 independent standalone carousel images');
    expect(brief).toContain('Do not submit all slide prompts together as one image-generation request.');
    expect(brief).toContain('Generate no extra variants');
  });

  it('omits caption and hashtag sections for Direct None while retaining the approval workflow', () => {
    const singleBrief = buildCreativeBrief({ settings: { ...settings, workflowMode: 'DIRECT_IMAGE', captionMode: 'NONE' }, resolvedProductId: 'serum', recentHistory: [], template: directTemplate });
    const carouselBrief = buildCreativeBrief({ settings: { ...settings, workflowMode: 'DIRECT_IMAGE', postStructure: 'CAROUSEL', requestedSlideCount: 5, captionMode: 'NONE' }, resolvedProductId: 'serum', recentHistory: [], template: directCarouselTemplate });
    for (const brief of [singleBrief, carouselBrief]) {
      expect(brief).toContain('Caption: None');
      expect(brief).not.toContain('# INSTAGRAM CAPTION');
      expect(brief).not.toContain('# HASHTAGS');
    }
    expect(singleBrief).toMatch(/Reply APPROVE to generate this image\.$/);
    expect(carouselBrief).toContain('5 independent standalone carousel images');
  });

  it('keeps Explore Carousel concise and exactly three-directional', () => {
    const brief = buildCreativeBrief({ settings: { ...settings, postStructure: 'CAROUSEL', requestedSlideCount: 6 }, resolvedProductId: 'serum', recentHistory: [], template: exploreCarouselTemplate });
    expect(brief).toContain('Create exactly three meaningfully different Instagram carousel concepts');
    expect(brief).toContain('SLIDE COUNT: 6');
    expect(brief).toContain('## IDEA A');
    expect(brief).toContain('## IDEA B');
    expect(brief).toContain('## IDEA C');
    expect(brief).toContain('Do not write full individual image-generation prompts');
    expect(brief).not.toContain('Reply APPROVE to generate the carousel.');
    expect(brief).toContain('Caption: Standard (Explore mode: remain concept-focused; do not generate full captions or hashtags.)');
    expect(brief).not.toContain('# INSTAGRAM CAPTION');
    expect(brief).not.toContain('# HASHTAGS');
  });
});
