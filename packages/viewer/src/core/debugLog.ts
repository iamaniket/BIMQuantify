/**
 * debugLog — tiny, dependency-free, gated diagnostic logging for the viewer.
 *
 * Multi-model loads can hang, blank, or silently hide a model, and there was no
 * way to see *why* (culled? off-screen? failed to load?). These helpers add
 * structured, prefixed (`[viewer:<cat>]`) console output around the model
 * lifecycle, visibility/culling, scene bounds, and the drag/render path.
 *
 * Gating: OFF in production by default; ON automatically in development, or at
 * runtime anywhere via `window.__viewerDebug = true` or the `?viewerDebug=1`
 * URL param. Hot paths may call `vlog`/`vwarn` freely — both early-return on a
 * cheap boolean read when disabled. `vdump` is for explicit, user-invoked
 * snapshots and always prints (the `debug.dump` command).
 */

import type * as THREE from 'three';

declare global {
  // eslint-disable-next-line no-var
  var __viewerDebug: boolean | undefined;
}

// `process.env.NODE_ENV` is statically replaced by the bundler (Next/Turbopack/
// webpack) at build time, so in the browser it resolves to a literal string —
// we must reference it DIRECTLY (not via `globalThis.process`, which the
// replacement can't see and which is undefined in the browser, the bug that
// kept dev auto-on silently off). `declare const` satisfies the viewer's
// tsconfig (no @types/node); `devModeOn()` try/catches the case of a bundler
// that leaves the reference intact where `process` is genuinely undefined.
declare const process: { env: { NODE_ENV?: string } };

function devModeOn(): boolean {
  try {
    return process.env.NODE_ENV === 'development';
  } catch {
    return false;
  }
}

let cachedEnabled: boolean | null = null;
let firstTs = 0;

function computeEnabled(): boolean {
  if (typeof window !== 'undefined') {
    // URL opt-in/out (works in any build). Latch the global so subsequent calls
    // and other viewer instances on the page stay in sync without re-parsing.
    try {
      const v = new URLSearchParams(window.location.search).get('viewerDebug');
      if (v === '1') {
        globalThis.__viewerDebug = true;
        return true;
      }
      if (v === '0') {
        globalThis.__viewerDebug = false;
        return false;
      }
    } catch {
      /* malformed URL — ignore */
    }
    // Auto-on on local dev hosts. This is deliberately NOT gated on
    // `process.env.NODE_ENV`: a transpiled workspace package can't always rely
    // on the bundler replacing that literal, and the whole point is that the
    // logs "just appear" while developing. Set `window.__viewerDebug = false`
    // (or `?viewerDebug=0`) to silence them on a local prod build.
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host.endsWith('.local')) {
      return true;
    }
  }
  // Auto-on in development (SSR / non-browser builds).
  if (devModeOn()) return true;
  return false;
}

/**
 * Whether verbose viewer logging is on. An explicit `window.__viewerDebug`
 * (true OR false) always wins and is re-read each call, so toggling it from the
 * console takes effect immediately; otherwise the dev/URL result is cached so
 * per-call cost stays a single property read on hot paths.
 */
export function isViewerDebug(): boolean {
  const override = typeof globalThis !== 'undefined' ? globalThis.__viewerDebug : undefined;
  if (override === true) return true;
  if (override === false) return false;
  if (cachedEnabled === null) cachedEnabled = computeEnabled();
  return cachedEnabled;
}

function stamp(): string {
  if (typeof performance === 'undefined') return '';
  const now = performance.now();
  if (firstTs === 0) firstTs = now;
  return `+${(now - firstTs).toFixed(0)}ms`;
}

/** Gated info log. No-op unless {@link isViewerDebug}. */
export function vlog(cat: string, msg: string, data?: unknown): void {
  if (!isViewerDebug()) return;
  if (data !== undefined) console.log(`[viewer:${cat}] ${stamp()} ${msg}`, data);
  else console.log(`[viewer:${cat}] ${stamp()} ${msg}`);
}

/** Gated warning log. No-op unless {@link isViewerDebug}. */
export function vwarn(cat: string, msg: string, data?: unknown): void {
  if (!isViewerDebug()) return;
  if (data !== undefined) console.warn(`[viewer:${cat}] ${stamp()} ${msg}`, data);
  else console.warn(`[viewer:${cat}] ${stamp()} ${msg}`);
}

/**
 * Always-on error log — ignores the debug gate. Reserved for genuine failures
 * (e.g. a model that fails to load) that a user/developer must see by default,
 * unlike the chatty per-frame `vlog`/`vwarn` lifecycle telemetry. Never put hot-
 * path logging through this.
 */
export function verror(cat: string, msg: string, data?: unknown): void {
  if (data !== undefined) console.warn(`[viewer:${cat}] ${msg}`, data);
  else console.warn(`[viewer:${cat}] ${msg}`);
}

/**
 * Explicit snapshot dump — always prints, ignoring the gate, because it is only
 * ever called from a user-invoked command (`debug.dump`).
 */
export function vdump(label: string, data: unknown): void {
  console.log(`[viewer:dump] ${label}`, data);
}

const r3 = (n: number): number => Math.round(n * 1000) / 1000;

export interface BoxSummary {
  empty: boolean;
  size: [number, number, number];
  center: [number, number, number];
  min: [number, number, number];
  max: [number, number, number];
  maxDim: number;
}

/** Compact, log-friendly view of a Box3 (rounded; null/empty tolerant). */
export function boxSummary(box: THREE.Box3 | null | undefined): BoxSummary | null {
  if (!box) return null;
  const empty = box.isEmpty();
  const sx = empty ? 0 : box.max.x - box.min.x;
  const sy = empty ? 0 : box.max.y - box.min.y;
  const sz = empty ? 0 : box.max.z - box.min.z;
  return {
    empty,
    size: [r3(sx), r3(sy), r3(sz)],
    center: empty
      ? [0, 0, 0]
      : [r3((box.min.x + box.max.x) / 2), r3((box.min.y + box.max.y) / 2), r3((box.min.z + box.max.z) / 2)],
    min: [r3(box.min.x), r3(box.min.y), r3(box.min.z)],
    max: [r3(box.max.x), r3(box.max.y), r3(box.max.z)],
    maxDim: r3(Math.max(sx, sy, sz)),
  };
}
