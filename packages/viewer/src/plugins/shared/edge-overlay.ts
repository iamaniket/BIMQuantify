/**
 * Edge-overlay helper. Creates THREE.LineSegments from a model item's
 * geometry so the host plugin can show coloured edge strokes on hover
 * or selection. One instance per plugin; each manages its own set of
 * line objects in the scene.
 */

import * as THREE from 'three';

import type { ItemId, ViewerContext } from '../../core/types.js';

const itemKey = (i: ItemId): string => `${i.modelId}::${String(i.localId)}`;

export class EdgeOverlay {
  private readonly lines = new Map<string, THREE.LineSegments[]>();
  private readonly geoCache = new Map<string, THREE.EdgesGeometry>();

  async add(
    ctx: ViewerContext,
    items: ItemId[],
    color: THREE.Color,
  ): Promise<void> {
    const mat = new THREE.LineBasicMaterial({ color, depthTest: true });

    for (const item of items) {
      const k = itemKey(item);
      if (this.lines.has(k)) continue;

      const model = ctx.models().get(item.modelId);
      if (!model) continue;

      try {
        const meshDataArrays = await model.getItemsGeometry([item.localId]);
        const segments: THREE.LineSegments[] = [];

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

            const line = new THREE.LineSegments(edgesGeo, mat.clone());
            line.renderOrder = 999;
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
    for (const geo of this.geoCache.values()) geo.dispose();
    this.geoCache.clear();
  }
}
