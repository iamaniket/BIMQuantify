/**
 * Content-kind classification drives whether a model gets the (architectural)
 * floor-plan cut and how the portal badges/federates each discipline. These
 * cases pin the buckets and the dominant-share thresholds.
 */

import { describe, expect, it } from 'vitest';

import {
  detectContentKind,
  shouldGenerateFloorPlan,
} from '../src/pipeline/classify.js';

describe('detectContentKind', () => {
  it('classifies an architecture-dominant model as architectural', () => {
    expect(
      detectContentKind({
        IfcWall: 120,
        IfcDoor: 40,
        IfcWindow: 35,
        IfcSlab: 12,
        IfcSpace: 30,
        IfcDuctSegment: 4, // incidental MEP — below PRESENT_SHARE
      }),
    ).toBe('architectural');
  });

  it('classifies an MEP-dominant model as mep (from raw counts, not canonical)', () => {
    expect(
      detectContentKind({
        IfcDuctSegment: 220,
        IfcPipeSegment: 180,
        IfcFlowFitting: 90,
        IfcFlowTerminal: 60,
        IfcWall: 5, // a few host walls referenced — incidental
      }),
    ).toBe('mep');
  });

  it('classifies a structural-dominant model as structural', () => {
    expect(
      detectContentKind({
        IfcColumn: 80,
        IfcBeam: 140,
        IfcFooting: 24,
        IfcSlab: 6, // slabs are arch-bucket but minor here
      }),
    ).toBe('structural');
  });

  it('classifies a multi-discipline coordination model as mixed', () => {
    expect(
      detectContentKind({
        IfcWall: 90,
        IfcSpace: 30,
        IfcColumn: 40,
        IfcBeam: 50,
        IfcDuctSegment: 80,
        IfcPipeSegment: 70,
      }),
    ).toBe('mixed');
  });

  it('returns none when no classified geometry is present', () => {
    expect(detectContentKind({})).toBe('none');
    expect(
      detectContentKind({
        IfcBuildingElementProxy: 500,
        IfcFurnishingElement: 200,
      }),
    ).toBe('none');
  });

  it('treats a spaces-only (zoning) model as architectural', () => {
    expect(detectContentKind({ IfcSpace: 48 })).toBe('architectural');
  });
});

describe('shouldGenerateFloorPlan', () => {
  it('generates only for architectural and mixed content', () => {
    expect(shouldGenerateFloorPlan('architectural')).toBe(true);
    expect(shouldGenerateFloorPlan('mixed')).toBe(true);
    expect(shouldGenerateFloorPlan('structural')).toBe(false);
    expect(shouldGenerateFloorPlan('mep')).toBe(false);
    expect(shouldGenerateFloorPlan('none')).toBe(false);
  });
});
