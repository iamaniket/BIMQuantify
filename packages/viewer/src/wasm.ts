/**
 * Resolve where the host app serves the web-ifc.wasm + fragments worker.
 *
 * Next.js host convention: copy both files into `public/`:
 *   - web-ifc.wasm        → `/web-ifc/` (default `wasmPath`)
 *   - fragments worker.mjs → `/fragments/worker.mjs` (default `workerUrl`)
 * Override either via `setWasmPath` / `setWorkerUrl` before mounting.
 */

let wasmPath = '/web-ifc/';
let workerUrl = '/fragments/worker.mjs';

export function getWasmPath(): string {
  return wasmPath;
}

export function setWasmPath(path: string): void {
  wasmPath = path.endsWith('/') ? path : `${path}/`;
}

export function getWorkerUrl(): string {
  return workerUrl;
}

export function setWorkerUrl(url: string): void {
  workerUrl = url;
}
