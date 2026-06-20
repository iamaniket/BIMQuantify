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

// No internal timeout here: this runs inside a worker thread and the host's
// JOB_TIMEOUT_MS deadline + worker.terminate() is the real cancellation (see
// worker-host.ts) — a Promise.race could only reject, never stop the work.
export async function generateFragments(
  bytes: Uint8Array,
  // Defaults to the configured JOB_GEOMETRY_THRESHOLD (1). Accepting an explicit
  // override keeps the function unit-testable across thresholds without env
  // juggling; the worker always uses the configured value.
  threshold: number = getConfig().JOB_GEOMETRY_THRESHOLD,
): Promise<Uint8Array> {
  const importer = new IfcImporter();
  importer.wasm = {
    path: `${resolveWasmDir()}${path.sep}`,
    absolute: true,
  };

  // The IfcImporter default (3000) skips elements with simple geometry
  // (furniture, fittings, fixtures) — they get metadata but no renderable tiles,
  // making them invisible in the viewer. We default to 1 (tessellate everything)
  // via JOB_GEOMETRY_THRESHOLD; see config.ts for the trade-off.
  importer.geometryProcessSettings.threshold = threshold;

  const result = await importer.process({ bytes });

  if (!(result instanceof Uint8Array)) {
    throw new Error('@thatopen/fragments returned non-Uint8Array fragments payload');
  }
  return result;
}
