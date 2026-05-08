/**
 * Walkthrough plugin — first-person WASD navigation.
 *
 * On enter: saves the current camera state and controls config, then
 * switches to a first-person scheme: mouse-look rotates, WASD moves,
 * Q/E move down/up. On exit: restores the saved camera state.
 *
 * Movement is driven by a rAF loop that reads held keys and moves the
 * camera by delta-time-scaled increments along view-relative directions.
 */

import * as THREE from 'three';
import type { Plugin, ViewerContext } from '../../core/types.js';

const NAME = 'walkthrough' as const;

export interface WalkthroughPluginOptions {
  /** Walk speed in units/second. Default: 5. */
  speed?: number;
  /** Eye height above the floor. Default: 1.7 (metres). */
  eyeHeight?: number;
}

export interface WalkthroughPluginAPI {
  isActive(): boolean;
  setSpeed(speed: number): void;
}

interface SavedState {
  posX: number; posY: number; posZ: number;
  tgtX: number; tgtY: number; tgtZ: number;
  minDist: number;
  maxDist: number;
  mouseLeft: number;
  mouseRight: number;
  mouseMiddle: number;
}

const KEYS_FORWARD = new Set(['KeyW', 'ArrowUp']);
const KEYS_BACK = new Set(['KeyS', 'ArrowDown']);
const KEYS_LEFT = new Set(['KeyA', 'ArrowLeft']);
const KEYS_RIGHT = new Set(['KeyD', 'ArrowRight']);
const KEYS_UP = new Set(['KeyE', 'Space']);
const KEYS_DOWN = new Set(['KeyQ', 'ShiftLeft', 'ShiftRight']);
const ALL_KEYS = new Set([
  ...KEYS_FORWARD, ...KEYS_BACK,
  ...KEYS_LEFT, ...KEYS_RIGHT,
  ...KEYS_UP, ...KEYS_DOWN,
]);

export function walkthroughPlugin(
  options: WalkthroughPluginOptions = {},
): Plugin & WalkthroughPluginAPI {
  let ctxRef: ViewerContext | null = null;
  let active = false;
  let speed = options.speed ?? 5;
  const eyeHeight = options.eyeHeight ?? 1.7;
  let saved: SavedState | null = null;
  let rafId: number | null = null;
  let lastTime = 0;

  const held = new Set<string>();

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!active) return;
    // Ignore when user is typing in an input
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (ALL_KEYS.has(e.code)) {
      e.preventDefault();
      held.add(e.code);
    }
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    held.delete(e.code);
  };

  const tick = (time: number): void => {
    if (!ctxRef || !active) return;
    rafId = requestAnimationFrame(tick);

    if (lastTime === 0) { lastTime = time; return; }
    const dt = Math.min((time - lastTime) / 1000, 0.1); // cap at 100ms
    lastTime = time;

    const camera = ctxRef.camera as THREE.PerspectiveCamera;
    const controls = ctxRef.cameraControls;

    // Compute view-relative movement
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();

    const right = new THREE.Vector3();
    right.crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();

    const move = new THREE.Vector3();

    for (const code of held) {
      if (KEYS_FORWARD.has(code)) move.add(fwd);
      if (KEYS_BACK.has(code)) move.sub(fwd);
      if (KEYS_RIGHT.has(code)) move.add(right);
      if (KEYS_LEFT.has(code)) move.sub(right);
      if (KEYS_UP.has(code)) move.y += 1;
      if (KEYS_DOWN.has(code)) move.y -= 1;
    }

    if (move.lengthSq() < 0.001) return;
    move.normalize().multiplyScalar(speed * dt);

    // Move both the camera position and the look-at target by the same delta
    // so the viewing direction stays constant.
    const pos = new THREE.Vector3();
    controls.getPosition(pos);
    const tgt = new THREE.Vector3();
    controls.getTarget(tgt);

    pos.add(move);
    tgt.add(move);

    void controls.setLookAt(pos.x, pos.y, pos.z, tgt.x, tgt.y, tgt.z, false);
  };

  const enter = (args: unknown): void => {
    if (!ctxRef || active) return;
    const opts = (args ?? {}) as { eyeHeight?: number; speed?: number };
    if (opts.speed !== undefined) speed = opts.speed;
    const height = opts.eyeHeight ?? eyeHeight;

    const controls = ctxRef.cameraControls;

    // Save current state for restoration
    const pos = new THREE.Vector3();
    controls.getPosition(pos);
    const tgt = new THREE.Vector3();
    controls.getTarget(tgt);

    const ctor = controls.constructor as { ACTION?: Record<string, number> };
    const ACTION = ctor.ACTION ?? {};

    saved = {
      posX: pos.x, posY: pos.y, posZ: pos.z,
      tgtX: tgt.x, tgtY: tgt.y, tgtZ: tgt.z,
      minDist: controls.minDistance,
      maxDist: controls.maxDistance,
      mouseLeft: controls.mouseButtons.left as number,
      mouseRight: controls.mouseButtons.right as number,
      mouseMiddle: controls.mouseButtons.middle as number,
    };

    // Configure controls for first-person: no dolly, mouse-look via left drag
    controls.minDistance = 0;
    controls.maxDistance = 0;
    controls.mouseButtons.left = (ACTION.ROTATE ?? 1) as typeof controls.mouseButtons.left;
    controls.mouseButtons.right = (ACTION.NONE ?? 0) as typeof controls.mouseButtons.right;
    controls.mouseButtons.middle = (ACTION.NONE ?? 0) as typeof controls.mouseButtons.middle;

    // Place camera at eye height above the current floor point
    const eyePos = new THREE.Vector3(pos.x, pos.y, pos.z);
    if (height > 0) {
      // Use current Y as-is if we're already close to a reasonable height,
      // otherwise adjust to eye height relative to model bottom.
      const box = new THREE.Box3();
      for (const model of ctxRef.models().values()) {
        const mBox = model.box;
        if (mBox && !mBox.isEmpty()) box.union(mBox);
      }
      if (!box.isEmpty()) {
        eyePos.y = box.min.y + height;
      }
    }
    const lookTarget = eyePos.clone().add(
      new THREE.Vector3().subVectors(tgt, pos).setY(0).normalize(),
    );
    void controls.setLookAt(
      eyePos.x, eyePos.y, eyePos.z,
      lookTarget.x, lookTarget.y, lookTarget.z,
      false,
    );

    // Start key listeners + movement loop
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    lastTime = 0;
    rafId = requestAnimationFrame(tick);

    active = true;
    ctxRef.events.emit('walkthrough:change', { active: true });
  };

  const exit = (): void => {
    if (!ctxRef || !active) return;

    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    held.clear();
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }

    // Restore saved camera state
    const controls = ctxRef.cameraControls;
    if (saved) {
      controls.minDistance = saved.minDist;
      controls.maxDistance = saved.maxDist;
      controls.mouseButtons.left = saved.mouseLeft as typeof controls.mouseButtons.left;
      controls.mouseButtons.right = saved.mouseRight as typeof controls.mouseButtons.right;
      controls.mouseButtons.middle = saved.mouseMiddle as typeof controls.mouseButtons.middle;
      void controls.setLookAt(
        saved.posX, saved.posY, saved.posZ,
        saved.tgtX, saved.tgtY, saved.tgtZ,
        true,
      );
      saved = null;
    }

    active = false;
    ctxRef.events.emit('walkthrough:change', { active: false });
  };

  const api: Plugin & WalkthroughPluginAPI = {
    name: NAME,
    dependencies: ['camera'],

    isActive() { return active; },
    setSpeed(s: number) { speed = s; },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      ctx.commands.register('walkthrough.enter', (args: unknown) => enter(args), {
        title: 'Enter first-person walkthrough',
      });
      ctx.commands.register('walkthrough.exit', () => exit(), {
        title: 'Exit first-person walkthrough',
      });
      ctx.commands.register('walkthrough.toggle', () => {
        if (active) exit(); else enter(undefined);
      }, {
        title: 'Toggle first-person walkthrough',
      });
      ctx.commands.register('walkthrough.isActive', () => active, {
        title: 'Check walkthrough state',
      });
      ctx.commands.register('walkthrough.setSpeed', (args: unknown) => {
        const s = typeof args === 'number' ? args : (args as { speed?: number })?.speed;
        if (typeof s === 'number' && s > 0) speed = s;
      }, {
        title: 'Set walkthrough speed',
      });
    },

    uninstall() {
      if (active) exit();
      ctxRef = null;
    },
  };

  return api;
}
