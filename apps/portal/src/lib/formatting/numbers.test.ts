import { describe, expect, it } from 'vitest';

import { formatApproxCount } from '@/lib/formatting/numbers';

describe('formatApproxCount', () => {
  it.each([
    [-1, '0'],
    [0, '0'],
    [1, '1'],
    [9, '9'],
    [10, '10+'],
    [14, '10+'],
    [27, '20+'],
    [99, '90+'],
    [100, '100+'],
    [121, '100+'],
    [199, '100+'],
    [200, '200+'],
    [1000, '1000+'],
    [1234, '1000+'],
    [9999, '9000+'],
    [10_000, '10000+'],
    [12_500, '10000+'],
  ])('formatApproxCount(%i) === %s', (n, expected) => {
    expect(formatApproxCount(n)).toBe(expected);
  });

  it('returns "0" for NaN / non-finite input', () => {
    expect(formatApproxCount(Number.NaN)).toBe('0');
    expect(formatApproxCount(Number.POSITIVE_INFINITY)).toBe('0');
  });
});
