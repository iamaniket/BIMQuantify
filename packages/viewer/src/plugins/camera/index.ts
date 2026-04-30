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

import type { ItemId, Plugin, Vec3, ViewerContext } from '../../core/types.js';

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
  /** Padding multiplier when framing geometry. Default: 1.8 (matches initial mount). */
  framePadding?: number;
}

export function cameraPlugin(options: CameraPluginOptions = {}): Plugin {
  const padding = options.framePadding ?? 1.8;

  return {
    name: NAME,

    install(ctx: ViewerContext) {
      const { commands } = ctx;

      const setView = async (view: ViewName): Promise<void> => {
        const box = computeSceneBox(ctx);
        const fallback = box.isEmpty();
        const center = fallback ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
        const size = fallback ? new THREE.Vector3(10, 10, 10) : box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z, 1);
        const distance = maxDim * padding;

        const dir = VIEW_DIRECTIONS[view];
        const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
        const offset = {
          x: (dir[0] / len) * distance,
          y: (dir[1] / len) * distance,
          z: (dir[2] / len) * distance,
        };

        await ctx.cameraControls.setLookAt(
          center.x + offset.x,
          center.y + offset.y,
          center.z + offset.z,
          center.x,
          center.y,
          center.z,
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

      // Generic "frame model along an arbitrary direction" — used by the
      // ViewCube for edge/corner picks (any of the 26 regions can resolve
      // to a non-axis vector). Direction is normalised here.
      commands.register(
        'camera.view.fromVector',
        async (args) => {
          const a = args as { direction: Vec3 } | undefined;
          if (!a?.direction) return;
          const len = Math.hypot(a.direction.x, a.direction.y, a.direction.z) || 1;
          const dx = a.direction.x / len;
          const dy = a.direction.y / len;
          const dz = a.direction.z / len;
          const box = computeSceneBox(ctx);
          const fallback = box.isEmpty();
          const center = fallback ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
          const size = fallback ? new THREE.Vector3(10, 10, 10) : box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z, 1);
          const distance = maxDim * padding;
          await ctx.cameraControls.setLookAt(
            center.x + dx * distance,
            center.y + dy * distance,
            center.z + dz * distance,
            center.x,
            center.y,
            center.z,
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
          await frameBox(ctx, box, padding);
        },
        { title: 'Zoom to fit', defaultShortcut: 'F' },
      );

      commands.register(
        'camera.frameSelection',
        async () => {
          // selection plugin owns the state — read it through the registry
          // by calling the `selection.get` command. If selection isn't
          // installed, fall back to zoomExtents.
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
          await frameBox(ctx, box, padding);
        },
        { title: 'Frame selection', defaultShortcut: 'Shift+F' },
      );
    },

    uninstall() {
      // Commands cleaned up by ownership; nothing else to tear down.
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

async function frameBox(
  ctx: ViewerContext,
  box: THREE.Box3,
  padding: number,
): Promise<void> {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1);
  const distance = maxDim * padding;
  // Preserve current view direction.
  const camPos = ctx.camera.position.clone();
  const target = new THREE.Vector3();
  ctx.cameraControls.getTarget(target);
  const dir = camPos.clone().sub(target).normalize();
  if (dir.lengthSq() === 0) dir.set(1, 1, 1).normalize();
  await ctx.cameraControls.setLookAt(
    center.x + dir.x * distance,
    center.y + dir.y * distance,
    center.z + dir.z * distance,
    center.x,
    center.y,
    center.z,
    true,
  );
}
