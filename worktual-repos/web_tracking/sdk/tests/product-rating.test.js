import { describe, expect, it } from 'vitest';
import { normalizeProductRating } from '../src/ratings/index.js';

describe('normalizeProductRating', () => {
  it('requires score and an identifier', () => {
    expect(() => normalizeProductRating({ score: 10 })).toThrow(/orderId/);
    expect(
      normalizeProductRating({
        score: 10,
        orderId: 'BXUK-1',
        productName: 'Skirt',
      }),
    ).toEqual({
      score: 10,
      scale: '0-10',
      orderId: 'BXUK-1',
      productName: 'Skirt',
    });
  });

  it('accepts orderNumber alias', () => {
    const row = normalizeProductRating({
      orderNumber: 'BXUK-2',
      orderItemId: 'line-1',
      score: 9,
    });
    expect(row.orderId).toBe('BXUK-2');
    expect(row.orderItemId).toBe('line-1');
    expect(row.score).toBe(9);
  });
});
