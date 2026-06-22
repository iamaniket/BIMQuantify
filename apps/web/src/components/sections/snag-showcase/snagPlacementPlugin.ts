import type { Plugin, ViewerContext, Vec3 } from '@bimstitch/viewer';
import { pick } from '@bimstitch/viewer/viewer-3d';

export type ElementPointsArgs = {
  /** How many spread-out surface points to return. */
  count: number;
  /** Scene id of the model to sample (matches the marker's `modelId`). */
  modelId: string;
};

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

const byCoord = (a: Vec3, b: Vec3): number => a.x - b.x || a.y - b.y || a.z - b.z;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

// Dev-only diagnostics (captured in the Next dev log via the browser console),
// so a hard reload reveals exactly why placement did/didn't find geometry. Never
// runs in production.
const dbg = (...parts: unknown[]): void => {
  if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.warn('[snag-debug]', ...parts);
  }
};

/**
 * Greedy farthest-point selection: pick `count` points that are maximally spread
 * out so no two snag pins cluster on the same wall. Seeded from a RANDOM element
 * each call, so every reload yields a different — but still well-distributed —
 * placement of the demo snags (the randomness is in WHICH surface points are
 * chosen, not how many snags show).
 */
function spread(points: Vec3[], count: number): Vec3[] {
  if (points.length <= count) return points;
  const remaining = [...points];
  const seed = Math.floor(Math.random() * remaining.length);
  const chosen: Vec3[] = [remaining.splice(seed, 1)[0]!];
  while (chosen.length < count && remaining.length > 0) {
    let bestIdx = 0;
    let bestMin = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const p = remaining[i]!;
      let minD = Infinity;
      for (const c of chosen) minD = Math.min(minD, dist(p, c));
      if (minD > bestMin) {
        bestMin = minD;
        bestIdx = i;
      }
    }
    chosen.push(remaining.splice(bestIdx, 1)[0]!);
  }
  return chosen;
}

/**
 * Marketing-showcase snag placement. Sibling of `autoRotatePlugin` /
 * `cameraZoomPlugin` — registers `showcase.elementPoints`, which returns up to
 * `count` well-spread points that sit ON the demo model's visible SURFACE (in the
 * model's LOCAL frame, the frame `entity-marker` expects).
 *
 * Why surface points, not bounding-box centroids
 * ----------------------------------------------
 * The pins MUST land on the building's skin. An element's axis-aligned
 * bounding-box centroid is NOT a surface point — it's the volumetric centre,
 * i.e. *inside* the solid, and for L-shaped / ring / sloped / curved / assembly
 * elements it's in empty air offset from the geometry. Pinning a CSS2D marker
 * there (and CSS2D markers do not depth-test) makes the pin read as floating on
 * an invisible box rather than stuck to the model. So a centroid is only an
 * *aiming target* here, never the anchor.
 *
 * How a real surface point is found (same path as the real app)
 * -------------------------------------------------------------
 * For each candidate element we project its world centroid through the LIVE
 * camera to get its true on-screen NDC, then `pick()` (the GPU raycast that
 * powers right-click "place finding") returns the first SURFACE hit along that
 * line of sight — a real point on the building's exterior. That hit point is the
 * anchor, exactly like `Finding.anchor_x/y/z` (a stored raycast hit) in the app.
 *
 * This fixes the earlier attempts:
 *  - The centroid version pinned to bounding-box centres → floating off the skin.
 *  - The first raycast version fired a *centred* NDC grid, but `cameraZoomPlugin`'s
 *    desktop right-shift (a camera `setFocalOffset`, see `panFraction`) slides the
 *    model into the right ~70%, so every probe sampled the empty left half and
 *    missed. Projecting a real centroid through the actual camera self-corrects for
 *    the shift (the projection and `pick`'s NDC→client-px conversion share the same
 *    canvas rect), so rays land on the model.
 *
 * SnagViewer calls it once in `onReady` after `showcase.zoomIn` frames the model,
 * then pins each demo snag to a returned surface point.
 */
export function snagPlacementPlugin(): Plugin {
  let ctx: ViewerContext | null = null;

  // Reject elements bigger than this fraction of the whole-model extent on any
  // axis (IfcSite / whole-storey / whole-building), whose centroid is a poor
  // aiming target (it can project to empty screen space, or onto the wrong face).
  // Keeps compact solids — walls, windows, columns, slabs, fixtures.
  const MAX_AXIS_FRACTION = 0.55;

  const elementPoints = async (args: unknown): Promise<Vec3[]> => {
    if (ctx === null) return [];
    // Stable non-null handle for use inside async closures below (the captured
    // `let ctx` widens back to nullable across awaits / callbacks).
    const context = ctx;
    const { count, modelId } = (args as ElementPointsArgs | undefined) ?? {
      count: 0,
      modelId: '',
    };
    if (count <= 0) return [];

    const model = context.models().get(modelId);
    if (!model) {
      dbg('model not found:', modelId, 'have:', [...ctx.models().keys()]);
      return [];
    }

    // `pick()` returns the hit point in WORLD space; `entity-marker` re-applies the
    // model's world matrix at render time, so hand back LOCAL-frame points (its
    // inverse). Identity for the single base model, but correct if coordination
    // ever shifts. Borrow the camera's Vector3 as scratch (no `three` import —
    // matches the sibling plugins).
    const { camera } = ctx;
    const obj = model.object;
    obj.updateWorldMatrix(true, false);
    const inv = obj.matrixWorld.clone().invert();
    const toLocal = (wx: number, wy: number, wz: number): Vec3 => {
      const v = camera.position.clone();
      v.set(wx, wy, wz).applyMatrix4(inv);
      return { x: v.x, y: v.y, z: v.z };
    };

    // Whole-model extent → axis caps for the oversized-element filter (kept in
    // WORLD space, the frame getBoxes returns).
    const mb = model.box;
    const hasExtent = Boolean(mb) && !mb.isEmpty();
    const capX = hasExtent ? (mb.max.x - mb.min.x) * MAX_AXIS_FRACTION : Infinity;
    const capY = hasExtent ? (mb.max.y - mb.min.y) * MAX_AXIS_FRACTION : Infinity;
    const capZ = hasExtent ? (mb.max.z - mb.min.z) * MAX_AXIS_FRACTION : Infinity;

    // Element geometry can still be streaming for a few seconds AFTER onReady
    // fires (the viewer holds the render loop open ~4s post-load), so getBoxes can
    // come back empty at first. Retry until it yields usable boxes (or give up
    // after ~2s) — both the aiming targets and the raycast need geometry present.
    // Local ids are known from metadata immediately and don't change as geometry
    // streams in — fetch them once, then retry only getBoxes below.
    let ids: number[] = [];
    try {
      ids = await model.getLocalIds();
    } catch (err) {
      dbg('getLocalIds threw:', err);
      ids = [];
    }
    let boxes: Awaited<ReturnType<typeof model.getBoxes>> = [];
    for (let attempt = 0; attempt < 8 && ids.length > 0; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        boxes = await model.getBoxes(ids);
      } catch (err) {
        dbg('getBoxes threw:', err);
        boxes = [];
      }
      const usable = boxes.filter((b) => b && !b.isEmpty()).length;
      dbg(`attempt ${attempt}: ids=${ids.length} boxes=${boxes.length} usable=${usable}`);
      if (usable > 0) break;
      // eslint-disable-next-line no-await-in-loop
      await sleep(250);
    }

    // AIMING TARGETS — world-space element centroids. Prefer compact (real
    // building part) centroids; keep all non-empty ones as a top-up so an
    // over-aggressive size filter can never starve the aim list.
    const compactAim: Vec3[] = [];
    const allAim: Vec3[] = [];
    for (const b of boxes) {
      if (!b || b.isEmpty()) continue;
      const sx = b.max.x - b.min.x;
      const sy = b.max.y - b.min.y;
      const sz = b.max.z - b.min.z;
      if (sx <= 0 && sy <= 0 && sz <= 0) continue; // degenerate / no geometry
      const c: Vec3 = {
        x: (b.min.x + b.max.x) / 2,
        y: (b.min.y + b.max.y) / 2,
        z: (b.min.z + b.max.z) / 2,
      };
      allAim.push(c);
      if (sx <= capX && sy <= capY && sz <= capZ) compactAim.push(c);
    }
    let aim = compactAim.length >= count ? compactAim : [...compactAim, ...allAim];

    // If boxes were all unusable, fall back to the direct centroid API just to
    // have *something* to aim at.
    if (aim.length === 0) {
      try {
        const positions = await model.getPositions(ids.length > 0 ? ids : undefined);
        aim = positions.filter(Boolean).map((p) => ({ x: p.x, y: p.y, z: p.z }));
      } catch (err) {
        dbg('getPositions fallback threw:', err);
        aim = [];
      }
    }
    if (aim.length === 0) {
      dbg('no aiming targets — returning [] (snags fall back to authored coords)');
      return [];
    }

    // Choose `count` well-spread compact-element centroids UP FRONT. A compact
    // element's bbox centre sits on/inside a real building part, so it is always a
    // valid ON-MODEL anchor — these are the guaranteed-on-model placements.
    const chosen = spread(aim, count);

    // Try to REFINE each centroid to a true surface point via a raycast (a pin stuck
    // to the building skin reads better than one at an element's volumetric centre),
    // but KEEP the centroid whenever the ray misses or the GPU pick buffer is
    // degenerate/stale (headless/SSR warmup returns the same hit for every ray).
    // This guarantees every snag lands on the model — we never substitute an
    // off-model authored coord here. `updateMatrixWorld` refreshes the camera's
    // matrixWorldInverse so `project` is exact even right after `showcase.zoomIn`.
    camera.updateMatrixWorld();
    const refined: Vec3[] = await Promise.all(
      chosen.map(async (c) => {
        const v = camera.position.clone();
        v.set(c.x, c.y, c.z).project(camera); // NDC in v.x / v.y, depth in v.z
        const onScreen = v.x >= -1 && v.x <= 1 && v.y >= -1 && v.y <= 1 && v.z >= -1 && v.z <= 1;
        if (!onScreen) return c; // centroid (on-model) when it'd project off-screen
        const hit = await pick(context, { x: v.x, y: v.y }).catch(() => null);
        return hit ? { x: hit.point.x, y: hit.point.y, z: hit.point.z } : c;
      }),
    );

    // Guarantee distinct anchors: if a refinement raycast collapsed two snags onto
    // the SAME surface point (a stale pick buffer returns one hit for every ray, or
    // two centroids occlude to one face), fall back to that element's own DISTINCT
    // centroid so the pins never stack on one spot.
    const key = (p: Vec3): string => `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}`;
    const seen = new Set<string>();
    const result: Vec3[] = [];
    for (let i = 0; i < chosen.length; i += 1) {
      let p = refined[i] ?? chosen[i]!;
      if (seen.has(key(p))) p = chosen[i]!; // distinct on-model centroid
      if (seen.has(key(p))) continue; // centroid itself a dup (shouldn't happen)
      seen.add(key(p));
      result.push(toLocal(p.x, p.y, p.z));
    }

    dbg(
      `placed ${String(result.length)}/${String(count)} on-model points `
      + `(compactAim=${String(compactAim.length)} allAim=${String(allAim.length)})`,
    );

    if (result.length === 0) {
      dbg('no on-model points — returning [] (snags fall back to authored coords)');
      return [];
    }

    // Ordered left→right so the spotlight cycle sweeps coherently across the
    // building (the *set* still varies per reload via the random spread seed).
    return result.sort(byCoord);
  };

  return {
    name: 'showcase-snag-placement',
    install(context: ViewerContext): void {
      ctx = context;
      context.commands.register('showcase.elementPoints', elementPoints, {
        title: 'Sample well-spread surface points on the model for the demo snags',
      });
    },
    uninstall(): void {
      ctx = null;
    },
  };
}
