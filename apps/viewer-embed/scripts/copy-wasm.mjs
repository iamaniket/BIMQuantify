#!/usr/bin/env node
/**
 * Copy the runtime assets @bimstitch/viewer needs into apps/viewer-embed/public/:
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

async function copyWebIfcWasm() {
  let wasmDir;
  try {
    wasmDir = dirname(require.resolve('web-ifc'));
  } catch (err) {
    console.error('[copy-wasm] web-ifc not installed — skipping web-ifc.wasm', err);
    return;
  }
  const targetDir = join(here, '..', 'public', 'web-ifc');
  await mkdir(targetDir, { recursive: true });
  for (const name of ['web-ifc.wasm', 'web-ifc-mt.wasm']) {
    const src = join(wasmDir, name);
    if (!(await exists(src))) continue;
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
    console.error('[copy-wasm] @thatopen/fragments not installed — skipping worker', err);
    return;
  }
  // The worker ships at dist/Worker/worker.mjs in @thatopen/fragments.
  const src = join(fragmentsDir, 'Worker', 'worker.mjs');
  if (!(await exists(src))) {
    console.error(`[copy-wasm] expected worker at ${src} but it is missing`);
    return;
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
