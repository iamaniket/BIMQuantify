import { describe, expect, it } from 'vitest';

import { paginationRange } from '@bimstitch/ui';

describe('paginationRange', () => {
  it('lists every page when the count fits without eliding', () => {
    expect(paginationRange(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(paginationRange(3, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('elides on the right near the start', () => {
    expect(paginationRange(2, 20)).toEqual([1, 2, 3, 4, 5, 'dots', 20]);
  });

  it('elides on the left near the end', () => {
    expect(paginationRange(19, 20)).toEqual([1, 'dots', 16, 17, 18, 19, 20]);
  });

  it('elides on both sides in the middle', () => {
    expect(paginationRange(10, 20)).toEqual([1, 'dots', 9, 10, 11, 'dots', 20]);
  });

  it('always includes the first and last page', () => {
    const range = paginationRange(10, 50);
    expect(range[0]).toBe(1);
    expect(range[range.length - 1]).toBe(50);
  });
});
