#!/usr/bin/env node
/**
 * Copy the runtime assets @bimdossier/viewer needs into apps/viewer-embed/public/:
 *   - web-ifc.wasm + web-ifc-mt.wasm   → public/web-ifc/
 *   - @thatopen/fragments worker.mjs   → public/fragments/worker.mjs
 *
 * Identical in spirit to apps/portal/scripts/copy-wasm.mjs — Vite copies
 * everything under public/ into dist/ verbatim, and `base: './'` makes the
 * runtime references relative (`./web-ifc/`, `./fragments/worker.mjs` — see
 * src/main.tsx) so the built bundle resolves them from its own folder when
 * loaded off the device filesystem inside react-native-webview.
 *
 * Runs as `predev` / `prebuild`. web-ifc + @thatopen/fragments are devDeps of
 * this package so `require.resolve` finds them under pnpm's .pnpm store.
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

// web-ifc.wasm is required; web-ifc-mt.wasm is the optional multi-threaded build.
const REQUIRED_WASM = new Set(['web-ifc.wasm']);

async function copyWebIfcWasm() {
  let wasmDir;
  try {
    wasmDir = dirname(require.resolve('web-ifc'));
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
    fragmentsDir = dirname(require.resolve('@thatopen/fragments'));
  } catch (err) {
    throw new Error(`[copy-wasm] @thatopen/fragments is not installed — cannot copy the fragments worker: ${String(err)}`);
  }
  // The worker ships at dist/Worker/worker.mjs in @thatopen/fragments.
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
