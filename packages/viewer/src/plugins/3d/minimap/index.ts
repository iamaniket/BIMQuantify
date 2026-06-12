/**
 * Minimap plugin — the model-interaction half of the floor-plan minimap.
 *
 * The portal owns the *presentation* (fetch + decode the floor-plan artifact,
 * draw the plan onto a canvas, the level dropdown). This plugin owns everything
 * that has to reach into the 3D model:
 *   - the per-model IFC↔viewer calibration (built from the IFC bbox + the live
 *     world AABB);
 *   - projecting the live camera onto the plan and emitting `minimap:pose` so
 *     the view can draw the "you are here" marker without any world-space math;
 *   - click-to-navigate (`minimap.navigateTo`) — plan point → camera fly-to;
 *   - storey isolation (`minimap.isolateItems`) — hide every element except the
 *     ones on the selected level, reusing the `visibility` plugin.
 *
 * Storey membership is resolved by the portal from the extraction `metadata`
 * (`elements[].containedIn` walked up the `spatialTree`), not by the runtime
 * classifier: the viewer loads only geometry fragments, so the IFC spatial
 * relations the classifier needs are absent and `byIfcBuildingStorey` returns
 * nothing. The portal passes the resolved `localIds` to `minimap.isolateItems`.
 *
 * This keeps the minimap↔model link inside `ViewerContext` (direct access to
 * the camera, the plugin registry, and the command bus) instead of scattered
 * across portal React effects.
 */

import type { Plugin, ViewerContext, Vec3 } from '../../../core/types.js';

import {
  makeCalibration,
  planToViewer,
  viewerToPlan,
  viewerToPlanElevation,
  type Bbox3,
  type Calibration,
  type ViewerVec3,
  type WorldBox,
} from './planCoords.js';

/** A world point projected onto the plan, with its recovered IFC elevation. */
export type ProjectedPlanPoint = { x: number; y: number; elevation: number };

const NAME = 'minimap' as const;

export interface MinimapPluginOptions {
  // Reserved for future options.
}

export interface MinimapPluginAPI {
  isCalibrated(): boolean;
  activeStorey(): string | null;
  isIsolated(): boolean;
}

type CalibrateArgs = { ifcBbox: Bbox3; planAxisX: number; planAxisY: number };
type NavigateArgs = { planX: number; planY: number; elevation: number };
/** Lift a plan point at a storey elevation into viewer world space. */
type PlanToWorldArgs = { planX: number; planY: number; elevation: number };
/** Place + aim the camera first-person from the plan (here + look, plan coords). */
type PlaceCameraArgs = {
  planX: number;
  planY: number;
  lookX: number;
  lookY: number;
  elevation: number;
  animate?: boolean;
};

/** Eye height above the storey floor (model units ≈ metres) for first-person placement. */
const EYE_HEIGHT = 1.6;
/** Resolved storey membership (local ids = IFC express ids) + a display label. */
type IsolateArgs = { localIds: number[]; label?: string | null };
type CameraPose = { position: ViewerVec3; target: ViewerVec3 };

export function minimapPlugin(
  _options: MinimapPluginOptions = {},
): Plugin & MinimapPluginAPI {
  let ctxRef: ViewerContext | null = null;
  let calibration: Calibration | null = null;
  let activeStorey: string | null = null;
  let isolated = false;
  /** Latest world-space camera pose, projected on the next animation frame. */
  let latestPose: CameraPose | null = null;
  let rafId: number | null = null;
  const disposers: Array<() => void> = [];

  const projectAndEmit = (): void => {
    rafId = null;
    const ctx = ctxRef;
    const cal = calibration;
    const pose = latestPose;
    if (!ctx || !cal || !pose) return;
    ctx.events.emit('minimap:pose', {
      here: viewerToPlan(pose.position, cal),
      look: viewerToPlan(pose.target, cal),
    });
  };

  const scheduleProject = (): void => {
    if (rafId !== null) return;
    if (typeof requestAnimationFrame === 'undefined') {
      projectAndEmit();
      return;
    }
    rafId = requestAnimationFrame(projectAndEmit);
  };

  const calibrate = async (args: CalibrateArgs): Promise<void> => {
    const ctx = ctxRef;
    if (!ctx || !args) return;
    const worldBox = await ctx.commands
      .execute<undefined, WorldBox | null>('camera.getSceneBox')
      .catch(() => null);
    if (!worldBox) return;
    calibration = makeCalibration(args.ifcBbox, worldBox, args.planAxisX, args.planAxisY);
    ctx.events.emit('minimap:calibrated', { calibrated: true });
    // Seed the marker immediately from the current camera pose.
    const pose = await ctx.commands
      .execute<undefined, CameraPose>('camera.getPose')
      .catch(() => null);
    if (pose) {
      latestPose = pose;
      scheduleProject();
    }
  };

  const navigateTo = async (args: NavigateArgs): Promise<void> => {
    const ctx = ctxRef;
    const cal = calibration;
    if (!ctx || !cal || !args) return;
    const p = planToViewer(args.planX, args.planY, args.elevation, cal);
    await ctx.commands
      .execute('camera.flyToPoint', { x: p.x, y: p.y, z: p.z, animate: true })
      .catch(() => undefined);
  };

  /**
   * Place + aim the camera at an eye-level first-person pose from the plan: the
   * `here` plan point becomes the eye (raised by {@link EYE_HEIGHT}), the `look`
   * plan point the target at the same height → a level horizontal view. Unlike
   * `navigateTo` (which preserves the current orbit), this sets the heading.
   */
  const placeCamera = async (args: PlaceCameraArgs): Promise<void> => {
    const ctx = ctxRef;
    const cal = calibration;
    if (!ctx || !cal || !args) return;
    const h = args.elevation + EYE_HEIGHT;
    const eye = planToViewer(args.planX, args.planY, h, cal);
    const tgt = planToViewer(args.lookX, args.lookY, h, cal);
    await ctx.cameraControls
      .setLookAt(eye.x, eye.y, eye.z, tgt.x, tgt.y, tgt.z, args.animate ?? false)
      .catch(() => undefined);
  };

  /**
   * Isolate the given elements (hide everything else). `localIds` are the
   * storey's element express ids, resolved by the portal from the extraction
   * metadata. Empty list → show the full model (no isolation).
   */
  const isolateItems = async (args: IsolateArgs): Promise<void> => {
    const ctx = ctxRef;
    if (!ctx) return;
    const localIds = Array.isArray(args?.localIds) ? args.localIds : [];
    const label = args?.label ?? null;
    activeStorey = label;
    if (localIds.length === 0) {
      await showAllLevels();
      return;
    }
    const modelId = [...ctx.models().keys()][0];
    if (!modelId) return;
    const items = localIds.map((localId) => ({ modelId, localId }));
    await ctx.commands.execute('visibility.isolateItem', items).catch(() => undefined);
    isolated = true;
    ctx.events.emit('minimap:level', { storeyName: label, isolated: true });
  };

  const showAllLevels = async (): Promise<void> => {
    const ctx = ctxRef;
    if (!ctx) return;
    await ctx.commands.execute('visibility.showAll').catch(() => undefined);
    isolated = false;
    ctx.events.emit('minimap:level', { storeyName: activeStorey, isolated: false });
  };

  const project = (p: ViewerVec3, cal: Calibration): ProjectedPlanPoint => {
    const plan = viewerToPlan(p, cal);
    return { x: plan.x, y: plan.y, elevation: viewerToPlanElevation(p, cal) };
  };

  /** Project a world-space point onto the plan (+elevation). Null until calibrated. */
  const projectPoint = (p: ViewerVec3): ProjectedPlanPoint | null => {
    const cal = calibration;
    if (!cal || !p) return null;
    return project(p, cal);
  };

  /** Batch variant of {@link projectPoint} — each entry null if invalid. */
  const projectPoints = (points: ViewerVec3[]): Array<ProjectedPlanPoint | null> => {
    const cal = calibration;
    if (!cal || !Array.isArray(points)) return [];
    return points.map((p) => (p ? project(p, cal) : null));
  };

  /**
   * Lift a plan (X,Y) point at the given elevation into viewer world space — the
   * inverse of {@link projectPoint}. Used by the 2D floor-plan "Add finding"
   * flow to anchor a finding to the 3D model at the clicked storey-floor spot.
   * Null until calibrated.
   */
  const planToWorld = (args: PlanToWorldArgs): ViewerVec3 | null => {
    const cal = calibration;
    if (!cal || !args) return null;
    return planToViewer(args.planX, args.planY, args.elevation, cal);
  };

  /**
   * Select an IFC space (room) in 3D by its expressID (== fragment localId).
   * Resolves the modelId internally so the portal never handles it — the 2D
   * floor-plan pane only knows spaceIds.
   */
  const selectSpace = async (args: { spaceId: number } | null): Promise<void> => {
    const ctx = ctxRef;
    if (!ctx || typeof args?.spaceId !== 'number') return;
    const modelId = [...ctx.models().keys()][0];
    if (!modelId) return;
    await ctx.commands
      .execute('selection.set', [{ modelId, localId: args.spaceId }])
      .catch(() => undefined);
  };

  const api: Plugin & MinimapPluginAPI = {
    name: NAME,
    dependencies: ['visibility'],

    isCalibrated() {
      return calibration !== null;
    },
    activeStorey() {
      return activeStorey;
    },
    isIsolated() {
      return isolated;
    },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      ctx.commands.register('minimap.calibrate', (args: unknown) => calibrate(args as CalibrateArgs), {
        title: 'Calibrate the minimap IFC↔viewer transform',
      });
      ctx.commands.register('minimap.navigateTo', (args: unknown) => navigateTo(args as NavigateArgs), {
        title: 'Fly the camera to a plan point',
      });
      ctx.commands.register('minimap.placeCamera', (args: unknown) => placeCamera(args as PlaceCameraArgs), {
        title: 'Place + aim the camera first-person from the plan',
      });
      ctx.commands.register('minimap.isolateItems', (args: unknown) => isolateItems(args as IsolateArgs), {
        title: 'Isolate a storey in 3D (hide other levels)',
      });
      ctx.commands.register('minimap.showAllLevels', () => showAllLevels(), {
        title: 'Show all levels (clear storey isolation)',
      });
      ctx.commands.register('minimap.getState', () => ({
        calibrated: calibration !== null,
        activeStorey,
        isolated,
      }), { title: 'Get minimap state' });
      ctx.commands.register('minimap.projectPoint', (args: unknown) =>
        projectPoint(args as ViewerVec3), {
        title: 'Project a world point onto the plan',
      });
      ctx.commands.register('minimap.planToWorld', (args: unknown) =>
        planToWorld(args as PlanToWorldArgs), {
        title: 'Lift a plan point at an elevation into world space',
      });
      ctx.commands.register('minimap.projectPoints', (args: unknown) =>
        projectPoints(args as ViewerVec3[]), {
        title: 'Project world points onto the plan (batch)',
      });
      ctx.commands.register('minimap.selectSpace', (args: unknown) =>
        selectSpace(args as { spaceId: number }), {
        title: 'Select an IFC space in 3D by id',
      });

      // Re-project the marker whenever the camera moves (rAF-coalesced).
      const offCam = ctx.events.on('camera:change', (pose: { position: Vec3; target: Vec3 }) => {
        latestPose = { position: pose.position, target: pose.target };
        scheduleProject();
      });
      // A fresh model invalidates the calibration + isolation state.
      const offModel = ctx.events.on('model:loaded', () => {
        calibration = null;
        activeStorey = null;
        isolated = false;
      });
      disposers.push(offCam, offModel);
    },

    uninstall() {
      if (rafId !== null && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(rafId);
      }
      rafId = null;
      disposers.forEach((d) => d());
      disposers.length = 0;
      ctxRef = null;
      calibration = null;
      latestPose = null;
    },
  };

  return api;
}
