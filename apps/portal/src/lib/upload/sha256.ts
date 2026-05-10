import { createSHA256 } from 'hash-wasm';

const CHUNK_BYTES = 8 * 1024 * 1024; // 8 MB

/**
 * Stream-compute the SHA-256 of a File. Reads in 8 MB chunks so we don't
 * materialise multi-GB uploads as a single ArrayBuffer (which would OOM the
 * tab). Calls onProgress with a [0, 1] fraction after each chunk.
 *
 * Returns lowercase hex (matches the API's `^[a-f0-9]{64}$` validator).
 */
export async function computeFileSha256(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<string> {
  const hasher = await createSHA256();
  hasher.init();

  const total = file.size;
  let read = 0;
  for (let offset = 0; offset < total; offset += CHUNK_BYTES) {
    const slice = file.slice(offset, Math.min(offset + CHUNK_BYTES, total));
    const buf = new Uint8Array(await slice.arrayBuffer());
    hasher.update(buf);
    read += buf.byteLength;
    onProgress?.(total === 0 ? 1 : read / total);
  }

  return hasher.digest('hex');
}
