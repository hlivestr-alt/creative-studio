import { describe, expect, it } from 'vitest';
import { getProductReferencePaths, products } from './data';

describe('normalized product data', () => {
  it('loads every supported product with a reference image and restrictions', () => {
    expect(products).toHaveLength(7);
    for (const product of products) {
      expect(product.imagePath).toMatch(/^product-assets\/.+\.png$/);
      expect(product.packagingRestrictions.length).toBeGreaterThan(0);
      expect(product.benefitTerritories.length).toBeGreaterThan(0);
      expect(product.physicalIdentity.size).toBe(product.size);
      expect(product.physicalIdentity.packageComponents.length).toBeGreaterThan(0);
      expect(product.physicalIdentity.referencePresentationState.length).toBeGreaterThan(0);
      expect(product.physicalIdentity.unprintedSurfaceAppearance).toMatchObject({
        content: 'blank',
        text: 'none',
        graphics: 'none',
        logos: 'none',
        barcode: 'none',
        regulatoryCopy: 'none',
        instructions: 'none',
        labels: 'none'
      });
      expect(product.physicalIdentity.unprintedSurfaceAppearance.finish.length).toBeGreaterThan(0);
      expect(product.physicalIdentity.referenceAuthority).toContain('authorit');
      expect(product.physicalIdentity.forbiddenInterpretations.length).toBeGreaterThan(0);
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

  it('keeps the serum physical material separate from its reference-visible finish', () => {
    const serum = products.find((product) => product.id === 'serum');
    expect(serum?.physicalIdentity.physicalMaterial).toBe('glass');
    expect(serum?.physicalIdentity.surfaceAppearance).toContain('opaque painted/coated');
    expect(serum?.physicalIdentity.transparency).toBe('opaque; no visible internal liquid');
    expect(serum?.physicalIdentity.visibleGlassTransparency).toBe(false);
  });

  it('does not fabricate physical manufacturing materials for products without verification', () => {
    const unverified = products.filter((product) => !['serum', 'full-series'].includes(product.id));
    expect(unverified).toHaveLength(5);
    for (const product of unverified) {
      expect(product.physicalIdentity.physicalMaterial).toBe('unknown / do not infer; match visible reference');
    }
  });

  it('models the Skin Cream jar and detached lid separately from their staged reference arrangement', () => {
    const skinCream = products.find((product) => product.id === 'skin-cream')!;
    const identity = skinCream.physicalIdentity;

    expect(identity.packageType).toBe('cream jar');
    expect(identity.packageComponents).toEqual(['jar body', 'detachable lid']);
    expect(identity.closureType).toBe('detachable lid; exact mechanism follows reference');
    expect(identity.referencePresentationState).toEqual([
      'jar is open',
      'lid is removed from the jar',
      'removed lid is positioned underneath the jar in the supplied reference',
      'cream is visible only through the open jar top'
    ]);
    expect(identity.shape).toContain('detached lid shown underneath is separate');
    expect(identity.shape).toContain('not part of the permanent jar silhouette');
    expect(identity.referenceAuthority).toContain("detached lid shown underneath the jar is authoritative for the lid's visible appearance");
    expect(identity.forbiddenInterpretations).toEqual(expect.arrayContaining([
      'permanent white base',
      'integrated white pedestal',
      'double-base jar',
      'second lid',
      'duplicate closure'
    ]));
    expect(JSON.stringify({ identity, restrictions: skinCream.packagingRestrictions })).not.toContain('broad white base');
    expect(JSON.stringify({ identity, restrictions: skinCream.packagingRestrictions })).not.toContain('unseen lid design');
  });

  it('keeps every other product core physical identity unchanged', () => {
    const expected = {
      cleanser: ['squeeze tube', 'white flip-top base cap', 'unknown / do not infer; match visible reference'],
      toner: ['spray-pump bottle', 'white spray pump assembly under a tall clear outer protective cap', 'unknown / do not infer; match visible reference'],
      serum: ['dropper bottle', 'white bulb-and-collar dropper', 'glass'],
      'eye-cream': ['slim squeeze tube', 'small white base cap', 'unknown / do not infer; match visible reference'],
      mask: ['single-use flat sachet', 'sealed tear-open sachet; no separate cap, pump, dropper, or lid', 'unknown / do not infer; match visible reference'],
      'full-series': ['composite six-product lineup', "product-specific; reproduce each closure only from that product's own master reference", 'product-specific / do not infer or generalize; match each visible reference']
    } as const;

    for (const [id, [packageType, closureType, physicalMaterial]] of Object.entries(expected)) {
      const identity = products.find((product) => product.id === id)!.physicalIdentity;
      expect([identity.packageType, identity.closureType, identity.physicalMaterial]).toEqual([packageType, closureType, physicalMaterial]);
    }
  });

  it('normalizes front, rear, side, opacity, and contents visibility as explicit packaging truth', () => {
    for (const product of products) {
      const identity = product.physicalIdentity;

      expect(identity.frontSurfaceAppearance).toMatchObject({ content: expect.stringContaining('printed'), printedArtwork: expect.any(String) });
      expect(identity.rearSurfaceAppearance).toMatchObject({ content: 'blank', printedArtwork: 'none', text: 'none', graphics: 'none', logos: 'none', barcode: 'none', regulatoryCopy: 'none', instructions: 'none', labels: 'none' });
      expect(identity.sideSurfaceAppearance).toMatchObject({ content: 'blank', printedArtwork: 'none', text: 'none', graphics: 'none', logos: 'none', barcode: 'none', regulatoryCopy: 'none', instructions: 'none', labels: 'none' });
      expect(identity.rearSurfaceAppearance.continuity).toContain('clean blank uninterrupted continuation');
      expect(identity.sideSurfaceAppearance.continuity).toContain('clean blank uninterrupted continuation');
      expect(identity.opacityBehavior.length).toBeGreaterThan(0);
      expect(identity.contentsVisibility.length).toBeGreaterThan(0);
    }
  });

  it('encodes Cleanser as an opaque, non-see-through package without translucent wording', () => {
    const cleanser = products.find((product) => product.id === 'cleanser')!;
    const identity = cleanser.physicalIdentity;
    const identityText = [
      cleanser.packagingDescription,
      identity.surfaceAppearance,
      identity.transparency,
      identity.opacityBehavior,
      identity.contentsVisibility,
      identity.rearSurfaceAppearance.finish,
      identity.sideSurfaceAppearance.finish
    ].join(' ');

    expect(identity.transparency).toBe('opaque warm-orange tube body; package walls do not reveal contents');
    expect(identity.opacityBehavior).toContain('opaque orange tube body');
    expect(identity.opacityBehavior).toContain('non-see-through package walls');
    expect(identity.contentsVisibility).toContain('contents are not visible through the opaque tube walls');
    expect(identityText).not.toMatch(/translucent|translucency|transparent orange|reference-visible translucency/i);
    expect(identity.frontSurfaceAppearance.finish).toContain('opaque');
    expect(identity.frontSurfaceAppearance.finish).toContain('glossy');
    expect(identity.frontSurfaceAppearance.appliesTo).toContain('white flip-top base cap');
  });

  it('stores every manually verified product measurement without derived dimensions', () => {
    const dimensions = Object.fromEntries(products.map((product) => [product.id, product.physicalIdentity.dimensions]));

    expect(dimensions['eye-cream']).toMatchObject({ overallHeightCm: 13, widthBottomCm: 1.5, widthTopCm: 3 });
    expect(dimensions['eye-cream'].componentMeasurements).toEqual([{ component: 'white closure/lid', heightCm: 3 }]);
    expect(dimensions.serum).toMatchObject({ overallHeightCm: 10, widthCm: 3 });
    expect(dimensions.serum.componentMeasurements).toEqual([{ component: 'white dropper assembly', heightCm: 3.5 }]);
    expect(dimensions.toner).toMatchObject({ overallHeightCm: 14, widthCm: 4 });
    expect(dimensions.toner.componentMeasurements.map((measurement) => [measurement.component, measurement.heightCm])).toEqual([
      ['white pump assembly', 4.5],
      ['white base portion', 2],
      ['transparent protective cap', 3]
    ]);
    expect(dimensions.mask).toMatchObject({ overallHeightCm: 17, widthCm: 11 });
    expect(dimensions['skin-cream']).toMatchObject({ overallHeightCm: 4.2, diameterCm: 6 });
    expect(dimensions['skin-cream'].componentMeasurements).toEqual([{ component: 'white detachable lid', heightCm: 1.2 }]);
    expect(dimensions.cleanser).toMatchObject({ overallHeightCm: 14, widthBottomCm: 3.5, widthTopCm: 6 });
    expect(dimensions.cleanser.componentMeasurements).toEqual([{ component: 'white lid', heightCm: 2 }]);
  });

  it('preserves authoritative totals and does not encode derived component arithmetic', () => {
    const tonerDimensions = products.find((product) => product.id === 'toner')!.physicalIdentity.dimensions;
    const skinCreamDimensions = products.find((product) => product.id === 'skin-cream')!.physicalIdentity.dimensions;
    const tonerComponentSum = tonerDimensions.componentMeasurements.reduce((sum, measurement) => sum + (measurement.heightCm ?? 0), 0);

    expect(tonerDimensions.overallHeightCm).toBe(14);
    expect(tonerComponentSum).toBe(9.5);
    expect(tonerDimensions.notes.join(' ')).toContain('must never be summed');
    expect(skinCreamDimensions.overallHeightCm).toBe(4.2);
    expect(skinCreamDimensions).not.toHaveProperty('jarBodyHeightCm');
    expect(skinCreamDimensions.componentMeasurements.some((measurement) => measurement.component === 'jar body')).toBe(false);
    expect(skinCreamDimensions.notes.join(' ')).toContain('Do not derive jar-body height');
  });

  it('keeps Eye Cream narrow and Skin Cream low and wide from verified measurements', () => {
    const eye = products.find((product) => product.id === 'eye-cream')!.physicalIdentity.dimensions;
    const bottleAndTubeLowerWidths = ['cleanser', 'toner', 'serum'].map((id) => {
      const dimensions = products.find((product) => product.id === id)!.physicalIdentity.dimensions;
      return dimensions.widthBottomCm ?? dimensions.widthCm!;
    });
    const skinCream = products.find((product) => product.id === 'skin-cream')!.physicalIdentity.dimensions;

    expect(eye.widthBottomCm).toBeLessThan(Math.min(...bottleAndTubeLowerWidths));
    expect(eye.widthTopCm).toBe(3);
    expect(skinCream.diameterCm).toBeGreaterThan(skinCream.overallHeightCm!);
  });

  it('separates clear colorless Serum liquid from the opaque coated amber-orange bottle', () => {
    const serumProduct = products.find((product) => product.id === 'serum')!;
    const identity = serumProduct.physicalIdentity;

    expect(identity.physicalMaterial).toBe('glass');
    expect(identity.surfaceAppearance).toContain('opaque painted/coated glossy amber-orange');
    expect(identity.transparency).toBe('opaque; no visible internal liquid');
    expect(identity.contentsAppearance).toMatchObject({
      color: 'clear and colorless',
      transparency: 'transparent',
      visualConsistency: 'water-like',
      visibleThroughPackageWalls: false
    });
    expect(identity.contentsAppearance?.forbiddenColorInterpretations).toEqual(['golden', 'amber', 'yellow', 'orange']);
    expect(serumProduct.visualMotifs).toContain('Clear colorless serum droplet');
    expect(serumProduct.textureCues).toEqual(['clear colorless transparent water-like serum', 'clear transparent droplet']);
    expect(JSON.stringify({ visualMotifs: serumProduct.visualMotifs, textureCues: serumProduct.textureCues }).toLowerCase()).not.toContain('golden');
  });
});
