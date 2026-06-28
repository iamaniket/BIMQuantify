import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { buildCssVariables, cssVarNames, darkTheme, lightTheme } from '@bimdossier/design-tokens';

/**
 * Contract guard for the design-token CSS-variable pipeline:
 *
 *   `@bimdossier/design-tokens` (tokens.css)  →  defines the core `--vars`
 *   `@bimdossier/tailwind-config` (preset)    →  references them as `var(--x)`
 *   `apps/portal/src/app/globals.css`        →  defines the extra `--vars`
 *                                                (sidebar / brand / disc / header …)
 *
 * The namespace is split across those three sources, so a `var(--typo)` in the
 * tailwind preset silently resolves to nothing and ships a broken style — exactly
 * the failure CLAUDE.md's "Never invent CSS-variable names" rule warns about. This
 * test fails CI the moment the preset references a var that no source defines.
 *
 * It also folds in two cheap package-integrity checks (cssVarNames ↔ buildCssVariables
 * sync, and light/dark value parity) that TypeScript alone does not guarantee.
 *
 * Mirrors the parity-guard style of `i18n-parity.test.ts`.
 */

const require = createRequire(import.meta.url);

/** Minimal shape we introspect; `@bimdossier/tailwind-config` ships no type declarations. */
type TailwindPreset = {
  theme?: { extend?: Record<string, unknown> };
}

const preset = require('@bimdossier/tailwind-config') as TailwindPreset;

/**
 * Vars that are referenced by the preset but legitimately have no static CSS
 * declaration. Keep this list tiny and documented — anything added here stops
 * being guarded, so a real typo must never be silenced by an allowlist entry.
 */
const RUNTIME_INJECTED_ALLOWLIST = new Set<string>([
  // Fraunces display face, injected by next/font for the auth experience.
  // Documented in apps/portal/src/app/globals.css.
  '--font-display',
]);

/** Recursively collect every `var(--x)` name from a nested config value. */
function collectVarRefs(node: unknown, out: Set<string>): void {
  if (typeof node === 'string') {
    for (const match of node.matchAll(/var\(\s*(--[A-Za-z0-9-]+)/g)) {
      const name = match[1];
      if (name !== undefined) out.add(name);
    }
  } else if (Array.isArray(node)) {
    for (const item of node) collectVarRefs(item, out);
  } else if (node !== null && typeof node === 'object') {
    for (const value of Object.values(node)) collectVarRefs(value, out);
  }
}

/** Every `--name:` custom-property declaration in a CSS source. */
function collectVarDecls(css: string): Set<string> {
  const names = new Set<string>();
  for (const match of css.matchAll(/(--[A-Za-z0-9-]+)\s*:/g)) {
    const name = match[1];
    if (name !== undefined) names.add(name);
  }
  return names;
}

describe('CSS-variable contract (design-tokens → tailwind-config → globals.css)', () => {
  // Vars the design-tokens package defines (== the keys serialized into tokens.css).
  const packageVars = new Set(Object.keys(buildCssVariables(lightTheme)));

  // Vars the portal declares itself (sidebar, brand, disc, issue, header, fonts …).
  // Anchored on cwd (the portal package root under both the `test` script and turbo)
  // rather than import.meta.url, which Vitest does not expose as a file: URL.
  const globalsCss = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
  const globalsVars = collectVarDecls(globalsCss);

  // Vars the tailwind preset references via var(--x).
  const referencedVars = new Set<string>();
  collectVarRefs(preset.theme?.extend, referencedVars);

  it('tailwind preset references no undefined CSS var', () => {
    const defined = new Set([...packageVars, ...globalsVars, ...RUNTIME_INJECTED_ALLOWLIST]);
    const undefinedRefs = [...referencedVars].filter((v) => !defined.has(v)).sort();
    expect(
      undefinedRefs,
      `tailwind-config references CSS vars defined nowhere (add them to tokens.css or ` +
        `globals.css, or to RUNTIME_INJECTED_ALLOWLIST if injected at runtime): ` +
        undefinedRefs.join(', '),
    ).toEqual([]);
  });

  it('sanity-checks that something is actually being verified', () => {
    // Guards against the walk/parse silently producing empty sets (a green-by-vacuity
    // bug that would make the contract test meaningless).
    expect(referencedVars.size).toBeGreaterThan(0);
    expect(packageVars.size).toBeGreaterThan(0);
    expect(globalsVars.size).toBeGreaterThan(0);
  });

  it('cssVarNames stays in sync with buildCssVariables', () => {
    // The one type-unguarded seam: a cssVarNames entry the builder forgets to emit
    // (or vice-versa) compiles fine but drops a CSS var at runtime.
    const declared = new Set<string>(Object.values(cssVarNames));
    const emitted = new Set<string>(Object.keys(buildCssVariables(lightTheme)));
    const onlyDeclared = [...declared].filter((n) => !emitted.has(n)).sort();
    const onlyEmitted = [...emitted].filter((n) => !declared.has(n)).sort();
    expect(
      onlyDeclared,
      `cssVarNames entries not emitted by buildCssVariables: ${onlyDeclared.join(', ')}`,
    ).toEqual([]);
    expect(
      onlyEmitted,
      `buildCssVariables emits vars absent from cssVarNames: ${onlyEmitted.join(', ')}`,
    ).toEqual([]);
  });

  it('light & dark emit identical, non-empty values', () => {
    const light = buildCssVariables(lightTheme);
    const dark = buildCssVariables(darkTheme);
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());

    const blankLight = Object.entries(light)
      .filter(([, v]) => v.trim() === '')
      .map(([k]) => k);
    const blankDark = Object.entries(dark)
      .filter(([, v]) => v.trim() === '')
      .map(([k]) => k);
    expect(blankLight, `empty values in lightTheme: ${blankLight.join(', ')}`).toEqual([]);
    expect(blankDark, `empty values in darkTheme: ${blankDark.join(', ')}`).toEqual([]);
  });
});
