import { describe, expect, it } from 'vitest';
import { recommendProduct } from './rotation';
import type { HistoryRecord, ProductId } from './types';

const used = (id: number, product: ProductId, createdAt: string): HistoryRecord => ({ id, createdAt, product, workflowMode: 'DIRECT_IMAGE', postStructure: 'SINGLE_IMAGE', requestedSlideCount: null, captionMode: 'STANDARD', postType: 'Product Hero', topic: 'Auto', visualStyle: 'Clean Studio', creativityLevel: 'Balanced', format: 'Instagram Feed 4:5', language: 'Indonesian', preparedBrief: '', conceptTitle: null, headline: null, status: 'Used', notes: null });

describe('Smart Rotation', () => {
  it('is deterministic and prefers a never-used product', () => {
    const history = [used(1, 'cleanser', '2026-08-25T00:00:00.000Z'), used(2, 'toner', '2026-08-24T00:00:00.000Z')];
    const first = recommendProduct(history, new Date('2026-08-26T00:00:00.000Z'));
    const second = recommendProduct(history, new Date('2026-08-26T00:00:00.000Z'));
    expect(first).toEqual(second);
    expect(['serum', 'eye-cream', 'skin-cream', 'mask']).toContain(first.productId);
    expect(first.reason).toContain('not featured');
  });

  it('penalizes immediate repetition', () => {
    const history = [used(1, 'serum', '2026-08-25T00:00:00.000Z'), used(2, 'serum', '2026-08-24T00:00:00.000Z')];
    expect(recommendProduct(history, new Date('2026-08-26T00:00:00.000Z')).productId).not.toBe('serum');
  });
});
