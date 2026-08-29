import { describe, expect, it } from 'vitest';
import { getProductReferencePaths, products } from './data';

describe('normalized product data', () => {
  it('loads every supported product with a reference image and restrictions', () => {
    expect(products).toHaveLength(7);
    for (const product of products) {
      expect(product.imagePath).toMatch(/^product-assets\/.+\.png$/);
      expect(product.packagingRestrictions.length).toBeGreaterThan(0);
      expect(product.benefitTerritories.length).toBeGreaterThan(0);
    }
  });

  it('marks only Serum as the hero product', () => {
    expect(products.filter((product) => product.isHero).map((product) => product.id)).toEqual(['serum']);
  });

  it('exposes every required reference for Full Series and one reference for a single product', () => {
    const fullSeries = products.find((product) => product.id === 'full-series');
    const serum = products.find((product) => product.id === 'serum');
    expect(fullSeries).toBeDefined();
    expect(serum).toBeDefined();
    expect(getProductReferencePaths(fullSeries!)).toHaveLength(6);
    expect(getProductReferencePaths(fullSeries!)).toContain('product-assets/cleanser.png');
    expect(getProductReferencePaths(serum!)).toEqual(['product-assets/serum.png']);
  });
});
