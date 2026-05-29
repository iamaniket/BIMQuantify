/**
 * OutlineCache — build the model's hard-edge outline once, store it.
 *
 * On demand (typically when a model finishes loading) it walks every item,
 * extracts hard edges, and stores them as one concatenated position buffer
 * plus a per-element index (which span of the buffer belongs to which
 * `localId`). The build runs in batches that yield to the event loop, so a
 * large model can stream/build slowly without freezing the UI — the whole
 * point is to pay this cost exactly once.
 *
 * From that index it can merge edges into a small set of
 * `LineSegmentsGeometry` chunks — either the full model (memoized, reused by
 * x-ray) or filtered to an arbitrary set of visible `localId`s (owned and
 * disposed by the caller). Only CPU-side geometry is stored (no
 * material/colour); consumers wrap chunks in their own `LineSegments2`.
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

/**
 * Per-model edge data: one concatenated position buffer + a per-element index
 * giving each element's span within it. `slotOf` maps localId → row in the
 * parallel `starts`/`lengths` arrays.
 */
interface EdgeIndex {
  positions: Float32Array;
  starts: Uint32Array;
  lengths: Uint32Array;
  slotOf: Map<number, number>;
}

export class OutlineCache {
  private readonly indices = new Map<string, EdgeIndex>();
  private readonly fullChunks = new Map<string, LineSegmentsGeometry[]>();
  private readonly building = new Map<string, Promise<void>>();

  has(modelId: string): boolean {
    return this.indices.has(modelId);
  }

  /**
   * Full-model merged chunks (every element), built lazily on first use and
   * memoized. Owned by the cache — callers MUST NOT dispose these. Used by
   * x-ray's "show all" outline.
   */
  getGeometries(modelId: string): LineSegmentsGeometry[] | undefined {
    const cached = this.fullChunks.get(modelId);
    if (cached) return cached;
    const index = this.indices.get(modelId);
    if (!index) return undefined;
    const chunks = this.buildGeometries(modelId, null);
    this.fullChunks.set(modelId, chunks);
    return chunks;
  }

  /**
   * Merge edges into chunks for a subset of the model.
   *
   * - `null` → the full model.
   * - `{ visible }` → only those localIds (used for isolation).
   * - `{ hidden }` → every element except those localIds (used for hide).
   *
   * The returned chunks are freshly allocated and OWNED BY THE CALLER
   * (dispose them when replaced) — except the memoized full set returned via
   * {@link getGeometries}.
   */
  buildGeometries(
    modelId: string,
    filter: { visible?: Set<number>; hidden?: Set<number> } | null,
  ): LineSegmentsGeometry[] {
    const index = this.indices.get(modelId);
    if (!index) return [];
    const { positions, starts, lengths, slotOf } = index;

    const sliceOf = (slot: number): Float32Array | null => {
      const len = lengths[slot]!;
      if (len === 0) return null;
      return positions.subarray(starts[slot]!, starts[slot]! + len);
    };

    const slices: Float32Array[] = [];
    if (filter?.visible) {
      for (const localId of filter.visible) {
        const slot = slotOf.get(localId);
        if (slot === undefined) continue;
        const s = sliceOf(slot);
        if (s) slices.push(s);
      }
    } else {
      const hidden = filter?.hidden;
      for (const [localId, slot] of slotOf) {
        if (hidden?.has(localId)) continue;
        const s = sliceOf(slot);
        if (s) slices.push(s);
      }
    }
    return mergeChunks(slices);
  }

  /** Resolves once the outline for `modelId` exists (or build is impossible). */
  whenReady(modelId: string): Promise<void> {
    if (this.indices.has(modelId)) return Promise.resolve();
    return this.building.get(modelId) ?? Promise.resolve();
  }

  /** Build once; concurrent/repeat calls share the same in-flight promise. */
  build(ctx: ViewerContext, modelId: string): Promise<void> {
    if (this.indices.has(modelId)) return Promise.resolve();
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
      this.indices.set(modelId, emptyIndex());
      return;
    }

    // Accumulate one element's edges at a time so we can record its span.
    const perElement: Float32Array[] = [];
    const elementIds: number[] = [];
    let totalFloats = 0;

    for (let i = 0; i < localIds.length; i += BATCH_SIZE) {
      const batch = localIds.slice(i, i + BATCH_SIZE);
      let meshArrays: RawMeshGeometry[][];
      try {
        meshArrays = await model.getItemsGeometry(batch);
      } catch {
        continue;
      }
      for (let j = 0; j < meshArrays.length; j++) {
        const localId = batch[j]!;
        const meshArr = meshArrays[j] ?? [];
        let elementFloats = 0;
        const parts: Float32Array[] = [];
        for (const meshData of meshArr) {
          const positions = extractEdgePositions(meshData);
          if (!positions) continue;
          parts.push(positions);
          elementFloats += positions.length;
        }
        if (elementFloats === 0) continue;
        const merged =
          parts.length === 1 ? parts[0]! : concat(parts, elementFloats);
        perElement.push(merged);
        elementIds.push(localId);
        totalFloats += elementFloats;
      }
      // Yield so model LOD streaming and the UI keep running during the build.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    this.indices.set(modelId, buildIndex(perElement, elementIds, totalFloats));
  }

  dispose(): void {
    for (const chunks of this.fullChunks.values()) {
      for (const geo of chunks) geo.dispose();
    }
    this.fullChunks.clear();
    this.indices.clear();
    this.building.clear();
  }
}

/** Merge position slices into `LineSegmentsGeometry` chunks under the float cap. */
function mergeChunks(slices: Float32Array[]): LineSegmentsGeometry[] {
  const chunks: LineSegmentsGeometry[] = [];
  let pending: Float32Array[] = [];
  let pendingFloats = 0;

  const flush = (): void => {
    if (pendingFloats === 0) return;
    const merged = concat(pending, pendingFloats);
    const geo = new LineSegmentsGeometry();
    geo.setPositions(merged);
    chunks.push(geo);
    pending = [];
    pendingFloats = 0;
  };

  for (const slice of slices) {
    if (pendingFloats + slice.length > MAX_FLOATS_PER_CHUNK) flush();
    pending.push(slice);
    pendingFloats += slice.length;
  }
  flush();
  return chunks;
}

function concat(parts: Float32Array[], totalFloats: number): Float32Array {
  const out = new Float32Array(totalFloats);
  let off = 0;
  for (const arr of parts) {
    out.set(arr, off);
    off += arr.length;
  }
  return out;
}

function buildIndex(
  perElement: Float32Array[],
  elementIds: number[],
  totalFloats: number,
): EdgeIndex {
  const positions = new Float32Array(totalFloats);
  const starts = new Uint32Array(perElement.length);
  const lengths = new Uint32Array(perElement.length);
  const slotOf = new Map<number, number>();

  let off = 0;
  for (let slot = 0; slot < perElement.length; slot++) {
    const arr = perElement[slot]!;
    positions.set(arr, off);
    starts[slot] = off;
    lengths[slot] = arr.length;
    slotOf.set(elementIds[slot]!, slot);
    off += arr.length;
  }
  return { positions, starts, lengths, slotOf };
}

function emptyIndex(): EdgeIndex {
  return {
    positions: new Float32Array(0),
    starts: new Uint32Array(0),
    lengths: new Uint32Array(0),
    slotOf: new Map(),
  };
}
