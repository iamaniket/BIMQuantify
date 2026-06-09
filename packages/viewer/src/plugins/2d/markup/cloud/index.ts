/** Revision-cloud markup tool — a rectangle whose edges are outward scallops. */

import type * as THREE from 'three';

import type { DocumentContext, DocumentPlugin } from '../../../../pdf-core/documentTypes.js';
import type { Pt } from '../../measure/math.js';
import type { MarkupBuildOpts, MarkupCoreAPI, MarkupToolContext } from '../core/api.js';
import type { MarkupStyle } from '../types.js';
import { MARKUP_CORE_NAME } from '../core/index.js';
import { makeLineMaterial, polylineObject, twoPointDrag } from '../core/draw.js';

const ARC_D = 16; // target scallop diameter in px
const STEPS = 6; // arc samples per scallop

/** Build the scalloped outline (CSS px) for the rectangle spanned by a,b. */
function cloudOutline(a: Pt, b: Pt): Pt[] {
  const rectCorners: Pt[] = [
    [a[0], a[1]],
    [b[0], a[1]],
    [b[0], b[1]],
    [a[0], b[1]],
  ];
  const cx = (a[0] + b[0]) / 2;
  const cy = (a[1] + b[1]) / 2;
  const verts: Pt[] = [];

  for (let e = 0; e < 4; e += 1) {
    const p = rectCorners[e]!;
    const q = rectCorners[(e + 1) % 4]!;
    const ex = q[0] - p[0];
    const ey = q[1] - p[1];
    const len = Math.hypot(ex, ey) || 1;
    const ux = ex / len;
    const uy = ey / len;
    // Outward normal: pick the perpendicular pointing away from the rect centre.
    let nx = uy;
    let ny = -ux;
    const mx = (p[0] + q[0]) / 2;
    const my = (p[1] + q[1]) / 2;
    if ((mx - cx) * nx + (my - cy) * ny < 0) {
      nx = -nx;
      ny = -ny;
    }
    const n = Math.max(1, Math.round(len / ARC_D));
    const r = len / (2 * n);
    for (let i = 0; i < n; i += 1) {
      const scx = p[0] + ex * ((i + 0.5) / n);
      const scy = p[1] + ey * ((i + 0.5) / n);
      for (let s = 0; s <= STEPS; s += 1) {
        const ang = Math.PI * (1 - s / STEPS); // π → 0: start → end, bulging outward
        const along = Math.cos(ang) * r;
        const out = Math.sin(ang) * r;
        verts.push([scx + ux * along + nx * out, scy + uy * along + ny * out]);
      }
    }
  }
  return verts;
}

function build(css: Pt[], style: MarkupStyle, _opts: MarkupBuildOpts): THREE.Object3D[] {
  if (css.length < 2) return [];
  return [polylineObject(cloudOutline(css[0]!, css[1]!), true, makeLineMaterial(style.color))];
}

export function markupCloudPlugin(): DocumentPlugin {
  return {
    name: 'markup-cloud',
    dependencies: [MARKUP_CORE_NAME],
    install(ctx: DocumentContext): void {
      const core = ctx.plugins.get<MarkupCoreAPI>(MARKUP_CORE_NAME);
      if (!core) throw new Error('markup-cloud requires markup-core');
      core.registerTool({ tool: 'cloud', build, createInteraction: (c: MarkupToolContext) => twoPointDrag(c) });
    },
  };
}
