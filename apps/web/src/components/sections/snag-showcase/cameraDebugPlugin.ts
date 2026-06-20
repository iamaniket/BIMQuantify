import type { Plugin, ViewerContext } from '@bimstitch/viewer';

type Vec3Like = { x: number; y: number; z: number };

const r3 = (n: number): number => Math.round(n * 1000) / 1000;
const v3 = (v: Vec3Like): Vec3Like => ({ x: r3(v.x), y: r3(v.y), z: r3(v.z) });

/**
 * Debug-only camera/model logger for the marketing 3D showcase. Sibling of
 * `autoRotatePlugin` / `cameraZoomPlugin`; wired into `<SnagViewer>`'s plugin
 * array only behind a dev/`?camdebug` gate, so it never ships to visitors.
 *
 * Purpose: dial in "bigger + shifted right" WITHOUT guessing. The showcase look
 * is relative knobs on `cameraZoomPlugin` (`factorWide`, `panFraction`, plus
 * `polarDeg`/`azimuthDeg`) — responsive by construction, not an absolute camera
 * pose. On each user interaction this prints the raw camera/model state AND the
 * *derived* knob values, so you orbit to taste and paste the numbers straight in.
 *
 * Why a plugin and not a `handle.events` subscription in SnagViewer:
 *   - The user-only `controlstart`/`controlend` events live on
 *     `ctx.cameraControls`, which isn't exposed through `ViewerHandle`. Idle
 *     auto-rotate moves the camera via `cameraControls.rotate(...)` — that fires
 *     camera-controls' `update` (and the viewer's `camera:change`) but NOT
 *     `controlend`. So logging on `controlend` is silent during the spin and
 *     fires only on real drag — exactly the requirement.
 */
export function cameraDebugPlugin(): Plugin {
  let ctx: ViewerContext | null = null;

  const snapshot = (label: string): void => {
    if (ctx === null) return;
    const cc = ctx.cameraControls;

    // No `three` import (matches the sibling plugins) — clone the camera's own
    // Vector3 as scratch for the out-param getters.
    const target = cc.getTarget(ctx.camera.position.clone());
    const focalOffset = cc.getFocalOffset(ctx.camera.position.clone());
    const distance = cc.distance;
    const wide = typeof window !== 'undefined' && window.innerWidth >= 1024;

    // Perspective fov maths — same as cameraZoomPlugin, so the derived knobs
    // invert its formulas exactly.
    const cam = ctx.camera as unknown as { isPerspectiveCamera?: boolean; fov?: number; aspect?: number };
    const persp = Boolean(cam.isPerspectiveCamera) && !!cam.fov && !!cam.aspect;
    const halfV = persp ? ((cam.fov as number) * Math.PI) / 180 / 2 : NaN;
    const halfH = persp ? Math.atan(Math.tan(halfV) * (cam.aspect as number)) : NaN;
    const tanH = persp ? Math.tan(halfH) : NaN;

    // Union of every loaded model's world AABB → center / size / radius.
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    let any = false;
    for (const m of ctx.models().values()) {
      const b = m.box;
      if (!b || b.isEmpty()) continue;
      any = true;
      minX = Math.min(minX, b.min.x);
      minY = Math.min(minY, b.min.y);
      minZ = Math.min(minZ, b.min.z);
      maxX = Math.max(maxX, b.max.x);
      maxY = Math.max(maxY, b.max.y);
      maxZ = Math.max(maxZ, b.max.z);
    }
    const size: Vec3Like = { x: maxX - minX, y: maxY - minY, z: maxZ - minZ };
    const radius = Math.hypot(size.x, size.y, size.z) / 2;
    const model = any
      ? {
          center: v3({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 }),
          size: v3(size),
          radius: r3(radius),
        }
      : null;

    // Auto-fit distance D0 (same as cameraZoomPlugin): fits the bounding sphere
    // in the limiting (smaller) half-angle. The knobs are relative to this.
    const d0 = persp && any && radius > 0 ? radius / Math.sin(Math.min(halfV, halfH)) : NaN;
    const okD0 = Number.isFinite(d0) && d0 > 0;

    // Derived cameraZoomPlugin knobs:
    //   factorWide: zoomIn dollies to D0*(1-f), so f = 1 - distance/D0.
    //   panFraction == on-screen shift (focal offset sized against final distance).
    const factorWide = okD0 ? r3(1 - distance / (d0 as number)) : null;
    const screenShiftFraction =
      Number.isFinite(tanH) && tanH !== 0 ? r3(-focalOffset.x / (distance * tanH)) : null;
    const panFraction = screenShiftFraction;

    // eslint-disable-next-line no-console
    console.log(`[snag-cam] ${label}`, {
      position: v3(ctx.camera.position),
      target: v3(target),
      distance: r3(distance),
      focalOffset: v3(focalOffset),
      zoom: r3(ctx.camera.zoom),
      azimuthDeg: r3((cc.azimuthAngle * 180) / Math.PI),
      polarDeg: r3((cc.polarAngle * 180) / Math.PI),
      branch: wide ? 'wide (desktop)' : 'narrow (mobile)',
      model,
      // ↓ Paste these into cameraZoomPlugin({ ... }) in SnagViewer.tsx.
      suggestedKnobs: {
        factorWide, // → factorWide (desktop) / factor (mobile)
        panFraction, // → panFraction (desktop right-shift)
        polarDeg: r3((cc.polarAngle * 180) / Math.PI), // → polarDeg (tilt)
        azimuthDeg: r3((cc.azimuthAngle * 180) / Math.PI), // → azimuthDeg (facing)
        fitDistance: okD0 ? r3(d0 as number) : '(no perspective/model yet)',
      },
    });
  };

  const onControlEnd = (): void => snapshot('interaction end');

  return {
    name: 'showcase-camera-debug',
    install(context: ViewerContext): void {
      ctx = context;
      // User-only: fires on drag release, never during programmatic spin.
      context.cameraControls.addEventListener('controlend', onControlEnd);
      // On-demand snapshot (e.g. to read the framed pose without dragging).
      context.commands.register('showcase.debug.snapshot', () => snapshot('snapshot'), {
        title: 'Log the current showcase camera + model state',
      });
    },
    uninstall(): void {
      if (ctx !== null) {
        ctx.cameraControls.removeEventListener('controlend', onControlEnd);
      }
      ctx = null;
    },
  };
}
