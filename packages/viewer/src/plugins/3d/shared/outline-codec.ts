/**
 * Outline artifact codec — decodes the processor's precomputed hard-edge
 * outline (binary format v1, stored gzip-compressed in S3).
 *
 * Decompressed layout, all little-endian:
 *
 *   bytes 0-7    ASCII magic "BIMOUTL1"
 *   uint32       elementCount
 *   uint32       totalFloats
 *   Uint32Array  localIds[elementCount]
 *   Uint32Array  lengths[elementCount]   (floats per element, multiples of 6)
 *   Float32Array positions[totalFloats]  (hard-edge segment endpoints,
 *                                         per-mesh transforms already baked)
 *
 * `starts[]` is not stored — callers derive it by prefix-summing `lengths`.
 * Any validation failure (or a missing native DecompressionStream) returns
 * null so callers fall back to client-side edge extraction.
 */

export interface DecodedOutline {
  localIds: Uint32Array;
  lengths: Uint32Array;
  positions: Float32Array;
}

const MAGIC = 'BIMOUTL1';
/** magic(8) + elementCount(4) + totalFloats(4). */
const HEADER_BYTES = 16;

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
  const elementCount = view.getUint32(8, true);
  const totalFloats = view.getUint32(12, true);
  const expectedBytes = HEADER_BYTES + elementCount * 8 + totalFloats * 4;
  if (data.byteLength !== expectedBytes) return null;

  // The array payloads are read with typed-array views — platform little
  // endian, the same assumption the fragments binary already makes.
  const localIds = new Uint32Array(
    data.buffer,
    data.byteOffset + HEADER_BYTES,
    elementCount,
  );
  const lengths = new Uint32Array(
    data.buffer,
    data.byteOffset + HEADER_BYTES + elementCount * 4,
    elementCount,
  );
  const positions = new Float32Array(
    data.buffer,
    data.byteOffset + HEADER_BYTES + elementCount * 8,
    totalFloats,
  );

  let sum = 0;
  for (let i = 0; i < elementCount; i++) {
    const len = lengths[i]!;
    if (len % 6 !== 0) return null;
    sum += len;
  }
  if (sum !== totalFloats) return null;

  return { localIds, lengths, positions };
}
