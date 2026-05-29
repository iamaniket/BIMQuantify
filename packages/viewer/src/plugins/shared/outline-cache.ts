/**
 * OutlineCache — build the model's hard-edge outline once, store it.
 *
 * On demand (typically when a model finishes loading) it walks every item,
 * extracts hard edges, and bakes them into a small set of merged
 * `LineSegmentsGeometry` chunks. The build runs in batches that yield to
 * the event loop, so a large model can stream/build slowly without freezing
 * the UI — the whole point is to pay this cost exactly once.
 *
 * Only CPU-side geometry is stored (no material/colour). Consumers wrap it
 * in their own `LineSegments2` with whatever look they need (grey depth-off
 * lines for x-ray, dark depth-tested lines for the idle/last frame), and a
 * single geometry can back many objects, so memory cost is ~one copy of the
 * edge data regardless of how many features use it.
 */

import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

import type { ViewerContext } from '../../core/types.js';
import { extractEdgePositions, type RawMeshGeometry } from './edges.js';

const BATCH_SIZE = 1000;
// ~500k segments per chunk (6 floats/segment) — keeps each instanced buffer
// well under GPU limits while keeping the chunk count tiny.
const MAX_FLOATS_PER_CHUNK = 3_000_000;

interface ModelWithGeometry {
  getLocalIds(): Promise<Iterable<number>>;
  getItemsGeometry(ids: number[]): Promise<RawMeshGeometry[][]>;
}

export class OutlineCache {
  private readonly geometries = new Map<string, LineSegmentsGeometry[]>();
  private readonly building = new Map<string, Promise<void>>();

  has(modelId: string): boolean {
    return this.geometries.has(modelId);
  }

  getGeometries(modelId: string): LineSegmentsGeometry[] | undefined {
    return this.geometries.get(modelId);
  }

  /** Resolves once the outline for `modelId` exists (or build is impossible). */
  whenReady(modelId: string): Promise<void> {
    if (this.geometries.has(modelId)) return Promise.resolve();
    return this.building.get(modelId) ?? Promise.resolve();
  }

  /** Build once; concurrent/repeat calls share the same in-flight promise. */
  build(ctx: ViewerContext, modelId: string): Promise<void> {
    if (this.geometries.has(modelId)) return Promise.resolve();
    const existing = this.building.get(modelId);
    if (existing) return existing;
    const p = this.run(ctx, modelId).finally(() => {
      this.building.delete(modelId);
    });
    this.building.set(modelId, p);
    return p;
  }

  private async run(ctx: ViewerContext, modelId: string): Promise<void> {
    const model = ctx.models().get(modelId) as unknown as
      | ModelWithGeometry
      | undefined;
    if (!model) return;

    let localIds: number[];
    try {
      localIds = [...(await model.getLocalIds())];
    } catch {
      this.geometries.set(modelId, []);
      return;
    }

    const chunks: LineSegmentsGeometry[] = [];
    let pending: Float32Array[] = [];
    let pendingFloats = 0;

    const flush = (): void => {
      if (pendingFloats === 0) return;
      const merged = new Float32Array(pendingFloats);
      let off = 0;
      for (const arr of pending) {
        merged.set(arr, off);
        off += arr.length;
      }
      const geo = new LineSegmentsGeometry();
      geo.setPositions(merged);
      chunks.push(geo);
      pending = [];
      pendingFloats = 0;
    };

    for (let i = 0; i < localIds.length; i += BATCH_SIZE) {
      const batch = localIds.slice(i, i + BATCH_SIZE);
      let meshArrays: RawMeshGeometry[][];
      try {
        meshArrays = await model.getItemsGeometry(batch);
      } catch {
        continue;
      }
      for (const meshArr of meshArrays) {
        for (const meshData of meshArr ?? []) {
          const positions = extractEdgePositions(meshData);
          if (!positions) continue;
          if (pendingFloats + positions.length > MAX_FLOATS_PER_CHUNK) flush();
          pending.push(positions);
          pendingFloats += positions.length;
        }
      }
      // Yield so model LOD streaming and the UI keep running during the build.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    flush();

    this.geometries.set(modelId, chunks);
  }

  dispose(): void {
    for (const chunks of this.geometries.values()) {
      for (const geo of chunks) geo.dispose();
    }
    this.geometries.clear();
    this.building.clear();
  }
}
