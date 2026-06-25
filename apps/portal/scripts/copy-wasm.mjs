#!/usr/bin/env node
/**
 * Copy WASM and worker assets the viewer needs at runtime into apps/portal/public/:
 *   - web-ifc.wasm + web-ifc-mt.wasm   → public/web-ifc/
 *   - @thatopen/fragments worker.mjs   → public/fragments/worker.mjs
 *
 * Runs as `predev` / `prebuild` so the files are always fresh when the dev
 * server or build starts. Pnpm puts these under .pnpm/, so we resolve via
 * `require.resolve` instead of guessing paths.
 */

import { mkdir, copyFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(pathToFileURL(join(here, 'noop.js')).href);

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

// web-ifc.wasm is required for the viewer to load any model; web-ifc-mt.wasm is
// the optional multi-threaded build. A missing REQUIRED asset must fail the
// build, not ship a bundle that 404s on the WASM at runtime.
const REQUIRED_WASM = new Set(['web-ifc.wasm']);

async function copyWebIfcWasm() {
  let wasmDir;
  try {
    const entry = require.resolve('web-ifc');
    wasmDir = dirname(entry);
  } catch (err) {
    throw new Error(`[copy-wasm] web-ifc is not installed — cannot copy web-ifc.wasm: ${String(err)}`);
  }
  const targetDir = join(here, '..', 'public', 'web-ifc');
  await mkdir(targetDir, { recursive: true });
  for (const name of ['web-ifc.wasm', 'web-ifc-mt.wasm']) {
    const src = join(wasmDir, name);
    if (!(await exists(src))) {
      if (REQUIRED_WASM.has(name)) {
        throw new Error(`[copy-wasm] required asset missing: ${src}`);
      }
      continue;
    }
    const dst = join(targetDir, name);
    await copyFile(src, dst);
    console.log(`[copy-wasm] ${src} → ${dst}`);
  }
}

async function copyFragmentsWorker() {
  let fragmentsDir;
  try {
    const entry = require.resolve('@thatopen/fragments');
    fragmentsDir = dirname(entry);
  } catch (err) {
    throw new Error(`[copy-wasm] @thatopen/fragments is not installed — cannot copy the fragments worker: ${String(err)}`);
  }
  // The worker file ships at dist/Worker/worker.mjs in @thatopen/fragments.
  const src = join(fragmentsDir, 'Worker', 'worker.mjs');
  if (!(await exists(src))) {
    throw new Error(`[copy-wasm] required fragments worker missing at ${src}`);
  }
  const targetDir = join(here, '..', 'public', 'fragments');
  await mkdir(targetDir, { recursive: true });
  const dst = join(targetDir, 'worker.mjs');
  await copyFile(src, dst);
  console.log(`[copy-wasm] ${src} → ${dst}`);
}

async function main() {
  await copyWebIfcWasm();
  await copyFragmentsWorker();
}

main().catch((err) => {
  console.error('[copy-wasm] failed:', err);
  process.exit(1);
});
