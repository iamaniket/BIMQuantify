import type { Plugin, ViewerContext, Vec3 } from '@bimdossier/viewer';
import { buildClippingPlanes, type SectionPlaneData } from '@bimdossier/viewer/viewer-3d';

import type { StoryCamera } from './storySteps';

export type ApplyStepArgs = {
  camera: StoryCamera;
  /** Animate the flight (camera-controls smooth-damps it). False = instant. */
  animate?: boolean;
};

export type SetCutArgs = {
  enabled: boolean;
  /** Sweep position 0..1 — 0 = plane at the roof (nothing cut), 1 = deepest. */
  t: number;
};

export type SetAnchorArgs = {
  /** The featured pin's anchor in its model's LOCAL frame. */
  position: Vec3;
  modelId: string;
};

export type StoryDirectorOptions = {
  /** Camera damping in seconds — one flight per step, interruptible. Default 0.7. */
  smoothTime?: number;
  /**
   * Desktop-only right-shift as a fraction of the viewport half-width (the
   * step card overlays the left). Same camera-focal-offset trick as the snag
   * showcase — never canvas padding, which breaks `pick()`. Default 0.2.
   */
  panFraction?: number;
  /**
   * Below-lg up-shift as a fraction of the viewport half-height — the step
   * card anchors to the bottom third on mobile, so the model sits in the
   * upper two-thirds. Default 0.18.
   */
  liftFraction?: number;
};

type Box = { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };

/** Deepest cut leaves the ground floor: sweep covers this fraction of the height. */
const CUT_DEPTH_FRACTION = 0.85;

const CUT_PLANE_ID = 'story-cut';

/**
 * Host-side director for the scroll-driven "how it works" story. Sibling of the
 * snag-showcase plugins (`autoRotatePlugin` / `cameraZoomPlugin` / …) — it owns
 * every scene mutation the story needs, so the React host only issues commands:
 *
 *  - `story.applyStep { camera, animate }` — computes a MODEL-RELATIVE pose
 *    (azimuth/polar/distanceFactor off `camera.getSceneBox`, the proven
 *    `cameraZoomPlugin.frame` math) and flies there via `setLookAt(..., animate)`.
 *    camera-controls smooth-damps the flight (`smoothTime`, set once at
 *    install — dedicated viewer, no restore needed), so a fast scroll simply
 *    interrupts mid-flight and re-damps to the new pose. `lookAtAnchor` poses
 *    aim at the featured snag anchor set via `story.setAnchor`.
 *  - `story.setCut { enabled, t }` — one horizontal "dollhouse" clipping plane
 *    sweeping down through the building (Y-up). The plane is built once via
 *    the viewer's `buildClippingPlanes` and mutated in place per scrub frame,
 *    so materials never recompile mid-sweep (`needsUpdate` only on the 0↔1
 *    plane-count change — the `material-clipping.ts` pattern). Emits
 *    `section:change` with the serialized plane so the outline plugin clips
 *    its fat lines too (it already subscribes).
 *  - `story.setAnchor { position, modelId }` — stores the featured-pin anchor
 *    (model-LOCAL frame) used by `lookAtAnchor` poses.
 *
 * Re-asserts the current pose on `model:loaded` (defeats the built-in
 * `camera.zoomExtents`, same trick as `cameraZoomPlugin`) and re-assigns the
 * cut to materials that stream in while it is active. Every mutation ends with
 * `ctx.requestRender()` — the viewer parks in MANUAL render mode between
 * flights, so nothing draws without a wake-up.
 */
export function storyDirectorPlugin(options: StoryDirectorOptions = {}): Plugin {
  const smoothTime = options.smoothTime ?? 0.7;
  const panFraction = options.panFraction ?? 0.2;
  const liftFraction = options.liftFraction ?? 0.18;

  let ctx: ViewerContext | null = null;
  let offModelLoaded: (() => void) | null = null;
  let anchor: SetAnchorArgs | null = null;
  let lastPose: StoryCamera | null = null;

  // The single cut plane (a THREE.Plane from buildClippingPlanes) + the array
  // identity every material shares. Scrubs mutate the plane in place; only the
  // enable/disable transitions touch `material.clippingPlanes` and flip
  // `needsUpdate` (shader recompile on plane-count change).
  let cutPlanes: ReturnType<typeof buildClippingPlanes> | null = null;
  let cutActive = false;

  const forEachMaterial = (fn: (mat: { clippingPlanes: unknown; needsUpdate: boolean }) => void): void => {
    if (ctx === null) return;
    for (const model of ctx.models().values()) {
      model.object.traverse((obj) => {
        const mesh = obj as { isMesh?: boolean; material?: unknown };
        if (!mesh.isMesh) return;
        const mat = mesh.material;
        if (Array.isArray(mat)) {
          for (const m of mat) fn(m as { clippingPlanes: unknown; needsUpdate: boolean });
        } else if (mat) {
          fn(mat as { clippingPlanes: unknown; needsUpdate: boolean });
        }
      });
    }
  };

  const applyStep = async (args: unknown): Promise<void> => {
    if (ctx === null) return;
    const { camera: pose, animate = true } = (args as ApplyStepArgs | undefined) ?? { camera: null };
    if (!pose) return;
    lastPose = pose;
    // Stable non-null handle across the await below.
    const context = ctx;
    const controls = context.cameraControls;
    const box = await context.commands.execute<undefined, Box | null>('camera.getSceneBox');
    if (!box || ctx === null) return;

    // Model center + bounding-sphere radius.
    const cx = (box.min.x + box.max.x) / 2;
    const cy = (box.min.y + box.max.y) / 2;
    const cz = (box.min.z + box.max.z) / 2;
    const r =
      Math.hypot(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z) / 2;
    if (r <= 0) return;

    // Aim at the featured snag anchor (re-based from its model's LOCAL frame,
    // like snagSpotlightPlugin) or the model center. Borrow the camera's
    // Vector3 as scratch — no `three` import, matching the sibling plugins.
    let tx = cx;
    let ty = cy;
    let tz = cz;
    if (pose.lookAtAnchor && anchor !== null) {
      const model = context.models().get(anchor.modelId);
      const v = context.camera.position.clone();
      v.set(anchor.position.x, anchor.position.y, anchor.position.z);
      if (model) {
        model.object.updateWorldMatrix(true, false);
        v.applyMatrix4(model.object.matrixWorld);
      }
      tx = v.x;
      ty = v.y;
      tz = v.z;
    }

    const cam = context.camera as unknown as { fov: number; aspect: number };
    const halfV = ((cam.fov ?? 60) * Math.PI) / 180 / 2;
    const halfH = Math.atan(Math.tan(halfV) * (cam.aspect ?? 1));
    // Distance that fits the sphere in the limiting (smaller) half-angle,
    // scaled by the step's factor (1 = plain fit, <1 = closer).
    const d0 = r / Math.sin(Math.min(halfV, halfH));
    const dd = d0 * pose.distanceFactor;

    // Eye on the (azimuth, polar) sphere around the target, distance dd.
    // camera-controls / three Spherical, Y-up: x = sinφ·sinθ, y = cosφ,
    // z = sinφ·cosθ.
    const polarRad = (pose.polarDeg * Math.PI) / 180;
    const azimuthRad = (pose.azimuthDeg * Math.PI) / 180;
    const sinP = Math.sin(polarRad);
    const ex = tx + dd * sinP * Math.sin(azimuthRad);
    const ey = ty + dd * Math.cos(polarRad);
    const ez = tz + dd * sinP * Math.cos(azimuthRad);
    void controls.setLookAt(ex, ey, ez, tx, ty, tz, animate);

    // A negative focal offset slides the subject the OTHER way along the
    // camera axis (see cameraZoomPlugin's panFraction note): desktop shifts
    // the model RIGHT clearing the left-aligned step card; below lg the card
    // is bottom-anchored, so shift the model UP instead.
    const wide = typeof window !== 'undefined' && window.innerWidth >= 1024;
    const offsetX = wide ? -Math.tan(halfH) * dd * panFraction : 0;
    const offsetY = wide ? 0 : -Math.tan(halfV) * dd * liftFraction;
    void controls.setFocalOffset(offsetX, offsetY, 0, animate);

    ctx.requestRender();
  };

  const emitCutChange = (planes: SectionPlaneData[]): void => {
    ctx?.events.emit('section:change', {
      planes: planes.map((p) => ({ id: CUT_PLANE_ID, ...p })),
    });
  };

  const clearCut = (): void => {
    if (ctx === null || !cutActive) return;
    cutActive = false;
    cutPlanes = null;
    forEachMaterial((mat) => {
      if (mat.clippingPlanes) {
        mat.clippingPlanes = null;
        mat.needsUpdate = true;
      }
    });
    ctx.renderer.localClippingEnabled = false;
    emitCutChange([]);
    ctx.requestRender();
  };

  const setCut = (args: unknown): void => {
    if (ctx === null) return;
    const { enabled = false, t = 0 } = (args as Partial<SetCutArgs> | undefined) ?? {};
    if (!enabled) {
      clearCut();
      return;
    }

    // Union of the loaded models' world AABBs (sync — this runs per scrub
    // frame, so no async getSceneBox round-trip).
    let minY = Infinity;
    let maxY = -Infinity;
    let cx = 0;
    let cz = 0;
    let any = false;
    for (const m of ctx.models().values()) {
      const b = m.box;
      if (!b || b.isEmpty()) continue;
      any = true;
      minY = Math.min(minY, b.min.y);
      maxY = Math.max(maxY, b.max.y);
      cx = (b.min.x + b.max.x) / 2;
      cz = (b.min.z + b.max.z) / 2;
    }
    if (!any) return;

    // Y-up: the plane starts at the roof and sweeps down, clipping everything
    // ABOVE it (normal points down → the upper half-space is the negative
    // side). The deepest cut keeps the ground floor so the model never
    // disappears entirely.
    const tc = Math.min(Math.max(t, 0), 1);
    const height = maxY - tc * (maxY - minY) * CUT_DEPTH_FRACTION;
    const data: SectionPlaneData = {
      normal: { x: 0, y: -1, z: 0 },
      point: { x: cx, y: height, z: cz },
      active: true,
    };
    const fresh = buildClippingPlanes([data])[0];
    if (!fresh) return;

    const plane = cutPlanes?.[0];
    if (!cutActive || !plane) {
      // Enable transition: assign the (single-element) plane array to every
      // fragment material once; count 0→1 needs a shader recompile.
      cutActive = true;
      cutPlanes = [fresh];
      const planes = cutPlanes;
      forEachMaterial((mat) => {
        mat.clippingPlanes = planes;
        mat.needsUpdate = true;
      });
      ctx.renderer.localClippingEnabled = true;
    } else {
      // Scrub: mutate the shared plane in place — same count, no recompile.
      plane.normal.copy(fresh.normal);
      plane.constant = fresh.constant;
    }
    emitCutChange([data]);
    ctx.requestRender();
  };

  return {
    name: 'story-director',
    install(context: ViewerContext): void {
      ctx = context;
      // One damped flight per step; fast scrolls interrupt gracefully.
      // Dedicated story viewer — no restore needed on uninstall.
      context.cameraControls.smoothTime = smoothTime;

      context.commands.register('story.applyStep', applyStep, {
        title: 'Fly the story camera to a step pose (model-relative)',
      });
      context.commands.register('story.setCut', setCut, {
        title: 'Drive the story dollhouse cut plane (0..1 sweep)',
      });
      context.commands.register(
        'story.setAnchor',
        (args: unknown) => {
          anchor = (args as SetAnchorArgs | undefined) ?? null;
        },
        { title: 'Set the featured snag anchor for lookAtAnchor poses' },
      );

      // Re-assert on every model load: `model:loaded` fires before the
      // viewer's built-in `camera.zoomExtents`, and the host's onReady pose
      // runs after it — this handler covers later loads/streaming (same trick
      // as cameraZoomPlugin) and keeps streamed-in materials clipped.
      offModelLoaded = context.events.on('model:loaded', () => {
        if (lastPose) void applyStep({ camera: lastPose, animate: false });
        if (cutActive && cutPlanes) {
          const planes = cutPlanes;
          forEachMaterial((mat) => {
            if (mat.clippingPlanes !== planes) {
              mat.clippingPlanes = planes;
              mat.needsUpdate = true;
            }
          });
          context.requestRender();
        }
      });
    },
    uninstall(): void {
      offModelLoaded?.();
      offModelLoaded = null;
      clearCut();
      anchor = null;
      lastPose = null;
      ctx = null;
    },
  };
}
