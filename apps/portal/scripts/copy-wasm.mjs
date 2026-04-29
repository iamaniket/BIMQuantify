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

async function copyWebIfcWasm() {
  let wasmDir;
  try {
    const entry = require.resolve('web-ifc');
    wasmDir = dirname(entry);
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
    const entry = require.resolve('@thatopen/fragments');
    fragmentsDir = dirname(entry);
  } catch (err) {
    console.error('[copy-wasm] @thatopen/fragments not installed — skipping worker', err);
    return;
  }
  // The worker file ships at dist/Worker/worker.mjs in @thatopen/fragments.
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
