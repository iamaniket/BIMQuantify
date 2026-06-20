import type { Plugin, ViewerContext, Vec3 } from '@bimstitch/viewer';

export type ElementPointsArgs = {
  /** How many spread-out element centroids to return. */
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
 * set of snags (the marketing brief: "random 5 snags").
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
 * `cameraZoomPlugin` — registers `showcase.elementPoints`, which reads the loaded
 * demo model's GEOMETRY (every element's bounding box) and returns up to `count`
 * well-spread element centroids (in the model's LOCAL frame, the frame
 * `entity-marker` expects).
 *
 * This is camera- and layout-independent — unlike the old screen-space raycast it
 * replaced, which fired a centered NDC grid that missed the model once SnagViewer
 * shifted it right via a 500px canvas pad. A centroid sits INSIDE a real element,
 * so the CSS2D pin (which doesn't depth-test) always projects onto the building
 * from every rotation angle, never floating in interior air.
 *
 * SnagViewer calls it once in `onReady` after `showcase.zoomIn` frames the model,
 * then pins each demo snag to a returned point.
 */
export function snagPlacementPlugin(): Plugin {
  let ctx: ViewerContext | null = null;

  // Reject elements bigger than this fraction of the whole-model extent on any
  // axis (IfcSite / whole-storey / whole-building), whose centroid floats in
  // interior air. Keeps compact solids — walls, windows, columns, slabs, fixtures.
  const MAX_AXIS_FRACTION = 0.55;

  const elementPoints = async (args: unknown): Promise<Vec3[]> => {
    if (ctx === null) return [];
    const { count, modelId } = (args as ElementPointsArgs | undefined) ?? {
      count: 0,
      modelId: '',
    };
    if (count <= 0) return [];

    const model = ctx.models().get(modelId);
    if (!model) {
      dbg('model not found:', modelId, 'have:', [...ctx.models().keys()]);
      return [];
    }

    // `getBoxes`/`getPositions` return WORLD-space coords; entity-marker re-applies
    // the model's world matrix at render time, so hand back LOCAL-frame points (its
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

    // Whole-model extent → axis caps for the oversized-element filter.
    const mb = model.box;
    const hasExtent = Boolean(mb) && !mb.isEmpty();
    const capX = hasExtent ? (mb.max.x - mb.min.x) * MAX_AXIS_FRACTION : Infinity;
    const capY = hasExtent ? (mb.max.y - mb.min.y) * MAX_AXIS_FRACTION : Infinity;
    const capZ = hasExtent ? (mb.max.z - mb.min.z) * MAX_AXIS_FRACTION : Infinity;

    // Element geometry can still be streaming for a few seconds AFTER onReady
    // fires (the viewer holds the render loop open ~4s post-load), so getBoxes can
    // come back empty at first. Retry until it yields usable boxes (or give up
    // after ~2s) — this is the fix for snags falling back to hardcoded coords.
    let ids: number[] = [];
    let boxes: Awaited<ReturnType<typeof model.getBoxes>> = [];
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        ids = await model.getLocalIds();
        // eslint-disable-next-line no-await-in-loop
        boxes = ids.length > 0 ? await model.getBoxes(ids) : [];
      } catch (err) {
        dbg('getLocalIds/getBoxes threw:', err);
        ids = [];
        boxes = [];
      }
      const usable = boxes.filter((b) => b && !b.isEmpty()).length;
      dbg(`attempt ${attempt}: ids=${ids.length} boxes=${boxes.length} usable=${usable}`);
      if (usable > 0) break;
      // eslint-disable-next-line no-await-in-loop
      await sleep(250);
    }

    // Prefer compact (on-geometry) centroids; keep ALL non-empty ones as a
    // fallback pool so an over-aggressive size filter can never starve us to [].
    const filtered: Vec3[] = [];
    const all: Vec3[] = [];
    for (const b of boxes) {
      if (!b || b.isEmpty()) continue;
      const sx = b.max.x - b.min.x;
      const sy = b.max.y - b.min.y;
      const sz = b.max.z - b.min.z;
      if (sx <= 0 && sy <= 0 && sz <= 0) continue; // degenerate / no geometry
      const c = toLocal((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
      all.push(c);
      if (sx <= capX && sy <= capY && sz <= capZ) filtered.push(c);
    }
    let pool = filtered.length >= count ? filtered : all;

    // Last resort: the direct centroid API, in case boxes were all unusable.
    if (pool.length === 0) {
      try {
        const positions = await model.getPositions(ids.length > 0 ? ids : undefined);
        pool = positions.filter(Boolean).map((p) => toLocal(p.x, p.y, p.z));
      } catch (err) {
        dbg('getPositions fallback threw:', err);
        pool = [];
      }
    }

    dbg(`pool=${pool.length} (filtered=${filtered.length} all=${all.length}) count=${count}`);
    if (pool.length === 0) return [];

    // Stable left→right ordering so the spotlight cycle sweeps coherently across
    // the building (the *set* still varies per reload via the random spread seed).
    return spread(pool, count).sort(byCoord);
  };

  return {
    name: 'showcase-snag-placement',
    install(context: ViewerContext): void {
      ctx = context;
      context.commands.register('showcase.elementPoints', elementPoints, {
        title: 'Sample well-spread element centroids for the demo snags',
      });
    },
    uninstall(): void {
      ctx = null;
    },
  };
}
