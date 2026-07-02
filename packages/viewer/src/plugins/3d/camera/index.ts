/**
 * Camera plugin — registers named-view, zoom-extents, and frame-selection
 * commands. Other plugins (ViewCube, keyboard-shortcuts) drive the camera
 * through these commands rather than touching `cameraControls` directly.
 *
 * Default keyboard shortcuts are declared on each command so the
 * `keyboard-shortcuts` plugin can pick them up automatically.
 */

import * as THREE from 'three';
import type * as FRAGS from '@thatopen/fragments';

import { verror } from '../../../core/debugLog.js';
import { frameView } from '../../../core/framing.js';
import { computeVisibleSolidBox } from '../../../core/visibleBox.js';
import type { ItemId, Plugin, Vec3, ViewerContext } from '../../../core/types.js';

const NAME = 'camera' as const;

type ViewName = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'iso';

const VIEW_DIRECTIONS: Record<ViewName, [number, number, number]> = {
  // direction the camera looks FROM (relative to target). Up is +Y.
  top: [0, 1, 0],
  bottom: [0, -1, 0],
  front: [0, 0, 1],
  back: [0, 0, -1],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  iso: [1, 1, 1],
};

const VIEW_SHORTCUTS: Partial<Record<ViewName, string>> = {
  top: 'Numpad7',
  front: 'Numpad1',
  left: 'Numpad3',
  iso: 'Numpad0',
};

interface CameraPluginOptions {
  /** Padding multiplier when framing geometry. Default: 1.2 (matches initial mount). */
  framePadding?: number;
}

export function cameraPlugin(options: CameraPluginOptions = {}): Plugin {
  const padding = options.framePadding ?? 1.2;

  let homeSaved = false;
  let offModelLoaded: (() => void) | null = null;
  let disposed = false;

  return {
    name: NAME,

    install(ctx: ViewerContext) {
      const { commands } = ctx;
      disposed = false;

      offModelLoaded = ctx.events.on('model:loaded', () => {
        // Defer one frame — Viewer.frameModel() sets the camera in
        // the same tick as model:loaded, so we snapshot after it lands.
        // The viewer can be disposed between the event and the frame
        // (unmount during load), after which the camera getter throws.
        requestAnimationFrame(() => {
          if (disposed) return;
          ctx.cameraControls.saveState();
          homeSaved = true;
        });
      });

      const setView = async (view: ViewName): Promise<void> => {
        const dir = VIEW_DIRECTIONS[view];
        await frameView(
          ctx.cameraControls,
          ctx.camera,
          sceneOrFallbackBox(ctx),
          new THREE.Vector3(dir[0], dir[1], dir[2]),
          padding,
          true,
        );
      };

      for (const view of Object.keys(VIEW_DIRECTIONS) as ViewName[]) {
        const shortcut = VIEW_SHORTCUTS[view];
        commands.register(`camera.view.${view}`, () => setView(view), {
          title: `${view[0]?.toUpperCase() ?? ''}${view.slice(1)} view`,
          ...(shortcut ? { defaultShortcut: shortcut } : {}),
        });
      }

      // Relative-orbit primitive used by the ViewCube for live drag and
      // snap-rotate arrows. Wraps camera-controls' `rotate(dA, dP, anim)`
      // so plugins never touch `cameraControls` directly.
      commands.register(
        'camera.orbit.delta',
        async (args) => {
          const a = args as
            | { deltaAzimuth?: number; deltaPolar?: number; animate?: boolean }
            | undefined;
          if (!a) return;
          const dA = a.deltaAzimuth ?? 0;
          const dP = a.deltaPolar ?? 0;
          if (dA === 0 && dP === 0) return;
          await ctx.cameraControls.rotate(dA, dP, a.animate ?? false);
        },
        { title: 'Orbit camera by delta' },
      );

      /** Snap to iso (top-front-right) and fit the given box. */
      const snapIsoAndFit = async (box: THREE.Box3): Promise<void> => {
        await frameView(ctx.cameraControls, ctx.camera, box, new THREE.Vector3(1, 1, 1), padding, true);
      };

      commands.register(
        'camera.home',
        async () => {
          if (homeSaved) {
            await ctx.cameraControls.reset(true);
            return;
          }
          const box = computeSceneBox(ctx);
          if (box.isEmpty()) return;
          await snapIsoAndFit(box);
        },
        { title: 'Home view', defaultShortcut: 'H' },
      );

      // Generic "frame model along an arbitrary direction" — used by the
      // ViewCube for edge/corner picks (any of the 26 regions can resolve
      // to a non-axis vector). Direction is normalised here.
      commands.register(
        'camera.view.fromVector',
        async (args) => {
          const a = args as { direction: Vec3 } | undefined;
          if (!a?.direction) return;
          await frameView(
            ctx.cameraControls,
            ctx.camera,
            sceneOrFallbackBox(ctx),
            new THREE.Vector3(a.direction.x, a.direction.y, a.direction.z),
            padding,
            true,
          );
        },
        { title: 'View along direction' },
      );

      commands.register(
        'camera.zoomExtents',
        async () => {
          const box = computeSceneBox(ctx);
          if (box.isEmpty()) return;
          await snapIsoAndFit(box);
        },
        { title: 'Zoom to fit', defaultShortcut: 'G' },
      );

      commands.register(
        'camera.frameSelection',
        async () => {
          if (!commands.has('selection.get')) {
            await commands.execute('camera.zoomExtents');
            return;
          }
          const selected = await commands.execute<undefined, ItemId[]>('selection.get');
          if (!selected.length) {
            await commands.execute('camera.zoomExtents');
            return;
          }
          const box = await computeSelectionBox(ctx, selected);
          if (box.isEmpty()) return;
          await snapIsoAndFit(box);
        },
        { title: 'Frame selection', defaultShortcut: 'Shift+F' },
      );

      // World-space centroid of the current selection, or null when nothing is
      // selected. Used by the 2D floor-plan pane to pan/pulse the plan to a
      // 3D-selected element (projected through the minimap calibration).
      commands.register(
        'camera.getSelectionCentroid',
        async (): Promise<{ x: number; y: number; z: number } | null> => {
          if (!commands.has('selection.get')) return null;
          const selected = await commands.execute<undefined, ItemId[]>('selection.get');
          if (!selected.length) return null;
          const box = await computeSelectionBox(ctx, selected);
          if (box.isEmpty()) return null;
          const c = box.getCenter(new THREE.Vector3());
          return { x: c.x, y: c.y, z: c.z };
        },
        { title: 'Get selection centroid (world)' },
      );

      // Fit the camera to the currently visible set (all − hidden). When
      // nothing is hidden, this is just zoom-to-fit (fast path). Used by the
      // double-click gesture both to zoom an isolated element and to fit the
      // visible view on an empty-space double-click.
      commands.register(
        'camera.frameVisible',
        async () => {
          const hidden = commands.has('visibility.getHidden')
            ? await commands.execute<undefined, ItemId[]>('visibility.getHidden')
            : [];
          if (!hidden.length) {
            await commands.execute('camera.zoomExtents');
            return;
          }
          // Framing fits to everything that isn't hidden; ghosted/x-rayed
          // items still frame, so no xray exclusion here.
          const box = await computeVisibleSolidBox(ctx, { hidden, xrayed: [] });
          if (box.isEmpty()) return;
          await snapIsoAndFit(box);
        },
        { title: 'Frame visible' },
      );

      // Recenter the camera on a world-space point (e.g. a minimap tap),
      // preserving the current orbit (view direction + distance). Args are
      // THREE world coords — callers convert from plan space first.
      commands.register(
        'camera.flyToPoint',
        async (args) => {
          const a = args as
            | { x?: number; y?: number; z?: number; animate?: boolean }
            | undefined;
          if (!a || a.x === undefined || a.y === undefined || a.z === undefined) return;
          const pos = new THREE.Vector3();
          const tgt = new THREE.Vector3();
          ctx.cameraControls.getPosition(pos);
          ctx.cameraControls.getTarget(tgt);
          const offset = pos.sub(tgt); // preserve orbit + distance
          await ctx.cameraControls.setLookAt(
            a.x + offset.x,
            a.y + offset.y,
            a.z + offset.z,
            a.x,
            a.y,
            a.z,
            a.animate ?? true,
          );
        },
        { title: 'Fly to point' },
      );

      // Gently bring the model back into view WITHOUT yanking to an iso view or
      // changing projection / nav mode — the target for the portal's "Recenter"
      // pill and the empty-space double-click. Unlike `zoomExtents`/`home` (which
      // snap to iso, exiting a first-person walkthrough), this preserves the
      // current viewing angle and re-aims at the model center.
      //
      // The root cause of the model sliding out of frame in first-person/split is
      // accumulated truck/pan `focalOffset`, which `setLookAt` does NOT clear — so
      // we reset it first, then re-center.
      commands.register(
        'camera.recenter',
        async () => {
          const box = computeSceneBox(ctx);
          if (box.isEmpty()) return;
          const center = box.getCenter(new THREE.Vector3());
          const sphere = box.getBoundingSphere(new THREE.Sphere());
          ctx.cameraControls.setFocalOffset(0, 0, 0, false);
          const pos = new THREE.Vector3();
          const tgt = new THREE.Vector3();
          ctx.cameraControls.getPosition(pos);
          ctx.cameraControls.getTarget(tgt);
          const dir = pos.sub(tgt); // current view direction × distance
          let dist = dir.length();
          if (!(dist > 1e-4)) {
            dir.set(0, 0, 1);
            dist = 1;
          }
          dir.normalize();
          // Keep the viewing angle; sanity-clamp distance so the model is neither
          // a speck nor clipped (perspective). Harmless in ortho (size is zoom-driven).
          const r = Math.max(sphere.radius, 1e-3);
          dir.multiplyScalar(THREE.MathUtils.clamp(dist, r * 0.8, r * 12));
          await ctx.cameraControls.setLookAt(
            center.x + dir.x,
            center.y + dir.y,
            center.z + dir.z,
            center.x,
            center.y,
            center.z,
            true,
          );
        },
        { title: 'Recenter on model' },
      );

      // Read the current camera pose so the minimap can draw "you are here"
      // before the first camera:change event fires.
      commands.register(
        'camera.getPose',
        () => {
          const pos = new THREE.Vector3();
          const tgt = new THREE.Vector3();
          ctx.cameraControls.getPosition(pos);
          ctx.cameraControls.getTarget(tgt);
          return {
            position: { x: pos.x, y: pos.y, z: pos.z },
            target: { x: tgt.x, y: tgt.y, z: tgt.z },
          };
        },
        { title: 'Get camera pose' },
      );

      // Current projection mode of the OrthoPerspective rig. Used by callers that
      // switch to orthographic temporarily (e.g. calibration's top-down plan view)
      // so they can restore the prior mode on exit.
      commands.register(
        'camera.getProjection',
        () => ctx.obcCamera.projection.current,
        { title: 'Get camera projection' },
      );

      // Switch the camera projection (perspective ↔ orthographic). Orthographic is
      // a true flat plan — used by calibration so the 3D pane matches the 2D PDF.
      // Switching swaps the active three camera instance, so we must re-bind the
      // fragments LOD/culling to it (otherwise streaming targets the stale camera
      // → holes), and re-assert maxDistance (OrbitMode reverts it to 300 on switch).
      commands.register(
        'camera.setProjection',
        async (args) => {
          const a = args as { mode?: 'Orthographic' | 'Perspective' } | undefined;
          const mode = a?.mode;
          if (mode !== 'Orthographic' && mode !== 'Perspective') return;
          if (ctx.obcCamera.projection.current === mode) return;
          await ctx.obcCamera.projection.set(mode);
          for (const model of ctx.models().values()) {
            (model as FRAGS.FragmentsModel).useCamera(ctx.camera);
          }
          ctx.cameraControls.maxDistance = Infinity;
          // OBC keeps the ortho frustum aspect via a size-delta; a switch that
          // coincides with the calibration pane resize desyncs it from the
          // canvas (horizontal squeeze). Re-derive it absolutely as the last
          // write (no-op when switching to Perspective).
          ctx.syncOrthoAspect();
          // Single source of truth for the toolbar projection toggle — calibration
          // and the minimap also drive projection, so consumers reflect this event
          // rather than tracking optimistic local state.
          ctx.events.emit('camera:projection', { mode });
          ctx.requestRender();
        },
        { title: 'Set camera projection' },
      );

      // Camera responsiveness: lower smoothTime = snappier, higher = more inertial.
      // The 3D rig otherwise inherits camera-controls' library defaults (0.25 /
      // 0.125); the portal maps a single "Responsiveness" slider onto both. Driven
      // live from viewer settings via applyLiveCommands3D — keep it out of
      // needsReload so it never forces a viewer remount.
      commands.register(
        'camera.setDamping',
        (args) => {
          const a = args as
            | { smoothTime?: number; draggingSmoothTime?: number }
            | undefined;
          if (!a) return;
          const c = ctx.cameraControls as unknown as {
            smoothTime: number;
            draggingSmoothTime: number;
          };
          if (typeof a.smoothTime === 'number') c.smoothTime = Math.max(0.0001, a.smoothTime);
          if (typeof a.draggingSmoothTime === 'number') {
            c.draggingSmoothTime = Math.max(0.0001, a.draggingSmoothTime);
          }
          ctx.requestRender();
        },
        { title: 'Set camera damping' },
      );

      // Model world-space AABB, used by the minimap to calibrate the IFC↔viewer
      // transform (the model is recentered on load, so a fixed offset won't do).
      commands.register(
        'camera.getSceneBox',
        () => {
          const box = computeSceneBox(ctx);
          if (box.isEmpty()) return null;
          return {
            min: { x: box.min.x, y: box.min.y, z: box.min.z },
            max: { x: box.max.x, y: box.max.y, z: box.max.z },
          };
        },
        { title: 'Get scene world box' },
      );
    },

    uninstall() {
      disposed = true;
      offModelLoaded?.();
      offModelLoaded = null;
      homeSaved = false;
    },
  };
}

function computeSceneBox(ctx: ViewerContext): THREE.Box3 {
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
  return any ? box : new THREE.Box3();
}

async function computeSelectionBox(
  ctx: ViewerContext,
  selected: ItemId[],
): Promise<THREE.Box3> {
  const out = new THREE.Box3();
  // Group localIds by model.
  const byModel = new Map<string, number[]>();
  for (const item of selected) {
    let arr = byModel.get(item.modelId);
    if (!arr) {
      arr = [];
      byModel.set(item.modelId, arr);
    }
    arr.push(item.localId);
  }
  const models = ctx.models();
  for (const [modelId, ids] of byModel) {
    const model = models.get(modelId);
    if (!model) continue;
    try {
      const mb = await (model as FRAGS.FragmentsModel).getMergedBox(ids);
      if (!mb.isEmpty()) out.union(mb);
    } catch {
      // ignore; some items may not have geometry
    }
  }
  return out;
}

function sceneOrFallbackBox(ctx: ViewerContext): THREE.Box3 {
  const box = computeSceneBox(ctx);
  if (!box.isEmpty()) return box;
  // An empty box with models LOADED means bounds failed to compute (not merely
  // an empty scene) — the ±5 fallback would then frame the wrong place. Log only
  // that anomaly; a genuinely empty scene is expected and stays silent.
  if (ctx.models().size > 0) {
    verror('camera', 'scene box empty despite loaded models — using ±5 fallback frame');
  }
  return new THREE.Box3(new THREE.Vector3(-5, -5, -5), new THREE.Vector3(5, 5, 5));
}
