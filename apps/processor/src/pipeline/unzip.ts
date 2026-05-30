/**
 * ifcZIP → IFC bytes.
 *
 * An ifcZIP is a plain zip that (by convention) wraps a single `.ifc` model.
 * The API can't schema-sniff a zip — its first bytes are the zip magic, not
 * `ISO-10303-21` — so it only confirms the upload is a real zip and defers the
 * actual IFC parsing to here. We decompress the first `*.ifc` entry and hand
 * those bytes to `openModel`, which still gates on a supported schema.
 *
 * fflate's `unzipSync` is synchronous and dependency-free; the `filter` hook
 * lets us skip decompressing non-IFC siblings (notes, thumbnails, macOS
 * resource forks) entirely.
 */

import { unzipSync, type UnzipFileInfo } from 'fflate';

export class NoIfcInZipError extends Error {
  constructor() {
    super('NO_IFC_ENTRY_IN_ZIP');
    this.name = 'NoIfcInZipError';
  }
}

export function extractIfcFromZip(bytes: Uint8Array): Uint8Array {
  const entries = unzipSync(bytes, {
    filter: (file: UnzipFileInfo) => file.name.toLowerCase().endsWith('.ifc'),
  });
  // First `.ifc` in archive order. `noUncheckedIndexedAccess` makes the lookup
  // `Uint8Array | undefined`, so guard before returning.
  for (const name of Object.keys(entries)) {
    const data = entries[name];
    if (data !== undefined) return data;
  }
  throw new NoIfcInZipError();
}
