/**
 * Cross-service binary-format contract guard.
 *
 * The outline / floor-plan artifact magic tags are the contract between this
 * processor (the ENCODER) and @bimdossier/viewer (the DECODER). The viewer
 * returns null on a magic mismatch — so a one-sided bump fails SILENTLY (no
 * edges / the 2D map disappears), with no error anywhere.
 *
 * The canonical values live in @bimdossier/contracts, but the processor stays
 * deliberately decoupled from the workspace (it has no @bimdossier/* dependency
 * — npm-internal + Docker build), so it keeps its own copies in
 * src/pipeline/{outline,floorplans}.ts. This test pins those copies to the
 * canonical values so a one-sided change in the processor fails CI LOUDLY
 * instead of silently breaking the viewer.
 *
 * If you intentionally bump a format: change @bimdossier/contracts, the viewer
 * codec, the processor constant AND this test together — and remember that old
 * S3 artifacts then need re-extraction.
 */
import { describe, expect, it } from 'vitest';

import { FLOORPLAN_MAGIC } from '../src/pipeline/floorplans.js';
import { OUTLINE_MAGIC } from '../src/pipeline/outline.js';

// Mirrored from @bimdossier/contracts (kept as literals here because the
// processor has no @bimdossier/* dependency to import them from).
const CANONICAL_OUTLINE_MAGIC = 'BIMOUTL2';
const CANONICAL_FLOORPLAN_MAGIC = 'BIMFPLN2';

describe('binary artifact format magic tags (processor ↔ viewer contract)', () => {
  it('OUTLINE_MAGIC matches the @bimdossier/contracts canonical value', () => {
    expect(OUTLINE_MAGIC).toBe(CANONICAL_OUTLINE_MAGIC);
  });

  it('FLOORPLAN_MAGIC matches the @bimdossier/contracts canonical value', () => {
    expect(FLOORPLAN_MAGIC).toBe(CANONICAL_FLOORPLAN_MAGIC);
  });
});
