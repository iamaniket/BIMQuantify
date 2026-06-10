/**
 * Outline artifact codec — decodes the processor's precomputed hard-edge
 * outline (binary format v2, stored gzip-compressed in S3).
 *
 * The artifact is INSTANCED: unique edge "templates" in LOCAL space plus a
 * per-element instance row carrying a 4x4 transform. The viewer keeps that
 * shape and places templates on the GPU per instance — it does NOT expand to
 * world space here. Decompressed layout, all little-endian:
 *
 *   bytes 0-7    ASCII magic "BIMOUTL2"
 *   uint32       templateCount
 *   uint32       instanceCount
 *   uint32       templateFloatsTotal
 *   Uint32Array  templateLengths[templateCount]       (floats/template, mult. of 6)
 *   Float32Array templatePositions[templateFloatsTotal] (local segment endpoints)
 *   Uint32Array  instanceLocalIds[instanceCount]
 *   Uint32Array  instanceTemplateIndex[instanceCount]
 *   Float32Array instanceTransforms[instanceCount*16] (column-major 4x4)
 *
 * Template start offsets are not stored — derived by prefix-summing lengths.
 * Any validation failure (or a missing native DecompressionStream) returns
 * null so the caller simply shows no edges.
 */

export interface DecodedOutline {
  /** One Float32Array per unique shape: local segment endpoints, multiple of 6. */
  templates: Float32Array[];
  instanceLocalIds: Uint32Array;
  instanceTemplateIndex: Uint32Array;
  /** Flat column-major 4x4 matrices, 16 floats per instance. */
  instanceTransforms: Float32Array;
}

const MAGIC = 'BIMOUTL2';
/** magic(8) + templateCount(4) + instanceCount(4) + templateFloatsTotal(4). */
const HEADER_BYTES = 20;

export async function decodeOutline(
  bytes: Uint8Array,
): Promise<DecodedOutline | null> {
  const raw = await gunzip(bytes);
  return raw ? parseOutline(raw) : null;
}

/** Native gunzip; null when unavailable or the stream is corrupt. */
async function gunzip(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined') return null;
  try {
    const ds = new DecompressionStream('gzip');
    const writer = ds.writable.getWriter();
    // Copy so the chunk is a plain-ArrayBuffer-backed BufferSource; swallow
    // writer rejections (a corrupt stream surfaces via the readable side).
    void writer.write(new Uint8Array(bytes)).catch(() => undefined);
    void writer.close().catch(() => undefined);
    const buffer = await new Response(ds.readable).arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

function parseOutline(raw: Uint8Array): DecodedOutline | null {
  if (raw.byteLength < HEADER_BYTES) return null;
  for (let i = 0; i < MAGIC.length; i++) {
    if (raw[i] !== MAGIC.charCodeAt(i)) return null;
  }

  // Typed-array views need element-size-aligned byteOffsets; re-copy when
  // the slice isn't 4-byte aligned (fresh gunzip output always is).
  const data = raw.byteOffset % 4 === 0 ? raw : raw.slice();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const templateCount = view.getUint32(8, true);
  const instanceCount = view.getUint32(12, true);
  const templateFloatsTotal = view.getUint32(16, true);
  const expectedBytes =
    HEADER_BYTES +
    templateCount * 4 +
    templateFloatsTotal * 4 +
    instanceCount * 4 +
    instanceCount * 4 +
    instanceCount * 64;
  if (data.byteLength !== expectedBytes) return null;

  let base = data.byteOffset + HEADER_BYTES;
  const templateLengths = new Uint32Array(data.buffer, base, templateCount);
  base += templateCount * 4;
  const templatePositions = new Float32Array(data.buffer, base, templateFloatsTotal);
  base += templateFloatsTotal * 4;
  // .slice() detaches from the transient inflate buffer so it can be GC'd.
  const instanceLocalIds = new Uint32Array(data.buffer, base, instanceCount).slice();
  base += instanceCount * 4;
  const instanceTemplateIndex = new Uint32Array(data.buffer, base, instanceCount).slice();
  base += instanceCount * 4;
  const instanceTransforms = new Float32Array(data.buffer, base, instanceCount * 16).slice();

  const templates: Float32Array[] = [];
  let tOff = 0;
  let sum = 0;
  for (let i = 0; i < templateCount; i++) {
    const len = templateLengths[i]!;
    if (len % 6 !== 0) return null;
    templates.push(templatePositions.slice(tOff, tOff + len));
    tOff += len;
    sum += len;
  }
  if (sum !== templateFloatsTotal) return null;

  for (let i = 0; i < instanceCount; i++) {
    if (instanceTemplateIndex[i]! >= templateCount) return null;
  }

  return { templates, instanceLocalIds, instanceTemplateIndex, instanceTransforms };
}
