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

import { LAYER_OVERLAY } from '../../../core/layers.js';
import type { ItemId, ViewerContext } from '../../../core/types.js';
import { extractEdgePositions } from './edges.js';
import {
  applyClippingPlanes,
  buildClippingPlanes,
  type SectionPlaneData,
} from './clipping.js';

export interface EdgeOverlayOptions {
  lineWidth?: number;
}

const itemKey = (i: ItemId): string => `${i.modelId}::${String(i.localId)}`;

export class EdgeOverlay {
  private readonly lines = new Map<string, LineSegments2[]>();
  private readonly lineWidth: number;
  private currentPlanes: THREE.Plane[] = [];
  private clipCount = 0;
  private sectionUnsub: (() => void) | null = null;

  constructor(opts: EdgeOverlayOptions = {}) {
    this.lineWidth = opts.lineWidth ?? 2;
  }

  /**
   * Lazily wire this overlay to the section plugin (idempotent). Keeps the
   * overlay's line materials clipped to the active section planes — both ones
   * created later and ones already painted when the plane moves.
   */
  private ensureSectionSync(ctx: ViewerContext): void {
    if (this.sectionUnsub) return;
    this.sectionUnsub = ctx.events.on('section:change', ({ planes }) => {
      this.setClippingPlanes(planes);
    });
    void ctx.commands
      .execute('section.list')
      .then((planes) => {
        if (Array.isArray(planes)) this.setClippingPlanes(planes as SectionPlaneData[]);
      })
      .catch(() => undefined);
  }

  private setClippingPlanes(planes: SectionPlaneData[]): void {
    this.currentPlanes = buildClippingPlanes(planes);
    const prev = this.clipCount;
    for (const segs of this.lines.values()) {
      for (const seg of segs) {
        applyClippingPlanes(seg.material as LineMaterial, this.currentPlanes, prev);
      }
    }
    this.clipCount = this.currentPlanes.length;
  }

  async add(
    ctx: ViewerContext,
    items: ItemId[],
    color: THREE.Color,
  ): Promise<void> {
    this.ensureSectionSync(ctx);
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
    applyClippingPlanes(mat, this.currentPlanes, -1);

    const grouped = new Map<string, ItemId[]>();
    for (const item of items) {
      const k = itemKey(item);
      if (this.lines.has(k)) continue;
      let arr = grouped.get(item.modelId);
      if (!arr) {
        arr = [];
        grouped.set(item.modelId, arr);
      }
      arr.push(item);
    }

    for (const [modelId, modelItems] of grouped) {
      const model = ctx.models().get(modelId);
      if (!model) continue;

      const localIds = modelItems.map((i) => i.localId);

      try {
        const meshDataArrays = await model.getItemsGeometry(localIds);

        for (let idx = 0; idx < modelItems.length; idx++) {
          const item = modelItems[idx]!;
          const k = itemKey(item);
          const meshDataArr = meshDataArrays[idx] ?? [];
          const segments: LineSegments2[] = [];

          for (const meshData of meshDataArr) {
            // Edges are extracted with the mesh transform baked into world
            // space, so the line object itself stays at identity.
            const positions = extractEdgePositions(meshData);
            if (!positions) continue;

            const lineGeo = new LineSegmentsGeometry();
            lineGeo.setPositions(positions);

            const line = new LineSegments2(lineGeo, mat.clone());
            line.renderOrder = 999;
            line.layers.set(LAYER_OVERLAY);
            line.name = `edge-overlay::${k}`;

            ctx.scene.add(line);
            segments.push(line);
          }

          if (segments.length) {
            this.lines.set(k, segments);
          }
        }
      } catch {
        // Some items may not resolve geometry (eg spatial tree nodes).
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
    this.sectionUnsub?.();
    this.sectionUnsub = null;
  }
}
