/**
 * Edge-overlay helper — fat-line edition.
 *
 * Creates LineSegments2 (screen-space triangle-expanded lines) from a
 * model item's geometry so the host plugin can show coloured edge
 * strokes on hover or selection. Uses Three.js "fat lines"
 * (LineMaterial + LineSegments2) instead of native GL_LINES so line
 * width actually works cross-platform.
 *
 * One instance per plugin; each manages its own set of line objects.
 */

import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';

import { LAYER_OVERLAY } from '../../core/layers.js';
import type { ItemId, ViewerContext } from '../../core/types.js';

export interface EdgeOverlayOptions {
  lineWidth?: number;
}

const itemKey = (i: ItemId): string => `${i.modelId}::${String(i.localId)}`;

export class EdgeOverlay {
  private readonly lines = new Map<string, LineSegments2[]>();
  private readonly lineWidth: number;

  constructor(opts: EdgeOverlayOptions = {}) {
    this.lineWidth = opts.lineWidth ?? 2;
  }

  async add(
    ctx: ViewerContext,
    items: ItemId[],
    color: THREE.Color,
  ): Promise<void> {
    const size = ctx.renderer.getSize(new THREE.Vector2());
    const dpr = ctx.renderer.getPixelRatio();

    const mat = new LineMaterial({
      color: color.getHex(),
      linewidth: this.lineWidth,
      worldUnits: false,
      depthTest: false,
      transparent: true,
      opacity: 0.85,
      resolution: new THREE.Vector2(size.x * dpr, size.y * dpr),
    });

    for (const item of items) {
      const k = itemKey(item);
      if (this.lines.has(k)) continue;

      const model = ctx.models().get(item.modelId);
      if (!model) continue;

      try {
        const meshDataArrays = await model.getItemsGeometry([item.localId]);
        const segments: LineSegments2[] = [];

        for (const meshDataArr of meshDataArrays) {
          for (const meshData of meshDataArr) {
            if (!meshData.positions) continue;

            const bufGeo = new THREE.BufferGeometry();
            bufGeo.setAttribute('position', new THREE.BufferAttribute(meshData.positions, 3));
            if (meshData.indices) {
              bufGeo.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
            }

            const edgesGeo = new THREE.EdgesGeometry(bufGeo, 30);
            bufGeo.dispose();

            const lineGeo = new LineSegmentsGeometry().fromEdgesGeometry(edgesGeo);
            edgesGeo.dispose();

            const line = new LineSegments2(lineGeo, mat.clone());
            line.renderOrder = 999;
            line.layers.set(LAYER_OVERLAY);
            line.name = `edge-overlay::${k}`;

            if (meshData.transform) {
              line.applyMatrix4(meshData.transform);
            }

            ctx.scene.add(line);
            segments.push(line);
          }
        }

        if (segments.length) {
          this.lines.set(k, segments);
        }
      } catch {
        // Item may not have geometry (e.g. spatial structure node).
      }
    }
  }

  updateResolution(w: number, h: number): void {
    for (const segs of this.lines.values()) {
      for (const seg of segs) {
        (seg.material as LineMaterial).resolution.set(w, h);
      }
    }
  }

  remove(ctx: ViewerContext, items: ItemId[]): void {
    for (const item of items) {
      const k = itemKey(item);
      const segs = this.lines.get(k);
      if (!segs) continue;
      for (const seg of segs) {
        ctx.scene.remove(seg);
        seg.geometry.dispose();
        (seg.material as THREE.Material).dispose();
      }
      this.lines.delete(k);
    }
  }

  clear(ctx: ViewerContext): void {
    for (const segs of this.lines.values()) {
      for (const seg of segs) {
        ctx.scene.remove(seg);
        seg.geometry.dispose();
        (seg.material as THREE.Material).dispose();
      }
    }
    this.lines.clear();
  }

  dispose(ctx: ViewerContext): void {
    this.clear(ctx);
  }
}
