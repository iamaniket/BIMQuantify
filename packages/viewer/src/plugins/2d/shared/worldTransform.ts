/**
 * Pure (no three.js / DOM) transforms between the 2D viewer's persistence /
 * storage spaces and the shared scene's **world space**.
 *
 * World space = PDF points, **Y-up, origin bottom-left**, spanning the *rendered
 * (rotated)* page box `[0, uvW] × [0, uvH]`. This is the coordinate system the
 * shared `scene` plugin's ortho camera lives in, so anything added to a scene
 * layer in world coords pans/zooms for free.
 *
 * The two stored spaces:
 *  - **artifact**: PDF points, Y-up, relative to the *unrotated* box `{w0, h0}`
 *    (the measure plugin's space; also the PDF geometry artifact's space);
 *  - **normalized**: `0..1`, **top-left, Y-down**, relative to the *unrotated*
 *    box (markup persistence + finding/cert/attachment anchors).
 *
 * Rotation (0/90/180/270) is folded in by reusing the already-tested rotation
 * switch in `measure/transform.ts` (`artifactToCss` / `cssToArtifact`) and
 * flipping Y (CSS is Y-down, world is Y-up). Keeping a single rotation
 * implementation avoids a second, drift-prone copy.
 */

import type { DocumentContext } from '../../../pdf-core/documentTypes.js';
import { artifactToCss, cssToArtifact } from '../measure/transform.js';

/** Minimal page box: unrotated dims in PDF points + an optional intrinsic rotation. */
export interface PageBox {
  w: number;
  h: number;
  rot?: number;
}

/** Everything the world transforms need for the current page + rotation. */
export interface WorldParams {
  /** Unrotated box width (PDF points). */
  w0: number;
  /** Unrotated box height (PDF points). */
  h0: number;
  /** Rendered (rotated) page box width (PDF points) — the world X span. */
  uvW: number;
  /** Rendered (rotated) page box height (PDF points) — the world Y span. */
  uvH: number;
  /** Combined rotation in degrees: `(userRotation + (box.rot ?? 0)) % 360`. */
  rotation: number;
}

/**
 * Derive {@link WorldParams} from the document context. Pass the precise page
 * box from a geometry artifact when available (markup / measure
 * `setPageGeometry`); otherwise the unrotated box is inferred from the unscaled
 * viewport. Returns null before the first page render.
 */
export function worldParams(ctx: DocumentContext, box?: PageBox | null): WorldParams | null {
  const uv = ctx.getUnscaledViewport(); // post-rotation dims
  if (!uv) return null;
  const extraRot = box?.rot ?? 0;
  const rotation = (((ctx.getRotation() + extraRot) % 360) + 360) % 360;
  let w0: number;
  let h0: number;
  if (box) {
    w0 = box.w;
    h0 = box.h;
  } else if (rotation === 90 || rotation === 270) {
    // getUnscaledViewport() is post-rotation; un-transpose to the unrotated box.
    w0 = uv.height;
    h0 = uv.width;
  } else {
    w0 = uv.width;
    h0 = uv.height;
  }
  return { w0, h0, uvW: uv.width, uvH: uv.height, rotation };
}

/** Artifact point (PDF pts, Y-up, unrotated box) → world (PDF pts, Y-up, rotated box). */
export function artifactToWorld(ax: number, ay: number, p: WorldParams): [number, number] {
  const [cx, cy] = artifactToCss(ax, ay, { w: p.w0, h: p.h0, pageW: p.uvW, pageH: p.uvH, rotation: p.rotation });
  return [cx, p.uvH - cy];
}

/** Inverse of {@link artifactToWorld}. */
export function worldToArtifact(wx: number, wy: number, p: WorldParams): [number, number] {
  return cssToArtifact(wx, p.uvH - wy, { w: p.w0, h: p.h0, pageW: p.uvW, pageH: p.uvH, rotation: p.rotation });
}

/** Normalized (0..1, top-left, Y-down) → world (PDF pts, Y-up, rotated box). */
export function normToWorld(nx: number, ny: number, p: WorldParams): [number, number] {
  return artifactToWorld(nx * p.w0, (1 - ny) * p.h0, p);
}

/** Inverse of {@link normToWorld}. */
export function worldToNorm(wx: number, wy: number, p: WorldParams): [number, number] {
  const [ax, ay] = worldToArtifact(wx, wy, p);
  return [p.w0 === 0 ? 0 : ax / p.w0, p.h0 === 0 ? 0 : 1 - ay / p.h0];
}

/** Map a whole shape from normalized space to world space. */
export function normPointsToWorld(points: ReadonlyArray<readonly [number, number]>, p: WorldParams): [number, number][] {
  return points.map(([nx, ny]) => normToWorld(nx, ny, p));
}

/** Map a whole shape from world space back to normalized space. */
export function worldPointsToNorm(points: ReadonlyArray<readonly [number, number]>, p: WorldParams): [number, number][] {
  return points.map(([wx, wy]) => worldToNorm(wx, wy, p));
}

/** Map a whole shape from artifact space to world space. */
export function artifactPointsToWorld(points: ReadonlyArray<readonly [number, number]>, p: WorldParams): [number, number][] {
  return points.map(([ax, ay]) => artifactToWorld(ax, ay, p));
}
