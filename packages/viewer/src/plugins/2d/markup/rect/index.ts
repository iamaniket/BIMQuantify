/** Rectangle markup tool — a closed outline plus a translucent fill. */

import type * as THREE from 'three';

import type { DocumentContext, DocumentPlugin } from '../../../../pdf-core/documentTypes.js';
import type { Pt } from '../../measure/math.js';
import type { MarkupBuildOpts, MarkupCoreAPI, MarkupToolContext } from '../core/api.js';
import type { MarkupStyle } from '../types.js';
import { MARKUP_CORE_NAME } from '../core/index.js';
import { fillObject, makeFillMaterial, makeLineMaterial, polylineObject, twoPointDrag } from '../core/draw.js';

function corners(a: Pt, b: Pt): Pt[] {
  return [
    [a[0], a[1]],
    [b[0], a[1]],
    [b[0], b[1]],
    [a[0], b[1]],
  ];
}

function build(world: Pt[], style: MarkupStyle, _opts: MarkupBuildOpts): THREE.Object3D[] {
  if (world.length < 2) return [];
  const pts = corners(world[0]!, world[1]!);
  return [
    fillObject(pts, makeFillMaterial(style.color)),
    polylineObject(pts, true, makeLineMaterial(style.color)),
  ];
}

export function markupRectPlugin(): DocumentPlugin {
  return {
    name: 'markup-rect',
    dependencies: [MARKUP_CORE_NAME],
    install(ctx: DocumentContext): void {
      const core = ctx.plugins.get<MarkupCoreAPI>(MARKUP_CORE_NAME);
      if (!core) throw new Error('markup-rect requires markup-core');
      core.registerTool({ tool: 'rect', build, createInteraction: (c: MarkupToolContext) => twoPointDrag(c) });
    },
  };
}
