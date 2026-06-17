/**
 * Section plugin — clipping planes for cutting through geometry.
 *
 * Wraps ThatOpen's `Clipper` component internally for plane creation,
 * deletion, material clipping, and interactive gizmos (TransformControls).
 * Our plugin layer adds the command/event interface consumed by the rest
 * of the viewer ecosystem.
 *
 * Depends on the camera plugin for scene-box computation used when sizing
 * the visual plane helper.
 */

import * as THREE from 'three';
import { Clipper, Worlds } from '@thatopen/components';
import type { SimplePlane, World } from '@thatopen/components';
import type { Plugin, Vec3, ViewerContext } from '../../../core/types.js';

const NAME = 'section' as const;

export interface SectionPlane {
  id: string;
  normal: Vec3;
  point: Vec3;
  active: boolean;
}

export interface SectionPluginOptions {
  /** Default helper plane size. Default: 5. */
  helperSize?: number;
  /** Helper plane colour. Default: 0x1e90ff (dodger blue). */
  helperColor?: number;
  /** Helper plane opacity. Default: 0.12. */
  helperOpacity?: number;
}

export interface SectionConfig {
  helperSize: number;
  helperColor: number;
  helperOpacity: number;
}

export interface SectionPluginAPI {
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  planes(): SectionPlane[];
}

export function sectionPlugin(
  options: SectionPluginOptions = {},
): Plugin & SectionPluginAPI {
  let helperSize = options.helperSize ?? 5;
  let helperColor = options.helperColor ?? 0x1e90ff;
  let helperOpacity = options.helperOpacity ?? 0.12;

  let ctxRef: ViewerContext | null = null;
  let clipper: Clipper | null = null;
  let world: World | null = null;
  let enabled = true;

  let placementActive = false;
  let selectedId: string | null = null;
  // Map our stable string ids to Clipper's SimplePlane ids
  let nextId = 0;
  const ourIdToClipperId = new Map<string, string>();
  const clipperIdToOurId = new Map<string, string>();

  const getPlane = (id: string): SimplePlane | null => {
    if (!clipper) return null;
    const cId = ourIdToClipperId.get(id);
    if (!cId) return null;
    return clipper.list.get(cId) ?? null;
  };

  // ----- emit -----

  const emitChange = (): void => {
    if (!ctxRef) return;
    const planes = list();
    ctxRef.events.emit('section:change', { planes });
  };

  // ----- serialization -----

  const serializePlane = (plane: SimplePlane, id: string): SectionPlane => ({
    id,
    normal: { x: plane.normal.x, y: plane.normal.y, z: plane.normal.z },
    point: { x: plane.origin.x, y: plane.origin.y, z: plane.origin.z },
    active: plane.enabled,
  });

  const list = (): SectionPlane[] => {
    if (!clipper) return [];
    const result: SectionPlane[] = [];
    for (const [cId, plane] of clipper.list) {
      const ourId = clipperIdToOurId.get(cId);
      if (ourId) result.push(serializePlane(plane, ourId));
    }
    return result;
  };

  // ----- commands -----

  const add = (args: unknown): string => {
    if (!ctxRef || !clipper || !world || !enabled) return '';
    const opts = (args ?? {}) as { normal?: Vec3; point?: Vec3 };
    const normal = opts.normal
      ? new THREE.Vector3(opts.normal.x, opts.normal.y, opts.normal.z).normalize()
      : new THREE.Vector3(0, 1, 0);
    const point = opts.point
      ? new THREE.Vector3(opts.point.x, opts.point.y, opts.point.z)
      : getDefaultPoint();

    const clipperId = clipper.createFromNormalAndCoplanarPoint(world, normal, point);
    const ourId = `section-${String(++nextId)}`;
    ourIdToClipperId.set(ourId, clipperId);
    clipperIdToOurId.set(clipperId, ourId);

    // Apply our styling
    const plane = getPlane(ourId);
    if (plane) {
      applyStyle(plane);
    }

    ctxRef.renderer.localClippingEnabled = true;
    emitChange();
    selectPlane(ourId);
    return ourId;
  };

  const remove = (args: unknown): void => {
    if (!ctxRef || !clipper || !world) return;
    const id = typeof args === 'string' ? args : (args as { id?: string })?.id;
    if (!id) return;
    const cId = ourIdToClipperId.get(id);
    if (!cId) return;

    if (selectedId === id) selectPlane(null);
    void clipper.delete(world, cId).catch(() => undefined);
    ourIdToClipperId.delete(id);
    clipperIdToOurId.delete(cId);

    if (ourIdToClipperId.size === 0) {
      ctxRef.renderer.localClippingEnabled = false;
    }
    emitChange();
  };

  const removeAll = (): void => {
    if (!ctxRef || !clipper) return;
    selectPlane(null);
    clipper.deleteAll();
    ourIdToClipperId.clear();
    clipperIdToOurId.clear();
    ctxRef.renderer.localClippingEnabled = false;
    emitChange();
  };

  const toggle = (args: unknown): void => {
    if (!ctxRef || !clipper || !enabled) return;
    const id = typeof args === 'string' ? args : (args as { id?: string })?.id;
    if (id) {
      const plane = getPlane(id);
      if (!plane) return;
      plane.enabled = !plane.enabled;
    } else {
      // Toggle all
      const allActive = [...clipper.list.values()].every((p) => p.enabled);
      for (const plane of clipper.list.values()) {
        plane.enabled = !allActive;
      }
    }
    emitChange();
  };

  const flip = (args: unknown): void => {
    if (!ctxRef || !clipper || !enabled) return;
    const id = typeof args === 'string' ? args : (args as { id?: string })?.id;
    if (!id) return;
    const plane = getPlane(id);
    if (!plane) return;
    const negNormal = plane.normal.clone().negate();
    plane.setFromNormalAndCoplanarPoint(negNormal, plane.origin);
    emitChange();
  };

  // ----- selection -----

  const selectPlane = (id: string | null): void => {
    if (selectedId === id) return;
    // Deactivate controls on previous selection
    if (selectedId) {
      const prev = getPlane(selectedId);
      if (prev) {
        prev.visible = true;
        // Deactivate TransformControls by hiding then showing
        // SimplePlane's controls are toggled via visible + enabled state
      }
    }
    selectedId = id;
    if (id) {
      const plane = getPlane(id);
      if (plane) {
        plane.visible = true;
      }
    }
    ctxRef?.events.emit('section:select', { id });
  };

  // ----- placement mode -----

  const activate = async (): Promise<void> => {
    if (!ctxRef || !clipper || !world || !enabled || placementActive) return;
    placementActive = true;

    // Use Clipper's built-in interactive creation
    const created = await clipper.create(world).catch(() => null);
    placementActive = false;

    if (created) {
      // Register the created plane with our id system
      // Find the clipper id for this new plane
      for (const [cId, plane] of clipper.list) {
        if (plane === created && !clipperIdToOurId.has(cId)) {
          const ourId = `section-${String(++nextId)}`;
          ourIdToClipperId.set(ourId, cId);
          clipperIdToOurId.set(cId, ourId);
          applyStyle(plane);
          if (ctxRef) ctxRef.renderer.localClippingEnabled = true;
          emitChange();
          selectPlane(ourId);
          break;
        }
      }
    }
  };

  const deactivate = async (): Promise<void> => {
    if (!ctxRef || !placementActive) return;
    // Clipper's create() is awaited; cancellation is not directly exposed.
    // The placement promise will resolve/reject when the user clicks or cancels.
    placementActive = false;
  };

  // ----- helpers -----

  const getDefaultPoint = (): THREE.Vector3 => {
    if (!ctxRef) return new THREE.Vector3();
    const box = new THREE.Box3();
    for (const model of ctxRef.models().values()) {
      const mBox = model.box;
      if (mBox && !mBox.isEmpty()) box.union(mBox);
    }
    if (box.isEmpty()) return new THREE.Vector3();
    return box.getCenter(new THREE.Vector3());
  };

  const applyStyle = (plane: SimplePlane): void => {
    plane.size = helperSize;
    try {
      const mat = plane.planeMaterial;
      if (mat && !Array.isArray(mat)) {
        (mat as THREE.MeshBasicMaterial).color.set(helperColor);
        (mat as THREE.MeshBasicMaterial).opacity = helperOpacity;
        mat.needsUpdate = true;
      }
    } catch {
      // Material may not be a MeshBasicMaterial in all cases
    }
  };

  const setEnabled = (next: boolean): void => {
    if (enabled === next) return;
    enabled = next;
    if (clipper) {
      clipper.enabled = next;
      clipper.visible = next;
    }
    if (!next && ctxRef) {
      ctxRef.renderer.localClippingEnabled = false;
    } else if (next && ctxRef && ourIdToClipperId.size > 0) {
      ctxRef.renderer.localClippingEnabled = true;
    }
    ctxRef?.events.emit('feature:enabled', { name: NAME, enabled });
    emitChange();
  };

  const api: Plugin & SectionPluginAPI = {
    name: NAME,
    dependencies: ['camera', 'mode'],

    planes: list,
    setEnabled,
    isEnabled() { return enabled; },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      // Get ThatOpen Clipper and World
      clipper = ctx.components.get(Clipper);
      const worlds = ctx.components.get(Worlds);
      world = worlds.list.values().next().value ?? null;

      if (clipper) {
        clipper.enabled = true;
        // Per-material clipping keeps UI overlays (viewcube, pivot) unclipped
        clipper.localClippingPlanes = true;

        // Bridge Clipper events → our event bus
        clipper.onAfterDrag.add(() => {
          emitChange();
          ctx.requestRender();
        });
      }

      ctx.commands.register('section.add', (args: unknown) => add(args), {
        title: 'Add a section plane',
      });
      ctx.commands.register('section.remove', (args: unknown) => remove(args), {
        title: 'Remove a section plane',
      });
      ctx.commands.register('section.removeAll', () => removeAll(), {
        title: 'Remove all section planes',
      });
      ctx.commands.register('section.toggle', (args: unknown) => toggle(args), {
        title: 'Toggle section plane(s)',
      });
      ctx.commands.register('section.flip', (args: unknown) => flip(args), {
        title: 'Flip section plane normal',
      });
      ctx.commands.register('section.list', () => list(), {
        title: 'List section planes',
      });
      ctx.commands.register('section.setEnabled', (args: unknown) => {
        const on = typeof args === 'boolean' ? args : (args as { enabled?: boolean })?.enabled;
        if (typeof on === 'boolean') setEnabled(on);
        return enabled;
      }, { title: 'Enable/disable section feature' });
      ctx.commands.register('section.isEnabled', () => enabled, {
        title: 'Get section enabled state',
      });

      // Placement mode commands
      ctx.commands.register('section.activate', () => activate(), {
        title: 'Enter section placement mode',
      });
      ctx.commands.register('section.deactivate', () => deactivate(), {
        title: 'Exit section placement mode',
      });
      ctx.commands.register('section.isActive', () => placementActive, {
        title: 'Check if section placement mode is active',
      });

      // Selection commands
      ctx.commands.register('section.select', (args: unknown) => {
        const id = args === null ? null : typeof args === 'string' ? args : (args as { id?: string | null })?.id ?? null;
        selectPlane(id);
      }, { title: 'Select a section plane' });
      ctx.commands.register('section.getSelected', () => selectedId, {
        title: 'Get selected section plane ID',
      });

      // Manipulation commands
      ctx.commands.register('section.move', (args: unknown) => {
        const { id, offset } = args as { id: string; offset: number };
        const plane = getPlane(id);
        if (!plane) return;
        const newPoint = plane.origin.clone().addScaledVector(plane.normal, offset);
        plane.setFromNormalAndCoplanarPoint(plane.normal, newPoint);
        emitChange();
      }, { title: 'Slide section plane along its normal' });

      ctx.commands.register('section.setNormal', (args: unknown) => {
        const { id, normal: n } = args as { id: string; normal: Vec3 };
        const plane = getPlane(id);
        if (!plane) return;
        plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(n.x, n.y, n.z), plane.origin);
        emitChange();
      }, { title: 'Set section plane orientation' });

      ctx.commands.register('section.setPoint', (args: unknown) => {
        const { id, point: p } = args as { id: string; point: Vec3 };
        const plane = getPlane(id);
        if (!plane) return;
        plane.setFromNormalAndCoplanarPoint(plane.normal, new THREE.Vector3(p.x, p.y, p.z));
        emitChange();
      }, { title: 'Set section plane position' });

      ctx.commands.register('section.rotate', (args: unknown) => {
        const { id, axis: a, angle } = args as { id: string; axis: Vec3; angle: number };
        const plane = getPlane(id);
        if (!plane) return;
        const axisVec = new THREE.Vector3(a.x, a.y, a.z).normalize();
        const quat = new THREE.Quaternion().setFromAxisAngle(axisVec, angle);
        const newNormal = plane.normal.clone().applyQuaternion(quat);
        plane.setFromNormalAndCoplanarPoint(newNormal, plane.origin);
        emitChange();
      }, { title: 'Rotate section plane normal around axis' });

      ctx.commands.register('section.getExtent', (args: unknown) => {
        const id = typeof args === 'string' ? args : (args as { id?: string })?.id;
        if (!id || !ctxRef) return null;
        const plane = getPlane(id);
        if (!plane) return null;
        const box = new THREE.Box3();
        for (const model of ctxRef.models().values()) {
          const mBox = model.box;
          if (mBox && !mBox.isEmpty()) box.union(mBox);
        }
        if (box.isEmpty()) return null;
        const corners = [
          new THREE.Vector3(box.min.x, box.min.y, box.min.z),
          new THREE.Vector3(box.max.x, box.min.y, box.min.z),
          new THREE.Vector3(box.min.x, box.max.y, box.min.z),
          new THREE.Vector3(box.min.x, box.min.y, box.max.z),
          new THREE.Vector3(box.max.x, box.max.y, box.min.z),
          new THREE.Vector3(box.max.x, box.min.y, box.max.z),
          new THREE.Vector3(box.min.x, box.max.y, box.max.z),
          new THREE.Vector3(box.max.x, box.max.y, box.max.z),
        ];
        const n = plane.normal;
        const projections = corners.map((c) => c.dot(n));
        const min = Math.min(...projections);
        const max = Math.max(...projections);
        const current = plane.origin.dot(n);
        return { min, max, current };
      }, { title: 'Get slider range for a section plane' });

      ctx.commands.register('section.getConfig', (): SectionConfig => ({
        helperSize, helperColor, helperOpacity,
      }), { title: 'Get section display config' });

      ctx.commands.register('section.setConfig', (args: unknown) => {
        const cfg = args as Partial<SectionConfig>;
        if (cfg.helperSize !== undefined) helperSize = cfg.helperSize;
        if (cfg.helperColor !== undefined) helperColor = cfg.helperColor;
        if (cfg.helperOpacity !== undefined) helperOpacity = cfg.helperOpacity;

        // Apply updated style to all existing planes
        if (clipper) {
          clipper.size = helperSize;
          const mat = clipper.material;
          if (mat) {
            mat.color.set(helperColor);
            mat.opacity = helperOpacity;
            mat.needsUpdate = true;
          }
          for (const plane of clipper.list.values()) {
            applyStyle(plane);
          }
        }
        emitChange();
      }, { title: 'Update section display config' });
    },

    uninstall() {
      if (clipper) {
        clipper.deleteAll();
        clipper.enabled = false;
      }
      ourIdToClipperId.clear();
      clipperIdToOurId.clear();
      selectedId = null;
      placementActive = false;
      if (ctxRef) {
        ctxRef.renderer.localClippingEnabled = false;
      }
      clipper = null;
      world = null;
      ctxRef = null;
    },
  };

  return api;
}
