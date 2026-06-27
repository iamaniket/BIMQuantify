/**
 * Per-level floor-plan artifact: a horizontal section cut at ~1.2 m above each
 * IfcBuildingStorey, plus IfcSpace room footprints, encoded as a compact binary.
 *
 * For every storey we cut the model with the plane (up-axis) = floor + 1.2 m
 * (the architectural plan convention — chest height, so walls/columns/doors read
 * as line work). Each triangle that straddles the plane contributes one 2D
 * segment in the two horizontal axes. Meshes belonging to an IfcSpace are
 * bucketed separately as *room* geometry (so the viewer can fill + label rooms);
 * everything else is *wall* line work. Geometry access mirrors
 * `metadata.ts::computeBoundingBox` (web-ifc `StreamAllMeshes` → `flatTransformation`
 * → world vertices); we add the triangle index array so we can slice faces.
 *
 * UP-AXIS IS DETECTED, NOT ASSUMED. web-ifc returns each model's raw authored
 * coordinates, whose vertical axis varies (IFC is nominally Z-up, but many models
 * are Y-up). Cutting at a fixed Z on a Y-up model yields a vertical section (an
 * elevation, not a plan). We detect the up-axis per model with a layered resolver
 * (`resolveUpAxis`): storeys stack along the up-axis (so their per-axis geometry
 * minima separate vertically and cluster horizontally), the IfcBuildingStorey
 * Elevation attribute fits the up-axis as a near-constant floor offset, and an
 * area-weighted triangle-normal histogram is the last-resort fallback. The normal
 * histogram alone is ambiguous — a wall facing +X puts as much area on X as a
 * floor does in an X-up model — so on facade/tower/MEP-heavy models it mis-elects
 * a horizontal axis and the plan reads as a side elevation; the stacking and
 * elevation signals fix that. We then cut perpendicular to the up-axis and emit
 * the two horizontal axes. The horizontal axis indices are stored in the artifact
 * so the viewer can map its (Y-up, recentered) camera onto the plan.
 *
 * The per-storey floor level is derived from the lowest world coordinate (along
 * the up-axis) of the physical elements contained in that storey (the
 * IfcBuildingStorey.Elevation attribute is optional and frequently absent).
 *
 * Binary format v2, stored gzip-compressed (fflate `gzipSync` here, native
 * `DecompressionStream('gzip')` in the browser). Decompressed payload, all
 * little-endian. The 32-byte header keeps every typed-array view 4-byte aligned;
 * level/room *names* are NOT stored here — they live in metadata.json, joined by
 * storey/space expressID:
 *
 *   bytes 0-7    ASCII magic "BIMFPLN2"
 *   uint32       levelCount
 *   uint32       wallFloatsTotal        (sum of all levels' wall-segment floats)
 *   uint32       roomCount              (sum of all levels' room counts)
 *   uint32       roomFloatsTotal        (sum of all rooms' segment floats)
 *   uint32       planAxisX              (IFC axis index 0/1/2 for the plan's X)
 *   uint32       planAxisY              (IFC axis index for the plan's Y)
 *   Int32Array   levelStoreyIds[levelCount]       (IfcBuildingStorey expressID)
 *   Float32Array levelElevations[levelCount]      (storey elevation, model units)
 *   Uint32Array  levelWallFloatCounts[levelCount] (floats/level, multiple of 4)
 *   Uint32Array  levelRoomCounts[levelCount]      (rooms/level)
 *   Int32Array   roomSpaceIds[roomCount]          (IfcSpace expressID)
 *   Float32Array roomCentroids[roomCount*2]       (cx,cy per room — label anchor)
 *   Uint32Array  roomSegFloatCounts[roomCount]    (floats/room, multiple of 4)
 *   Float32Array wallSegments[wallFloatsTotal]    (x1,y1,x2,y2,… concatenated)
 *   Float32Array roomSegments[roomFloatsTotal]    (x1,y1,x2,y2,… concatenated)
 *
 * Per-level/-room slices are derived by prefix-summing the count arrays.
 */

import { gunzipSync, gzipSync } from 'fflate';
import {
  IFCBUILDINGSTOREY,
  IFCGEOMETRICREPRESENTATIONCONTEXT,
  IFCSPACE,
  type IfcAPI,
} from 'web-ifc';

import { logger, type Logger } from '../log.js';
import { numberValue } from './attributes.js';

/** One IfcSpace footprint on a level: cut segments + centroid (label anchor). */
export type FloorPlanRoom = {
  spaceId: number;
  /** Label anchor: mean of the room's cut-segment endpoints, plan XY. */
  centroid: [number, number];
  /** Cut segments [x1,y1,x2,y2,…] in plan (horizontal) coords, model units. */
  segments: Float32Array;
};

/** One storey's plan: wall line work + room footprints (plan/horizontal coords). */
export type FloorPlanLevel = {
  storeyExpressID: number;
  /** Storey floor level in model units, measured along the detected up-axis. */
  elevation: number;
  /** Wall/structure cut segments [x1,y1,x2,y2,…] in plan coords. */
  wallSegments: Float32Array;
  rooms: FloorPlanRoom[];
};

/** Decoded artifact: the plan's two horizontal IFC axes + the per-storey levels. */
export type DecodedFloorPlans = {
  /** IFC axis index (0=x,1=y,2=z) the plan's X / Y horizontal coords use. */
  planAxisX: number;
  planAxisY: number;
  levels: FloorPlanLevel[];
};

/** Minimal element shape buildFloorPlans needs (a subset of metadata's ElementEntry). */
export type FloorPlanElement = { expressID: number; containedIn: number | null };

/** Cut height above each storey floor, in metres (plan convention). */
export const CUT_HEIGHT_M = 1.2;

export const FLOORPLAN_MAGIC = 'BIMFPLN2';

/** magic(8) + levelCount + wallFloatsTotal + roomCount + roomFloatsTotal + planAxisX + planAxisY. */
const HEADER_BYTES = 32;

/**
 * Metres per model length unit, parsed from `metadata.project.lengthUnit`
 * (e.g. "MILLIMETRE", "METRE"). Geometry is in model units, so the cut offset
 * must be too. Unknown → assume metres.
 */
export function metresPerUnit(lengthUnit: string | null): number {
  if (!lengthUnit) return 1;
  const u = lengthUnit.toUpperCase();
  if (u.includes('MILLI')) return 0.001;
  if (u.includes('CENTI')) return 0.01;
  if (u.includes('DECI')) return 0.1;
  if (u.includes('KILO')) return 1000;
  if (u.includes('FOOT') || u.includes('FEET')) return 0.3048;
  if (u.includes('INCH')) return 0.0254;
  if (u.includes('METR')) return 1; // METRE / METER
  // Non-empty but unrecognised unit: defaulting to metres can cut a mislabeled
  // millimetre model at ~1.2 mm (a degenerate, near-floor plan) with no signal.
  logger.warn({ lengthUnit }, 'metresPerUnit: unrecognised length unit; assuming metres');
  return 1;
}

/**
 * Intersect a single triangle with the plane (3rd/"up" coordinate) = cut.
 * Each vertex is given as (h1, h2, up) where h1,h2 are the two horizontal
 * coordinates emitted into the 2D segment and `up` is the slice axis. Returns
 * [u1,v1,u2,v2] where the plane crosses the triangle, or null when it does not
 * straddle the plane. A triangle that genuinely crosses cuts exactly two edges.
 */
export function sliceTriangleAtAxis(
  ah1: number, ah2: number, aUp: number,
  bh1: number, bh2: number, bUp: number,
  ch1: number, ch2: number, cUp: number,
  cut: number,
): [number, number, number, number] | null {
  const da = aUp - cut;
  const db = bUp - cut;
  const dc = cUp - cut;
  const pts: number[] = [];
  const edge = (
    d0: number, x0: number, y0: number,
    d1: number, x1: number, y1: number,
  ): void => {
    // Only strict sign changes cross the plane; equal signed distances mean the
    // edge is parallel to (or lies in) the plane — skip to avoid divide-by-zero.
    if ((d0 < 0 && d1 < 0) || (d0 > 0 && d1 > 0)) return;
    if (d0 === d1) return;
    const t = d0 / (d0 - d1);
    if (t < 0 || t > 1) return;
    pts.push(x0 + t * (x1 - x0), y0 + t * (y1 - y0));
  };
  edge(da, ah1, ah2, db, bh1, bh2);
  edge(db, bh1, bh2, dc, ch1, ch2);
  edge(dc, ch1, ch2, da, ah1, ah2);
  if (pts.length < 4) return null;
  const x1 = pts[0]!;
  const y1 = pts[1]!;
  const x2 = pts[2]!;
  const y2 = pts[3]!;
  if (x1 === x2 && y1 === y2) return null;
  return [x1, y1, x2, y2];
}

/** Apply a column-major 4×4 to a local vertex, writing world coords into out[3]. */
function toWorld(
  m: ArrayLike<number>, px: number, py: number, pz: number, out: [number, number, number],
): void {
  out[0] = (m[0] ?? 0) * px + (m[4] ?? 0) * py + (m[8] ?? 0) * pz + (m[12] ?? 0);
  out[1] = (m[1] ?? 0) * px + (m[5] ?? 0) * py + (m[9] ?? 0) * pz + (m[13] ?? 0);
  out[2] = (m[2] ?? 0) * px + (m[6] ?? 0) * py + (m[10] ?? 0) * pz + (m[14] ?? 0);
}

/** One resolved storey: express id, displayed elevation, and the world cut plane. */
export type ScanStorey = { expressID: number; elevation: number; cut: number };

/**
 * Result of the single geometry sweep shared by metadata (the bounding box) and
 * the floor plans (up-axis + per-storey cut planes). One `StreamAllMeshes`
 * drives all of it, so the walk thread transforms each vertex to world exactly
 * once instead of three times (old: metadata bbox + floor-plan pass 1 + pass 2).
 */
export type GeometryScan = {
  /** World-space axis-aligned bounding box over every vertex, or null if empty. */
  bbox: { min: [number, number, number]; max: [number, number, number] } | null;
  /** IFC axis index the plan's X / Y horizontal coords use. */
  planAxisX: number;
  planAxisY: number;
  /** Detected up-axis (0=x, 1=y, 2=z). */
  upAxis: number;
  /** Storeys with a resolved cut plane, sorted by elevation. */
  storeys: ScanStorey[];
  /** IfcSpace express ids — reused by the slice pass to bucket room geometry. */
  spaceIds: Set<number>;
};

/** How `resolveUpAxis` decided — surfaced in the scan log for diagnosis. */
type UpAxisMethod = 'consensus' | 'stacking' | 'elevation' | 'histogram';

/** A `[min,max]` range per axis for the storeys that carry indexed geometry. */
type StoreyRange = { min: [number, number, number]; max: [number, number, number] };

/**
 * Storey-stacking signal: storeys share a footprint but stack vertically, so on
 * the up-axis their `[min,max]` bands barely overlap while on the horizontal
 * axes they overlap almost completely. Crucially this is robust to setbacks /
 * podium+tower / wings / balconies — a smaller upper footprint still sits WITHIN
 * the lower one, so the horizontal bands keep overlapping (unlike the per-storey
 * *minima spread*, which a setback inflates on a horizontal axis and so misfires).
 * Returns the least-overlapping axis when it is decisively separated, else null.
 */
function stackingAxis(ranges: StoreyRange[]): { axis: number; overlaps: [number, number, number] } | null {
  if (ranges.length < 2) return null;
  const overlaps = [0, 1, 2].map((k) => {
    const bands = ranges.map((r) => [r.min[k]!, r.max[k]!] as [number, number]).sort((p, q) => p[0] - q[0]);
    let unionLo = Infinity;
    let unionHi = -Infinity;
    for (const [lo, hi] of bands) {
      if (lo < unionLo) unionLo = lo;
      if (hi > unionHi) unionHi = hi;
    }
    const ext = unionHi - unionLo;
    if (!(ext > 0)) return 1; // a zero-extent axis is fully "overlapping" (no separation)
    let overlapSum = 0;
    for (let i = 1; i < bands.length; i += 1) {
      overlapSum += Math.max(0, Math.min(bands[i - 1]![1], bands[i]![1]) - bands[i]![0]);
    }
    return overlapSum / ((bands.length - 1) * ext); // ≈0 stacked, ≈1 co-located
  }) as [number, number, number];
  const order = [0, 1, 2].sort((p, q) => overlaps[p]! - overlaps[q]!);
  const best = order[0]!;
  const second = order[1]!;
  // The up-axis bands must be clearly the least-overlapping (well under half,
  // and at most half the runner-up's overlap).
  if (overlaps[best]! < 0.5 && overlaps[best]! <= 0.5 * overlaps[second]!) {
    return { axis: best, overlaps };
  }
  return null;
}

/**
 * Elevation-attribute signal: on the up-axis a storey's lowest geometry sits a
 * near-constant floor offset below its declared IfcBuildingStorey.Elevation, so
 * `min[k] − elevation` has low variance there and high variance on a horizontal
 * axis (which tracks the footprint). Returns the smallest-residual-variance axis
 * when it is a clear winner, else null. Needs ≥2 storeys with both values and a
 * non-degenerate elevation span.
 */
function elevationAxis(
  storeyMin: Map<number, [number, number, number]>,
  elevationAttr: Map<number, number>,
): number | null {
  const paired: { min: [number, number, number]; elev: number }[] = [];
  for (const [id, m] of storeyMin) {
    const elev = elevationAttr.get(id);
    if (elev !== undefined && Number.isFinite(elev) && m.every(Number.isFinite)) {
      paired.push({ min: m, elev });
    }
  }
  if (paired.length < 2) return null;
  const elevs = paired.map((p) => p.elev);
  if (Math.max(...elevs) - Math.min(...elevs) <= 0) return null;
  const resVar = [0, 1, 2].map((k) => {
    const r = paired.map((p) => p.min[k]! - p.elev);
    const mean = r.reduce((s, b) => s + b, 0) / r.length;
    return r.reduce((s, b) => s + (b - mean) ** 2, 0) / r.length;
  });
  const order = [0, 1, 2].sort((p, q) => resVar[p]! - resVar[q]!);
  const best = order[0]!;
  const second = order[1]!;
  // Reject a non-discriminating tie (e.g. both ≈0) rather than picking index 0.
  if (resVar[second]! <= 0) return null;
  return resVar[best]! <= 0.25 * resVar[second]! ? best : null;
}

/**
 * Resolve the model's up-axis (0=x, 1=y, 2=z). The normal histogram alone is
 * ambiguous — a wall facing +X concentrates as much area on X as a floor does in
 * an X-up model — so on facade/tower/sparse-slab models it mis-elects a
 * horizontal axis, cutting an elevation instead of a plan. We combine three
 * signals by CONSENSUS rather than trusting any one in isolation:
 *
 *   • histogram  — argmax of Σ area-weighted |normal| per axis (default Z on tie).
 *   • stacking   — least inter-storey band overlap (see `stackingAxis`).
 *   • elevation  — best fit of storey minima to the Elevation attr (`elevationAxis`).
 *
 * If any axis wins ≥2 of the available votes, take it (the two signals fail in
 * different directions, so agreement is strong evidence). Otherwise prefer the
 * most physically-grounded available signal: elevation → stacking → histogram.
 * This fixes the regression where a lone stacking vote (or a lone histogram
 * vote) could override the others and silently produce a side elevation.
 */
export function resolveUpAxis(
  upBins: number[],
  storeyMin: Map<number, [number, number, number]>,
  storeyMax: Map<number, [number, number, number]>,
  elevationAttr: Map<number, number>,
  _bbox: GeometryScan['bbox'],
): {
  upAxis: number;
  method: UpAxisMethod;
  /** Per-axis vote of each signal (null = signal abstained). */
  votes: { histogram: number | null; stacking: number | null; elevation: number | null };
  /** Per-axis inter-storey band overlap (the stacking metric), if computed. */
  overlaps: [number, number, number] | null;
  /** Storeys whose geometry ranges were available to the stacking signal. */
  finiteStoreys: number;
} {
  const anyGeom = upBins[0]! > 0 || upBins[1]! > 0 || upBins[2]! > 0;
  const histogram = anyGeom
    ? (() => {
        let up = 2; // default Z (IFC nominal up) on a tie
        if (upBins[0]! > upBins[1]! && upBins[0]! > upBins[2]!) up = 0;
        else if (upBins[1]! > upBins[0]! && upBins[1]! > upBins[2]!) up = 1;
        return up;
      })()
    : null;

  // Storeys with a fully-finite [min,max] range on every axis.
  const ranges: StoreyRange[] = [];
  for (const [id, min] of storeyMin) {
    const max = storeyMax.get(id);
    if (max && min.every(Number.isFinite) && max.every(Number.isFinite)) {
      ranges.push({ min, max });
    }
  }
  const stack = stackingAxis(ranges);
  const stacking = stack?.axis ?? null;
  const elevation = elevationAxis(storeyMin, elevationAttr);

  const votes = { histogram, stacking, elevation };
  const base = {
    votes,
    overlaps: stack?.overlaps ?? null,
    finiteStoreys: ranges.length,
  };

  // Consensus: any axis backed by ≥2 of the (up to three) available votes.
  const tally = [0, 0, 0];
  for (const v of [histogram, stacking, elevation]) if (v !== null) tally[v]! += 1;
  const top = tally.indexOf(Math.max(...tally));
  if (tally[top]! >= 2) return { upAxis: top, method: 'consensus', ...base };

  // No agreement → trust the most physically-grounded available signal.
  if (elevation !== null) return { upAxis: elevation, method: 'elevation', ...base };
  if (stacking !== null) return { upAxis: stacking, method: 'stacking', ...base };
  if (histogram !== null) return { upAxis: histogram, method: 'histogram', ...base };
  return { upAxis: 2, method: 'histogram', ...base }; // degenerate / no geometry → Z
}

/**
 * Single-pass geometry scan. Detects the up-axis (layered resolver — storey
 * stacking → elevation fit → normal-histogram fallback, see `resolveUpAxis`),
 * each storey's floor level (lowest contained-element coordinate
 * along the up-axis, falling back to the Elevation attribute), AND the global
 * axis-aligned bounding box — all from ONE `StreamAllMeshes` sweep.
 *
 * The bbox accumulates over every vertex (matching the old `computeBoundingBox`
 * in metadata.ts), while the up-axis histogram and per-storey minima use only
 * indexed (triangulated) geometry, exactly as the old floor-plan pass 1 did.
 *
 * UP-AXIS IS DETECTED, NOT ASSUMED (IFC is nominally Z-up but many models are
 * Y-up) — see the file header. The sweep runs unconditionally because the bbox
 * is always needed, even for models with no storeys / no floor plan.
 */
export function scanModelGeometry(
  api: IfcAPI,
  modelID: number,
  lengthUnit: string | null,
  elements: readonly FloorPlanElement[],
  logger?: Logger,
): GeometryScan {
  // Storeys + their optional Elevation attribute (used for the displayed level
  // value and ordering; the cut height itself comes from geometry below).
  const storeyVec = api.GetLineIDsWithType(modelID, IFCBUILDINGSTOREY);
  const storeyIds: number[] = [];
  const elevationAttr = new Map<number, number>();
  for (let i = 0; i < storeyVec.size(); i += 1) {
    const id = storeyVec.get(i);
    storeyIds.push(id);
    const line = api.GetLine(modelID, id, false) as Record<string, unknown>;
    const e = numberValue(line['Elevation']);
    if (e !== null) elevationAttr.set(id, e);
  }
  const storeyIdSet = new Set(storeyIds);

  // IfcSpace express IDs (room geometry) and element→storey containment.
  const spaceIds = new Set<number>();
  const spaceVec = api.GetLineIDsWithType(modelID, IFCSPACE);
  for (let i = 0; i < spaceVec.size(); i += 1) spaceIds.add(spaceVec.get(i));

  // Map every element (incl. geometry-bearing aggregated children) to its
  // ancestor storey by walking the containedIn chain — geometry frequently lives
  // in aggregated parts whose direct container is another element, not a storey.
  const containedInOf = new Map<number, number | null>();
  for (const el of elements) containedInOf.set(el.expressID, el.containedIn);
  const resolveStorey = (start: number): number | undefined => {
    let cur: number | undefined = start;
    for (let hops = 0; hops < 64 && cur !== undefined; hops += 1) {
      const parent = containedInOf.get(cur);
      if (parent === null || parent === undefined) return undefined;
      if (storeyIdSet.has(parent)) return parent;
      cur = parent;
    }
    return undefined;
  };
  const elementToStorey = new Map<number, number>();
  for (const el of elements) {
    const storey =
      el.containedIn !== null && storeyIdSet.has(el.containedIn)
        ? el.containedIn
        : resolveStorey(el.expressID);
    if (storey !== undefined) elementToStorey.set(el.expressID, storey);
  }

  // One sweep: global bbox (every vertex), up-axis histogram + per-storey
  // min/max range (indexed geometry only). upBins = Σ|n.x|, Σ|n.y|, Σ|n.z|
  // (n = 2·area normal). The per-storey [min,max] range per axis feeds the
  // stacking signal (storeys overlap horizontally, separate vertically).
  const upBins = [0, 0, 0];
  const storeyMin = new Map<number, [number, number, number]>();
  const storeyMax = new Map<number, [number, number, number]>();
  const a: [number, number, number] = [0, 0, 0];
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let touched = false;
  const growBbox = (): void => {
    if (a[0] < minX) minX = a[0];
    if (a[1] < minY) minY = a[1];
    if (a[2] < minZ) minZ = a[2];
    if (a[0] > maxX) maxX = a[0];
    if (a[1] > maxY) maxY = a[1];
    if (a[2] > maxZ) maxZ = a[2];
    touched = true;
  };

  api.StreamAllMeshes(modelID, (mesh) => {
    const isSpace = spaceIds.has(mesh.expressID);
    const storeyId = isSpace ? undefined : elementToStorey.get(mesh.expressID);
    const placements = mesh.geometries;
    for (let g = 0; g < placements.size(); g += 1) {
      const placedGeom = placements.get(g);
      const geom = api.GetGeometry(modelID, placedGeom.geometryExpressID);
      const verts = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
      const m = placedGeom.flatTransformation;
      const vCount = Math.floor(verts.length / 6);
      if (vCount === 0) continue;
      const indices = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());

      if (indices.length === 0) {
        // No triangles: contributes to the bbox (the old computeBoundingBox swept
        // every vertex) but not to the histogram / per-storey minima (the old
        // pass 1 skipped index-less geometry).
        for (let v = 0; v < vCount; v += 1) {
          const o = v * 6;
          toWorld(m, verts[o] ?? 0, verts[o + 1] ?? 0, verts[o + 2] ?? 0, a);
          growBbox();
        }
        continue;
      }

      const wx = new Float64Array(vCount);
      const wy = new Float64Array(vCount);
      const wz = new Float64Array(vCount);
      let min: [number, number, number] | undefined;
      let max: [number, number, number] | undefined;
      if (storeyId !== undefined) {
        min = storeyMin.get(storeyId);
        if (min === undefined) {
          min = [Infinity, Infinity, Infinity];
          storeyMin.set(storeyId, min);
        }
        max = storeyMax.get(storeyId);
        if (max === undefined) {
          max = [-Infinity, -Infinity, -Infinity];
          storeyMax.set(storeyId, max);
        }
      }
      for (let v = 0; v < vCount; v += 1) {
        const o = v * 6;
        toWorld(m, verts[o] ?? 0, verts[o + 1] ?? 0, verts[o + 2] ?? 0, a);
        wx[v] = a[0];
        wy[v] = a[1];
        wz[v] = a[2];
        growBbox();
        if (min && max) {
          if (a[0] < min[0]) min[0] = a[0];
          if (a[1] < min[1]) min[1] = a[1];
          if (a[2] < min[2]) min[2] = a[2];
          if (a[0] > max[0]) max[0] = a[0];
          if (a[1] > max[1]) max[1] = a[1];
          if (a[2] > max[2]) max[2] = a[2];
        }
      }
      // Area-weighted normal histogram: |cross(v1-v0, v2-v0)| per axis.
      for (let t = 0; t + 2 < indices.length; t += 3) {
        const i0 = indices[t]!;
        const i1 = indices[t + 1]!;
        const i2 = indices[t + 2]!;
        const e1x = wx[i1]! - wx[i0]!, e1y = wy[i1]! - wy[i0]!, e1z = wz[i1]! - wz[i0]!;
        const e2x = wx[i2]! - wx[i0]!, e2y = wy[i2]! - wy[i0]!, e2z = wz[i2]! - wz[i0]!;
        upBins[0]! += Math.abs(e1y * e2z - e1z * e2y);
        upBins[1]! += Math.abs(e1z * e2x - e1x * e2z);
        upBins[2]! += Math.abs(e1x * e2y - e1y * e2x);
      }
    }
  });

  const bbox: GeometryScan['bbox'] = touched
    ? { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] }
    : null;

  // Up-axis by consensus of histogram + storey-stacking + elevation signals
  // (see `resolveUpAxis`). No single signal is trusted alone — the histogram is
  // ambiguous on facade/tower models, and minima-based stacking misfires on
  // setbacks — so a model would otherwise be cut as a side elevation.
  const upAxisResult = resolveUpAxis(upBins, storeyMin, storeyMax, elevationAttr, bbox);
  const { upAxis, method: upAxisMethod } = upAxisResult;
  const hX = upAxis === 0 ? 1 : 0;
  const hY = upAxis === 2 ? 1 : 2;

  // Resolve cut planes along the up-axis. Floor base = contained-geometry min
  // (along up), falling back to the Elevation attribute; displayed elevation
  // prefers the attribute. Storeys with neither are skipped.
  const offset = CUT_HEIGHT_M / metresPerUnit(lengthUnit);
  const storeys: ScanStorey[] = [];
  for (const id of storeyIds) {
    const geomBase = storeyMin.get(id)?.[upAxis];
    const attr = elevationAttr.get(id);
    const base = geomBase !== undefined && Number.isFinite(geomBase) ? geomBase : attr;
    if (base === undefined || !Number.isFinite(base)) continue;
    storeys.push({ expressID: id, elevation: attr ?? base, cut: base + offset });
  }
  storeys.sort((s1, s2) => s1.elevation - s2.elevation);

  logger?.info(
    {
      stage: 'geometryScan',
      upAxis: ['x', 'y', 'z'][upAxis],
      upAxisMethod,
      // Diagnostics so a future axis misfire is debuggable from the logs: the
      // normal histogram (Σ|n| per axis), each signal's vote, the inter-storey
      // band overlaps (the stacking metric), and how many storeys fed it.
      upBins: upBins.map((b) => Math.round(b)),
      votes: upAxisResult.votes,
      storeyOverlaps: upAxisResult.overlaps,
      finiteStoreys: upAxisResult.finiteStoreys,
      storeys: storeys.length,
      hasBbox: bbox !== null,
    },
    'geometry scan complete',
  );

  return { bbox, planAxisX: hX, planAxisY: hY, upAxis, storeys, spaceIds };
}

/**
 * Read the building's true north from `IfcGeometricRepresentationContext.TrueNorth`
 * and express it as a bearing in the floor-plan frame: radians CLOCKWISE from
 * plan-up (+planAxisY). Returns null when the model declares no TrueNorth, when
 * the direction is degenerate, or when the plan isn't drawn in the world XY plane
 * (non-standard up-axis) — the viewer then shows no north compass.
 *
 * TrueNorth is a 2D `IfcDirection` in the context's XY plane (the world
 * horizontal plane for a standard Z-up model). The walk worker reads native,
 * un-converted geometry, so TrueNorth shares the frame the plan segments are
 * sliced in. We treat it as a horizontal 3-vector [x, y, 0], project onto the
 * plan's two horizontal world axes, and take `atan2(x, y)` — the same convention
 * the 2D scene uses (plan +Y is screen-up, no flip), so the angle feeds the
 * compass dial directly.
 */
export function extractTrueNorth(
  api: IfcAPI,
  modelID: number,
  planAxisX: number,
  planAxisY: number,
): number | null {
  // TrueNorth lives in the world XY plane; only meaningful when the plan's two
  // axes are exactly world X/Y (standard Z-up). Otherwise we can't map it.
  if (planAxisX > 1 || planAxisY > 1) return null;

  const ids = api.GetLineIDsWithType(modelID, IFCGEOMETRICREPRESENTATIONCONTEXT);
  for (let i = 0; i < ids.size(); i += 1) {
    let ctx: Record<string, unknown>;
    try {
      ctx = api.GetLine(modelID, ids.get(i), true) as Record<string, unknown>;
    } catch {
      continue;
    }
    const tn = ctx['TrueNorth'];
    if (tn === null || typeof tn !== 'object') continue;
    const ratios = (tn as Record<string, unknown>)['DirectionRatios'];
    if (!Array.isArray(ratios) || ratios.length < 2) continue;
    const wx = numberValue(ratios[0]);
    const wy = numberValue(ratios[1]);
    if (wx === null || wy === null) continue;
    // TrueNorth is horizontal, so its world up-component is 0.
    const world = [wx, wy, 0];
    const px = world[planAxisX] ?? 0;
    const py = world[planAxisY] ?? 0;
    if (px === 0 && py === 0) continue; // degenerate direction
    // Bearing clockwise from plan-up (+planAxisY): (0,1) → 0, (1,0) → +90°.
    return Math.atan2(px, py);
  }
  return null;
}

/**
 * Slice walls + rooms at each storey's cut plane (the floor-plan "pass 2"),
 * using the up-axis and cut planes already resolved by `scanModelGeometry`.
 * Emits segments in the two horizontal axes. Returns `{0, 1, []}` when the scan
 * found no usable storeys (mirrors the old empty-result axes).
 */
export function sliceFloorPlans(
  api: IfcAPI,
  modelID: number,
  scan: GeometryScan,
  logger?: Logger,
): DecodedFloorPlans {
  const { upAxis, planAxisX: hX, planAxisY: hY, storeys, spaceIds } = scan;
  if (storeys.length === 0) return { planAxisX: 0, planAxisY: 1, levels: [] };

  const a: [number, number, number] = [0, 0, 0];
  const wallByLevel: number[][] = storeys.map(() => []);
  const roomsByLevel: Map<number, number[]>[] = storeys.map(() => new Map());
  api.StreamAllMeshes(modelID, (mesh) => {
    const isSpace = spaceIds.has(mesh.expressID);
    const placements = mesh.geometries;
    for (let g = 0; g < placements.size(); g += 1) {
      const placedGeom = placements.get(g);
      const geom = api.GetGeometry(modelID, placedGeom.geometryExpressID);
      const verts = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
      const indices = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
      const m = placedGeom.flatTransformation;
      const vCount = Math.floor(verts.length / 6);
      if (vCount === 0 || indices.length === 0) continue;

      // Transform vertices to world once; track the up-axis span so we only
      // slice planes this geom actually straddles. W[axis][vertex] indexing
      // lets the slice use the detected horizontal/up axes.
      const wx = new Float64Array(vCount);
      const wy = new Float64Array(vCount);
      const wz = new Float64Array(vCount);
      const W = [wx, wy, wz];
      let minUp = Infinity;
      let maxUp = -Infinity;
      for (let v = 0; v < vCount; v += 1) {
        const o = v * 6;
        toWorld(m, verts[o] ?? 0, verts[o + 1] ?? 0, verts[o + 2] ?? 0, a);
        wx[v] = a[0];
        wy[v] = a[1];
        wz[v] = a[2];
        const up = a[upAxis]!;
        if (up < minUp) minUp = up;
        if (up > maxUp) maxUp = up;
      }
      const Wup = W[upAxis]!;
      const WhX = W[hX]!;
      const WhY = W[hY]!;

      for (let L = 0; L < storeys.length; L += 1) {
        const cut = storeys[L]!.cut;
        if (cut < minUp || cut > maxUp) continue;
        let target: number[];
        if (isSpace) {
          const map = roomsByLevel[L]!;
          let bucket = map.get(mesh.expressID);
          if (bucket === undefined) {
            bucket = [];
            map.set(mesh.expressID, bucket);
          }
          target = bucket;
        } else {
          target = wallByLevel[L]!;
        }
        for (let t = 0; t + 2 < indices.length; t += 3) {
          const i0 = indices[t]!;
          const i1 = indices[t + 1]!;
          const i2 = indices[t + 2]!;
          const seg = sliceTriangleAtAxis(
            WhX[i0]!, WhY[i0]!, Wup[i0]!,
            WhX[i1]!, WhY[i1]!, Wup[i1]!,
            WhX[i2]!, WhY[i2]!, Wup[i2]!,
            cut,
          );
          if (seg) target.push(seg[0], seg[1], seg[2], seg[3]);
        }
      }
    }
  });

  const levels: FloorPlanLevel[] = [];
  for (let L = 0; L < storeys.length; L += 1) {
    const walls = wallByLevel[L]!;
    const roomMap = roomsByLevel[L]!;
    const rooms: FloorPlanRoom[] = [];
    for (const [spaceId, segs] of roomMap) {
      if (segs.length === 0) continue;
      let sx = 0;
      let sy = 0;
      const n = segs.length / 2;
      for (let i = 0; i < segs.length; i += 2) {
        sx += segs[i] ?? 0;
        sy += segs[i + 1] ?? 0;
      }
      rooms.push({ spaceId, centroid: [sx / n, sy / n], segments: Float32Array.from(segs) });
    }
    if (walls.length === 0 && rooms.length === 0) continue;
    levels.push({
      storeyExpressID: storeys[L]!.expressID,
      elevation: storeys[L]!.elevation,
      wallSegments: Float32Array.from(walls),
      rooms,
    });
  }

  logger?.info(
    {
      stage: 'floorplans',
      upAxis: ['x', 'y', 'z'][upAxis],
      planAxes: [hX, hY],
      storeys: storeys.length,
      levels: levels.length,
      rooms: levels.reduce((acc, l) => acc + l.rooms.length, 0),
    },
    'floor plans built',
  );
  return { planAxisX: hX, planAxisY: hY, levels };
}

/**
 * Build per-storey floor plans from a parsed IFC model in one call (scan +
 * slice). The extraction worker instead calls `scanModelGeometry` once — sharing
 * the scan with the metadata bbox — then `sliceFloorPlans`; this wrapper keeps a
 * standalone entry point for callers/tests that don't need the bbox.
 */
export function buildFloorPlans(
  api: IfcAPI,
  modelID: number,
  lengthUnit: string | null,
  elements: readonly FloorPlanElement[],
  logger?: Logger,
): DecodedFloorPlans {
  const scan = scanModelGeometry(api, modelID, lengthUnit, elements, logger);
  return sliceFloorPlans(api, modelID, scan, logger);
}

/** Encode a floor-plan result as gzipped format-v2 bytes (the S3 object). */
export function encodeFloorPlans(result: DecodedFloorPlans): Uint8Array {
  const { planAxisX, planAxisY, levels } = result;
  const levelCount = levels.length;
  let wallFloatsTotal = 0;
  let roomCount = 0;
  let roomFloatsTotal = 0;
  for (const lv of levels) {
    wallFloatsTotal += lv.wallSegments.length;
    roomCount += lv.rooms.length;
    for (const r of lv.rooms) roomFloatsTotal += r.segments.length;
  }

  const byteLength =
    HEADER_BYTES +
    levelCount * 4 + // levelStoreyIds
    levelCount * 4 + // levelElevations
    levelCount * 4 + // levelWallFloatCounts
    levelCount * 4 + // levelRoomCounts
    roomCount * 4 + // roomSpaceIds
    roomCount * 8 + // roomCentroids
    roomCount * 4 + // roomSegFloatCounts
    wallFloatsTotal * 4 + // wallSegments
    roomFloatsTotal * 4; // roomSegments

  const buf = new ArrayBuffer(byteLength);
  const u8 = new Uint8Array(buf);
  for (let i = 0; i < FLOORPLAN_MAGIC.length; i += 1) u8[i] = FLOORPLAN_MAGIC.charCodeAt(i);
  const dv = new DataView(buf);
  dv.setUint32(8, levelCount, true);
  dv.setUint32(12, wallFloatsTotal, true);
  dv.setUint32(16, roomCount, true);
  dv.setUint32(20, roomFloatsTotal, true);
  dv.setUint32(24, planAxisX, true);
  dv.setUint32(28, planAxisY, true);

  let off = HEADER_BYTES;
  const levelStoreyIds = new Int32Array(buf, off, levelCount);
  off += levelCount * 4;
  const levelElevations = new Float32Array(buf, off, levelCount);
  off += levelCount * 4;
  const levelWallFloatCounts = new Uint32Array(buf, off, levelCount);
  off += levelCount * 4;
  const levelRoomCounts = new Uint32Array(buf, off, levelCount);
  off += levelCount * 4;
  const roomSpaceIds = new Int32Array(buf, off, roomCount);
  off += roomCount * 4;
  const roomCentroids = new Float32Array(buf, off, roomCount * 2);
  off += roomCount * 8;
  const roomSegFloatCounts = new Uint32Array(buf, off, roomCount);
  off += roomCount * 4;
  const wallSegments = new Float32Array(buf, off, wallFloatsTotal);
  off += wallFloatsTotal * 4;
  const roomSegments = new Float32Array(buf, off, roomFloatsTotal);

  let wOff = 0;
  let rIdx = 0;
  let rsOff = 0;
  for (let L = 0; L < levelCount; L += 1) {
    const lv = levels[L]!;
    levelStoreyIds[L] = lv.storeyExpressID;
    levelElevations[L] = lv.elevation;
    levelWallFloatCounts[L] = lv.wallSegments.length;
    levelRoomCounts[L] = lv.rooms.length;
    wallSegments.set(lv.wallSegments, wOff);
    wOff += lv.wallSegments.length;
    for (const r of lv.rooms) {
      roomSpaceIds[rIdx] = r.spaceId;
      roomCentroids[rIdx * 2] = r.centroid[0];
      roomCentroids[rIdx * 2 + 1] = r.centroid[1];
      roomSegFloatCounts[rIdx] = r.segments.length;
      roomSegments.set(r.segments, rsOff);
      rsOff += r.segments.length;
      rIdx += 1;
    }
  }

  return gzipSync(u8);
}

/** Decode a gzipped format-v2 artifact. Used by tests and parity checks; the
 * browser path decompresses with native DecompressionStream instead. */
export function decodeFloorPlans(bytes: Uint8Array): DecodedFloorPlans {
  const inflated = gunzipSync(bytes);
  const u8 = inflated.byteOffset % 4 === 0 ? inflated : inflated.slice();
  if (u8.byteLength < HEADER_BYTES) {
    throw new Error('FLOORPLAN_TRUNCATED: payload shorter than the v2 header');
  }
  for (let i = 0; i < FLOORPLAN_MAGIC.length; i += 1) {
    if (u8[i] !== FLOORPLAN_MAGIC.charCodeAt(i)) {
      throw new Error('FLOORPLAN_BAD_MAGIC: not a format-v2 floor-plan payload');
    }
  }
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const levelCount = dv.getUint32(8, true);
  const wallFloatsTotal = dv.getUint32(12, true);
  const roomCount = dv.getUint32(16, true);
  const roomFloatsTotal = dv.getUint32(20, true);
  const planAxisX = dv.getUint32(24, true);
  const planAxisY = dv.getUint32(28, true);
  const expectedBytes =
    HEADER_BYTES +
    levelCount * 16 + // storeyIds + elevations + wallCounts + roomCounts (4 each)
    roomCount * 16 + // spaceIds(4) + centroids(8) + segFloatCounts(4)
    wallFloatsTotal * 4 +
    roomFloatsTotal * 4;
  if (u8.byteLength !== expectedBytes) {
    throw new Error(
      `FLOORPLAN_LENGTH_MISMATCH: expected ${expectedBytes} bytes, got ${u8.byteLength}`,
    );
  }

  let base = u8.byteOffset + HEADER_BYTES;
  const levelStoreyIds = new Int32Array(u8.buffer, base, levelCount);
  base += levelCount * 4;
  const levelElevations = new Float32Array(u8.buffer, base, levelCount);
  base += levelCount * 4;
  const levelWallFloatCounts = new Uint32Array(u8.buffer, base, levelCount);
  base += levelCount * 4;
  const levelRoomCounts = new Uint32Array(u8.buffer, base, levelCount);
  base += levelCount * 4;
  const roomSpaceIds = new Int32Array(u8.buffer, base, roomCount);
  base += roomCount * 4;
  const roomCentroids = new Float32Array(u8.buffer, base, roomCount * 2);
  base += roomCount * 8;
  const roomSegFloatCounts = new Uint32Array(u8.buffer, base, roomCount);
  base += roomCount * 4;
  const wallSegments = new Float32Array(u8.buffer, base, wallFloatsTotal);
  base += wallFloatsTotal * 4;
  const roomSegments = new Float32Array(u8.buffer, base, roomFloatsTotal);

  const levels: FloorPlanLevel[] = [];
  let wOff = 0;
  let rIdx = 0;
  let rsOff = 0;
  for (let L = 0; L < levelCount; L += 1) {
    const wc = levelWallFloatCounts[L]!;
    const rc = levelRoomCounts[L]!;
    const wallSeg = wallSegments.slice(wOff, wOff + wc);
    wOff += wc;
    const rooms: FloorPlanRoom[] = [];
    for (let r = 0; r < rc; r += 1) {
      const sc = roomSegFloatCounts[rIdx]!;
      rooms.push({
        spaceId: roomSpaceIds[rIdx]!,
        centroid: [roomCentroids[rIdx * 2]!, roomCentroids[rIdx * 2 + 1]!],
        segments: roomSegments.slice(rsOff, rsOff + sc),
      });
      rsOff += sc;
      rIdx += 1;
    }
    levels.push({
      storeyExpressID: levelStoreyIds[L]!,
      elevation: levelElevations[L]!,
      wallSegments: wallSeg,
      rooms,
    });
  }
  return { planAxisX, planAxisY, levels };
}
