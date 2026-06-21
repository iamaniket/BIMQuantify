/**
 * Section plugin — clipping planes for cutting through geometry.
 *
 * Wraps ThatOpen's `Clipper` / `SimplePlane` for plane lifecycle and the
 * interactive `TransformControls` gizmo (translate + rotate). The OBC clipper
 * cannot serve this viewer on its own for two reasons, both repaired here:
 *
 *  - **Placement**: OBC's `clipper.create(world)` raycasts the OBC world's
 *    mesh set, which is empty — this viewer loads models into a private
 *    `FragmentsModels` (`ctx.models()`), hittable only via `model.raycast()`.
 *    So we run placement through the viewer's own `pick()` + edit `mode`, then
 *    create the plane with `createFromNormalAndCoplanarPoint` (no raycast).
 *  - **Clipping**: with `localClippingPlanes = true` OBC assigns
 *    `material.clippingPlanes` only to materials it tracks (its
 *    `FragmentsManager`), so our private fragment materials never clip. We push
 *    the live `SimplePlane.three` planes onto every material in `ctx.models()`
 *    ourselves (`syncMaterialClipping`) and keep them clipped as geometry
 *    streams in.
 *
 * The OBC gizmo's `change` handler (`SimplePlane.update`) only re-derives the
 * plane from `this.normal` + the helper *position* — it ignores the helper's
 * *rotation*. So rotating the gizmo would spin the visual but never re-cut. We
 * attach our own `change` listener that derives the live normal from the
 * helper orientation (`lookAt` aligns local +Z to the normal) so rotation
 * actually reorients the cut.
 *
 * Depends on the camera plugin (scene-box sizing) and the mode plugin
 * (placement is an edit-mode tool, so the panel auto-opens and ESC cancels).
 */

import * as THREE from 'three';
import { Clipper, Worlds } from '@thatopen/components';
import type { SimplePlane, World } from '@thatopen/components';
import type { Plugin, Vec3, ViewerContext } from '../../../core/types.js';
import { pick } from '../../../core/Raycaster.js';
import { createMaterialClippingSync } from './material-clipping.js';

const NAME = 'section' as const;

export type GizmoMode = 'translate' | 'rotate';

export interface SectionPlane {
  id: string;
  normal: Vec3;
  point: Vec3;
  active: boolean;
}

export interface SectionPluginOptions {
  /** Helper plane size as a multiple of the model's largest dimension. Default: 1.1. */
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

/** TransformControls surface we use — narrowed to avoid a hard three/examples dep. */
interface GizmoControls {
  setMode(mode: GizmoMode): void;
  showX: boolean;
  showY: boolean;
  showZ: boolean;
  addEventListener(type: 'change', cb: () => void): void;
  removeEventListener(type: 'change', cb: () => void): void;
}

export function sectionPlugin(
  options: SectionPluginOptions = {},
): Plugin & SectionPluginAPI {
  let helperSize = options.helperSize ?? 1.1;
  let helperColor = options.helperColor ?? 0x1e90ff;
  let helperOpacity = options.helperOpacity ?? 0.12;

  let ctxRef: ViewerContext | null = null;
  let clipper: Clipper | null = null;
  let world: World | null = null;
  let enabled = true;

  let placementActive = false;
  let selectedId: string | null = null;
  let gizmoMode: GizmoMode = 'translate';

  // Map our stable string ids to Clipper's SimplePlane ids
  let nextId = 0;
  const ourIdToClipperId = new Map<string, string>();
  const clipperIdToOurId = new Map<string, string>();
  /** Per-plane `change` listener removers (our rotation-aware sync). */
  const controlSyncCleanup = new Map<string, () => void>();

  let clickUnsub: (() => void) | null = null;

  // Material-clipping subsystem. Owns `material.clippingPlanes` upkeep + the
  // streaming-material / model-loaded subscriptions; reads our live state by
  // injection (ctx, the clipper's plane list, the global `enabled` flag).
  const materialClipping = createMaterialClippingSync({
    getCtx: () => ctxRef,
    getPlanes: () => clipper?.list.values() ?? [],
    isEnabled: () => enabled,
  });
  const syncMaterialClipping = (): void => materialClipping.sync();

  const getPlane = (id: string): SimplePlane | null => {
    if (!clipper) return null;
    const cId = ourIdToClipperId.get(id);
    if (!cId) return null;
    return clipper.list.get(cId) ?? null;
  };

  // ----- emit -----

  const emitChange = (): void => {
    if (!ctxRef) return;
    ctxRef.events.emit('section:change', { planes: list() });
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

  // ----- gizmo + helper visibility -----

  const getControls = (plane: SimplePlane): GizmoControls | null => {
    const tc = (plane as unknown as { controls?: GizmoControls }).controls;
    return tc ?? null;
  };

  const applyGizmoMode = (plane: SimplePlane): void => {
    const tc = getControls(plane);
    if (!tc) return;
    tc.setMode(gizmoMode);
    if (gizmoMode === 'rotate') {
      tc.showX = true;
      tc.showY = true;
      tc.showZ = true;
    } else {
      // Translate only along the plane normal (the helper's local +Z).
      tc.showX = false;
      tc.showY = false;
      tc.showZ = true;
    }
  };

  /**
   * Only the selected, active plane shows its helper + gizmo. We assign
   * `plane.visible` unconditionally: OBC's setter routes through
   * `toggleControls`, which wires the gizmo's `change` / `dragging-changed`
   * (camera-suppression) listeners and is itself guarded against double-add,
   * so re-asserting the current value is cheap and keeps those listeners live.
   */
  const applySelectionVisibility = (): void => {
    if (!clipper) return;
    for (const [cId, plane] of clipper.list) {
      const ourId = clipperIdToOurId.get(cId);
      const shouldShow = enabled && plane.enabled && ourId === selectedId;
      plane.visible = shouldShow;
      if (shouldShow) applyGizmoMode(plane);
    }
  };

  /**
   * Attach a rotation-aware `change` listener to a plane's gizmo. OBC's own
   * `update` ignores helper rotation; we re-derive the normal from the helper's
   * orientation (local +Z) so rotate-mode drags actually reorient the cut, and
   * keep `plane.normal`/`origin`/`three` in sync for serialization + clipping.
   */
  const attachControlSync = (ourId: string, plane: SimplePlane): void => {
    const tc = getControls(plane);
    if (!tc) return;
    const helper = plane.helper;
    const onChange = (): void => {
      const newNormal = new THREE.Vector3(0, 0, 1)
        .applyQuaternion(helper.quaternion)
        .normalize();
      plane.normal.copy(newNormal);
      plane.origin.copy(helper.position);
      plane.three.setFromNormalAndCoplanarPoint(newNormal, helper.position);
      ctxRef?.requestRender();
    };
    tc.addEventListener('change', onChange);
    controlSyncCleanup.set(ourId, () => tc.removeEventListener('change', onChange));
  };

  const detachControlSync = (ourId: string): void => {
    const cleanup = controlSyncCleanup.get(ourId);
    if (cleanup) {
      cleanup();
      controlSyncCleanup.delete(ourId);
    }
  };

  // ----- helpers -----

  const getModelMaxDim = (): number => {
    if (!ctxRef) return 5;
    const box = new THREE.Box3();
    for (const model of ctxRef.models().values()) {
      const mBox = model.box;
      if (mBox && !mBox.isEmpty()) box.union(mBox);
    }
    if (box.isEmpty()) return 5;
    const size = box.getSize(new THREE.Vector3());
    return Math.max(size.x, size.y, size.z) || 5;
  };

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
    // Size the helper to span the model, not OBC's fixed 5 units.
    plane.size = getModelMaxDim() * helperSize;
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

    const plane = getPlane(ourId);
    if (plane) {
      applyStyle(plane);
      attachControlSync(ourId, plane);
    }

    syncMaterialClipping();
    selectPlane(ourId);
    emitChange();
    return ourId;
  };

  const remove = (args: unknown): void => {
    if (!ctxRef || !clipper || !world) return;
    const id = typeof args === 'string' ? args : (args as { id?: string })?.id;
    if (!id) return;
    const cId = ourIdToClipperId.get(id);
    if (!cId) return;

    if (selectedId === id) selectedId = null;
    detachControlSync(id);
    void clipper.delete(world, cId).catch(() => undefined);
    ourIdToClipperId.delete(id);
    clipperIdToOurId.delete(cId);

    syncMaterialClipping();
    applySelectionVisibility();
    emitChange();
  };

  const removeAll = (): void => {
    if (!ctxRef || !clipper) return;
    selectedId = null;
    for (const cleanup of controlSyncCleanup.values()) cleanup();
    controlSyncCleanup.clear();
    clipper.deleteAll();
    ourIdToClipperId.clear();
    clipperIdToOurId.clear();
    syncMaterialClipping();
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
      const allActive = [...clipper.list.values()].every((p) => p.enabled);
      for (const plane of clipper.list.values()) {
        plane.enabled = !allActive;
      }
    }
    syncMaterialClipping();
    applySelectionVisibility();
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
    ctxRef.requestRender();
  };

  // ----- selection -----

  const selectPlane = (id: string | null): void => {
    selectedId = id;
    applySelectionVisibility();
    ctxRef?.events.emit('section:select', { id });
    ctxRef?.requestRender();
  };

  // ----- placement mode (mirrors the measurement edit-mode tool) -----

  const onPlacementClick = async (e: {
    ndc: { x: number; y: number };
    button: number;
  }): Promise<void> => {
    if (!ctxRef || !placementActive || e.button !== 0) return;
    const hit = await pick(ctxRef, e.ndc);
    if (!hit) return; // missed the model — stay armed
    // Coplanar to the clicked face; negate the outward face normal so the cut
    // keeps the interior (reveals what's behind the surface). Fall back to a
    // horizontal cut when the raycast returns no normal.
    const raw = hit.raw.normal;
    const normal = raw
      ? new THREE.Vector3(raw.x, raw.y, raw.z).normalize().negate()
      : new THREE.Vector3(0, 1, 0);
    add({
      normal: { x: normal.x, y: normal.y, z: normal.z },
      point: hit.point,
    });
    // Single-shot: one click places one plane, then exit edit mode.
    await ctxRef.commands.execute('mode.exit').catch(() => undefined);
  };

  const activate = async (): Promise<void> => {
    if (!ctxRef || !clipper || !world || !enabled || placementActive) return;
    placementActive = true;
    clickUnsub = ctxRef.events.on('pointer:click', (ev) => {
      void onPlacementClick(ev);
    });
    await ctxRef.commands.execute('mode.enter', {
      name: 'section.place',
      label: 'Section',
      preserveCamera: true,
      cancel: () => false,
      onExit: () => {
        clickUnsub?.();
        clickUnsub = null;
        placementActive = false;
      },
    });
  };

  const deactivate = async (): Promise<void> => {
    if (!ctxRef || !placementActive) return;
    await ctxRef.commands.execute('mode.exit').catch(() => undefined);
  };

  const setEnabled = (next: boolean): void => {
    if (enabled === next) return;
    enabled = next;
    if (clipper) {
      clipper.enabled = next;
      clipper.visible = next;
    }
    syncMaterialClipping();
    applySelectionVisibility();
    ctxRef?.events.emit('feature:enabled', { name: NAME, enabled });
    emitChange();
  };

  const setGizmoMode = (mode: GizmoMode): void => {
    gizmoMode = mode;
    if (selectedId) {
      const plane = getPlane(selectedId);
      if (plane) applyGizmoMode(plane);
    }
    ctxRef?.requestRender();
  };

  const api: Plugin & SectionPluginAPI = {
    name: NAME,
    dependencies: ['camera', 'mode'],

    planes: list,
    setEnabled,
    isEnabled() { return enabled; },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      clipper = ctx.components.get(Clipper);
      const worlds = ctx.components.get(Worlds);
      world = worlds.list.values().next().value ?? null;

      if (clipper) {
        clipper.enabled = true;
        // Per-material (local) clipping keeps UI overlays (viewcube, pivot,
        // gizmo, finding pins) unclipped — we apply planes to our own fragment
        // materials in `syncMaterialClipping`.
        clipper.localClippingPlanes = true;

        // On drag end: re-serialize (panel + edge overlays snap to the final
        // pose) and repaint. Live in-drag feedback comes from each plane's own
        // `change` listener (`attachControlSync` → requestRender).
        clipper.onAfterDrag.add(() => {
          emitChange();
          ctx.requestRender();
        });
      }

      // Keep streamed-in geometry clipped + clip federated models on load.
      materialClipping.install();

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

      // Gizmo mode (translate / rotate — the "gyroscope")
      ctx.commands.register('section.setGizmoMode', (args: unknown) => {
        const mode = typeof args === 'string' ? args : (args as { mode?: string })?.mode;
        if (mode === 'translate' || mode === 'rotate') setGizmoMode(mode);
        return gizmoMode;
      }, { title: 'Set section gizmo mode (translate/rotate)' });
      ctx.commands.register('section.getGizmoMode', () => gizmoMode, {
        title: 'Get section gizmo mode',
      });

      // Manipulation commands
      ctx.commands.register('section.move', (args: unknown) => {
        const { id, offset } = args as { id: string; offset: number };
        const plane = getPlane(id);
        if (!plane) return;
        const newPoint = plane.origin.clone().addScaledVector(plane.normal, offset);
        plane.setFromNormalAndCoplanarPoint(plane.normal, newPoint);
        emitChange();
        ctxRef?.requestRender();
      }, { title: 'Slide section plane along its normal' });

      ctx.commands.register('section.setNormal', (args: unknown) => {
        const { id, normal: n } = args as { id: string; normal: Vec3 };
        const plane = getPlane(id);
        if (!plane) return;
        plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(n.x, n.y, n.z), plane.origin);
        emitChange();
        ctxRef?.requestRender();
      }, { title: 'Set section plane orientation' });

      ctx.commands.register('section.setPoint', (args: unknown) => {
        const { id, point: p } = args as { id: string; point: Vec3 };
        const plane = getPlane(id);
        if (!plane) return;
        plane.setFromNormalAndCoplanarPoint(plane.normal, new THREE.Vector3(p.x, p.y, p.z));
        emitChange();
        ctxRef?.requestRender();
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
        ctxRef?.requestRender();
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
        if (clipper) {
          for (const plane of clipper.list.values()) applyStyle(plane);
        }
        emitChange();
        ctxRef?.requestRender();
      }, { title: 'Update section display config' });
    },

    uninstall() {
      clickUnsub?.();
      clickUnsub = null;

      for (const cleanup of controlSyncCleanup.values()) cleanup();
      controlSyncCleanup.clear();

      if (clipper) {
        clipper.deleteAll();
        clipper.enabled = false;
      }
      // Tear down subscriptions + drop our planes off every fragment material.
      materialClipping.uninstall();

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
