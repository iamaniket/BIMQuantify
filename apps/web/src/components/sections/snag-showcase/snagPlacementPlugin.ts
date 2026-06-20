import type { Plugin, ViewerContext, Vec3 } from '@bimstitch/viewer';
import { pick } from '@bimstitch/viewer/viewer-3d';

export type SurfacePointsArgs = {
  /** How many spread-out surface points to return. */
  count: number;
  /** Scene id of the model to raycast (matches the marker's `modelId`). */
  modelId: string;
};

// Central NDC probe grid, tuned to the showcase's 3/4-corner framing (azimuth
// 45°, polar 90°, sizeBoost 1.5 — see cameraZoomPlugin). Kept well inside the
// frame (|x| ≤ 0.28 / |y| ≤ 0.24) so every sample lands on the building's
// silhouette; samples that miss the model are simply dropped. NDC is relative to
// the canvas and the model is camera-centered, so this is screen-size agnostic.
const NDC_XS = [-0.28, -0.14, 0, 0.14, 0.28] as const;
const NDC_YS = [0.24, 0.08, -0.08, -0.24] as const;

const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

const byCoord = (a: Vec3, b: Vec3): number => a.x - b.x || a.y - b.y || a.z - b.z;

/**
 * Greedy farthest-point selection: deterministically pick `count` points that
 * are maximally spread out, so no two snag pins cluster on the same flat wall.
 * Seeded from the lowest (x,y,z) hit so the result is stable across reloads.
 */
function spread(points: Vec3[], count: number): Vec3[] {
  if (points.length <= count) return points;
  const remaining = [...points].sort(byCoord);
  const chosen: Vec3[] = [remaining.shift() as Vec3];
  while (chosen.length < count && remaining.length > 0) {
    let bestIdx = 0;
    let bestMin = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const p = remaining[i] as Vec3;
      let minD = Infinity;
      for (const c of chosen) minD = Math.min(minD, dist(p, c));
      if (minD > bestMin) {
        bestMin = minD;
        bestIdx = i;
      }
    }
    chosen.push(remaining.splice(bestIdx, 1)[0] as Vec3);
  }
  return chosen;
}

/**
 * Marketing-showcase snag placement. Sibling of `autoRotatePlugin` /
 * `cameraZoomPlugin` — registers `showcase.surfacePoints`, which raycasts the
 * loaded demo model and returns up to `count` well-spread points that sit ON its
 * surface (in the model's LOCAL frame, the frame `entity-marker` expects).
 *
 * SnagViewer calls it once in `onReady` after `showcase.zoomIn` frames the
 * model, then pins the demo snags to the returned points. This replaces the old
 * hand-authored coordinates, which fell inside the bounding-box *volume* (empty
 * interior/air) and so projected as "floating" pins beside the building — the
 * CSS2D marker overlay does not depth-test, so an off-geometry anchor just
 * projects to wherever it lands on screen. On-surface points stay inside the
 * silhouette from every angle as the model auto-rotates.
 */
export function snagPlacementPlugin(): Plugin {
  let ctx: ViewerContext | null = null;

  const surfacePoints = async (args: unknown): Promise<Vec3[]> => {
    if (ctx === null) return [];
    const { count, modelId } = (args as SurfacePointsArgs | undefined) ?? {
      count: 0,
      modelId: '',
    };
    if (count <= 0) return [];

    // Pause the idle turntable so every probe samples the same framed pose
    // (no-op under reduced-motion — the command isn't registered), and flush any
    // pending `setLookAt` onto the camera so the raycast uses that pose.
    await ctx.commands.execute('auto-rotate.setPaused', { paused: true }).catch(() => undefined);
    ctx.cameraControls.update(0);

    const hits: Vec3[] = [];
    for (const x of NDC_XS) {
      for (const y of NDC_YS) {
        const hit = await pick(ctx, { x, y });
        if (hit) hits.push(hit.point);
      }
    }

    await ctx.commands.execute('auto-rotate.setPaused', { paused: false }).catch(() => undefined);

    if (hits.length === 0) return [];

    const chosen = spread(hits, count);

    // pick() returns WORLD-space points; entity-marker re-applies the model's
    // world matrix at render time, so hand back LOCAL-frame points (its inverse).
    // Identity for the single base model, but correct if coordination ever
    // shifts. Borrow the camera's Vector3 as scratch (no `three` import — matches
    // the sibling plugins).
    const obj = ctx.models().get(modelId)?.object ?? null;
    obj?.updateWorldMatrix(true, false);
    const inv = obj ? obj.matrixWorld.clone().invert() : null;
    const toLocal = (p: Vec3): Vec3 => {
      if (ctx === null || inv === null) return p;
      const v = ctx.camera.position.clone();
      v.set(p.x, p.y, p.z).applyMatrix4(inv);
      return { x: v.x, y: v.y, z: v.z };
    };

    // Stable left→right ordering so each snag tends to the same area on reload.
    return chosen.map(toLocal).sort(byCoord);
  };

  return {
    name: 'showcase-snag-placement',
    install(context: ViewerContext): void {
      ctx = context;
      context.commands.register('showcase.surfacePoints', surfacePoints, {
        title: 'Raycast well-spread on-surface points for the demo snags',
      });
    },
    uninstall(): void {
      ctx = null;
    },
  };
}
