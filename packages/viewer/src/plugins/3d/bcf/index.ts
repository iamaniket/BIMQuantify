import * as THREE from 'three';

import type { Plugin, ViewerContext, ItemId, Vec3 } from '../../../core/types.js';
import type { ScreenshotCaptureOptions, ScreenshotResult } from '../screenshot/index.js';
import type { SectionPlane } from '../section/index.js';

const NAME = 'bcf' as const;

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
    return items;
  };

  const itemsToGlobalIds = (items: ItemId[]): string[] => {
    const gids: string[] = [];
    for (const item of items) {
      const gid = itemToGlobalId.get(itemKey(item));
      if (gid) gids.push(gid);
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
      data.camera.fieldOfHeight = orthoCam.top - orthoCam.bottom;
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

    return data;
  };

  const applyViewpoint = async (data: BcfViewpointData): Promise<void> => {
    if (!ctxRef) return;

    // 1. Camera
    const vp = data.camera.viewPoint;
    const d = data.camera.direction;
    const dist = ctxRef.cameraControls.distance || 10;
    const tx = vp.x + d.x * dist;
    const ty = vp.y + d.y * dist;
    const tz = vp.z + d.z * dist;

    await ctxRef.cameraControls.setLookAt(
      vp.x, vp.y, vp.z,
      tx, ty, tz,
      true,
    );

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
    dependencies: ['camera', 'selection', 'visibility', 'section', 'screenshot'],

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
