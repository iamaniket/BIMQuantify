/**
 * Framing-watch plugin — detects when the loaded model has left the 3D camera's
 * view and emits `camera:framing` so the host (portal) can show a "model out of
 * view" recovery affordance.
 *
 * Why this exists: entering the portal's Split view switches the camera to
 * first-person (looking forward, not top-down). Panning/orbiting can then slide
 * the model out of the frustum and the 3D pane goes blank with no indication.
 * This watcher surfaces that state; the portal renders a non-blocking pill whose
 * Recenter button drives `camera.recenter`.
 *
 * On-demand-render contract (CRITICAL): this plugin MUST NOT call
 * `ctx.requestRender()`. The viewer parks rendering in MANUAL mode when idle;
 * waking it from a passive watcher would create a never-settling loop. It only
 * reads camera/projection state, exactly like the minimap's `scheduleProject`.
 * It coalesces `camera:change` bursts into one evaluation per animation frame
 * and emits only on a `{inView, reason}` transition.
 *
 * Full-preset only (not in the mobile `minimal` set) — the embed has its own
 * recovery story.
 */

import * as THREE from 'three';

import type { Plugin, ViewerContext } from '../../../core/types.js';
import { classifyFraming, type FramingState } from './classify.js';

const NAME = 'framing-watch' as const;

const _box = new THREE.Box3();
const _mb = new THREE.Box3();

/** World bounding sphere of all loaded models; radius -1 sentinel when empty. */
function computeSceneSphere(ctx: ViewerContext, out: THREE.Sphere): THREE.Sphere {
  _box.makeEmpty();
  let any = false;
  for (const model of ctx.models().values()) {
    let mb = model.box;
    if (!mb || mb.isEmpty()) {
      mb = _mb.setFromObject(model.object);
    }
    if (!mb.isEmpty()) {
      _box.union(mb);
      any = true;
    }
  }
  if (!any || _box.isEmpty()) {
    out.center.set(0, 0, 0);
    out.radius = -1;
    return out;
  }
  return _box.getBoundingSphere(out);
}

export function framingWatchPlugin(): Plugin {
  let ctxRef: ViewerContext | null = null;
  let rafId: number | null = null;
  let last: FramingState | null = null;
  const sphere = new THREE.Sphere();
  const disposers: Array<() => void> = [];

  const compute = (ctx: ViewerContext): FramingState | null => {
    // The camera / world / fragments can be torn down between a frame being
    // scheduled and its rAF callback firing (HMR, route change, React
    // strict-mode remount). Reading `ctx.camera` then throws "No camera
    // initialized!" (and a disposed FragmentsModels can throw from
    // `ctx.models()`). A passive watcher must fail safe — skip the frame rather
    // than let the throw escape into the rAF handler, where it surfaces as an
    // uncaught error in the dev overlay.
    try {
      const camera = ctx.camera;
      computeSceneSphere(ctx, sphere);
      camera.updateMatrixWorld(true);
      return classifyFraming(camera, sphere);
    } catch {
      return null;
    }
  };

  const evaluate = (): void => {
    rafId = null;
    const ctx = ctxRef;
    if (!ctx) return;
    const state = compute(ctx);
    // Camera/world not ready (mid-teardown) — skip without emitting a misleading
    // transition; uninstall will cancel any further frames.
    if (!state) return;
    // Emit only on a {inView, reason} transition — `coverage` drifts every frame
    // and would otherwise spam the bus during any camera motion.
    if (last && last.inView === state.inView && last.reason === state.reason) {
      last = state;
      return;
    }
    last = state;
    ctx.events.emit('camera:framing', state);
  };

  const schedule = (): void => {
    if (rafId !== null) return;
    if (typeof requestAnimationFrame === 'undefined') {
      evaluate();
      return;
    }
    rafId = requestAnimationFrame(evaluate);
  };

  return {
    name: NAME,

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      // Re-evaluate whenever the camera moves or the scene's bounds can change.
      // NB: every handler is projection-math only — no requestRender (see header).
      disposers.push(ctx.events.on('camera:change', schedule));
      disposers.push(ctx.events.on('viewer:idle', schedule));
      disposers.push(ctx.events.on('model:loaded', schedule));
      disposers.push(ctx.events.on('model:unloaded', schedule));
      disposers.push(ctx.events.on('model:visibility', schedule));
      disposers.push(ctx.events.on('visibility:change', schedule));

      // Synchronous pull — lets the portal read the state on Split entry before
      // any camera:change fires (same role camera.getPose plays for the minimap).
      ctx.commands.register(
        'camera.getFramingState',
        () => compute(ctx),
        { title: 'Get model framing state' },
      );

      // Seed one evaluation so a late-mounting consumer still gets current state.
      schedule();
    },

    uninstall() {
      if (rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(rafId);
      }
      rafId = null;
      disposers.forEach((d) => d());
      disposers.length = 0;
      ctxRef = null;
      last = null;
    },
  };
}
