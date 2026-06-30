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

import { verror } from '../../../core/debugLog.js';
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
import { pdfToPlan, planToPdf, type SheetTransform } from './sheetTransform.js';

export type { SheetTransform } from './sheetTransform.js';

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

type CalibrateArgs = {
  ifcBbox: Bbox3;
  planAxisX: number;
  planAxisY: number;
  /**
   * The model whose floor plan this minimap represents. In a federated
   * multi-discipline view the portal passes the ARCHITECTURAL model's id so
   * storey isolation + space selection target it (not whichever model loaded
   * first). Omitted for the single-file viewer → falls back to the first model.
   */
  modelId?: string;
  /**
   * Optional aligned-PDF-sheet transform. When set, the minimap operates in PDF
   * page coords (see {@link SheetTransform}); omit/null for the generated plan.
   * Can also be switched later via `minimap.setSheetTransform`.
   */
  sheetTransform?: SheetTransform | null;
};
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
  /** Keep the current 3D camera height (world Y) instead of snapping to floor + EYE_HEIGHT. */
  lockHeight?: boolean;
  animate?: boolean;
};

/** Eye height above the storey floor (model units ≈ metres) for first-person placement. */
const EYE_HEIGHT = 1.6;
/** Resolved storey membership (local ids = IFC express ids) + a display label. */
type IsolateArgs = { localIds: number[]; label?: string | null };
/**
 * Cross-model isolation: pre-keyed `{ modelId, localId }` items spanning several
 * federated models (the portal unions every discipline's storeys on one Level).
 * Unlike {@link IsolateArgs} these carry their own modelId, so isolation hides
 * off-level elements across ALL loaded models, not just the plan model.
 */
type IsolateAcrossArgs = {
  items: Array<{ modelId: string; localId: number }>;
  label?: string | null;
};
type CameraPose = { position: ViewerVec3; target: ViewerVec3 };

export function minimapPlugin(
  _options: MinimapPluginOptions = {},
): Plugin & MinimapPluginAPI {
  let ctxRef: ViewerContext | null = null;
  let calibration: Calibration | null = null;
  // The model the floor plan represents (set at calibrate time). Falls back to
  // the first loaded model when unset (single-file viewer).
  let planModelId: string | null = null;
  let activeStorey: string | null = null;
  let isolated = false;
  /** Latest world-space camera pose, projected on the next animation frame. */
  let latestPose: CameraPose | null = null;
  let rafId: number | null = null;
  // Active aligned-sheet transform (PDF<->plan). When set, the minimap operates
  // in PDF page coords: world projections are pushed through planToPdf, and
  // plan->world inputs are pulled back through pdfToPlan. Null -> the generated
  // BIMFPLN2 footprint plan space, unchanged. The single Y-up negation stays in
  // planToViewer/viewerToPlan; this only composes on top.
  let sheetTransform: SheetTransform | null = null;
  const disposers: Array<() => void> = [];

  /** World point -> active plan-surface 2D coords (PDF page if a sheet is set). */
  const worldToPlanSpace = (p: ViewerVec3, cal: Calibration): { x: number; y: number } => {
    const plan = viewerToPlan(p, cal);
    return sheetTransform ? planToPdf(plan, sheetTransform) : plan;
  };

  /** Active plan-surface 2D coords + elevation -> world point (inverse). */
  const planSpaceToWorld = (
    px: number,
    py: number,
    elevation: number,
    cal: Calibration,
  ): ViewerVec3 => {
    const plan = sheetTransform ? pdfToPlan({ x: px, y: py }, sheetTransform) : { x: px, y: py };
    return planToViewer(plan.x, plan.y, elevation, cal);
  };

  const projectAndEmit = (): void => {
    rafId = null;
    const ctx = ctxRef;
    const cal = calibration;
    const pose = latestPose;
    if (!ctx || !cal || !pose) return;
    ctx.events.emit('minimap:pose', {
      here: worldToPlanSpace(pose.position, cal),
      look: worldToPlanSpace(pose.target, cal),
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

  // The model whose floor plan drives the minimap. Federated callers calibrate
  // with the architectural model's id; the single-file viewer falls back to the
  // first (only) loaded model.
  const resolvePlanModelId = (ctx: ViewerContext): string | null =>
    planModelId ?? [...ctx.models().keys()][0] ?? null;

  const calibrate = async (args: CalibrateArgs): Promise<void> => {
    const ctx = ctxRef;
    if (!ctx || !args) return;
    const worldBox = await ctx.commands
      .execute<undefined, WorldBox | null>('camera.getSceneBox')
      .catch((err: unknown) => {
        // Don't silently abort calibration — the minimap would then never track
        // the camera (no "you are here", dead click-to-navigate) with no signal.
        verror('minimap', 'camera.getSceneBox failed during calibrate', err);
        return null;
      });
    if (!worldBox) return;
    planModelId = args.modelId ?? null;
    sheetTransform = args.sheetTransform ?? null;
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
    const p = planSpaceToWorld(args.planX, args.planY, args.elevation, cal);
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
    const eye = planSpaceToWorld(args.planX, args.planY, h, cal);
    const tgt = planSpaceToWorld(args.lookX, args.lookY, h, cal);
    // Height lives on world Y (the IFC up-axis always lands on +Y — see planCoords).
    // When panning from the 2D plan, freeze the eye height so the drag moves only
    // horizontally instead of snapping to the storey floor.
    if (args.lockHeight) {
      const pose = await ctx.commands
        .execute<undefined, CameraPose>('camera.getPose')
        .catch(() => null);
      if (pose) {
        eye.y = pose.position.y;
        tgt.y = pose.position.y; // keep the look level at the locked height
      }
    }
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
    const modelId = resolvePlanModelId(ctx);
    if (!modelId) return;
    const items = localIds.map((localId) => ({ modelId, localId }));
    await ctx.commands.execute('visibility.isolateItem', items).catch(() => undefined);
    isolated = true;
    ctx.events.emit('minimap:level', { storeyName: label, isolated: true });
  };

  /**
   * Isolate elements across SEVERAL models at once. The portal passes the union of
   * every discipline's storeys reconciled onto the active project Level, each item
   * already keyed by its own `{ modelId, localId }`. Empty list → show all.
   */
  const isolateItemsAcrossModels = async (args: IsolateAcrossArgs): Promise<void> => {
    const ctx = ctxRef;
    if (!ctx) return;
    const items = Array.isArray(args?.items) ? args.items : [];
    const label = args?.label ?? null;
    activeStorey = label;
    if (items.length === 0) {
      await showAllLevels();
      return;
    }
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
    const plan = worldToPlanSpace(p, cal);
    return { x: plan.x, y: plan.y, elevation: viewerToPlanElevation(p, cal) };
  };

  /**
   * Switch the active aligned-sheet transform without recalibrating. The portal
   * calls this when the active storey's aligned PDF changes — pass the solved
   * `{ scale, rotationRad, offsetX, offsetY }`, or null to revert to the
   * generated-plan coordinate space. Re-emits the pose marker in the new space.
   */
  const setSheetTransform = (t: SheetTransform | null): void => {
    sheetTransform = t;
    scheduleProject();
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
    return planSpaceToWorld(args.planX, args.planY, args.elevation, cal);
  };

  /**
   * Select an IFC space (room) in 3D by its expressID (== fragment localId).
   * Resolves the modelId internally so the portal never handles it — the 2D
   * floor-plan pane only knows spaceIds.
   */
  const selectSpace = async (args: { spaceId: number } | null): Promise<void> => {
    const ctx = ctxRef;
    if (!ctx || typeof args?.spaceId !== 'number') return;
    const modelId = resolvePlanModelId(ctx);
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
      ctx.commands.register(
        'minimap.isolateItemsAcrossModels',
        (args: unknown) => isolateItemsAcrossModels(args as IsolateAcrossArgs),
        { title: 'Isolate a level across all federated models' },
      );
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
      ctx.commands.register('minimap.setSheetTransform', (args: unknown) =>
        setSheetTransform(args as SheetTransform | null), {
        title: 'Set/clear the active aligned-PDF-sheet transform',
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
        sheetTransform = null;
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
      sheetTransform = null;
    },
  };

  return api;
}
