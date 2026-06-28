/**
 * ifcZIP → IFC bytes.
 *
 * An ifcZIP is a plain zip that (by convention) wraps a single `.ifc` model.
 * The API can't schema-sniff a zip — its first bytes are the zip magic, not
 * `ISO-10303-21` — so it only confirms the upload is a real zip and defers the
 * actual IFC parsing to here. We decompress the first `*.ifc` entry and hand
 * those bytes to `openModel`, which still gates on a supported schema.
 *
 * fflate's async `unzip` runs the inflate off the main thread (its own worker),
 * so a multi-GiB ifcZIP doesn't block the worker's event loop for seconds —
 * which would otherwise starve Redis polling and the inter-thread messaging of
 * any concurrent job. The `filter` hook still skips decompressing non-IFC
 * siblings (notes, thumbnails, macOS resource forks) entirely.
 */

import { unzip, type Unzipped, type UnzipFileInfo } from 'fflate';

import { PermanentError } from './errors.js';

export class NoIfcInZipError extends Error {
  constructor() {
    super('NO_IFC_ENTRY_IN_ZIP');
    this.name = 'NoIfcInZipError';
  }
}

/**
 * Decompress the inner `.ifc` from an ifcZIP, refusing zip bombs.
 *
 * A KB-sized zip can declare (and inflate to) a multi-GB `.ifc` and OOM the
 * worker. `maxBytes` (the job's `JOB_MAX_FILE_BYTES`) caps the inner entry on
 * two fronts: the filter rejects any `.ifc` whose central-directory
 * `originalSize` already exceeds the cap, so the bomb is **never inflated**; and
 * a post-inflate `data.length` check backstops a lying central directory. Both
 * surface as a permanent `IFC_TOO_LARGE` (mirrors the DXF guard in `dxf.ts`) so
 * BullMQ does not retry an over-limit file.
 */
export async function extractIfcFromZip(
  bytes: Uint8Array,
  maxBytes: number,
): Promise<Uint8Array> {
  // Holder object (not a bare `let`) so TS keeps the union type across the
  // filter closure instead of narrowing the post-loop read to `never`.
  const oversize: { entry: { name: string; originalSize: number } | null } = { entry: null };
  const entries = await new Promise<Unzipped>((resolve, reject) => {
    unzip(
      bytes,
      {
        filter: (file: UnzipFileInfo) => {
          if (!file.name.toLowerCase().endsWith('.ifc')) return false;
          if (file.originalSize > maxBytes) {
            // Skip (don't inflate) the oversized entry; remember it so we can
            // raise a precise IFC_TOO_LARGE instead of a misleading NoIfc error.
            oversize.entry = { name: file.name, originalSize: file.originalSize };
            return false;
          }
          return true;
        },
      },
      (err, data) => (err ? reject(err) : resolve(data)),
    );
  });
  // First `.ifc` in archive order. `noUncheckedIndexedAccess` makes the lookup
  // `Uint8Array | undefined`, so guard before returning.
  for (const name of Object.keys(entries)) {
    const data = entries[name];
    if (data !== undefined) {
      if (data.length > maxBytes) {
        throw new PermanentError(
          `IFC_TOO_LARGE: decompressed ${data.length} bytes exceeds the ${maxBytes}-byte limit`,
          'validation',
        );
      }
      return data;
    }
  }
  if (oversize.entry !== null) {
    throw new PermanentError(
      `IFC_TOO_LARGE: inner entry ${oversize.entry.name} declares ` +
        `${oversize.entry.originalSize} bytes, exceeding the ${maxBytes}-byte limit`,
      'validation',
    );
  }
  throw new NoIfcInZipError();
}
