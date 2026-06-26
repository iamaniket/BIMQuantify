#!/usr/bin/env node
/**
 * Guard against the invented-CSS-variable bug in packages/brand.
 *
 * The token layer (packages/design-tokens) defines `--success`, `--warning`,
 * `--error`, `--foreground-tertiary`, etc. — there is NO `--color-`-prefixed
 * variant. A `var(--color-success, #hex)` therefore never resolves and the
 * hardcoded hex fallback always wins, silently making the surface theme-blind
 * (see FALLBACKS_AUDIT.md). Per CLAUDE.md's styling hard-rule, never invent
 * CSS-variable names.
 *
 * Scans packages/brand/src for the `var(--color-` antipattern. Exits 1 on any
 * match so a reintroduction fails CI instead of rendering a plausible-but-
 * theme-blind component.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const BRAND_SRC = join(REPO_ROOT, 'packages', 'brand', 'src');
const BAD = /var\(\s*--color-/;

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...walk(full));
    } else if (/\.(tsx?|css)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

const failures = [];
let stat;
try {
  stat = statSync(BRAND_SRC);
} catch {
  stat = null;
}

if (stat?.isDirectory()) {
  for (const file of walk(BRAND_SRC)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (BAD.test(line)) {
        failures.push(`${relative(REPO_ROOT, file)}:${i + 1}: ${line.trim()}`);
      }
    });
  }
}

if (failures.length > 0) {
  console.error(
    'Found var(--color-...) references in packages/brand (these CSS vars do not\n' +
    'exist; the hex fallback always wins → theme-blind). Use the real token name\n' +
    '(var(--success), var(--foreground-tertiary), ...) or a Tailwind class:\n',
  );
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('brand-token check OK (no var(--color-...) in packages/brand)');
