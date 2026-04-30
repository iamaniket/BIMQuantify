/**
 * pivot-rotate plugin — Forge/Navisworks-style orbit pivot.
 *
 * On every drag-rotate start, the geometry point under the cursor becomes
 * the camera-controls orbit point for that drag. Pan (truck) speed is
 * also calibrated to that pivot's depth so panning feels 1:1 with the
 * object regardless of zoom. A small screen-space sphere marks the
 * pivot during the drag and fades out on release.
 *
 * How latency is avoided: `pick()` is async (worker raycast, ~5–50 ms).
 * Awaiting it inside pointerdown lets camera-controls start orbiting
 * around the *old* pivot for several frames. Instead we maintain a
 * hover cache, throttled to ~150 ms, fed by the existing
 * `pointer:move` bus event. On pointerdown the pivot is read
 * synchronously from the cache.
 *
 * Why a capture-phase pointerdown listener: mouse-bindings attaches in
 * bubble phase, and camera-controls 2.x also bubbles. A capture-phase
 * listener fires first, so `setOrbitPoint` lands before camera-controls
 * snapshots its rotation reference for the gesture.
 */

import * as THREE from 'three';

import { pick } from '../../core/Raycaster.js';
import type { Plugin, ViewerContext } from '../../core/types.js';

const NAME = 'pivot-rotate' as const;

export interface PivotIndicatorOptions {
  enabled?: boolean;
  /** 0xRRGGBB. Default: 0xff8a3d (matches selection accent). */
  color?: number;
  /** Diameter in screen pixels. Default 14. */
  pixelSize?: number;
  /** ms to fade out after the rotate-drag ends. Default 250. */
  fadeOutMs?: number;
}

export interface PivotRotateOptions {
  /** ms between background picks driven by pointer:move. Default 150. */
  hoverPickThrottleMs?: number;
  /**
   * Multiplier applied to (pivotDistance / referenceDistance) on truckSpeed.
   * Default 2.0. Lower → slower pan; higher → faster.
   */
  truckSpeedFactor?: number;
  /** [min, max] clamp on the computed truckSpeed. Default [0.25, 50]. */
  truckSpeedClamp?: [number, number];
  /**
   * Pivot indicator (small sphere drawn at the orbit point during a drag).
   * Pass `false` to disable. Defaults are sensible.
   */
  indicator?: PivotIndicatorOptions | false;
  /** console.log every pivot update. Default false. */
  debug?: boolean;
}

const INDICATOR_DEFAULTS: Required<PivotIndicatorOptions> = {
  enabled: true,
  color: 0xff8a3d,
  pixelSize: 14,
  fadeOutMs: 250,
};

const DEFAULTS = {
  hoverPickThrottleMs: 150,
  truckSpeedFactor: 2.0,
  truckSpeedClamp: [0.25, 50] as [number, number],
  debug: false,
};

type ButtonName = 'left' | 'middle' | 'right';

const BUTTON_NAME: Record<number, ButtonName> = {
  0: 'left',
  1: 'middle',
  2: 'right',
};

/**
 * Build a soft-edged white circle as an alpha map. The sprite material
 * tints it with the requested color, so the texture is colour-agnostic.
 */
function makeCircleTexture(): THREE.CanvasTexture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const cx = size / 2;
  const grad = g.createRadialGradient(cx, cx, 0, cx, cx, cx);
  grad.addColorStop(0.0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,1)');
  grad.addColorStop(0.75, 'rgba(255,255,255,0.65)');
  grad.addColorStop(1.0, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function pivotRotatePlugin(options: PivotRotateOptions = {}): Plugin {
  const opts = {
    ...DEFAULTS,
    ...options,
  };
  const indicatorOpts: Required<PivotIndicatorOptions> | null =
    options.indicator === false
      ? null
      : { ...INDICATOR_DEFAULTS, ...(options.indicator ?? {}) };

  let cleanup: (() => void) | null = null;

  return {
    name: NAME,

    install(ctx: ViewerContext) {
      const controls = ctx.cameraControls as unknown as {
        setOrbitPoint: (x: number, y: number, z: number) => void;
        getTarget: (out: THREE.Vector3) => THREE.Vector3;
        truckSpeed: number;
        distance: number;
        mouseButtons: { left: number; middle: number; right: number; wheel: number };
        constructor: { ACTION?: Record<string, number> };
      };
      const canvas = ctx.canvas;
      const camera = ctx.camera;
      const scene = ctx.scene;

      const ACTION = controls.constructor.ACTION;
      if (!ACTION || typeof ACTION.ROTATE !== 'number') {
        console.warn(
          '[pivot-rotate] camera-controls ACTION enum unavailable — plugin disabled.',
        );
        return;
      }
      const ROTATE = ACTION.ROTATE;

      const defaultTruckSpeed = controls.truckSpeed;
      let referenceDistance = controls.distance > 0 ? controls.distance : 1;

      // Hover cache. lastHit is in world space; null means "no geometry
      // under the cursor at the last pick".
      let lastHit: THREE.Vector3 | null = null;
      let pickInflight = false;
      let lastPickAt = 0;

      const maybePick = (ndc: { x: number; y: number }): void => {
        const now = Date.now();
        if (pickInflight) return;
        if (now - lastPickAt < opts.hoverPickThrottleMs) return;
        pickInflight = true;
        lastPickAt = now;
        void pick(ctx, ndc)
          .then((res) => {
            if (res) {
              lastHit = new THREE.Vector3(res.point.x, res.point.y, res.point.z);
            } else {
              lastHit = null;
            }
          })
          .catch(() => {
            lastHit = null;
          })
          .finally(() => {
            pickInflight = false;
          });
      };

      const offMove = ctx.events.on('pointer:move', ({ ndc }) => {
        maybePick(ndc);
      });

      // Recompute referenceDistance once a model frames the camera, so
      // the pivot-depth ratio is sensible for the loaded model's scale.
      const offModel = ctx.events.on('model:loaded', () => {
        // Defer one frame — Viewer.frameModel() runs after model:loaded
        // emits, so reading distance immediately would still be stale.
        requestAnimationFrame(() => {
          if (controls.distance > 0) referenceDistance = controls.distance;
        });
      });

      const computeSceneCenter = (): THREE.Vector3 | null => {
        const box = new THREE.Box3();
        let any = false;
        for (const model of ctx.models().values()) {
          let mb = model.box;
          if (!mb || mb.isEmpty()) {
            mb = new THREE.Box3().setFromObject(model.object);
          }
          if (!mb.isEmpty()) {
            box.union(mb);
            any = true;
          }
        }
        if (!any) return null;
        return box.getCenter(new THREE.Vector3());
      };

      // ── Pivot indicator ───────────────────────────────────────────────
      // Screen-space sphere drawn at the active pivot. Lives across the
      // whole drag, then fades out. depthTest off so it's never occluded
      // (matches Forge — you're orbiting around it, you should always see it).
      let sprite: THREE.Sprite | null = null;
      let spriteTex: THREE.CanvasTexture | null = null;
      let pivotWorld = new THREE.Vector3();
      let isHolding = false; // mouse currently down on a rotate gesture
      let fadeStartedAt = 0; // 0 means "not fading"
      let raf = 0;

      if (indicatorOpts && indicatorOpts.enabled) {
        spriteTex = makeCircleTexture();
        const mat = new THREE.SpriteMaterial({
          map: spriteTex,
          color: indicatorOpts.color,
          transparent: true,
          depthTest: false,
          depthWrite: false,
          opacity: 0,
        });
        sprite = new THREE.Sprite(mat);
        sprite.renderOrder = 999;
        sprite.visible = false;
        scene.add(sprite);
      }

      /**
       * Per-frame loop: keep the sprite at constant screen-pixel size
       * (perspective foreshortening would otherwise shrink it as the
       * camera dollies out) and progress the fade-out animation.
       */
      const tick = (): void => {
        raf = 0;
        if (!sprite || !indicatorOpts) return;

        // Size: world units per pixel at the sprite's depth, for a
        // perspective camera. (Orthographic would need a different formula
        // — fine to skip; SimpleCamera is perspective.)
        const persp = camera as THREE.PerspectiveCamera;
        const dist = camera.position.distanceTo(pivotWorld);
        const fovRad = (persp.fov * Math.PI) / 180;
        const worldPerPixel =
          (2 * Math.tan(fovRad / 2) * dist) / canvas.clientHeight;
        const s = indicatorOpts.pixelSize * worldPerPixel;
        sprite.scale.setScalar(s);
        sprite.position.copy(pivotWorld);

        // Opacity: full while holding, linear fade after release.
        const mat = sprite.material as THREE.SpriteMaterial;
        let alive = false;
        if (isHolding) {
          mat.opacity = 1;
          alive = true;
        } else if (fadeStartedAt > 0) {
          const elapsed = performance.now() - fadeStartedAt;
          const t = Math.min(1, elapsed / indicatorOpts.fadeOutMs);
          mat.opacity = 1 - t;
          if (t >= 1) {
            sprite.visible = false;
            fadeStartedAt = 0;
          } else {
            alive = true;
          }
        }
        if (alive) raf = requestAnimationFrame(tick);
      };

      const showIndicator = (p: THREE.Vector3): void => {
        if (!sprite) return;
        pivotWorld.copy(p);
        sprite.visible = true;
        fadeStartedAt = 0;
        (sprite.material as THREE.SpriteMaterial).opacity = 1;
        if (!raf) raf = requestAnimationFrame(tick);
      };

      const startFade = (): void => {
        if (!sprite || !sprite.visible) return;
        if (fadeStartedAt > 0) return;
        fadeStartedAt = performance.now();
        if (!raf) raf = requestAnimationFrame(tick);
      };

      const applyPivot = (p: THREE.Vector3, source: string): void => {
        controls.setOrbitPoint(p.x, p.y, p.z);
        const dist = camera.position.distanceTo(p);
        const raw = defaultTruckSpeed * (dist / referenceDistance) * opts.truckSpeedFactor;
        const [lo, hi] = opts.truckSpeedClamp;
        controls.truckSpeed = Math.min(hi, Math.max(lo, raw));
        if (opts.debug) {
          console.log(
            `[pivot-rotate] pivot=${source} (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}) dist=${dist.toFixed(2)} truckSpeed=${controls.truckSpeed.toFixed(3)}`,
          );
        }
        showIndicator(p);
      };

      const onPointerDown = (ev: PointerEvent): void => {
        const buttonName = BUTTON_NAME[ev.button];
        if (!buttonName) return;
        if (controls.mouseButtons[buttonName] !== ROTATE) return;

        isHolding = true;
        if (lastHit) {
          applyPivot(lastHit, 'hover-cache');
          return;
        }
        const center = computeSceneCenter();
        if (center) {
          applyPivot(center, 'scene-centre');
          return;
        }
        // No hit, no models — pivot stays where it was; don't show indicator.
        isHolding = false;
      };

      // Pointerup listens on window, not canvas: a drag often ends with
      // the cursor outside the canvas, in which case canvas pointerup
      // never fires.
      const onPointerUp = (): void => {
        if (!isHolding) return;
        isHolding = false;
        startFade();
      };

      canvas.addEventListener('pointerdown', onPointerDown, { capture: true });
      window.addEventListener('pointerup', onPointerUp);
      window.addEventListener('pointercancel', onPointerUp);

      // Programmatic pivot setter — useful for "frame selection sets the
      // pivot to the selection centroid" or similar host-driven flows.
      ctx.commands.register(
        'pivotRotate.setPivot',
        (args: unknown) => {
          const a = args as { x?: number; y?: number; z?: number } | undefined;
          if (
            !a ||
            typeof a.x !== 'number' ||
            typeof a.y !== 'number' ||
            typeof a.z !== 'number'
          ) {
            return false;
          }
          applyPivot(new THREE.Vector3(a.x, a.y, a.z), 'command');
          // Programmatic update isn't tied to a mouse hold — flash and fade.
          isHolding = false;
          startFade();
          return true;
        },
        { title: 'Set rotation pivot' },
      );

      cleanup = (): void => {
        canvas.removeEventListener(
          'pointerdown',
          onPointerDown,
          { capture: true } as EventListenerOptions,
        );
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('pointercancel', onPointerUp);
        offMove();
        offModel();
        controls.truckSpeed = defaultTruckSpeed;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        if (sprite) {
          scene.remove(sprite);
          (sprite.material as THREE.SpriteMaterial).dispose();
          sprite = null;
        }
        if (spriteTex) {
          spriteTex.dispose();
          spriteTex = null;
        }
      };
    },

    uninstall() {
      cleanup?.();
      cleanup = null;
    },
  };
}
