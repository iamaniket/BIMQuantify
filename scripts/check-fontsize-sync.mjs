#!/usr/bin/env node
/**
 * Guard the @bimdossier/ui font-size ↔ tailwind-merge contract.
 *
 * packages/tailwind-config/index.cjs defines a CUSTOM font-size scale
 * (text-body2, text-label2, text-h3, …). tailwind-merge only knows Tailwind's
 * built-in sizes, so any custom size NOT registered in cn()'s extendTailwindMerge
 * gets misclassified as a text-COLOR — and tailwind-merge then silently DROPS a
 * real color class merged before it (e.g. a primary button loses `text-primary-
 * foreground` and renders black). The failure is invisible at build/type-check.
 *
 * This check makes the preset the single source of the scale and fails CI if the
 * registered list in packages/ui/src/lib/cn.ts (CUSTOM_TEXT_SIZES) drifts from
 * it in EITHER direction (a new preset key not registered, or a stale registered
 * key not in the preset).
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

// Require the preset by ABSOLUTE path (it's a dependency-free object literal), so
// this works regardless of how pnpm links the workspace package into node_modules.
const PRESET_PATH = resolve(REPO_ROOT, 'packages/tailwind-config/index.cjs');
const CN_PATH = resolve(REPO_ROOT, 'packages/ui/src/lib/cn.ts');

const preset = require(PRESET_PATH);
const presetSizes = Object.keys(preset?.theme?.extend?.fontSize ?? {});

if (presetSizes.length === 0) {
  console.error(
    'font-size sync check FAILED: no theme.extend.fontSize found in packages/tailwind-config/index.cjs',
  );
  process.exit(1);
}

const cnSrc = readFileSync(CN_PATH, 'utf8');
const arrayMatch = cnSrc.match(/CUSTOM_TEXT_SIZES\s*=\s*\[([\s\S]*?)\]/);
if (!arrayMatch) {
  console.error(
    'font-size sync check FAILED: could not find the `CUSTOM_TEXT_SIZES = [ ... ]` array in\n' +
      'packages/ui/src/lib/cn.ts. The check-fontsize-sync script expects that named export.',
  );
  process.exit(1);
}

const registered = [...arrayMatch[1].matchAll(/['"]([\w-]+)['"]/g)].map((m) => m[1]);
const registeredSet = new Set(registered);
const presetSet = new Set(presetSizes);

const missing = presetSizes.filter((k) => !registeredSet.has(k)); // in preset, not in cn.ts
const stale = registered.filter((k) => !presetSet.has(k)); // in cn.ts, not in preset

const failures = [];
if (missing.length > 0) {
  failures.push(
    'These fontSize keys exist in packages/tailwind-config/index.cjs but are NOT\n' +
      'registered in CUSTOM_TEXT_SIZES (packages/ui/src/lib/cn.ts). tailwind-merge will\n' +
      'misclassify `text-<key>` as a color and silently drop real colors:\n' +
      missing.map((k) => `    - ${k}`).join('\n'),
  );
}
if (stale.length > 0) {
  failures.push(
    'These sizes are registered in CUSTOM_TEXT_SIZES (packages/ui/src/lib/cn.ts) but no\n' +
      'longer exist in the Tailwind preset — remove them or add them to the preset:\n' +
      stale.map((k) => `    - ${k}`).join('\n'),
  );
}

if (failures.length > 0) {
  console.error('font-size sync check FAILED:\n');
  for (const f of failures) console.error(`${f}\n`);
  process.exit(1);
}

console.log(`font-size sync check OK (${presetSizes.length} custom sizes registered in cn())`);
