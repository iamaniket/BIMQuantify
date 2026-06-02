#!/usr/bin/env node
/**
 * Verify that en.json and nl.json catalogs in every app share the same
 * leaf-key structure. A drift (key added to one locale, forgotten in the
 * other) silently downgrades the missing-locale render to next-intl's
 * fallback — a class of bug that survives CI today because there is no
 * structural check.
 *
 * Scans every `apps/<app>/messages/{en,nl}.json` and reports the
 * symmetric difference. Exits 1 on any mismatch.
 *
 * The packages/i18n shared catalog (TS objects implementing
 * `SharedMessages`) is parity-checked by TypeScript at compile time, so
 * no separate handling is needed for it here.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const APPS_DIR = join(REPO_ROOT, 'apps');
const LOCALES = ['en', 'nl'];

function collectLeafKeys(obj, prefix = '') {
  const keys = new Set();
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix === '' ? k : `${prefix}.${k}`;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      for (const inner of collectLeafKeys(v, path)) keys.add(inner);
    } else {
      keys.add(path);
    }
  }
  return keys;
}

function inANotB(a, b) {
  return [...a].filter((k) => !b.has(k));
}

const failures = [];
let appsChecked = 0;

for (const app of readdirSync(APPS_DIR)) {
  const messagesDir = join(APPS_DIR, app, 'messages');
  let stat;
  try {
    stat = statSync(messagesDir);
  } catch {
    continue;
  }
  if (!stat.isDirectory()) continue;

  const catalogs = {};
  let readFailed = false;
  for (const locale of LOCALES) {
    const path = join(messagesDir, `${locale}.json`);
    try {
      catalogs[locale] = JSON.parse(readFileSync(path, 'utf8'));
    } catch (err) {
      failures.push(`${app}: cannot read or parse ${locale}.json — ${err.message}`);
      readFailed = true;
    }
  }
  if (readFailed) continue;
  appsChecked += 1;

  const keysByLocale = Object.fromEntries(
    Object.entries(catalogs).map(([loc, obj]) => [loc, collectLeafKeys(obj)]),
  );

  for (const a of LOCALES) {
    for (const b of LOCALES) {
      if (a === b) continue;
      const missing = inANotB(keysByLocale[a], keysByLocale[b]);
      if (missing.length > 0) {
        const lines = missing.map((k) => `    - ${k}`).join('\n');
        failures.push(
          `${app}/messages: ${missing.length} key(s) in ${a}.json missing from ${b}.json:\n${lines}`,
        );
      }
    }
  }
}

if (failures.length > 0) {
  console.error('i18n parity check FAILED:');
  for (const f of failures) console.error(`\n${f}`);
  console.error(
    '\nFix by adding the missing key(s) to the locale file that lacks them, or removing them from the file that has them.',
  );
  process.exit(1);
}

console.log(`i18n parity check OK (${appsChecked} app catalog${appsChecked === 1 ? '' : 's'} in sync)`);
