import { describe, expect, it } from 'vitest';
import {
  buildCreativeFingerprint,
  calculateCreativePenaltySources,
  compareCreativeFingerprints,
  CreativeConstraintError,
  getCreativeFamilyGrammar,
  isNearDuplicate,
  planCreativeGenome,
  resolveCreativeFamilyForH3VideoType,
  simulateCreativeDiversity,
  toCreativeHistoryEntries,
  type CreativeHistoryEntry
} from './creative-diversity';
import { buildH3Prompt, createH3ReferencePlan } from './h3';
import { getProduct } from './data';
import type { CreativeGenome, H3ContentType, H3VideoBrief } from './types';

const cleanser = getProduct('cleanser')!;
const fixedNow = new Date('2026-01-01T12:00:00.000Z');

function historyEntry(plan: ReturnType<typeof planCreativeGenome>, index: number, createdAt = fixedNow.toISOString()): CreativeHistoryEntry {
  return {
    id: plan.generationJobId ?? `test-${index}`,
    generationJobId: plan.generationJobId ?? `test-${index}`,
    product: plan.product,
    contentFamily: plan.contentFamily,
    genome: plan.genome,
    fingerprint: plan.fingerprint,
    conceptSummary: plan.conceptSummary,
    createdAt,
    generationStatus: 'planned'
  };
}

function materializedCandidates(contentFamily: H3ContentType): CreativeGenome[] {
  return getCreativeFamilyGrammar(contentFamily).directions.flatMap((direction) => {
    const { id: _id, variants, ...base } = direction;
    void _id;
    return [
      { schemaVersion: 1, contentFamily, ...base },
      ...(variants ?? []).map((variant) => ({ schemaVersion: 1, contentFamily, ...base, ...variant }))
    ] as CreativeGenome[];
  });
}

function historyForCandidates(candidates: readonly CreativeGenome[]): CreativeHistoryEntry[] {
  return candidates.map((genome, index) => {
    const fingerprint = buildCreativeFingerprint(genome);
    return {
      id: `history-${index}`,
      generationJobId: `history-${index}`,
      product: cleanser.id,
      contentFamily: genome.contentFamily,
      genome,
      fingerprint,
      conceptSummary: null,
      createdAt: new Date(fixedNow.getTime() - index * 60_000).toISOString(),
      generationStatus: 'planned'
    };
  });
}

function h3Brief(overrides: Partial<H3VideoBrief> = {}): H3VideoBrief {
  return {
    product: cleanser.id,
    contentType: 'Product B-Roll',
    creativeVariety: 'Balanced',
    videoIdea: '',
    language: 'English',
    musicOnly: true,
    captions: false,
    subtitles: false,
    goal: 'Product reveal',
    customGoal: '',
    duration: 8,
    aspectRatio: '9:16',
    customAspectRatio: '',
    qualityPreset: 'Final',
    megapixels: 0.98,
    multiple: 32,
    fps: 24,
    workflowMode: 'REF2VA',
    cameraMotion: 'Cinematic',
    actionIntensity: 'Medium',
    pacing: 'Balanced',
    productFidelity: 'Exact',
    ending: 'Hero Shot',
    customEnding: '',
    sound: 'Music Only',
    promptDetail: 'Production',
    specialInstructions: '',
    references: createH3ReferencePlan(cleanser),
    ...overrides
  };
}

describe('Creative Diversity Engine', () => {
  it('gives Product B-Roll a broad family-specific grammar', () => {
    const grammar = getCreativeFamilyGrammar('Product B-Roll');
    expect(grammar.directions.length).toBeGreaterThanOrEqual(10);
    expect(new Set(grammar.directions.map((direction) => direction.creativeArchetype)).size).toBeGreaterThanOrEqual(10);
    expect(getCreativeFamilyGrammar('Cinematic Product Ad').directions[0].creativeArchetype).not.toBe(grammar.directions[0].creativeArchetype);
  });

  it('keeps 20 sequential Cleanser B-Rolls from collapsing onto one execution', () => {
    const history: CreativeHistoryEntry[] = [];
    const plans = [] as ReturnType<typeof planCreativeGenome>[];
    for (let index = 0; index < 20; index += 1) {
      const plan = planCreativeGenome({ product: cleanser, contentFamily: 'Product B-Roll', seed: 9000 + index, recentHistory: history, now: fixedNow, generationJobId: `cleanser-broll-${index}` });
      plans.push(plan);
      history.unshift(historyEntry(plan, index));
    }
    expect(new Set(plans.map((plan) => plan.genome.creativeArchetype)).size).toBeGreaterThanOrEqual(10);
    expect(new Set(plans.map((plan) => plan.genome.cameraPath)).size).toBeGreaterThanOrEqual(8);
    expect(new Set(plans.map((plan) => plan.genome.environment)).size).toBeGreaterThanOrEqual(10);
    for (let index = 1; index < plans.length; index += 1) {
      const comparison = compareCreativeFingerprints(plans[index - 1].fingerprint, plans[index].fingerprint);
      expect(comparison.meaningfulDifferenceCount).toBeGreaterThanOrEqual(4);
      expect(comparison.visualHookChanged || comparison.creativeArchetypeChanged).toBe(true);
    }
  });

  it('rejects exact and near duplicate fingerprints before a render', () => {
    const first = planCreativeGenome({ product: cleanser, contentFamily: 'Product B-Roll', seed: 17, now: fixedNow });
    const exact = buildCreativeFingerprint({ ...first.genome });
    const near = buildCreativeFingerprint({ ...first.genome, cameraPath: `${first.genome.cameraPath} with a tiny reframing` });
    const distinct = buildCreativeFingerprint({
      ...first.genome,
      creativeArchetype: 'Different Art Direction',
      visualHook: 'a vertical water column reveals the hero from below',
      environment: 'bright materials laboratory with clear glass cylinders',
      composition: 'orthographic-like grid with measured spacing and a single hero anchor',
      cameraPath: 'controlled overhead descent into a straight-on product view',
      lightingStyle: 'cool clinical white with a measured amber calibration line'
    });
    expect(isNearDuplicate(exact, first.fingerprint)).toBe(true);
    expect(isNearDuplicate(near, first.fingerprint)).toBe(true);
    expect(isNearDuplicate(distinct, first.fingerprint)).toBe(false);
  });

  it('uses repetition penalties and lets those penalties decay', () => {
    const first = planCreativeGenome({ product: cleanser, contentFamily: 'Product B-Roll', seed: 71, now: fixedNow, generationJobId: 'first' });
    const repeated = [0, 1, 2].map((index) => historyEntry(first, index));
    const baseline = planCreativeGenome({ product: cleanser, contentFamily: 'Product B-Roll', seed: 71, now: fixedNow, generationJobId: 'baseline' });
    const next = planCreativeGenome({ product: cleanser, contentFamily: 'Product B-Roll', seed: 71, recentHistory: repeated, now: fixedNow, generationJobId: 'next' });
    expect(next.fingerprint.signature).not.toBe(baseline.fingerprint.signature);

    const candidate = first.genome;
    const recentPenalty = calculateCreativePenaltySources(candidate, { product: cleanser, contentFamily: 'Product B-Roll', recentHistory: [historyEntry(first, 0, fixedNow.toISOString())], now: fixedNow });
    const oldPenalty = calculateCreativePenaltySources(candidate, { product: cleanser, contentFamily: 'Product B-Roll', recentHistory: [historyEntry(first, 0, '2025-11-01T12:00:00.000Z')], now: fixedNow });
    expect(recentPenalty.length).toBeGreaterThan(0);
    expect(recentPenalty.reduce((sum, item) => sum + item.penalty, 0)).toBeGreaterThan(oldPenalty.reduce((sum, item) => sum + item.penalty, 0));
  });

  it('preserves product truth and honors explicit creative instructions', () => {
    const plan = planCreativeGenome({
      product: cleanser,
      contentFamily: 'Product B-Roll',
      userIdea: 'Film the Cleanser in an orange laboratory with an overhead camera.',
      now: fixedNow,
      seed: 22
    });
    expect(plan.product).toBe(cleanser.id);
    expect(plan.productTruth).toMatchObject({
      product: cleanser.id,
      officialName: cleanser.officialName,
      referencePath: cleanser.imagePath,
      packagingDescription: cleanser.packagingDescription,
      physicalIdentity: cleanser.physicalIdentity,
      verifiedIngredients: cleanser.ingredients,
      verifiedClaims: cleanser.benefitTerritories,
      safetyConstraints: [...cleanser.packagingRestrictions, ...cleanser.physicalIdentity.forbiddenInterpretations]
    });
    expect(plan.genome.contentFamily).toBe('Product B-Roll');
    expect(plan.genome.environment).toBe('orange laboratory');
    expect(plan.genome.cameraPath).toBe('overhead top-down camera');
    expect(plan.genome).not.toHaveProperty('packagingDescription');
    expect(plan.genome).not.toHaveProperty('verifiedClaims');
    expect(plan.genome).not.toHaveProperty('safetyConstraints');
  });

  it('reproduces the same genome from the same seed and history', () => {
    const input = { product: cleanser, contentFamily: 'Product B-Roll' as const, seed: 123456, now: fixedNow, generationJobId: 'reproducible' };
    const first = planCreativeGenome(input);
    const second = planCreativeGenome(input);
    expect(second.genome).toEqual(first.genome);
    expect(second.fingerprint).toEqual(first.fingerprint);
    expect(second.noveltyScore).toBe(first.noveltyScore);
  });

  it('accepts a stable product ID for scheduler-facing planning', () => {
    const plan = planCreativeGenome({ product: 'cleanser', contentFamily: 'Product B-Roll', seed: 99, now: fixedNow });
    expect(plan.product).toBe('cleanser');
    expect(plan.productTruth.packagingDescription).toBe(cleanser.packagingDescription);
  });

  it('keeps the H3 render prompt lean and out of product packaging prose', () => {
    const plan = planCreativeGenome({ product: cleanser, contentFamily: 'Product B-Roll', seed: 808, now: fixedNow });
    const prompt = buildH3Prompt({ product: cleanser, brief: h3Brief({ creativeSeed: plan.creativeSeed, creativeGenome: plan.genome }), concept: null });
    expect(prompt).toContain('detailed_description:');
    expect(prompt).toContain(plan.genome.visualHook);
    expect(prompt).not.toContain(cleanser.packagingDescription);
    expect(prompt).not.toContain(JSON.stringify(plan.genome));
    expect(prompt).not.toContain('creativeArchetype:');
    expect(prompt).not.toContain('cameraPath:');
  });

  it('runs a deterministic 100-concept simulation with broad axis distribution', () => {
    const report = simulateCreativeDiversity({ product: cleanser, contentFamily: 'Product B-Roll', count: 100, seed: 20260901, now: fixedNow });
    expect(report.plans).toHaveLength(100);
    expect(Object.keys(report.archetypeDistribution).length).toBeGreaterThanOrEqual(10);
    expect(Object.keys(report.cameraDistribution).length).toBeGreaterThanOrEqual(8);
    expect(Object.keys(report.environmentDistribution).length).toBeGreaterThanOrEqual(10);
    expect(Math.min(...report.consecutiveDifferenceCounts)).toBeGreaterThanOrEqual(4);
    expect(report.rejectedConcepts.length).toBeGreaterThan(0);
    console.info('Creative Diversity 10-sample report', JSON.stringify(report.plans.slice(0, 10).map((plan, index) => ({
      index: index + 1,
      summary: plan.conceptSummary,
      fingerprint: {
        signature: plan.fingerprint.signature,
        archetype: plan.fingerprint.creativeArchetype,
        hook: plan.fingerprint.visualHook,
        environment: plan.fingerprint.environment,
        camera: plan.fingerprint.cameraPath
      },
      noveltyScore: plan.noveltyScore
    }))));
    console.info('Creative Diversity rejected examples', JSON.stringify(report.rejectedConcepts.slice(0, 5)));
    console.info('Creative Diversity 100-concept distribution', JSON.stringify({ archetypes: report.archetypeDistribution, cameras: report.cameraDistribution, environments: report.environmentDistribution }));
  }, 30_000);

  it('adapts persisted H3 records into diversity history', () => {
    const plan = planCreativeGenome({ product: cleanser, contentFamily: 'Product B-Roll', seed: 3, now: fixedNow });
    const record = {
      id: 9,
      createdAt: fixedNow.toISOString(),
      product: cleanser.id,
      contentType: 'Product B-Roll' as const,
      brief: h3Brief({ creativeGenome: plan.genome }),
      concept: null,
      resolvedMode: 'REF2VA' as const,
      referencePlan: createH3ReferencePlan(cleanser),
      timeline: [],
      chatGptRequest: '',
      recommendedSettings: null,
      prompt: '',
      creativeGenome: plan.genome,
      creativeFingerprint: plan.fingerprint,
      generationStatus: 'failed' as const,
      generationJobId: 'failed-job'
    };
    expect(toCreativeHistoryEntries([record])).toMatchObject([{ product: 'cleanser', contentFamily: 'Product B-Roll', generationStatus: 'failed', generationJobId: 'failed-job' }]);
  });

  it('returns a compatible direction when every direction is in recent history', () => {
    const candidates = materializedCandidates('Product B-Roll');
    const history = historyForCandidates(candidates);
    const window = candidates.length + 1;
    const plan = planCreativeGenome({
      product: cleanser,
      contentFamily: 'Product B-Roll',
      seed: 20260903,
      recentHistory: history,
      now: fixedNow,
      options: { sameProductFamilyWindow: window, sameProductWindow: window, globalWindow: window }
    });
    expect(plan.diversityFallbackUsed).toBe(true);
    expect(plan.diversityFallbackReason).toBe('compatible_pool_exhausted');
    expect(plan.rerollsUsed).toBe(12);
    expect(plan.diversityDiagnostics).toMatchObject({
      candidateFamilySearched: 'Product B-Roll',
      candidateCount: candidates.length,
      hardCompatibleCandidateCount: candidates.length,
      historyFilteredCandidateCount: candidates.length,
      diversityFallbackUsed: true
    });
  });

  it('uses the best compatible fallback after the reroll budget is exhausted', () => {
    const candidates = materializedCandidates('Product B-Roll');
    const history = historyForCandidates(candidates);
    const options = { sameProductFamilyWindow: candidates.length + 1, sameProductWindow: candidates.length + 1, globalWindow: candidates.length + 1, maxRerolls: 12 };
    const first = planCreativeGenome({ product: cleanser, contentFamily: 'Product B-Roll', seed: 77, recentHistory: history, now: fixedNow, options });
    const second = planCreativeGenome({ product: cleanser, contentFamily: 'Product B-Roll', seed: 77, recentHistory: history, now: fixedNow, options });
    expect(first.genome).toBeDefined();
    expect(first.rejectedCandidates).toHaveLength(12);
    expect(first.rerollsUsed).toBe(12);
    expect(second.fingerprint.signature).toBe(first.fingerprint.signature);
  });

  it('returns a candidate and records a missed novelty threshold instead of throwing', () => {
    const plan = planCreativeGenome({ product: cleanser, contentFamily: 'Product B-Roll', seed: 88, now: fixedNow, options: { noveltyThreshold: 101, maxRerolls: 0 } });
    expect(plan.diversityFallbackUsed).toBe(true);
    expect(plan.diversityFallbackReason).toBe('novelty_threshold_missed');
    expect(plan.noveltyThresholdMissed).toBe(true);
    expect(plan.noveltyScore).toBeLessThan(101);
  });

  it('keeps generating with a history window much larger than the candidate library', () => {
    const first = planCreativeGenome({ product: cleanser, contentFamily: 'Product B-Roll', seed: 91, now: fixedNow });
    const history = Array.from({ length: 1000 }, (_, index) => historyEntry(first, index));
    const plan = planCreativeGenome({ product: cleanser, contentFamily: 'Product B-Roll', seed: 92, recentHistory: history, now: fixedNow, options: { sameProductFamilyWindow: 5000, sameProductWindow: 5000, globalWindow: 5000 } });
    expect(plan.genome.contentFamily).toBe('Product B-Roll');
    expect(plan.diversityDiagnostics.hardCompatibleCandidateCount).toBeGreaterThan(0);
  });

  it('keeps the only effectively usable direction when novelty has no alternatives', () => {
    const first = planCreativeGenome({ product: cleanser, contentFamily: 'UGC Content', seed: 101, now: fixedNow });
    const history = Array.from({ length: 20 }, (_, index) => historyEntry(first, index));
    const plan = planCreativeGenome({ product: cleanser, contentFamily: 'UGC Content', seed: 101, recentHistory: history, now: fixedNow, options: { maxRerolls: 0, nearDuplicateSimilarity: 0, sameProductFamilyWindow: 100, sameProductWindow: 100, globalWindow: 100 } });
    expect(plan.genome).toBeDefined();
    expect(plan.diversityFallbackUsed).toBe(true);
    expect(plan.diversityDiagnostics.hardCompatibleCandidateCount).toBeGreaterThan(0);
  });

  it('still fails clearly for contradictory explicit hard locks', () => {
    expect(() => planCreativeGenome({ product: cleanser, contentFamily: 'Product B-Roll', userIdea: 'camera = Static and separately camera = Orbit', now: fixedNow })).toThrow(CreativeConstraintError);
  });

  it('routes Product B-Roll and UGC to their exact diversity families', () => {
    const broll = planCreativeGenome({ product: cleanser, contentFamily: resolveCreativeFamilyForH3VideoType('Product B-Roll'), seed: 111, now: fixedNow });
    const ugc = planCreativeGenome({ product: cleanser, contentFamily: resolveCreativeFamilyForH3VideoType('UGC Content'), seed: 111, now: fixedNow });
    expect(broll.diversityDiagnostics).toMatchObject({ selectedContentType: 'Product B-Roll', resolvedCreativeFamily: 'Product B-Roll', candidateFamilySearched: 'Product B-Roll' });
    expect(ugc.diversityDiagnostics).toMatchObject({ selectedContentType: 'UGC Content', resolvedCreativeFamily: 'UGC Content', candidateFamilySearched: 'UGC Content' });
    expect(broll.genome.creativeArchetype).not.toMatch(/^Creator /);
    expect(ugc.genome.creativeArchetype).toMatch(/^Creator /);
  });

  it('preserves explicit locks when falling back', () => {
    const plan = planCreativeGenome({ product: cleanser, contentFamily: 'Product B-Roll', userIdea: 'Film in an orange laboratory with a static camera.', seed: 121, now: fixedNow, options: { noveltyThreshold: 101, maxRerolls: 0 } });
    expect(plan.diversityFallbackUsed).toBe(true);
    expect(plan.genome.environment).toBe('orange laboratory');
    expect(plan.genome.cameraPath).toBe('locked-off static camera');
  });

  it('keeps fallback metadata deterministic for the same seed and history', () => {
    const candidates = materializedCandidates('Product B-Roll');
    const history = historyForCandidates(candidates);
    const input = { product: cleanser, contentFamily: 'Product B-Roll' as const, seed: 131, recentHistory: history, now: fixedNow, options: { sameProductFamilyWindow: candidates.length + 1, sameProductWindow: candidates.length + 1, globalWindow: candidates.length + 1 } };
    const first = planCreativeGenome(input);
    const second = planCreativeGenome(input);
    expect(second.diversityDiagnostics).toEqual(first.diversityDiagnostics);
    expect(second.fingerprint.signature).toBe(first.fingerprint.signature);
    expect(second.rerollsUsed).toBe(12);
  });
});
