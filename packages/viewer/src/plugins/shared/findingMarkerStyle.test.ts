import { describe, expect, it } from 'vitest';

import {
  FINDING_FILL_FALLBACK,
  RING_CLOSED,
  RING_OPEN,
  findingFillColor,
  findingRingColor,
} from './findingMarkerStyle';

describe('findingFillColor', () => {
  it('maps each status to its lifecycle color', () => {
    expect(findingFillColor('draft')).toBe('#c1c6cc');
    expect(findingFillColor('open')).toBe('#5f88b2');
    expect(findingFillColor('in_progress')).toBe('#3a5f99');
    expect(findingFillColor('resolved')).toBe('#4baf7d');
    // verified renders identically to resolved.
    expect(findingFillColor('verified')).toBe(findingFillColor('resolved'));
  });

  it('falls back to red for unknown/missing status', () => {
    expect(findingFillColor(undefined)).toBe(FINDING_FILL_FALLBACK);
    expect(findingFillColor('bogus')).toBe(FINDING_FILL_FALLBACK);
  });
});

describe('findingRingColor', () => {
  it('is red while the finding is open', () => {
    expect(findingRingColor('draft')).toBe(RING_OPEN);
    expect(findingRingColor('open')).toBe(RING_OPEN);
    expect(findingRingColor('in_progress')).toBe(RING_OPEN);
  });

  it('is neutral once the finding is resolved/verified', () => {
    expect(findingRingColor('resolved')).toBe(RING_CLOSED);
    expect(findingRingColor('verified')).toBe(RING_CLOSED);
  });

  it('treats unknown/missing status as open (red)', () => {
    expect(findingRingColor(undefined)).toBe(RING_OPEN);
    expect(findingRingColor('bogus')).toBe(RING_OPEN);
  });
});
