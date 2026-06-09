/** Freehand markup tool — an open polyline of sampled pointer points. */

import type * as THREE from 'three';

import type { DocumentContext, DocumentPlugin } from '../../../../pdf-core/documentTypes.js';
import type { Pt } from '../../measure/math.js';
import type { MarkupBuildOpts, MarkupCoreAPI, MarkupToolContext } from '../core/api.js';
import type { MarkupStyle } from '../types.js';
import { MARKUP_CORE_NAME } from '../core/index.js';
import { makeLineMaterial, polylineObject, sampledPath } from '../core/draw.js';

function build(css: Pt[], style: MarkupStyle, _opts: MarkupBuildOpts): THREE.Object3D[] {
  if (css.length < 2) return [];
  return [polylineObject(css, false, makeLineMaterial(style.color))];
}

export function markupFreehandPlugin(): DocumentPlugin {
  return {
    name: 'markup-freehand',
    dependencies: [MARKUP_CORE_NAME],
    install(ctx: DocumentContext): void {
      const core = ctx.plugins.get<MarkupCoreAPI>(MARKUP_CORE_NAME);
      if (!core) throw new Error('markup-freehand requires markup-core');
      core.registerTool({ tool: 'freehand', build, createInteraction: (c: MarkupToolContext) => sampledPath(c) });
    },
  };
}
