/**
 * Camera-fly plugin — arrow-key / D-pad camera navigation.
 *
 * A non-exclusive companion to the camera plugin: while enabled it drives the
 * camera from a held-key set in a rAF loop, but it never repositions the camera
 * on enter, never remaps the mouse, and never suppresses selection/hover. It is
 * meant to be toggled on by a toolbar fly-out popover and off again when that
 * popover closes.
 *
 * Direction scheme (camera height stays constant for the four arrows):
 *   - forward / back  → walk along the horizontal view direction (Y locked)
 *   - left / right    → turn (yaw) in place around the world Y axis (Y locked)
 *   - up / down       → raise / lower the camera straight along world Y
 *                       (the deliberate exception to the height lock)
 *
 * Every move goes through `cameraControls.setLookAt(...)`, whose camera-controls
 * `update` event makes `Viewer` emit `camera:change` — so the split-view 2D
 * anchor follows for free, no extra plumbing.
 */

import * as THREE from 'three';
import type * as FRAGS from '@thatopen/fragments';

import type { Plugin, ViewerContext } from '../../../core/types.js';

const NAME = 'camera-fly' as const;

export type FlyDirection = 'forward' | 'back' | 'left' | 'right' | 'up' | 'down';

const ALL_DIRECTIONS: readonly FlyDirection[] = [
  'forward', 'back', 'left', 'right', 'up', 'down',
];

function isFlyDirection(value: unknown): value is FlyDirection {
  return typeof value === 'string' && (ALL_DIRECTIONS as readonly string[]).includes(value);
}

/** Keyboard codes → direction token. Arrows move/turn; PageUp/Down change height. */
const KEY_TO_DIR: Record<string, FlyDirection> = {
  ArrowUp: 'forward',
  ArrowDown: 'back',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  PageUp: 'up',
  PageDown: 'down',
};

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const TWO_PI = Math.PI * 2;

export interface CameraFlyPluginOptions {
  /**
   * Translation speed as a fraction of the scene diagonal per second.
   * Default: 0.35 (≈ cross a model in ~3s when holding a direction).
   */
  moveFraction?: number;
  /** Turn speed in radians/second. Default: ~70°/s. */
  turnSpeed?: number;
}

export interface CameraFlyPluginAPI {
  isActive(): boolean;
}

export function cameraFlyPlugin(
  options: CameraFlyPluginOptions = {},
): Plugin & CameraFlyPluginAPI {
  let ctxRef: ViewerContext | null = null;
  let active = false;
  const moveFraction = options.moveFraction ?? 0.35;
  const turnSpeed = options.turnSpeed ?? THREE.MathUtils.degToRad(70);

  let rafId: number | null = null;
  let lastTime = 0;
  const held = new Set<FlyDirection>();

  /** World-space diagonal of all loaded models, used to scale move speed. */
  const sceneDiagonal = (): number => {
    if (!ctxRef) return 10;
    const box = new THREE.Box3();
    for (const model of ctxRef.models().values()) {
      const mBox = (model as FRAGS.FragmentsModel).box;
      if (mBox && !mBox.isEmpty()) box.union(mBox);
    }
    if (box.isEmpty()) return 10;
    const size = box.getSize(new THREE.Vector3());
    const diag = size.length();
    return diag > 0 ? diag : 10;
  };

  const tick = (time: number): void => {
    if (!ctxRef || !active) return;
    rafId = requestAnimationFrame(tick);

    if (lastTime === 0) { lastTime = time; return; }
    const dt = Math.min((time - lastTime) / 1000, 0.1); // cap at 100ms
    lastTime = time;

    if (held.size === 0) return;

    const camera = ctxRef.camera as THREE.PerspectiveCamera;
    const controls = ctxRef.cameraControls;

    const pos = new THREE.Vector3();
    controls.getPosition(pos);
    const tgt = new THREE.Vector3();
    controls.getTarget(tgt);

    // Horizontal forward (view direction flattened onto the ground plane).
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1); // looking straight up/down
    fwd.normalize();

    const moveStep = sceneDiagonal() * moveFraction * dt;
    const translate = new THREE.Vector3();
    let yaw = 0;

    for (const dir of held) {
      switch (dir) {
        case 'forward': translate.addScaledVector(fwd, moveStep); break;
        case 'back': translate.addScaledVector(fwd, -moveStep); break;
        case 'up': translate.addScaledVector(WORLD_UP, moveStep); break;
        case 'down': translate.addScaledVector(WORLD_UP, -moveStep); break;
        case 'left': yaw += turnSpeed * dt; break;
        case 'right': yaw -= turnSpeed * dt; break;
      }
    }

    // Translate position and target together so the view direction is preserved.
    if (translate.lengthSq() > 0) {
      pos.add(translate);
      tgt.add(translate);
    }

    // Yaw-in-place: rotate the look offset around world-up about the camera
    // position. Pitch (and thus camera height relative to target) is preserved.
    if (yaw !== 0) {
      const offset = tgt.clone().sub(pos).applyAxisAngle(WORLD_UP, yaw % TWO_PI);
      tgt.copy(pos).add(offset);
    }

    if (translate.lengthSq() === 0 && yaw === 0) return;
    void controls.setLookAt(pos.x, pos.y, pos.z, tgt.x, tgt.y, tgt.z, false);
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!active) return;
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((e.target as HTMLElement)?.isContentEditable) return;
    const dir = KEY_TO_DIR[e.code];
    if (!dir) return;
    e.preventDefault(); // stop page scroll on arrows / PageUp / PageDown
    held.add(dir);
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    const dir = KEY_TO_DIR[e.code];
    if (dir) held.delete(dir);
  };

  const enable = (): void => {
    if (!ctxRef || active) return;
    active = true;
    held.clear();
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    lastTime = 0;
    rafId = requestAnimationFrame(tick);
  };

  const disable = (): void => {
    if (!active) return;
    active = false;
    held.clear();
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  };

  return {
    name: NAME,
    dependencies: ['camera'],

    isActive() { return active; },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      ctx.commands.register('cameraFly.enable', () => { enable(); }, {
        title: 'Enable fly navigation',
      });
      ctx.commands.register('cameraFly.disable', () => { disable(); }, {
        title: 'Disable fly navigation',
      });
      ctx.commands.register('cameraFly.isActive', () => active, {
        title: 'Check fly navigation state',
      });

      // Press / release a direction — used by the on-screen D-pad buttons so
      // hold-to-move works identically to the keyboard.
      ctx.commands.register('cameraFly.press', (args: unknown) => {
        if (!active) return;
        const dir = (args as { dir?: unknown })?.dir;
        if (isFlyDirection(dir)) held.add(dir);
      }, { title: 'Start moving in a direction' });

      ctx.commands.register('cameraFly.release', (args: unknown) => {
        const dir = (args as { dir?: unknown })?.dir;
        if (isFlyDirection(dir)) held.delete(dir);
      }, { title: 'Stop moving in a direction' });
    },

    uninstall() {
      disable();
      ctxRef = null;
    },
  };
}
