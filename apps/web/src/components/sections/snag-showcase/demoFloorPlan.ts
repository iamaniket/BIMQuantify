/**
 * Loads the marketing snag showcase's 2D floor plan from the REAL model's
 * precomputed artifact.
 *
 * The real product extracts a `BIMFPLN2` floor-plan artifact from each model and
 * decodes it to a `DecodedFloorPlans` object in the browser. Here we ship that
 * exact artifact as a static asset (`public/models/demo.floorplans.bin`, gzip —
 * the codec gunzips it) and decode it with the SAME product codec, so the
 * marketing site needs no API and no processor run — just a static file.
 *
 * We keep only the GROUND FLOOR (the storey at peil 0 — "begane grond"), flip it
 * to the conventional top-view orientation (mirroring the portal's
 * `useFloorPlans`), and auto-place the curated demo snags onto the wall geometry.
 * (This model's plan carries wall cut-segments only — no room footprints — so
 * pins snap to the nearest wall rather than to room centroids.)
 */

import { decodeFloorPlans } from '@bimdossier/viewer/viewer-2d';
import type {
  DecodedFloorPlans, FloorPlanLevel,
} from '@bimdossier/viewer/viewer-2d';

/** Static floor-plan artifact (the real model's gzipped BIMFPLN2 plans). */
const FLOOR_PLANS_URL = '/models/demo.floorplans.bin';

/**
 * Curated subset of `DEMO_SNAGS` (by id) shown on the 2D plan. Their statuses
 * span the palette (open / in_progress / resolved / verified) so the shared
 * marker coloring is visible. Positions are computed at load from the real
 * ground-floor walls — see {@link loadDemoFloorPlan}.
 */
export const PLAN_SNAG_IDS = [
  'snag-wall',
  'snag-cover',
  'snag-pipe',
  'snag-glazing',
  'snag-airtight',
] as const;

/**
 * Spread targets (normalized 0..1, top-left Y-down) for the curated pins. Each
 * pin snaps to the wall point nearest its target, so the markers stay spread
 * across the plan AND sit on the drawing rather than floating in empty space.
 */
const PIN_ANCHORS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 0.30, y: 0.34 },
  { x: 0.68, y: 0.30 },
  { x: 0.50, y: 0.54 },
  { x: 0.28, y: 0.72 },
  { x: 0.72, y: 0.68 },
];

export type DemoFloorPlanData = {
  /** Single-level (ground floor) plan fed to `<DocumentViewer floorPlan={...} />`. */
  plan: DecodedFloorPlans;
  /** snag id → normalized position (0..1, top-left, Y-down) for `entity-marker-2d`. */
  snagPositions: Record<string, { x: number; y: number }>;
};

type Bbox = { minX: number; minY: number; maxX: number; maxY: number };

/**
 * Mirror of the portal's plan orientation flip (`useFloorPlans.ts`): negate the
 * Y of every `[x,y,…]` cut segment so the plan reads in the conventional 3D
 * top-view orientation (correct door-swing handedness). Mutates in place.
 */
function negateSegmentY(seg: Float32Array): void {
  for (let i = 1; i < seg.length; i += 2) seg[i] = -(seg[i] ?? 0);
}

/** Grow `b` to include every `[x,y,…]` point in `seg`. */
function accumulate(seg: Float32Array, b: Bbox): void {
  for (let i = 0; i + 1 < seg.length; i += 2) {
    const x = seg[i] ?? 0;
    const y = seg[i + 1] ?? 0;
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (y < b.minY) b.minY = y;
    if (y > b.maxY) b.maxY = y;
  }
}

/** Midpoint of each `[x1,y1,x2,y2]` cut segment (stride 4). */
function wallMidpoints(seg: Float32Array): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i + 3 < seg.length; i += 4) {
    pts.push([((seg[i] ?? 0) + (seg[i + 2] ?? 0)) / 2, ((seg[i + 1] ?? 0) + (seg[i + 3] ?? 0)) / 2]);
  }
  return pts;
}

/** Nearest point in `pts` to (wx, wy), or null if `pts` is empty. */
function nearest(pts: ReadonlyArray<[number, number]>, wx: number, wy: number): [number, number] | null {
  let best: [number, number] | null = null;
  let bd = Infinity;
  for (const p of pts) {
    const dx = p[0] - wx;
    const dy = p[1] - wy;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

/**
 * Ground floor = the lowest storey at or above grade (elevation ≥ 0). A real
 * building's foundation / crawlspace storeys sit below 0 with little geometry;
 * the storey at peil 0 ("GROUND FLOOR") is the one we want. Falls back to the
 * storey nearest 0 if somehow none are ≥ 0.
 */
function pickGroundFloor(levels: readonly FloorPlanLevel[]): FloorPlanLevel | undefined {
  const atOrAbove = levels
    .filter((l) => l.elevation >= 0)
    .sort((a, b) => a.elevation - b.elevation);
  if (atOrAbove[0]) return atOrAbove[0];
  return [...levels].sort((a, b) => Math.abs(a.elevation) - Math.abs(b.elevation))[0];
}

/**
 * Fetch + decode the real model's floor-plan artifact, keep ONLY the ground
 * floor, flip it to the top-view orientation, and auto-place the curated demo
 * snags onto the wall geometry (normalized over the plan's page box — the exact
 * frame `entity-marker-2d` consumes). Rejects if the file is missing or decodes
 * to nothing, so the host can swap in the static fallback.
 */
export async function loadDemoFloorPlan(): Promise<DemoFloorPlanData> {
  const res = await fetch(FLOOR_PLANS_URL);
  if (!res.ok) throw new Error(`floor-plan fetch failed: ${String(res.status)}`);
  const decoded = await decodeFloorPlans(new Uint8Array(await res.arrayBuffer()));
  if (decoded === null || decoded.levels.length === 0) {
    throw new Error('floor-plan decode returned no levels');
  }

  const ground = pickGroundFloor(decoded.levels);
  if (!ground) throw new Error('floor-plan has no usable level');

  // Flip to top-view orientation BEFORE measuring the bbox / placing pins, so
  // the page box, the wall geometry, and the pins all flip together.
  negateSegmentY(ground.wallSegments);
  for (const r of ground.rooms) negateSegmentY(r.segments);

  const groundLevel: FloorPlanLevel = {
    storeyExpressID: ground.storeyExpressID,
    elevation: ground.elevation,
    wallSegments: ground.wallSegments,
    rooms: ground.rooms.map((r) => ({
      spaceId: r.spaceId,
      centroid: [r.centroid[0], -r.centroid[1]] as [number, number],
      segments: r.segments,
    })),
  };

  const plan: DecodedFloorPlans = {
    planAxisX: decoded.planAxisX,
    planAxisY: decoded.planAxisY,
    levels: [groundLevel],
  };

  // Union bbox over walls (+ rooms if any) = the page box the 2D engine fits the
  // plan to, so normalizing against it lands the pins where the engine projects.
  const b: Bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  accumulate(groundLevel.wallSegments, b);
  for (const r of groundLevel.rooms) accumulate(r.segments, b);
  const w = b.maxX - b.minX || 1;
  const h = b.maxY - b.minY || 1;
  const norm = (x: number, y: number): { x: number; y: number } => ({
    x: (x - b.minX) / w,
    y: (b.maxY - y) / h, // top-left origin, Y-down
  });

  // Snap each curated snag to the wall point nearest its spread anchor.
  const mids = wallMidpoints(groundLevel.wallSegments);
  const snagPositions: Record<string, { x: number; y: number }> = {};
  PLAN_SNAG_IDS.forEach((id, i) => {
    const a = PIN_ANCHORS[i % PIN_ANCHORS.length] ?? { x: 0.5, y: 0.5 };
    const wx = b.minX + a.x * w;
    const wy = b.maxY - a.y * h;
    const p = nearest(mids, wx, wy);
    snagPositions[id] = p ? norm(p[0], p[1]) : a;
  });

  return { plan, snagPositions };
}
