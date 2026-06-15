import { describe, expect, it } from 'vitest';

import enMessages from '../../messages/en.json';
import nlMessages from '../../messages/nl.json';

/**
 * Parity guard for the portal's bilingual message catalogs, mirroring the API's
 * `apps/api/tests/test_i18n_catalog.py`. The bilingual hard rule (CLAUDE.md)
 * requires every user-visible string to exist in BOTH `nl` and `en`; this fails
 * CI the moment `messages/en.json` and `messages/nl.json` drift in keys or in
 * their `{placeholders}`, instead of leaking a raw key onto a user's screen.
 */

type Json = Record<string, unknown>;

/** Flatten a nested message object into dot-keyed leaf strings. */
function flatten(obj: Json, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(out, flatten(value as Json, path));
    } else {
      out[path] = String(value);
    }
  }
  return out;
}

/**
 * Extract the argument names from an ICU message. We walk brace depth and only
 * capture identifiers at depth 1 (the top-level `{name}` or `{count, plural, …}`),
 * so literal text inside plural/select sub-messages — e.g. the "No" in
 * `"{count, plural, =0 {No items} …}"` — is never mistaken for a placeholder.
 * This is the one deliberate deviation from the API's simpler `\{name\}` regex,
 * which the portal can't use because next-intl messages are ICU.
 */
function icuArgs(template: string): Set<string> {
  const args = new Set<string>();
  let depth = 0;
  for (let i = 0; i < template.length; i += 1) {
    const ch = template[i];
    if (ch === '{') {
      if (depth === 0) {
        const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*[,}]/.exec(template.slice(i + 1));
        const name = match === null ? undefined : match[1];
        if (name !== undefined) args.add(name);
      }
      depth += 1;
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
    }
  }
  return args;
}

describe('portal i18n catalogs (en/nl parity)', () => {
  const en = flatten(enMessages);
  const nl = flatten(nlMessages);

  it('have identical keys', () => {
    const enKeys = new Set(Object.keys(en));
    const nlKeys = new Set(Object.keys(nl));
    const onlyEn = [...enKeys].filter((k) => !nlKeys.has(k)).sort();
    const onlyNl = [...nlKeys].filter((k) => !enKeys.has(k)).sort();
    expect(onlyEn, `keys in en.json but missing from nl.json: ${onlyEn.join(', ')}`).toEqual([]);
    expect(onlyNl, `keys in nl.json but missing from en.json: ${onlyNl.join(', ')}`).toEqual([]);
  });

  it('have matching {placeholders} per key', () => {
    const mismatches: string[] = [];
    for (const [key, enValue] of Object.entries(en)) {
      const nlValue = nl[key];
      if (nlValue === undefined) continue; // key-parity test already reports this
      const enArgs = [...icuArgs(enValue)].sort();
      const nlArgs = [...icuArgs(nlValue)].sort();
      if (enArgs.join(',') !== nlArgs.join(',')) {
        mismatches.push(`${key}: en=[${enArgs.join(', ')}] vs nl=[${nlArgs.join(', ')}]`);
      }
    }
    expect(mismatches, `placeholder drift:\n  ${mismatches.join('\n  ')}`).toEqual([]);
  });

  it('have no empty string values', () => {
    const emptyEn = Object.entries(en).filter(([, v]) => v.trim() === '').map(([k]) => k);
    const emptyNl = Object.entries(nl).filter(([, v]) => v.trim() === '').map(([k]) => k);
    expect(emptyEn, `empty values in en.json: ${emptyEn.join(', ')}`).toEqual([]);
    expect(emptyNl, `empty values in nl.json: ${emptyNl.join(', ')}`).toEqual([]);
  });
});
