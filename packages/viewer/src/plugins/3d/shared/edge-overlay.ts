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
import {
  applyClippingPlanes,
  buildClippingPlanes,
  type SectionPlaneData,
} from './clipping.js';
import { getModelWorldMatrix } from './modelCoordination.js';

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
    // Stable base DPR, not the motion-lowered live ratio (see getBasePixelRatio).
    const dpr = ctx.getBasePixelRatio();

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
      const localIds = modelItems.map((i) => i.localId);

      // Get precomputed edges from the backend via the outline cache.
      let cachedEdges: Map<number, Float32Array> | null = null;
      try {
        cachedEdges = (await ctx.commands.execute('outline.getItemEdges', {
          modelId,
          localIds,
        })) as Map<number, Float32Array> | null;
      } catch {
        // Outline plugin not registered or cache not ready.
        continue;
      }

      if (!cachedEdges || cachedEdges.size === 0) continue;

      // Edge positions are model-local; `autoCoordinate` translates federated
      // models, so position each line with the model's world matrix or the
      // overlay renders offset (same pattern as the outline plugin). Computed
      // once per model; identity for a single/first model — a no-op there.
      const worldMatrix = getModelWorldMatrix(ctx, modelId);

      for (const item of modelItems) {
        const positions = cachedEdges.get(item.localId);
        if (!positions) continue;

        const k = itemKey(item);
        const lineGeo = new LineSegmentsGeometry();
        lineGeo.setPositions(positions);
        const line = new LineSegments2(lineGeo, mat.clone());
        line.renderOrder = 999;
        line.layers.set(LAYER_OVERLAY);
        line.name = `edge-overlay::${k}`;
        worldMatrix.decompose(line.position, line.quaternion, line.scale);
        ctx.scene.add(line);
        this.lines.set(k, [line]);
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
