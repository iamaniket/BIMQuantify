import * as THREE from 'three';

import { verror } from '../../../core/debugLog.js';
import type { Plugin, ViewerContext, ItemId, Vec3, CameraControls } from '../../../core/types.js';
import type { ScreenshotCaptureOptions, ScreenshotResult } from '../screenshot/index.js';
import type { SectionPlane } from '../section/index.js';

const NAME = 'bcf' as const;

/** Fallback orbit-target distance when no geometry is loaded to anchor against. */
const FALLBACK_TARGET_DISTANCE = 10;

/**
 * Union bounding-box centre of every loaded model, or null if none have
 * geometry. Mirrors the box resolution in `Viewer.frameModel`.
 */
function loadedModelsCenter(ctx: ViewerContext): THREE.Vector3 | null {
  const union = new THREE.Box3();
  let has = false;
  for (const model of ctx.models().values()) {
    let box = model.box;
    if (!box || box.isEmpty()) {
      box = new THREE.Box3().setFromObject(model.object);
    }
    if (!box.isEmpty()) {
      union.union(box);
      has = true;
    }
  }
  return has ? union.getCenter(new THREE.Vector3()) : null;
}

export interface BcfViewpointData {
  camera: {
    type: 'perspective' | 'orthographic';
    viewPoint: Vec3;
    direction: Vec3;
    upVector: Vec3;
    fieldOfView?: number;
    fieldOfHeight?: number;
  };
  components?: {
    visibility?: {
      defaultVisibility: boolean;
      exceptions: string[];
    };
    selection?: string[];
  };
  clippingPlanes?: Array<{ location: Vec3; direction: Vec3 }>;
  /**
   * X-ray state (non-standard BCF extension). Element refs are IFC GlobalIds,
   * resolved against the GlobalId map like selection/visibility.
   */
  xray?: {
    items: string[];
    opacityOverrides?: Array<{ globalId: string; opacity: number }>;
  };
  /**
   * Measurements (non-standard BCF extension). World-space points only — no
   * element refs, so they need no GlobalId map.
   */
  measurements?: Array<{
    type: string;
    points: Vec3[];
    height?: number;
  }>;
}

export interface BcfPluginOptions {
  snapshotWidth?: number;
  snapshotHeight?: number;
}

export interface BcfPluginAPI {
  captureViewpoint(): Promise<BcfViewpointData>;
  applyViewpoint(data: BcfViewpointData): Promise<void>;
  captureSnapshot(width?: number, height?: number): Promise<string | null>;
  setGlobalIdMap(map: Map<string, ItemId>): void;
}

export function bcfPlugin(options: BcfPluginOptions = {}): Plugin & BcfPluginAPI {
  const defaultSnapW = options.snapshotWidth ?? 1920;
  const defaultSnapH = options.snapshotHeight ?? 1080;

  let ctxRef: ViewerContext | null = null;
  let globalIdToItem = new Map<string, ItemId>();
  let itemToGlobalId = new Map<string, string>();

  const itemKey = (item: ItemId): string => `${item.modelId}::${String(item.localId)}`;

  const rebuildReverseMap = (): void => {
    itemToGlobalId = new Map();
    for (const [gid, item] of globalIdToItem) {
      itemToGlobalId.set(itemKey(item), gid);
    }
  };

  const globalIdsToItems = (gids: string[]): ItemId[] => {
    const items: ItemId[] = [];
    for (const gid of gids) {
      const item = globalIdToItem.get(gid);
      if (item) items.push(item);
    }
    if (items.length < gids.length) {
      // An incomplete GlobalId map silently drops part of a viewpoint's
      // selection/visibility set on apply — surface the lossy round-trip.
      verror('bcf', `applyViewpoint: ${String(gids.length - items.length)}/${String(gids.length)} GlobalIds had no loaded item (incomplete map)`);
    }
    return items;
  };

  const itemsToGlobalIds = (items: ItemId[]): string[] => {
    const gids: string[] = [];
    for (const item of items) {
      const gid = itemToGlobalId.get(itemKey(item));
      if (gid) gids.push(gid);
    }
    if (gids.length < items.length) {
      verror('bcf', `captureViewpoint: ${String(items.length - gids.length)}/${String(items.length)} items had no GlobalId (incomplete map) — viewpoint will be lossy`);
    }
    return gids;
  };

  const captureViewpoint = async (): Promise<BcfViewpointData> => {
    if (!ctxRef) {
      return {
        camera: {
          type: 'perspective',
          viewPoint: { x: 0, y: 0, z: 0 },
          direction: { x: 0, y: 0, z: -1 },
          upVector: { x: 0, y: 1, z: 0 },
          fieldOfView: 60,
        },
      };
    }

    const cam = ctxRef.camera;
    const target = new THREE.Vector3();
    ctxRef.cameraControls.getTarget(target);
    const dir = target.clone().sub(cam.position).normalize();
    const isOrtho = cam instanceof THREE.OrthographicCamera;

    const data: BcfViewpointData = {
      camera: {
        type: isOrtho ? 'orthographic' : 'perspective',
        viewPoint: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
        direction: { x: dir.x, y: dir.y, z: dir.z },
        upVector: { x: cam.up.x, y: cam.up.y, z: cam.up.z },
      },
    };

    if (isOrtho) {
      const orthoCam = cam as THREE.OrthographicCamera;
      // Visible world height = raw frustum height divided by zoom, so the
      // value survives a round-trip independent of the current zoom level.
      const zoom = orthoCam.zoom || 1;
      data.camera.fieldOfHeight = (orthoCam.top - orthoCam.bottom) / zoom;
    } else {
      const perspCam = cam as THREE.PerspectiveCamera;
      data.camera.fieldOfView = perspCam.fov;
    }

    // Selection
    const selected = (await ctxRef.commands.execute('selection.get')) as ItemId[] | undefined;
    if (selected && selected.length > 0) {
      const gids = itemsToGlobalIds(selected);
      if (gids.length > 0) {
        data.components = { ...data.components, selection: gids };
      }
    }

    // Visibility
    const hidden = (await ctxRef.commands.execute('visibility.getHidden')) as ItemId[] | undefined;
    if (hidden && hidden.length > 0) {
      const gids = itemsToGlobalIds(hidden);
      if (gids.length > 0) {
        data.components = {
          ...data.components,
          visibility: { defaultVisibility: true, exceptions: gids },
        };
      }
    }

    // Section planes
    const planes = (await ctxRef.commands.execute('section.list')) as SectionPlane[] | undefined;
    if (planes && planes.length > 0) {
      data.clippingPlanes = planes
        .filter((p) => p.active)
        .map((p) => ({
          location: { x: p.point.x, y: p.point.y, z: p.point.z },
          direction: { x: p.normal.x, y: p.normal.y, z: p.normal.z },
        }));
    }

    // X-ray (non-standard extension — element refs as GlobalIds)
    const xrayed = (await ctxRef.commands.execute('xray.get')) as ItemId[] | undefined;
    if (xrayed && xrayed.length > 0) {
      const gids = itemsToGlobalIds(xrayed);
      if (gids.length > 0) {
        const overrides = (await ctxRef.commands.execute('xray.getOpacityOverrides')) as
          | Array<{ item: ItemId; opacity: number }>
          | undefined;
        const opacityOverrides = (overrides ?? [])
          .map((o) => ({ globalId: itemToGlobalId.get(itemKey(o.item)), opacity: o.opacity }))
          .filter((o): o is { globalId: string; opacity: number } => o.globalId !== undefined);
        data.xray = {
          items: gids,
          ...(opacityOverrides.length > 0 ? { opacityOverrides } : {}),
        };
      }
    }

    // Measurements (non-standard extension — world-space points only)
    const measurements = (await ctxRef.commands.execute('measure.list')) as
      | Array<{ type: string; points: Vec3[]; height?: number }>
      | undefined;
    if (measurements && measurements.length > 0) {
      data.measurements = measurements.map((m) => ({
        type: m.type,
        points: m.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
        ...(m.height !== undefined ? { height: m.height } : {}),
      }));
    }

    return data;
  };

  const applyViewpoint = async (data: BcfViewpointData): Promise<void> => {
    if (!ctxRef) return;

    // 1. Camera
    const vp = data.camera.viewPoint;
    const d = data.camera.direction;
    const up = data.camera.upVector;
    const controls = ctxRef.cameraControls as CameraControls & {
      updateCameraUp?: () => void;
    };

    // Apply the stored up vector before framing — camera-controls reads
    // camera.up at setLookAt time to compute roll. Captured but previously
    // discarded on restore.
    ctxRef.camera.up.set(up.x, up.y, up.z);
    controls.updateCameraUp?.();

    // BCF stores only a normalised direction (no target/distance). Place the
    // orbit target at the model's depth along the view ray: the rendered view
    // is identical for any target on the ray (eye + direction unchanged), and
    // anchoring at the model keeps `updateDynamicNearFar` (which keys off the
    // camera-to-target distance) from clipping the model away.
    const eye = new THREE.Vector3(vp.x, vp.y, vp.z);
    const dir = new THREE.Vector3(d.x, d.y, d.z).normalize();
    const center = loadedModelsCenter(ctxRef);
    let dist = FALLBACK_TARGET_DISTANCE;
    if (center) {
      const along = center.clone().sub(eye).dot(dir);
      if (along > 1e-3) dist = along;
    }
    const target = eye.clone().addScaledVector(dir, dist);

    // Clear the residual focalOffset accumulated by truck (pan) and
    // pivot-rotate orbit drags. setLookAt does NOT clear it, so without this
    // the camera lands at the desired position + the stale offset — the
    // distorted view seen after panning/orbiting. Mirrors core/framing.ts.
    void controls.setFocalOffset(0, 0, 0, true);

    await ctxRef.cameraControls.setLookAt(
      eye.x, eye.y, eye.z,
      target.x, target.y, target.z,
      true,
    );

    // Orthographic zoom: match the captured visible world height. (The viewer
    // has no runtime perspective<->ortho switch, so this only takes effect
    // when the active camera is already orthographic.)
    if (
      ctxRef.camera instanceof THREE.OrthographicCamera &&
      data.camera.type === 'orthographic' &&
      data.camera.fieldOfHeight !== undefined &&
      data.camera.fieldOfHeight > 0
    ) {
      const orthoCam = ctxRef.camera;
      const frustumHeight = orthoCam.top - orthoCam.bottom;
      if (frustumHeight > 0) {
        void ctxRef.cameraControls.zoomTo(
          frustumHeight / data.camera.fieldOfHeight,
          true,
        );
      }
    }

    // 2. Selection
    if (data.components?.selection) {
      const items = globalIdsToItems(data.components.selection);
      if (items.length > 0) {
        await ctxRef.commands.execute('selection.set', items);
      }
    } else {
      await ctxRef.commands.execute('selection.clear');
    }

    // 3. Visibility
    await ctxRef.commands.execute('visibility.showAll');

    if (data.components?.visibility) {
      const vis = data.components.visibility;
      const items = globalIdsToItems(vis.exceptions);
      if (items.length > 0) {
        if (vis.defaultVisibility) {
          await ctxRef.commands.execute('visibility.hideItem', items);
        } else {
          await ctxRef.commands.execute('visibility.isolateItem', items);
        }
      }
    }

    // 4. Section planes
    await ctxRef.commands.execute('section.removeAll');

    if (data.clippingPlanes) {
      for (const cp of data.clippingPlanes) {
        await ctxRef.commands.execute('section.add', {
          normal: { x: cp.direction.x, y: cp.direction.y, z: cp.direction.z },
          point: { x: cp.location.x, y: cp.location.y, z: cp.location.z },
        });
      }
    }

    // 5. X-ray — reset to the stored state (clear, then re-apply).
    await ctxRef.commands.execute('xray.clear');
    if (data.xray && data.xray.items.length > 0) {
      const items = globalIdsToItems(data.xray.items);
      if (items.length > 0) {
        await ctxRef.commands.execute('xray.setEnabled', true);
        await ctxRef.commands.execute('xray.set', items);
        for (const ov of data.xray.opacityOverrides ?? []) {
          const it = globalIdsToItems([ov.globalId]);
          if (it.length > 0) {
            await ctxRef.commands.execute('xray.setItemOpacity', {
              items: it,
              opacity: ov.opacity,
            });
          }
        }
      }
    }

    // 6. Measurements — reset to the stored state (clear, then recreate).
    await ctxRef.commands.execute('measure.clear');
    if (data.measurements && data.measurements.length > 0) {
      await ctxRef.commands.execute('measure.restore', data.measurements);
    }

    ctxRef.events.emit('viewpoint:change', {
      viewpoints: [],
    });
  };

  const captureSnapshot = async (width?: number, height?: number): Promise<string | null> => {
    if (!ctxRef) return null;
    try {
      const result = (await ctxRef.commands.execute('screenshot.capture', {
        width: width ?? defaultSnapW,
        height: height ?? defaultSnapH,
      } satisfies ScreenshotCaptureOptions)) as ScreenshotResult;
      return result.dataUrl;
    } catch {
      return null;
    }
  };

  const setGlobalIdMap = (map: Map<string, ItemId>): void => {
    globalIdToItem = map;
    rebuildReverseMap();
  };

  const api: Plugin & BcfPluginAPI = {
    name: NAME,
    dependencies: ['camera', 'selection', 'visibility', 'section', 'screenshot', 'xray', 'measurement'],

    captureViewpoint,
    applyViewpoint,
    captureSnapshot,
    setGlobalIdMap,

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      ctx.commands.register(
        'bcf.captureViewpoint',
        async () => captureViewpoint(),
        { title: 'Capture BCF viewpoint' },
      );

      ctx.commands.register(
        'bcf.applyViewpoint',
        async (args: unknown) => {
          await applyViewpoint(args as BcfViewpointData);
        },
        { title: 'Apply BCF viewpoint' },
      );

      ctx.commands.register(
        'bcf.captureSnapshot',
        async (args: unknown) => {
          const a = args as { width?: number; height?: number } | undefined;
          return captureSnapshot(a?.width, a?.height);
        },
        { title: 'Capture BCF snapshot' },
      );

      ctx.commands.register(
        'bcf.setGlobalIdMap',
        (args: unknown) => {
          setGlobalIdMap(args as Map<string, ItemId>);
        },
        { title: 'Set BCF GlobalId map' },
      );
    },

    uninstall() {
      globalIdToItem.clear();
      itemToGlobalId.clear();
      ctxRef = null;
    },
  };

  return api;
}
