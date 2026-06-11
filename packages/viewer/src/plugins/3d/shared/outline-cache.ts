/**
 * OutlineCache — hold a model's INSTANCED hard-edge outline.
 *
 * Edges come exclusively from the backend precomputed artifact (processor's
 * `.outline.bin`, format v2): unique LOCAL-space "templates" + a per-element
 * instance row carrying a 4x4 transform. The cache keeps that instanced shape
 * (so {@link InstancedOutline} can upload each template to the GPU once) and
 * also expands it on demand into world-space `LineSegmentsGeometry` chunks for
 * the consumers that need flat positions:
 *   - x-ray's "show all" outline (full model, memoized);
 *   - the CPU-merged fallback for low-fan-out templates;
 *   - hover/select edge overlay (one element at a time).
 *
 * Client-side edge extraction has been removed — if the artifact is
 * unavailable, edges won't be shown.
 */

import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';

import type { DecodedOutline } from './outline-codec.js';

// ~500k segments per chunk (6 floats/segment) — keeps each instanced buffer
// well under GPU limits while keeping the chunk count tiny.
const MAX_FLOATS_PER_CHUNK = 3_000_000;

/** One element placement of a template: its localId + column-major 4x4. */
export interface InstanceRow {
  localId: number;
  transform: Float32Array;
}

/** Per-model instanced outline: unique templates + who places them. */
export interface OutlineModel {
  /** Local-space segment endpoints per unique shape (each a multiple of 6). */
  templates: Float32Array[];
  /** index = templateIndex → the elements that place that template. */
  instancesByTemplate: InstanceRow[][];
  /** localId → its placement rows (an element may have several meshes). */
  rowsByLocalId: Map<number, { templateIndex: number; transform: Float32Array }[]>;
}

/**
 * Apply a column-major 4x4 (placement, no perspective) to every (x,y,z) triple
 * in `src`, writing world-space coordinates into `dst` starting at `off`.
 */
export function transformSegments(
  src: Float32Array,
  m: Float32Array,
  dst: Float32Array,
  off: number,
): void {
  const m0 = m[0]!, m1 = m[1]!, m2 = m[2]!;
  const m4 = m[4]!, m5 = m[5]!, m6 = m[6]!;
  const m8 = m[8]!, m9 = m[9]!, m10 = m[10]!;
  const m12 = m[12]!, m13 = m[13]!, m14 = m[14]!;
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i]!, y = src[i + 1]!, z = src[i + 2]!;
    dst[off + i] = m0 * x + m4 * y + m8 * z + m12;
    dst[off + i + 1] = m1 * x + m5 * y + m9 * z + m13;
    dst[off + i + 2] = m2 * x + m6 * y + m10 * z + m14;
  }
}

export class OutlineCache {
  private readonly models = new Map<string, OutlineModel>();
  private readonly fullChunks = new Map<string, LineSegmentsGeometry[]>();

  has(modelId: string): boolean {
    return this.models.has(modelId);
  }

  /** Raw instanced data for the GPU renderer. Owned by the cache — read only. */
  getModel(modelId: string): OutlineModel | undefined {
    return this.models.get(modelId);
  }

  /**
   * Full-model merged chunks (every element), built lazily on first use and
   * memoized. Owned by the cache — callers MUST NOT dispose these. Used by
   * x-ray's "show all" outline.
   */
  getGeometries(modelId: string): LineSegmentsGeometry[] | undefined {
    const cached = this.fullChunks.get(modelId);
    if (cached) return cached;
    if (!this.models.has(modelId)) return undefined;
    const chunks = this.buildGeometries(modelId, null);
    this.fullChunks.set(modelId, chunks);
    return chunks;
  }

  /**
   * Expand visible elements to world space and merge into `LineSegmentsGeometry`
   * chunks under the float cap.
   *
   * - `null` → the full model.
   * - `{ visible }` → only those localIds (isolation).
   * - `{ hidden }` → every element except those localIds (hide).
   *
   * Returned chunks are freshly allocated and OWNED BY THE CALLER (dispose them
   * when replaced) — except the memoized full set returned via
   * {@link getGeometries}.
   */
  buildGeometries(
    modelId: string,
    filter: { visible?: Set<number>; hidden?: Set<number> } | null,
  ): LineSegmentsGeometry[] {
    const model = this.models.get(modelId);
    if (!model) return [];

    const slices: Float32Array[] = [];
    const pushItem = (localId: number): void => {
      const s = this.getItemPositions(modelId, localId);
      if (s) slices.push(s);
    };

    if (filter?.visible) {
      for (const localId of filter.visible) pushItem(localId);
    } else {
      const hidden = filter?.hidden;
      for (const localId of model.rowsByLocalId.keys()) {
        if (hidden?.has(localId)) continue;
        pushItem(localId);
      }
    }
    return mergeChunks(slices);
  }

  /** Outlines are seeded synchronously from the artifact, so this is immediate;
   * kept async (and accepting a modelId) for call-site compatibility. */
  whenReady(_modelId?: string): Promise<void> {
    return Promise.resolve();
  }

  /**
   * Seed from the processor's precomputed v2 artifact. Builds the per-template
   * instance lists and the localId→rows index. Once seeded, repeat calls are a
   * no-op for this model.
   */
  loadPrecomputed(modelId: string, decoded: DecodedOutline): void {
    if (this.models.has(modelId)) return;
    const { templates, instanceLocalIds, instanceTemplateIndex, instanceTransforms } = decoded;

    const instancesByTemplate: InstanceRow[][] = templates.map(() => []);
    const rowsByLocalId = new Map<number, { templateIndex: number; transform: Float32Array }[]>();

    for (let i = 0; i < instanceLocalIds.length; i++) {
      const localId = instanceLocalIds[i]!;
      const templateIndex = instanceTemplateIndex[i]!;
      // View into the owned instanceTransforms buffer — no copy.
      const transform = instanceTransforms.subarray(i * 16, i * 16 + 16);
      instancesByTemplate[templateIndex]?.push({ localId, transform });
      let rows = rowsByLocalId.get(localId);
      if (!rows) {
        rows = [];
        rowsByLocalId.set(localId, rows);
      }
      rows.push({ templateIndex, transform });
    }

    this.models.set(modelId, { templates, instancesByTemplate, rowsByLocalId });
  }

  /** No-op: client-side edge extraction was removed — edges come from the
   * artifact. Kept so existing call sites resolve cleanly. */
  build(): Promise<void> {
    return Promise.resolve();
  }

  /**
   * World-space hard-edge positions for a single element, expanded on demand by
   * applying each of its instance transforms to the referenced template.
   * Returns null when the model isn't cached or the element has no edges.
   */
  getItemPositions(modelId: string, localId: number): Float32Array | null {
    const model = this.models.get(modelId);
    if (!model) return null;
    const rows = model.rowsByLocalId.get(localId);
    if (!rows || rows.length === 0) return null;

    let total = 0;
    for (const r of rows) total += model.templates[r.templateIndex]?.length ?? 0;
    if (total === 0) return null;

    const out = new Float32Array(total);
    let off = 0;
    for (const r of rows) {
      const tmpl = model.templates[r.templateIndex];
      if (!tmpl || tmpl.length === 0) continue;
      transformSegments(tmpl, r.transform, out, off);
      off += tmpl.length;
    }
    return out;
  }

  dispose(): void {
    for (const chunks of this.fullChunks.values()) {
      for (const geo of chunks) geo.dispose();
    }
    this.fullChunks.clear();
    this.models.clear();
  }
}

/** Merge position slices into `LineSegmentsGeometry` chunks under the float cap. */
export function mergeChunks(slices: Float32Array[]): LineSegmentsGeometry[] {
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
