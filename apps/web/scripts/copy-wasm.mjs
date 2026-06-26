#!/usr/bin/env node
/**
 * Copy the worker asset the viewer needs at runtime into apps/web/public/:
 *   - @thatopen/fragments worker.mjs   → public/fragments/worker.mjs
 *
 * NOTE: we deliberately do NOT copy web-ifc.wasm here. The marketing snag
 * showcase only loads a pre-built .frag (public/models/demo.frag) through
 * @thatopen/fragments, so it never parses raw IFC and never fetches
 * web-ifc.wasm. (apps/portal still stages web-ifc because it can parse IFC
 * in-browser — that copy is intentionally separate.) The `web-ifc` package is
 * kept as a dependency only to satisfy the @thatopen/* peer constraint.
 *
 * Runs as `predev` / `prebuild` so the file is always fresh when the dev
 * server or build starts. Pnpm puts it under .pnpm/, so we resolve via
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
  await copyFragmentsWorker();
}

main().catch((err) => {
  console.error('[copy-wasm] failed:', err);
  process.exit(1);
});
