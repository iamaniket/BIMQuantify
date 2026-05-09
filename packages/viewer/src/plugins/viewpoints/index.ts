import * as THREE from 'three';

import type { Plugin, ViewerContext, ItemId, Vec3 } from '../../core/types.js';

const NAME = 'viewpoints' as const;

export interface Viewpoint {
  id: string;
  name: string;
  camera: {
    position: Vec3;
    target: Vec3;
    up: Vec3;
    projection: 'perspective' | 'orthographic';
  };
  selection?: ItemId[];
  visibility?: { hidden: ItemId[]; isolated: ItemId[] };
  sectionPlanes?: Array<{ normal: Vec3; point: Vec3 }>;
  snapshot?: string;
  createdAt: number;
}

export interface ViewpointsPluginAPI {
  save(name: string, options?: { includeSnapshot?: boolean }): Viewpoint;
  restore(id: string, options?: { animate?: boolean }): Promise<void>;
  remove(id: string): void;
  list(): Viewpoint[];
  update(id: string, partial: Partial<Pick<Viewpoint, 'name'>>): void;
}

let nextVpId = 0;

export function viewpointsPlugin(): Plugin & ViewpointsPluginAPI {
  let ctxRef: ViewerContext | null = null;
  const viewpoints = new Map<string, Viewpoint>();

  const emitChange = (): void => {
    ctxRef?.events.emit('viewpoint:change', {
      viewpoints: [...viewpoints.values()].map((v) => ({ id: v.id, name: v.name })),
    });
  };

  const captureCamera = (): Viewpoint['camera'] => {
    if (!ctxRef) {
      return { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 1, z: 0 }, projection: 'perspective' };
    }
    const cam = ctxRef.camera;
    const target = new THREE.Vector3();
    ctxRef.cameraControls.getTarget(target);
    const up = cam.up;
    return {
      position: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
      target: { x: target.x, y: target.y, z: target.z },
      up: { x: up.x, y: up.y, z: up.z },
      projection: cam instanceof THREE.OrthographicCamera ? 'orthographic' : 'perspective',
    };
  };

  const captureSnapshot = (): string | undefined => {
    if (!ctxRef) return undefined;
    try {
      ctxRef.renderer.render(ctxRef.scene, ctxRef.camera);
      return ctxRef.canvas.toDataURL('image/png');
    } catch {
      return undefined;
    }
  };

  const api: Plugin & ViewpointsPluginAPI = {
    name: NAME,
    dependencies: ['camera'],

    save(name, options) {
      const id = `vp-${String(++nextVpId)}-${String(Date.now())}`;
      const snapshot = options?.includeSnapshot !== false ? captureSnapshot() : null;
      const vp: Viewpoint = {
        id,
        name,
        camera: captureCamera(),
        ...(snapshot != null ? { snapshot } : {}),
        createdAt: Date.now(),
      };
      viewpoints.set(id, vp);
      emitChange();
      return vp;
    },

    async restore(id, options) {
      const vp = viewpoints.get(id);
      if (!vp || !ctxRef) return;
      const { position: p, target: t } = vp.camera;
      const animate = options?.animate ?? true;
      await ctxRef.cameraControls.setLookAt(
        p.x, p.y, p.z, t.x, t.y, t.z, animate,
      );
    },

    remove(id) {
      viewpoints.delete(id);
      emitChange();
    },

    list() {
      return [...viewpoints.values()];
    },

    update(id, partial) {
      const vp = viewpoints.get(id);
      if (!vp) return;
      if (partial.name !== undefined) vp.name = partial.name;
      emitChange();
    },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      ctx.commands.register('viewpoint.save', (args: unknown) => {
        const { name, includeSnapshot } = (args as { name?: string; includeSnapshot?: boolean }) ?? {};
        return api.save(name ?? `View ${viewpoints.size + 1}`, {
          ...(includeSnapshot !== undefined ? { includeSnapshot } : {}),
        });
      }, { title: 'Save viewpoint' });

      ctx.commands.register('viewpoint.restore', async (args: unknown) => {
        const { id, animate } = (args as { id: string; animate?: boolean });
        await api.restore(id, {
          ...(animate !== undefined ? { animate } : {}),
        });
      }, { title: 'Restore viewpoint' });

      ctx.commands.register('viewpoint.delete', (args: unknown) => {
        const { id } = args as { id: string };
        api.remove(id);
      }, { title: 'Delete viewpoint' });

      ctx.commands.register('viewpoint.list', () => api.list(), {
        title: 'List viewpoints',
      });

      ctx.commands.register('viewpoint.update', (args: unknown) => {
        const { id, ...partial } = args as { id: string; name?: string };
        api.update(id, partial);
      }, { title: 'Update viewpoint' });
    },

    uninstall() {
      viewpoints.clear();
      ctxRef = null;
    },
  };

  return api;
}
