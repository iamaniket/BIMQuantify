/**
 * Camera-fly plugin — WASD / D-pad camera navigation + first-person mouse-look.
 *
 * The exclusive "fly" tool. While enabled it drives the camera from a
 * held-direction set in a rAF loop (keyboard + on-screen D-pad), and it switches
 * the ThatOpen camera into its `FirstPerson` navigation mode so the mouse does
 * look-in-place (left-drag rotates the view about the camera, wheel dollies
 * forward/back) instead of orbiting a distant pivot. While active it also
 * suppresses click-selection / hover and stands `pivot-rotate` down (which in
 * first-person would otherwise hijack the left-drag as an orbit-pivot grab).
 * On disable the orbit controls config is restored to its pre-fly state and the
 * camera stays at its current FPN position/direction (with the pre-fly orbit
 * radius), re-asserted across the mode switch so ThatOpen's Orbit/FirstPerson
 * swaps (which relocate the orbit pivot and nudge the eye) can't drift the view. It is toggled by the toolbar Orbit/Navigation buttons (via the
 * tool-manager) and Esc; clicks and drags in the scene stay in fly mode.
 *
 * Direction scheme (camera height stays constant except for up/down):
 *   - forward / back            → walk along the horizontal view direction (W / S)
 *   - turnLeft / turnRight      → yaw in place around world Y (Q / E)
 *   - strafeLeft / strafeRight  → slide along the horizontal right vector (A / D)
 *   - up / down                 → raise / lower straight along world Y (R / F)
 *
 * The eight directions are registered as real commands (`cameraFly.forward`, …)
 * with `defaultShortcut`s, so they live in the keyboard-shortcuts map and are
 * rebindable from the viewer's Keyboard Settings like any other shortcut. The
 * shortcut dispatch fires those commands on **keydown** (= press); this plugin
 * owns a **keyup** listener for release (the shortcut system has no keyup) plus
 * the rAF loop. The on-screen D-pad drives the same held set via
 * `cameraFly.press` / `cameraFly.release`.
 *
 * Every move goes through `cameraControls.setLookAt(...)`, whose camera-controls
 * `update` event makes `Viewer` emit `camera:change` — so the split-view 2D
 * anchor follows for free, no extra plumbing.
 */

import * as THREE from 'three';
import type * as FRAGS from '@thatopen/fragments';

import type { Plugin, ViewerContext } from '../../../core/types.js';
import { suppressSelectionGestures } from '../shared/suppressSelection.js';

const NAME = 'camera-fly' as const;

export type FlyDirection =
  | 'forward'
  | 'back'
  | 'turnLeft'
  | 'turnRight'
  | 'strafeLeft'
  | 'strafeRight'
  | 'up'
  | 'down'
  // Keyboard-look (arrow keys) — rotate the view about the fixed eye. Not
  // movement; not exposed on the D-pad popover.
  | 'pitchUp'
  | 'pitchDown';

/** Direction → command name, label and default key. Source of truth for both
 *  command registration and the keyup release map. */
const DIRECTION_COMMANDS: ReadonlyArray<{
  dir: FlyDirection;
  command: string;
  title: string;
  shortcut: string;
}> = [
  { dir: 'forward', command: 'cameraFly.forward', title: 'Fly forward', shortcut: 'W' },
  { dir: 'back', command: 'cameraFly.back', title: 'Fly back', shortcut: 'S' },
  { dir: 'turnLeft', command: 'cameraFly.turnLeft', title: 'Fly turn left', shortcut: 'Q' },
  { dir: 'turnRight', command: 'cameraFly.turnRight', title: 'Fly turn right', shortcut: 'E' },
  { dir: 'strafeLeft', command: 'cameraFly.strafeLeft', title: 'Fly strafe left', shortcut: 'A' },
  { dir: 'strafeRight', command: 'cameraFly.strafeRight', title: 'Fly strafe right', shortcut: 'D' },
  { dir: 'up', command: 'cameraFly.up', title: 'Fly up', shortcut: 'R' },
  { dir: 'down', command: 'cameraFly.down', title: 'Fly down', shortcut: 'F' },
];

const ALL_DIRECTIONS: readonly FlyDirection[] = DIRECTION_COMMANDS.map((d) => d.dir);

/** Arrow keys are a keyboard-look control (rotate the view about the fixed
 *  eye), handled directly by the plugin rather than the rebindable shortcut
 *  system: ArrowUp/Down pitch the look up/down, ArrowLeft/Right yaw it. */
const ARROW_KEY_TO_DIR: Readonly<Record<string, FlyDirection>> = {
  ArrowUp: 'pitchUp',
  ArrowDown: 'pitchDown',
  ArrowLeft: 'turnLeft',
  ArrowRight: 'turnRight',
};

function isFlyDirection(value: unknown): value is FlyDirection {
  return typeof value === 'string' && (ALL_DIRECTIONS as readonly string[]).includes(value);
}

/** Last segment of a combo (e.g. "Shift+T" → "T"), matching the canonical key. */
function lastKey(combo: string): string {
  return combo.split('+').pop() ?? combo;
}

/** Base key for a keyup event, mirroring the shortcut plugin's canonical key. */
function baseKeyFromEvent(ev: KeyboardEvent): string {
  const code = ev.code;
  if (code.startsWith('Key') && code.length === 4) return code.slice(3);
  if (code.startsWith('Numpad')) return code;
  let key = ev.key;
  if (key === ' ') key = 'Space';
  if (key.length === 1) key = key.toUpperCase();
  return key;
}

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const TWO_PI = Math.PI * 2;
// Pitch clamp: keep the look direction within ~1° of straight up/down so the
// view never crosses vertical and flips the camera's up vector.
const MIN_PITCH_ANGLE = THREE.MathUtils.degToRad(1);
const MAX_PITCH_ANGLE = Math.PI - MIN_PITCH_ANGLE;

// Move-speed clamp + per-step factor for the in-fly speed adjust (± keys / popover).
const MOVE_FRACTION_MIN = 0.03;
const MOVE_FRACTION_MAX = 2;
const SPEED_STEP = 1.25;

export interface CameraFlyPluginOptions {
  /**
   * Translation speed as a fraction of the scene diagonal per second.
   * Default: 0.35 (≈ cross a model in ~3s when holding a direction).
   */
  moveFraction?: number;
  /** Turn speed in radians/second. Default: ~70°/s. */
  turnSpeed?: number;
  /** Mouse look-drag sensitivity in radians/pixel. Default: 0.0025. */
  lookSensitivity?: number;
  /** Movement multiplier applied while Shift is held (sprint). Default: 3. */
  sprintMultiplier?: number;
}

export interface CameraFlyPluginAPI {
  isActive(): boolean;
}

/** camera-controls fields FirstPerson/Orbit mode switches mutate — saved on
 *  enter so the exact pre-fly orbit config is restored on exit. */
interface FlySavedControls {
  minDistance: number;
  maxDistance: number;
  truckSpeed: number;
  infinityDolly: boolean;
  dollyToCursor: boolean;
  mouseLeft: number;
  mouseRight: number;
  mouseMiddle: number;
  mouseWheel: number;
  /**
   * Pre-fly camera pose. On entry the full snapshot (pos + dir) is re-asserted
   * so `FirstPersonMode`'s ~1-unit eye nudge doesn't show as a jump. On exit
   * only `radius` is used — the orbit distance for the new orbit target — while
   * position and direction come from the current FPN state so the user stays
   * where they walked to. `null` when the pre-fly offset was degenerate
   * (eye ≈ target).
   */
  pose: { pos: THREE.Vector3; dir: THREE.Vector3; radius: number } | null;
}

export function cameraFlyPlugin(
  options: CameraFlyPluginOptions = {},
): Plugin & CameraFlyPluginAPI {
  let ctxRef: ViewerContext | null = null;
  let active = false;
  // Mutable so the `cameraFly.setOptions` live command can retune them at
  // runtime (driven by the portal's settings sliders).
  let moveFraction = options.moveFraction ?? 0.18;
  let turnSpeed = options.turnSpeed ?? THREE.MathUtils.degToRad(70);
  let lookSensitivity = options.lookSensitivity ?? 0.0025;
  const sprintMultiplier = options.sprintMultiplier ?? 3;
  // True while Shift is held in fly mode — temporarily speeds up translation.
  let shiftHeld = false;

  // Clamp + broadcast the move speed (driven by the ± commands and the popover's
  // speed presets). Emitting `fly:speed` lets the popover reflect the live value.
  const setMoveFraction = (v: number): void => {
    moveFraction = Math.min(MOVE_FRACTION_MAX, Math.max(MOVE_FRACTION_MIN, v));
    ctxRef?.events.emit('fly:speed', { moveFraction });
  };

  let rafId: number | null = null;
  let lastTime = 0;
  const held = new Set<FlyDirection>();

  // Mouse look-drag state. We take over the left button (camera-controls'
  // ROTATE orbits the eye around the pinned target, which translates the
  // camera — not look-in-place), so we track the drag ourselves.
  let dragging = false;
  let lastDragX = 0;
  let lastDragY = 0;

  // First-person mode bookkeeping: saved controls config + the disposer that
  // rebinds the selection/hover gestures we suppressed on enter.
  let savedControls: FlySavedControls | null = null;
  let restoreSelection: (() => Promise<void>) | null = null;

  // base key → direction, used to release the right direction on keyup. Seeded
  // from defaults, refreshed from the live shortcut bindings on enable so user
  // rebindings are honored.
  let comboKeyToDir = new Map<string, FlyDirection>();

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

  const internalPress = (dir: FlyDirection): void => {
    if (!active) return;
    held.add(dir);
  };

  /**
   * Rotate the look direction about the *fixed* eye — yaw around world-up,
   * pitch around the horizontal right axis — then re-aim. Because the camera
   * position is preserved this is true look-in-place. Shared by the rAF loop
   * (arrow keys) and the mouse look-drag. Pitch is clamped so the view can't
   * cross vertical (which would flip the up vector).
   */
  const applyLook = (yawDelta: number, pitchDelta: number): void => {
    if (!ctxRef || (yawDelta === 0 && pitchDelta === 0)) return;
    const controls = ctxRef.cameraControls;

    const pos = new THREE.Vector3();
    controls.getPosition(pos);
    const tgt = new THREE.Vector3();
    controls.getTarget(tgt);

    const offset = tgt.clone().sub(pos); // FirstPerson keeps |offset| ≈ 1
    if (offset.lengthSq() < 1e-9) return;

    if (yawDelta !== 0) offset.applyAxisAngle(WORLD_UP, yawDelta % TWO_PI);

    if (pitchDelta !== 0) {
      // Horizontal right = right of the ground-projected view direction.
      const flat = new THREE.Vector3(offset.x, 0, offset.z);
      if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1); // looking near-vertical
      const right = new THREE.Vector3().crossVectors(flat, WORLD_UP).normalize();
      // Clamp: skip the pitch step if it would push within ~1° of straight
      // up/down (angle of `offset` to WORLD_UP must stay in [1°, 179°]).
      const current = offset.angleTo(WORLD_UP);
      // pitchUp (positive) raises the look → decreases the angle to WORLD_UP.
      const next = current - pitchDelta;
      if (next > MIN_PITCH_ANGLE && next < MAX_PITCH_ANGLE) {
        offset.applyAxisAngle(right, pitchDelta);
      }
    }

    tgt.copy(pos).add(offset);
    void controls.setLookAt(pos.x, pos.y, pos.z, tgt.x, tgt.y, tgt.z, false);
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

    // Horizontal right (Y-up coordinate system) for lateral strafe.
    const right = new THREE.Vector3().crossVectors(fwd, WORLD_UP).normalize();

    const moveStep =
      sceneDiagonal() * moveFraction * dt * (shiftHeld ? sprintMultiplier : 1);
    const translate = new THREE.Vector3();
    let yaw = 0;
    let pitch = 0;

    for (const dir of held) {
      switch (dir) {
        case 'forward': translate.addScaledVector(fwd, moveStep); break;
        case 'back': translate.addScaledVector(fwd, -moveStep); break;
        case 'strafeLeft': translate.addScaledVector(right, -moveStep); break;
        case 'strafeRight': translate.addScaledVector(right, moveStep); break;
        case 'up': translate.addScaledVector(WORLD_UP, moveStep); break;
        case 'down': translate.addScaledVector(WORLD_UP, -moveStep); break;
        case 'turnLeft': yaw += turnSpeed * dt; break;
        case 'turnRight': yaw -= turnSpeed * dt; break;
        case 'pitchUp': pitch += turnSpeed * dt; break;
        case 'pitchDown': pitch -= turnSpeed * dt; break;
      }
    }

    // Translate position and target together so the view direction is preserved.
    if (translate.lengthSq() > 0) {
      pos.add(translate);
      tgt.add(translate);
      void controls.setLookAt(pos.x, pos.y, pos.z, tgt.x, tgt.y, tgt.z, false);
    }

    // Yaw/pitch-in-place: rotate the look offset about the (now updated) eye.
    applyLook(yaw, pitch);
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === 'Shift') shiftHeld = false;
    const arrowDir = ARROW_KEY_TO_DIR[e.key];
    if (arrowDir) {
      held.delete(arrowDir);
      return;
    }
    const dir = comboKeyToDir.get(baseKeyFromEvent(e));
    if (dir) held.delete(dir);
  };

  /** Arrow keys = keyboard-look. Handled here (not via the rebindable shortcut
   *  system) so they're scoped to fly mode and don't steal arrows elsewhere. */
  const onKeyDown = (e: KeyboardEvent): void => {
    if (!active) return;
    if (e.key === 'Shift') shiftHeld = true;
    const dir = ARROW_KEY_TO_DIR[e.key];
    if (!dir) return;
    e.preventDefault(); // stop the page from scrolling
    held.add(dir);
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (!active || e.button !== 0 || !ctxRef) return;
    // Mouse-only look-drag: on touch, the on-screen look-joystick owns first-person
    // look (a one-finger canvas drag would otherwise fight it).
    if (e.pointerType !== 'mouse') return;
    if (e.target !== ctxRef.canvas) return;
    dragging = true;
    lastDragX = e.clientX;
    lastDragY = e.clientY;
    ctxRef.canvas.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: PointerEvent): void => {
    if (!dragging) return;
    const dx = e.clientX - lastDragX;
    const dy = e.clientY - lastDragY;
    lastDragX = e.clientX;
    lastDragY = e.clientY;
    // Negate so drag-right looks right and drag-up looks up (standard FPS feel).
    applyLook(-dx * lookSensitivity, -dy * lookSensitivity);
  };

  const onPointerUp = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    ctxRef?.canvas.releasePointerCapture?.(e.pointerId);
  };

  /** Rebuild base-key → direction from the live shortcut bindings (falling back
   *  to the built-in defaults), so keyup releases the correct direction even
   *  after the user rebinds a fly key. */
  const refreshKeyMap = async (): Promise<void> => {
    const map = new Map<string, FlyDirection>();
    for (const d of DIRECTION_COMMANDS) map.set(lastKey(d.shortcut), d.dir);
    try {
      if (ctxRef) {
        const list = (await ctxRef.commands.execute('shortcuts.list')) as {
          combo: string;
          command: string;
        }[];
        const byCommand = new Map(DIRECTION_COMMANDS.map((d) => [d.command, d.dir]));
        for (const { combo, command } of list) {
          const dir = byCommand.get(command);
          if (dir) map.set(lastKey(combo), dir);
        }
      }
    } catch {
      // shortcuts plugin unavailable — keep the default map.
    }
    comboKeyToDir = map;
  };

  const enable = async (): Promise<void> => {
    if (!ctxRef || active) return;
    const ctx = ctxRef;
    active = true;
    held.clear();
    dragging = false;
    void refreshKeyMap();
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('keydown', onKeyDown);
    // pointerdown on the container in capture phase (camera-controls listens on
    // the canvas; capture runs first). move/up on window so the drag tracks
    // even if the pointer leaves the canvas.
    ctx.container.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    lastTime = 0;
    rafId = requestAnimationFrame(tick);

    const controls = ctx.cameraControls;

    // Snapshot the exact pre-fly pose (eye + normalized view direction + orbit
    // radius) so it can be re-asserted across the ThatOpen mode swaps below and
    // in `disable()`. Captured BEFORE `set('FirstPerson')` mutates the rig.
    const eye = new THREE.Vector3();
    const lookTarget = new THREE.Vector3();
    controls.getPosition(eye);
    controls.getTarget(lookTarget);
    const viewDir = lookTarget.clone().sub(eye);
    // The RENDERED eye = the logical eye (target + spherical) PLUS any residual
    // focalOffset left by pivot-rotate's setOrbitPoint or truck (pan).
    // `getPosition` returns only the logical eye, so snapshot the three camera's
    // world position instead — then clearing the offset below re-asserts the pose
    // to exactly where the user sees the camera (no jump on enter). The offset
    // doesn't affect orientation, so `viewDir`/`radius` stay logical.
    const renderedEye = new THREE.Vector3();
    ctx.camera.getWorldPosition(renderedEye);
    const pose =
      viewDir.lengthSq() < 1e-9
        ? null
        : {
            pos: renderedEye.clone(),
            radius: eye.distanceTo(lookTarget),
            dir: viewDir.normalize(),
          };

    // Save the orbit config FirstPerson/Orbit will overwrite, so exit can
    // restore it byte-for-byte rather than inheriting OrbitMode's defaults.
    savedControls = {
      minDistance: controls.minDistance,
      maxDistance: controls.maxDistance,
      truckSpeed: controls.truckSpeed,
      infinityDolly: controls.infinityDolly,
      dollyToCursor: controls.dollyToCursor,
      mouseLeft: controls.mouseButtons.left as number,
      mouseRight: controls.mouseButtons.right as number,
      mouseMiddle: controls.mouseButtons.middle as number,
      mouseWheel: controls.mouseButtons.wheel as number,
      pose,
    };

    // Enter ThatOpen first-person navigation: target locked 1 unit ahead so
    // wheel DOLLY moves forward/back. infinityDolly lets the locked-distance
    // dolly translate the camera instead of no-op'ing against min==max==1.
    ctx.obcCamera.set('FirstPerson');
    controls.infinityDolly = true;
    // Dolly straight along the view axis (forward/back), not toward the cursor
    // point — predictable first-person "scroll to move".
    controls.dollyToCursor = false;

    // Clear any residual focalOffset left by pivot-rotate's setOrbitPoint or
    // truck (pan). setLookAt does NOT clear it (see framing.ts / bcf), and
    // camera-controls re-applies it along the camera's LOCAL axes every frame —
    // so in fly mode it swings the eye as the look direction rotates (the
    // look-also-moves-position bug). Zeroing it makes look-in-place truly
    // translation-free. The pose re-assert below uses the rendered eye, so this
    // is jump-free even when the incoming offset was large.
    controls.setFocalOffset(0, 0, 0, false);

    // Take over the left button: camera-controls' ROTATE orbits the eye around
    // the pinned target (translating the camera), not look-in-place. Disable it
    // and drive look ourselves via the pointer handlers (`onPointerMove` →
    // `applyLook`). `mouseLeft` is saved above, so orbit is restored on exit.
    const ACTION = (controls.constructor as { ACTION?: Record<string, number> }).ACTION;
    if (ACTION) {
      controls.mouseButtons.left = (ACTION['NONE'] ?? 0) as typeof controls.mouseButtons.left;
    }

    // Re-assert the snapshot pose at FirstPerson's unit radius so set('FirstPerson')'s
    // ~1-unit eye nudge doesn't show as a jump when entering fly. Synchronous —
    // a deferred re-assert could land after the Split-entry `minimap.placeCamera`.
    if (pose) {
      const { pos, dir } = pose;
      void controls.setLookAt(
        pos.x,
        pos.y,
        pos.z,
        pos.x + dir.x,
        pos.y + dir.y,
        pos.z + dir.z,
        false,
      );
    }

    // Pure-look: suppress click-selection + hover, and stand pivot-rotate down
    // (it grabs the left-drag as an orbit-pivot, which would fight our look).
    await ctx.commands.execute('pivotRotate.disable').catch(() => undefined);
    restoreSelection = await suppressSelectionGestures(ctx);
  };

  const disable = async (): Promise<void> => {
    if (!active) return;
    const ctx = ctxRef;
    active = false;
    held.clear();
    shiftHeld = false;
    dragging = false;
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('keydown', onKeyDown);
    if (ctx) {
      ctx.container.removeEventListener('pointerdown', onPointerDown, true);
    }
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (!ctx) return;

    const controls = ctx.cameraControls;

    // Snapshot the CURRENT FPN camera pose BEFORE set('Orbit') mutates the rig.
    // In FPN the focalOffset is zero (cleared on enter, not accumulated during
    // FPN since pivot-rotate is disabled), so getPosition() == rendered eye.
    const currentPos = new THREE.Vector3();
    const currentTarget = new THREE.Vector3();
    controls.getPosition(currentPos);
    controls.getTarget(currentTarget);
    const currentDir = currentTarget.clone().sub(currentPos);
    const currentPoseValid = currentDir.lengthSq() >= 1e-9;
    if (currentPoseValid) currentDir.normalize();

    // Re-enable pivot-rotate and rebind selection/hover.
    await ctx.commands.execute('pivotRotate.enable').catch(() => undefined);
    await restoreSelection?.();
    restoreSelection = null;

    // Back to orbit navigation (re-establishes a real orbit target), then
    // restore the exact pre-fly controls config — OrbitMode would otherwise
    // leave minDistance=1/maxDistance=300/truckSpeed=2 and infinityDolly on.
    ctx.obcCamera.set('Orbit');
    if (savedControls) {
      controls.minDistance = savedControls.minDistance;
      controls.maxDistance = savedControls.maxDistance;
      controls.truckSpeed = savedControls.truckSpeed;
      controls.infinityDolly = savedControls.infinityDolly;
      controls.dollyToCursor = savedControls.dollyToCursor;
      controls.mouseButtons.left = savedControls.mouseLeft as typeof controls.mouseButtons.left;
      controls.mouseButtons.right = savedControls.mouseRight as typeof controls.mouseButtons.right;
      controls.mouseButtons.middle = savedControls.mouseMiddle as typeof controls.mouseButtons.middle;
      controls.mouseButtons.wheel = savedControls.mouseWheel as typeof controls.mouseButtons.wheel;

      // Re-assert the CURRENT camera pose (not the pre-fly snapshot) AFTER
      // min/maxDistance are restored, so the orbit radius isn't clamped to
      // ThatOpen's [1, 300]. This overrides OrbitMode.activateOrbitControls,
      // which would otherwise place the orbit pivot |eyeFromOrigin| away and
      // drift the view. The pre-fly orbit radius is reused so the scroll-zoom
      // "feel" is preserved; position and direction come from the current FPN
      // state so the user stays where they walked to.
      if (currentPoseValid) {
        const orbitRadius =
          savedControls.pose?.radius ?? currentPos.distanceTo(currentTarget);
        void controls.setLookAt(
          currentPos.x,
          currentPos.y,
          currentPos.z,
          currentPos.x + currentDir.x * orbitRadius,
          currentPos.y + currentDir.y * orbitRadius,
          currentPos.z + currentDir.z * orbitRadius,
          false,
        );
      }
      savedControls = null;
    }
  };

  return {
    name: NAME,
    dependencies: ['camera', 'mouse-bindings'],

    isActive() { return active; },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      ctx.commands.register('cameraFly.enable', () => enable(), {
        title: 'Enable fly navigation',
      });
      ctx.commands.register('cameraFly.disable', () => disable(), {
        title: 'Disable fly navigation',
      });
      ctx.commands.register('cameraFly.isActive', () => active, {
        title: 'Check fly navigation state',
      });

      // Retune speeds live (driven by the portal settings sliders). Each field
      // is optional; only provided values are applied. turnSpeed is radians/sec.
      ctx.commands.register('cameraFly.setOptions', (args: unknown) => {
        const o = args as Partial<CameraFlyPluginOptions> | undefined;
        if (typeof o?.moveFraction === 'number') setMoveFraction(o.moveFraction);
        if (typeof o?.turnSpeed === 'number') turnSpeed = o.turnSpeed;
        if (typeof o?.lookSensitivity === 'number') lookSensitivity = o.lookSensitivity;
      }, { title: 'Set fly speed options' });

      // In-fly speed adjust. The mouse wheel already dollies forward/back in fly
      // mode, so speed is on the ± keys + the popover buttons instead. Default
      // shortcut for "faster" is '=' — the same physical key as '+', but unshifted
      // (a shifted '+' canonicalizes to 'Shift++' and wouldn't match). Rebindable.
      ctx.commands.register('cameraFly.speedUp', () => setMoveFraction(moveFraction * SPEED_STEP), {
        title: 'Fly faster',
        defaultShortcut: '=',
      });
      ctx.commands.register('cameraFly.speedDown', () => setMoveFraction(moveFraction / SPEED_STEP), {
        title: 'Fly slower',
        defaultShortcut: '-',
      });
      // Synchronous read of the live move speed, so a freshly-opened speed
      // readout can seed itself (the `fly:speed` event only fires on change).
      ctx.commands.register('cameraFly.getSpeed', () => moveFraction, {
        title: 'Get current fly speed',
      });

      // One command per direction, bound to a default key. The keyboard-shortcuts
      // plugin dispatches these on keydown (= press); release happens on keyup
      // (see `onKeyUp`). Registering them here also surfaces them in Keyboard
      // Settings as rebindable shortcuts.
      for (const { dir, command, title, shortcut } of DIRECTION_COMMANDS) {
        ctx.commands.register(command, () => { internalPress(dir); }, {
          title,
          defaultShortcut: shortcut,
        });
      }

      // Press / release a direction — used by the on-screen D-pad buttons so
      // hold-to-move works identically to the keyboard.
      ctx.commands.register('cameraFly.press', (args: unknown) => {
        const dir = (args as { dir?: unknown })?.dir;
        if (isFlyDirection(dir)) internalPress(dir);
      }, { title: 'Start moving in a direction' });

      ctx.commands.register('cameraFly.release', (args: unknown) => {
        const dir = (args as { dir?: unknown })?.dir;
        if (isFlyDirection(dir)) held.delete(dir);
      }, { title: 'Stop moving in a direction' });
    },

    async uninstall() {
      await disable();
      ctxRef = null;
    },
  };
}
