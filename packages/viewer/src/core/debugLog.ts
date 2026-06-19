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

let cachedEnabled: boolean | null = null;
let firstTs = 0;

function computeEnabled(): boolean {
  // URL opt-in (works in any build). Also latch the global so subsequent calls
  // and other viewer instances on the page stay enabled without re-parsing.
  if (typeof window !== 'undefined') {
    try {
      if (new URLSearchParams(window.location.search).get('viewerDebug') === '1') {
        globalThis.__viewerDebug = true;
        return true;
      }
    } catch {
      /* malformed URL — ignore */
    }
  }
  // Auto-on in development. Reach `process` via globalThis so this module needs
  // no @types/node (the viewer package's tsconfig doesn't pull it in).
  const proc = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process;
  if (proc?.env?.NODE_ENV === 'development') return true;
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
