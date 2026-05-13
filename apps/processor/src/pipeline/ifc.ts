/**
 * Wrap web-ifc so it can be initialised once and reused across jobs.
 *
 * web-ifc is the WASM-based IFC parser that ThatOpen's higher-level libraries
 * sit on top of. It loads the IFC into memory and exposes a model handle we
 * can use to walk elements, properties, and the spatial structure.
 *
 * web-ifc on Node loads `web-ifc-node.wasm` from a path we set via
 * `SetWasmPath`. We resolve the package directory at runtime via
 * `require.resolve('web-ifc/package.json')` so the path stays correct whether
 * we run with tsx (src/) or compiled JS (dist/) or Docker (the Dockerfile
 * copies the wasm next to the compiled JS).
 */

import { createRequire } from 'node:module';
import path from 'node:path';

import { IfcAPI } from 'web-ifc';

import { type SupportedSchema, SUPPORTED_SCHEMAS } from '../config.js';

const require = createRequire(import.meta.url);

let apiPromise: Promise<IfcAPI> | null = null;

function resolveWasmDir(): string {
  // Point at the installed web-ifc package directory; both web-ifc.wasm and
  // web-ifc-node.wasm live there. `require.resolve('web-ifc/package.json')`
  // would be cleaner but web-ifc's `exports` field doesn't expose package.json
  // as a subpath. Resolving the main entry and taking its dirname works.
  const entry = require.resolve('web-ifc');
  return path.dirname(entry);
}

async function buildApi(): Promise<IfcAPI> {
  const ifcApi = new IfcAPI();
  const dir = resolveWasmDir();
  // SetWasmPath wants a trailing separator. Second arg `true` means
  // "absolute path" (don't prepend the script directory).
  ifcApi.SetWasmPath(`${dir}${path.sep}`, true);
  await ifcApi.Init();
  return ifcApi;
}

export async function getIfcApi(): Promise<IfcAPI> {
  if (apiPromise === null) {
    apiPromise = buildApi().catch((err: unknown) => {
      // Don't cache a poisoned promise — throw away so the next job retries
      // initialisation from scratch.
      apiPromise = null;
      throw err;
    });
  }
  return apiPromise;
}

export async function openModel(bytes: Uint8Array): Promise<{
  modelID: number;
  schema: SupportedSchema;
}> {
  const ifcApi = await getIfcApi();
  const modelID = ifcApi.OpenModel(bytes);
  const rawSchema = ifcApi.GetModelSchema(modelID).toUpperCase();
  if (!isSupportedSchema(rawSchema)) {
    ifcApi.CloseModel(modelID);
    throw new UnsupportedSchemaError(rawSchema);
  }
  return { modelID, schema: rawSchema };
}

export async function closeModel(modelID: number): Promise<void> {
  if (apiPromise === null) return;
  try {
    const ifcApi = await apiPromise;
    ifcApi.CloseModel(modelID);
  } catch {
    // If the api itself failed to init, there's nothing to close.
  }
}

export class UnsupportedSchemaError extends Error {
  constructor(public readonly schema: string) {
    super(`UNSUPPORTED_SCHEMA: ${schema}`);
    this.name = 'UnsupportedSchemaError';
  }
}

function isSupportedSchema(value: string): value is SupportedSchema {
  return (SUPPORTED_SCHEMAS as readonly string[]).includes(value);
}
