import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultCtaSettings, renderCtaEndCard } from './cta-end-card';
import type { ProductId } from './types';

const qa = process.env.PROYA_RENDER_CTA_QA === '1' ? it : it.skip;
const examples: Array<{ productId: ProductId; seed: number }> = [
  { productId: 'cleanser', seed: 0 },
  { productId: 'serum', seed: 1 },
  { productId: 'toner', seed: 2 },
  { productId: 'skin-cream', seed: 3 },
  { productId: 'eye-cream', seed: 4 },
  { productId: 'mask', seed: 6 }
];

describe('opt-in real CTA visual QA renders', () => {
  qa('renders all six verified masters across the four layouts', async () => {
    const directory = resolve('cta-visual-qa');
    mkdirSync(directory, { recursive: true });
    const results = await Promise.all(examples.map(({ productId, seed }) => renderCtaEndCard({
      productId,
      masterPath: resolve(`product-assets/${productId}.png`),
      outputPath: resolve(directory, `${productId}.mp4`),
      settings: { ...defaultCtaSettings, duration: 8, style: 'Auto' },
      language: 'Indonesian', aspectRatio: '9:16', seed
    })));
    expect(new Set(results.map(result => result.layout)).size).toBe(4);
    for (const result of results) {
      expect(statSync(result.path).size).toBeGreaterThan(50_000);
      expect(readFileSync(result.path).subarray(4, 8).toString()).toBe('ftyp');
    }
  }, 60_000);
});
