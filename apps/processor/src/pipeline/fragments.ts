/**
 * IFC → ThatOpen .frag conversion.
 *
 * `@thatopen/fragments` ships an `IfcImporter` that takes raw IFC bytes and
 * produces an optimised binary fragment bundle the viewer can render quickly
 * without re-parsing the IFC each time.
 *
 * IfcImporter spins up its OWN web-ifc IfcAPI internally and so needs its
 * own wasm-path config (separate from the IfcAPI we keep in `./ifc.ts`).
 * `importer.wasm = { path, absolute: true }` is the documented seam.
 */

import path from 'node:path';
import { createRequire } from 'node:module';

import { IfcImporter } from '@thatopen/fragments';

import { getConfig } from '../config.js';

const require = createRequire(import.meta.url);

function resolveWasmDir(): string {
  const entry = require.resolve('web-ifc');
  return path.dirname(entry);
}

export async function generateFragments(bytes: Uint8Array): Promise<Uint8Array> {
  const cfg = getConfig();
  const timeoutMs = cfg.JOB_TIMEOUT_MS;

  const importer = new IfcImporter();
  importer.wasm = {
    path: `${resolveWasmDir()}${path.sep}`,
    absolute: true,
  };

  // Default threshold (3000) skips elements with simple geometry
  // (furniture, fittings, fixtures) — they get metadata but no
  // renderable tiles, making them invisible in the viewer.
  importer.geometryProcessSettings.threshold = 1;

  const result = await Promise.race([
    importer.process({ bytes }),
    new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Fragment generation timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    }),
  ]);

  if (!(result instanceof Uint8Array)) {
    throw new Error('@thatopen/fragments returned non-Uint8Array fragments payload');
  }
  return result;
}
