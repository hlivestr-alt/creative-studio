import { describe, expect, it } from 'vitest';
import { advanceAutoCursor, isTransientTransport, safeOutputComponent, type AutoH3Session } from './auto-h3';

describe('Auto H3 cursor and transport classification', () => {
  it('reshuffles content per product and products only at a cycle boundary', () => {
    const session = { selectedProducts: ['cleanser', 'serum'], selectedContentTypes: ['Product B-Roll', 'Product Demo'], productOrder: ['cleanser', 'serum'], contentTypeOrder: ['Product B-Roll', 'Product Demo'], productIndex: 0, contentTypeIndex: 1, cycleNumber: 1, cycleSeed: 100, shuffleProducts: true, shuffleContentTypes: true } as AutoH3Session;
    const next = advanceAutoCursor(session, 200, () => 0);
    expect(next.productOrder).toEqual(session.productOrder);
    expect(next.contentTypeOrder).toEqual(['Product Demo', 'Product B-Roll']);
    expect(next.productIndex).toBe(1);
    const cycle = advanceAutoCursor({ ...next, contentTypeIndex: 1 }, 200, () => 0);
    expect(cycle.productOrder).toEqual(['serum', 'cleanser']);
    expect(cycle.cycleNumber).toBe(2);
    expect(cycle.cycleSeed).toBe(200);
  });
  it.each(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'HTTP 502', 'HTTP 503', 'HTTP 504', 'WebSocket disconnected', 'TimeoutError'])('retries transient %s', message => expect(isTransientTransport(new Error(message))).toBe(true));
  it('sanitizes directory components without changing product truth', () => {
    expect(safeOutputComponent('Ingredient / Texture')).toBe('Ingredient-Texture');
    expect(safeOutputComponent('../../Windows')).toBe('Windows');
    expect(safeOutputComponent('CON')).toBe('_CON');
    expect(isTransientTransport('ComfyUI rejected invalid workflow (400)')).toBe(false);
  });
});
