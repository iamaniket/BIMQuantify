#!/usr/bin/env node
/**
 * Language-drift guard for the bilingual (en/nl) message catalogs.
 *
 * The structural check (check-i18n-parity.mjs) and the portal/API parity tests
 * verify that keys and {placeholders} match across locales — but NONE of them
 * verify the value is actually in the right language. A Dutch string can sit in
 * en.json (or English in nl.json) and every existing gate passes. This catches
 * the most common, highest-signal instance of that bug: an identical multi-word
 * PHRASE in both locales, which is almost always a copy-paste / forgotten
 * translation (e.g. nl.json left holding "Write your post body in Markdown.").
 *
 * Scope: every apps/<app>/messages/{en,nl}.json (mirrors check-i18n-parity.mjs).
 *
 * Deliberately conservative to stay low-noise:
 *   - Only flags values where en === nl.
 *   - Only flags multi-WORD phrases (two letter-runs separated by whitespace);
 *     single words are skipped — cognates ("Privacy", "Audio"), proper nouns
 *     ("BimDossier") and acronyms ("PDF", "Wkb") are legitimately identical.
 *   - {placeholders} are stripped before the word test, so "v{n}" / "{a} · {b}"
 *     formats don't trip it.
 *   - An explicit allowlist (.i18n-allowlist.json) covers the handful of real
 *     phrases that are intentionally identical in both languages (statutory
 *     proper nouns, pure-format strings).
 *
 * A new identical phrase fails CI: translate it, or add it to the allowlist if
 * it is genuinely language-neutral.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '..');
const APPS_DIR = join(REPO_ROOT, 'apps');
const ALLOWLIST_PATH = join(REPO_ROOT, '.i18n-allowlist.json');
const LOCALES = ['en', 'nl'];

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix === '' ? k : `${prefix}.${k}`;
    // Recurse objects AND arrays (by index) so string leaves inside arrays —
    // e.g. an faq.items[].question — are compared, not stringified to junk.
    if (v !== null && typeof v === 'object') flatten(v, path, out);
    else out[path] = String(v);
  }
  return out;
}

/** Remove ICU placeholders so "{a} · {b}" / "v{n}" don't read as phrases. */
function stripPlaceholders(value) {
  return value.replace(/\{[^}]*\}/g, ' ');
}

/** True when the text has two letter-runs separated by whitespace (a phrase). */
function isMultiWord(text) {
  return /[A-Za-zÀ-ſ]+\s+[A-Za-zÀ-ſ]+/.test(text);
}

function loadAllowlist() {
  try {
    const raw = JSON.parse(readFileSync(ALLOWLIST_PATH, 'utf8'));
    return {
      values: new Set((raw.values ?? []).map((s) => String(s))),
      keys: new Set((raw.keys ?? []).map((s) => String(s))),
    };
  } catch {
    return { values: new Set(), keys: new Set() };
  }
}

const allow = loadAllowlist();
const failures = [];
let appsChecked = 0;

for (const app of readdirSync(APPS_DIR)) {
  const messagesDir = join(APPS_DIR, app, 'messages');
  try {
    if (!statSync(messagesDir).isDirectory()) continue;
  } catch {
    continue;
  }

  let en;
  let nl;
  try {
    en = flatten(JSON.parse(readFileSync(join(messagesDir, 'en.json'), 'utf8')));
    nl = flatten(JSON.parse(readFileSync(join(messagesDir, 'nl.json'), 'utf8')));
  } catch {
    continue; // parity check reports unreadable/unparseable catalogs
  }
  appsChecked += 1;

  for (const [key, enValue] of Object.entries(en)) {
    if (nl[key] !== enValue) continue; // only identical values are suspect
    const stripped = stripPlaceholders(enValue).trim();
    if (!isMultiWord(stripped)) continue; // single words/cognates/acronyms: skip
    if (allow.values.has(enValue)) continue;
    if (allow.keys.has(`${app}:${key}`)) continue;
    failures.push(`${app}:${key} = ${JSON.stringify(enValue)}`);
  }
}

if (failures.length > 0) {
  console.error('i18n value-drift check FAILED — identical en/nl phrases (likely untranslated):\n');
  for (const f of failures) console.error(`  ${f}`);
  console.error(
    '\nEach phrase above is identical in en.json and nl.json. Either translate the\n' +
      'Dutch (or English) value, or — if it is genuinely language-neutral (a statutory\n' +
      'proper noun, a pure format string) — add it to .i18n-allowlist.json\n' +
      '("values": ["<exact string>"]  or  "keys": ["<app>:<dotted.key>"]).',
  );
  process.exit(1);
}

console.log(`i18n value-drift check OK (${appsChecked} app catalog${appsChecked === 1 ? '' : 's'} scanned)`);
