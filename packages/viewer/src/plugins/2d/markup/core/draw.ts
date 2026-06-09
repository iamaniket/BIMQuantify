/**
 * Shared three.js primitive builders, a per-colour material factory, and the
 * two reusable drawing-interaction helpers (`twoPointDrag`, `sampledPath`).
 * These keep each per-shape plugin tiny — a shape plugin only supplies its
 * `build()` geometry and picks an interaction.
 *
 * All builders take CSS-px points (the markup overlay's ortho camera is in CSS
 * px, identical to the measure plugin) and return objects with `depthTest:false`
 * so markup always draws over the page raster.
 */

import * as THREE from 'three';

import type { Pt } from '../../measure/math.js';
import type { MarkupInteraction, MarkupToolContext } from './api.js';

/** Text height as a fraction of the rendered page height (scales with zoom). */
export const TEXT_SIZE_FRAC = 0.026;

/** Min CSS-px movement before a freehand path samples a new point. */
const FREEHAND_MIN_STEP = 3;

/** CSS-px drag distance above which a pointer-up commits a 2-point shape. */
const DRAG_COMMIT_PX = 4;

const FILL_OPACITY = 0.12;

/**
 * Fresh stroke material for one colour. Each shape builds only the materials it
 * attaches to its objects, so the core's `disposeGroup` (which disposes every
 * object's material) never leaks an unused one.
 */
export function makeLineMaterial(color: string): THREE.LineBasicMaterial {
  return new THREE.LineBasicMaterial({ color: new THREE.Color(color), depthTest: false, transparent: true });
}

/** Fresh translucent fill material for one colour. */
export function makeFillMaterial(color: string): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity: FILL_OPACITY,
    side: THREE.DoubleSide,
    depthTest: false,
  });
}

export function lineObject(a: Pt, b: Pt, mat: THREE.Material): THREE.Line {
  const geom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(a[0], a[1], 0),
    new THREE.Vector3(b[0], b[1], 0),
  ]);
  const line = new THREE.Line(geom, mat);
  line.frustumCulled = false;
  line.renderOrder = 2;
  return line;
}

/** Open or closed polyline through CSS points. */
export function polylineObject(cssPts: Pt[], close: boolean, mat: THREE.Material): THREE.Line {
  const verts = cssPts.map((p) => new THREE.Vector3(p[0], p[1], 0));
  if (close && verts.length > 0) verts.push(verts[0]!.clone());
  const geom = new THREE.BufferGeometry().setFromPoints(verts);
  const line = close ? new THREE.LineLoop(geom, mat) : new THREE.Line(geom, mat);
  line.frustumCulled = false;
  line.renderOrder = 2;
  return line;
}

/** Filled polygon (translucent) from CSS points. */
export function fillObject(cssPts: Pt[], mat: THREE.Material): THREE.Mesh {
  const shape = new THREE.Shape(cssPts.map((p) => new THREE.Vector2(p[0], p[1])));
  const geom = new THREE.ShapeGeometry(shape);
  const mesh = new THREE.Mesh(geom, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return mesh;
}

// --------------------------------------------------------------- interactions

/**
 * Two-point drag (rectangle / arrow / cloud): press to set the first point,
 * drag to rubber-band, release (if moved) or click again to commit the second.
 */
export function twoPointDrag(c: MarkupToolContext): MarkupInteraction {
  let p0: Pt | null = null;
  let dragging = false;

  return {
    onPointerDown(e: PointerEvent): void {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const p = c.cursorToArtifact(e);
      if (p0 === null) {
        p0 = p;
        dragging = true;
        c.root.setPointerCapture?.(e.pointerId);
        c.preview([p0, p]);
      } else {
        c.submit([p0, p]);
        p0 = null;
        dragging = false;
      }
    },
    onPointerMove(e: PointerEvent): void {
      if (p0 === null) return;
      c.preview([p0, c.cursorToArtifact(e)]);
    },
    onPointerUp(e: PointerEvent): void {
      if (p0 === null || !dragging) return;
      const p = c.cursorToArtifact(e);
      const a = c.artifactToCss(p0);
      const b = c.artifactToCss(p);
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > DRAG_COMMIT_PX) {
        c.submit([p0, p]);
        p0 = null;
        dragging = false;
      } else {
        // Treat as the first click of a two-click placement.
        dragging = false;
      }
    },
  };
}

/** Freehand: sample points along the drag while the primary button is held. */
export function sampledPath(c: MarkupToolContext): MarkupInteraction {
  let pts: Pt[] = [];
  let drawing = false;
  let lastCss: Pt | null = null;

  return {
    onPointerDown(e: PointerEvent): void {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const p = c.cursorToArtifact(e);
      pts = [p];
      drawing = true;
      lastCss = c.artifactToCss(p);
      c.root.setPointerCapture?.(e.pointerId);
      c.preview(pts);
    },
    onPointerMove(e: PointerEvent): void {
      if (!drawing) return;
      const p = c.cursorToArtifact(e);
      const pc = c.artifactToCss(p);
      if (lastCss === null || Math.hypot(pc[0] - lastCss[0], pc[1] - lastCss[1]) >= FREEHAND_MIN_STEP) {
        pts.push(p);
        lastCss = pc;
        c.preview(pts);
      }
    },
    onPointerUp(): void {
      if (!drawing) return;
      drawing = false;
      if (pts.length >= 2) c.submit(pts);
      else c.cancel();
      pts = [];
      lastCss = null;
    },
  };
}
