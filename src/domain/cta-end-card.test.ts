import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { CTA_LAYOUTS, CTA_PRODUCT_PRICES, ctaEligibleStyles, ctaLines, defaultCtaSettings, isCtaEndCard, renderCtaEndCard, resolveCtaLayout, resolveCtaStyle } from './cta-end-card';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isSupportBRoll, supportBRollReferencePlan } from './support-b-roll';
import { createOptionalH3ReferencePlan } from './h3';
import { products } from './data';
import { safeOutputComponent, advanceAutoCursor, type AutoH3Session } from './auto-h3';

describe('independent local CTA / End Card', () => {
  it('rotates deterministically through four genuinely different layout archetypes', () => {
    expect(CTA_LAYOUTS).toEqual(['Center Hero', 'Product Left / Price Right', 'Product Lower / Offer Upper', 'Minimal Premium']);
    expect([0, 1, 2, 3, 4].map(resolveCtaLayout)).toEqual([...CTA_LAYOUTS, 'Center Hero']);
  });

  it('is not Support B-Roll, whose references remain empty', () => {
    expect(isCtaEndCard('CTA / End Card')).toBe(true);
    expect(isSupportBRoll('CTA / End Card')).toBe(false);
    expect(isSupportBRoll('Support B-Roll')).toBe(true);
    const references = supportBRollReferencePlan(createOptionalH3ReferencePlan(products[0]));
    expect(references.productReference.source).toBe('none');
    expect(references.referenceImages).toEqual([]);
  });

  it('allows price, benefit, and promo only when supplied; shop/minimal always', () => {
    expect(ctaEligibleStyles(defaultCtaSettings)).toEqual(['Shop', 'Minimal Premium']);
    const settings = { ...defaultCtaSettings, price: 'Rp75.000', benefit: 'Kulit tampak lebih cerah', promo: 'Promo hari ini' };
    expect(ctaEligibleStyles(settings)).toEqual(['Price', 'Shop', 'Benefit', 'Minimal Premium', 'Promo']);
    expect(ctaLines('Price', settings, 'Indonesian')).toEqual(['Rp75.000', 'Cek sekarang']);
    expect(() => resolveCtaStyle({ ...defaultCtaSettings, style: 'Promo' }, 0)).toThrow(/requires/);
    expect(resolveCtaStyle(defaultCtaSettings, 0, 'Shop')).toBe('Minimal Premium');
  });

  it('preserves custom text exactly and uses language-specific defaults', () => {
    expect(ctaLines('Shop', defaultCtaSettings, 'English')).toEqual(['Shop now']);
    expect(ctaLines('Shop', defaultCtaSettings, 'Indonesian')).toEqual(['Cek sekarang']);
    expect(ctaLines('Shop', { ...defaultCtaSettings, action: 'Klik keranjang kuning' }, 'English')).toEqual(['Klik keranjang kuning']);
    expect(ctaLines('Price', { ...defaultCtaSettings, price: '' }, 'English')).toEqual(['', 'Shop now']);
  });

  it('maps every approved product price verbatim, including Full Series as the set', () => {
    expect(CTA_PRODUCT_PRICES).toEqual({
      cleanser: { discounted: 'Rp89.000', original: 'Rp222.500' },
      toner: { discounted: 'Rp102.990', original: 'Rp257.475' },
      'skin-cream': { discounted: 'Rp119.900', original: 'Rp299.750' },
      'eye-cream': { discounted: 'Rp74.990', original: 'Rp187.500' },
      serum: { discounted: 'Rp116.990', original: 'Rp267.500' },
      mask: { discounted: 'Rp15.000', original: 'Rp37.500' },
      'full-series': { discounted: 'Rp429.900', original: 'Rp1.074.750' }
    });
  });

  it('archives under a distinct content-type component and schedules independently', () => {
    expect(safeOutputComponent('CTA / End Card')).toBe('CTA-End-Card');
    const session = { selectedProducts: ['serum'], selectedContentTypes: ['UGC Content', 'Support B-Roll', 'CTA / End Card'], productOrder: ['serum'], contentTypeOrder: ['UGC Content', 'Support B-Roll', 'CTA / End Card'], shuffleProducts: false, shuffleContentTypes: false, productIndex: 0, contentTypeIndex: 1, cycleNumber: 1 } as AutoH3Session;
    const next = advanceAutoCursor(session, 42);
    expect(next.contentTypeOrder[next.contentTypeIndex]).toBe('CTA / End Card');
    expect(advanceAutoCursor(next, 42).cycleNumber).toBe(2);
  });

  it('renders the verified master locally without a model and fails for a missing master', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'proya-cta-test-'));
    try {
      const outputPath = join(dir, 'test.mp4');
      const result = await renderCtaEndCard({ productId: 'serum', masterPath: resolve('product-assets/serum.png'), outputPath,
        settings: { ...defaultCtaSettings, duration: 8, style: 'Shop', action: 'Klik keranjang kuning' },
        language: 'Indonesian', aspectRatio: '9:16', seed: 17 });
      expect(result.size).toBeGreaterThan(10000);
      expect(readFileSync(outputPath).subarray(4, 8).toString()).toBe('ftyp');
      const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', outputPath], { encoding: 'utf8' });
      expect(probe.status).toBe(0);
      expect(Number(probe.stdout.trim())).toBeGreaterThanOrEqual(8);
      expect(Number(probe.stdout.trim())).toBeLessThan(8.1);
      const frameHash = (second: number) => spawnSync('ffmpeg', ['-v', 'error', '-ss', String(second), '-i', outputPath, '-frames:v', '1', '-f', 'md5', '-'], { encoding: 'utf8' }).stdout.trim();
      expect(frameHash(6)).not.toBe(frameHash(7));
      await expect(renderCtaEndCard({ productId: 'serum', masterPath: join(dir, 'missing.png'), outputPath,
        settings: defaultCtaSettings, language: 'English', aspectRatio: '9:16', seed: 1 })).rejects.toThrow(/master missing/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
