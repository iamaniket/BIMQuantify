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

export class NoIfcInZipError extends Error {
  constructor() {
    super('NO_IFC_ENTRY_IN_ZIP');
    this.name = 'NoIfcInZipError';
  }
}

export async function extractIfcFromZip(bytes: Uint8Array): Promise<Uint8Array> {
  const entries = await new Promise<Unzipped>((resolve, reject) => {
    unzip(
      bytes,
      { filter: (file: UnzipFileInfo) => file.name.toLowerCase().endsWith('.ifc') },
      (err, data) => (err ? reject(err) : resolve(data)),
    );
  });
  // First `.ifc` in archive order. `noUncheckedIndexedAccess` makes the lookup
  // `Uint8Array | undefined`, so guard before returning.
  for (const name of Object.keys(entries)) {
    const data = entries[name];
    if (data !== undefined) return data;
  }
  throw new NoIfcInZipError();
}
