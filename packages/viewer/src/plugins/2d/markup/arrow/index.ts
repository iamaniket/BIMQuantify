/** Arrow / leader markup tool — a shaft from tail to head with a 2-segment head. */

import type * as THREE from 'three';

import type { DocumentContext, DocumentPlugin } from '../../../../pdf-core/documentTypes.js';
import type { Pt } from '../../measure/math.js';
import type { MarkupBuildOpts, MarkupCoreAPI, MarkupToolContext } from '../core/api.js';
import type { MarkupStyle } from '../types.js';
import { MARKUP_CORE_NAME } from '../core/index.js';
import { lineObject, makeLineMaterial, twoPointDrag } from '../core/draw.js';

const HEAD_LEN = 12; // px (constant on screen — CSS is rebuilt every reproject)
const HEAD_SPREAD = 0.45; // radians

function build(css: Pt[], style: MarkupStyle, _opts: MarkupBuildOpts): THREE.Object3D[] {
  if (css.length < 2) return [];
  const tail = css[0]!;
  const head = css[1]!;
  const mat = makeLineMaterial(style.color);
  const ang = Math.atan2(head[1] - tail[1], head[0] - tail[0]);
  const p1: Pt = [head[0] - HEAD_LEN * Math.cos(ang - HEAD_SPREAD), head[1] - HEAD_LEN * Math.sin(ang - HEAD_SPREAD)];
  const p2: Pt = [head[0] - HEAD_LEN * Math.cos(ang + HEAD_SPREAD), head[1] - HEAD_LEN * Math.sin(ang + HEAD_SPREAD)];
  return [lineObject(tail, head, mat), lineObject(head, p1, mat), lineObject(head, p2, mat)];
}

export function markupArrowPlugin(): DocumentPlugin {
  return {
    name: 'markup-arrow',
    dependencies: [MARKUP_CORE_NAME],
    install(ctx: DocumentContext): void {
      const core = ctx.plugins.get<MarkupCoreAPI>(MARKUP_CORE_NAME);
      if (!core) throw new Error('markup-arrow requires markup-core');
      core.registerTool({ tool: 'arrow', build, createInteraction: (c: MarkupToolContext) => twoPointDrag(c) });
    },
  };
}
