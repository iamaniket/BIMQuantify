/**
 * OutlineCache — build the model's hard-edge outline once, store it.
 *
 * Edges come exclusively from the backend precomputed artifact
 * (processor's `.outline.bin`). Client-side edge extraction has been
 * removed — if the artifact is unavailable, edges won't be shown.
 *
 * From the cached index it can merge edges into a small set of
 * `LineSegmentsGeometry` chunks — either the full model (memoized, reused by
 * x-ray) or filtered to an arbitrary set of visible `localId`s (owned and
 * disposed by the caller). Only CPU-side geometry is stored (no
 * material/colour); consumers wrap chunks in their own `LineSegments2`.
 */

import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

import type { DecodedOutline } from './outline-codec.js';

// ~500k segments per chunk (6 floats/segment) — keeps each instanced buffer
// well under GPU limits while keeping the chunk count tiny.
const MAX_FLOATS_PER_CHUNK = 3_000_000;

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

  /**
   * Seed the index from the processor's precomputed artifact instead of
   * extracting edges client-side. `starts` is derived by prefix-summing
   * `lengths`. Once seeded, `build()` (including any in-flight run) is a
   * no-op for this model.
   */
  loadPrecomputed(modelId: string, decoded: DecodedOutline): void {
    if (this.indices.has(modelId)) return;
    const { localIds, lengths, positions } = decoded;
    const starts = new Uint32Array(lengths.length);
    const slotOf = new Map<number, number>();
    let off = 0;
    for (let slot = 0; slot < lengths.length; slot++) {
      starts[slot] = off;
      const len = lengths[slot]!;
      // The encoder omits zero-edge elements entirely; skip defensively.
      if (len > 0) slotOf.set(localIds[slot]!, slot);
      off += len;
    }
    this.indices.set(modelId, { positions, starts, lengths, slotOf });
  }

  /** Build once; concurrent/repeat calls share the same in-flight promise. */
  build(modelId: string): Promise<void> {
    // Client-side edge extraction is removed — edges must come from the
    // backend precomputed artifact. Return a no-op promise.
    if (this.indices.has(modelId)) return Promise.resolve();
    const existing = this.building.get(modelId);
    if (existing) return existing;
    const p = Promise.resolve();
    this.building.set(modelId, p);
    p.finally(() => this.building.delete(modelId));
    return p;
  }

  /**
   * Look up precomputed edge positions for a single element. Returns the
   * Float32Array sub-view into the cached buffer, or null when the model
   * isn't cached or the element has no hard edges.
   */
  getItemPositions(modelId: string, localId: number): Float32Array | null {
    const index = this.indices.get(modelId);
    if (!index) return null;
    const slot = index.slotOf.get(localId);
    if (slot === undefined) return null;
    const len = index.lengths[slot]!;
    if (len === 0) return null;
    return index.positions.subarray(index.starts[slot]!, index.starts[slot]! + len);
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
