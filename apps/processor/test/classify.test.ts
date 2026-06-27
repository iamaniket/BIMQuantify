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

  it('labels a curtain-wall-heavy architectural model structural (members/plates dominate)', () => {
    // Real ArchiCAD facade export: curtain walls explode into IfcMember mullions
    // + IfcPlate panels, so the content SHARE reads structural even though it is
    // an architectural building. The label is intentionally honest; the
    // floor-plan decision is decoupled (see shouldGenerateFloorPlan below).
    expect(detectContentKind(LAKESIDE_ARCH_FACADE)).toBe('structural');
  });
});

// Curtain-wall-heavy architectural model (the bug report's NBS_Lakeside_Arch):
// real architecture (walls/curtain-walls/spaces) is present in force but the
// discipline share tips structural because mullions/panels/members out-count it.
const LAKESIDE_ARCH_FACADE: Record<string, number> = {
  IfcMember: 1149,
  IfcBeam: 631,
  IfcPlate: 368,
  IfcFurnishingElement: 154,
  IfcColumn: 142,
  IfcCovering: 118,
  IfcWallStandardCase: 72,
  IfcCurtainWall: 70,
  IfcRailing: 42,
  IfcBuildingElementProxy: 32,
  IfcDoor: 22,
  IfcSpace: 21,
  IfcFlowTerminal: 17,
  IfcSlab: 9,
  IfcFlowSegment: 5,
  IfcWindow: 5,
  IfcStair: 2,
};

describe('shouldGenerateFloorPlan', () => {
  describe('user-declared discipline wins when set', () => {
    // A structural-shaped histogram (no plan-readable envelope) — proves the
    // declared discipline overrides content, both directions.
    const frame = { IfcColumn: 80, IfcBeam: 140, IfcFooting: 24 };

    it('forces ON for architectural / coordination even on non-arch content', () => {
      expect(shouldGenerateFloorPlan(frame, 'architectural')).toBe(true);
      expect(shouldGenerateFloorPlan(frame, 'coordination')).toBe(true);
    });

    it('forces OFF for structural / mep even when walls are present', () => {
      expect(shouldGenerateFloorPlan(LAKESIDE_ARCH_FACADE, 'structural')).toBe(false);
      expect(shouldGenerateFloorPlan({ IfcWall: 120, IfcSpace: 30 }, 'mep')).toBe(false);
    });
  });

  describe('falls back to content auto-detection when discipline is other/unset', () => {
    it('generates for a curtain-wall-heavy arch model via the envelope floor', () => {
      // detected_kind is "structural", but the wall/curtain-wall/space envelope
      // clears MIN_PLAN_ENVELOPE — the regression that started this fix.
      expect(shouldGenerateFloorPlan(LAKESIDE_ARCH_FACADE)).toBe(true);
      expect(shouldGenerateFloorPlan(LAKESIDE_ARCH_FACADE, 'other')).toBe(true);
      expect(shouldGenerateFloorPlan(LAKESIDE_ARCH_FACADE, null)).toBe(true);
    });

    it('generates for a small but clearly architectural model', () => {
      expect(shouldGenerateFloorPlan({ IfcWall: 4, IfcSpace: 1 })).toBe(true);
      expect(shouldGenerateFloorPlan({ IfcSpace: 48 })).toBe(true);
    });

    it('skips a pure-MEP model that only references a few host walls', () => {
      expect(
        shouldGenerateFloorPlan({
          IfcDuctSegment: 220,
          IfcPipeSegment: 180,
          IfcFlowFitting: 90,
          IfcWall: 5, // below MIN_PLAN_ENVELOPE; incidental
        }),
      ).toBe(false);
    });

    it('skips a pure structural frame with no wall/room envelope', () => {
      expect(shouldGenerateFloorPlan({ IfcColumn: 80, IfcBeam: 140, IfcFooting: 24 })).toBe(false);
    });

    it('skips an empty / proxy-and-furniture-only model', () => {
      expect(shouldGenerateFloorPlan({})).toBe(false);
      expect(
        shouldGenerateFloorPlan({ IfcBuildingElementProxy: 500, IfcFurnishingElement: 200 }),
      ).toBe(false);
    });
  });
});
