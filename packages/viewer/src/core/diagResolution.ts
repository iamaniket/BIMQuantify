/**
 * TEMPORARY resolution-fluctuation diagnostics.
 *
 * Remove after debugging: delete this file and every `diag(...)` /
 * buffer-watcher call site (grep `diagResolution` and `diag(`).
 *
 * Disable at runtime without a rebuild by running in the browser console:
 *   window.__VIEWER_DIAG__ = false
 * (re-enable with `= true`). On by default while this file exists.
 */
import type * as THREE from 'three';

function on(): boolean {
  if (typeof window === 'undefined') return false;
  return (window as unknown as { __VIEWER_DIAG__?: boolean }).__VIEWER_DIAG__ !== false;
}

function now(): string {
  return typeof performance !== 'undefined' ? performance.now().toFixed(0) : '0';
}

export function diag(tag: string, ...args: unknown[]): void {
  if (!on()) return;
  // eslint-disable-next-line no-console
  console.log(`[VDIAG +${now()}ms] ${tag}`, ...args);
}

/**
 * Wrap renderer.setPixelRatio so every DPR change is logged with the caller
 * (second stack frame). This is the key probe: it shows WHO changes the device
 * pixel ratio and to what value, catching any setter beyond interactive-performance.
 */
export function patchPixelRatio(renderer: THREE.WebGLRenderer): void {
  const r = renderer as THREE.WebGLRenderer & { __vdiagPatched?: boolean };
  if (r.__vdiagPatched) return;
  r.__vdiagPatched = true;
  const orig = renderer.setPixelRatio.bind(renderer);
  renderer.setPixelRatio = (value: number): void => {
    if (on()) {
      const caller = new Error().stack?.split('\n')[2]?.trim() ?? '';
      diag(`setPixelRatio -> ${value.toFixed(3)}`, caller);
    }
    orig(value);
  };
}

/**
 * Returns a per-frame callback that logs only when the renderer's backing-store
 * size actually changes — i.e. the real on-screen resolution steps. Call it
 * from the rAF tick (runs regardless of render mode).
 */
export function makeBufferWatcher(): (renderer: THREE.WebGLRenderer) => void {
  let last = '';
  return (renderer: THREE.WebGLRenderer): void => {
    if (!on()) return;
    const c = renderer.domElement;
    const buf = `${c.width}x${c.height}`;
    if (buf === last) return;
    const prev = last;
    last = buf;
    diag(`buffer ${prev || '(init)'} -> ${buf} dpr=${renderer.getPixelRatio().toFixed(3)}`);
  };
}
