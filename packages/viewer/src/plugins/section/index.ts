/**
 * Section plugin — clipping planes for cutting through geometry.
 *
 * Each section plane is a `THREE.Plane` injected into every model material's
 * `clippingPlanes` array. A translucent helper mesh visualises the plane.
 * Planes are applied per-material (not `renderer.clippingPlanes`) so that
 * UI overlays like the viewcube and pivot indicator are never clipped.
 *
 * Depends on the camera plugin for scene-box computation used when sizing
 * the visual plane helper.
 */

import * as THREE from 'three';
import type { Plugin, Vec3, ViewerContext } from '../../core/types.js';

const NAME = 'section' as const;

export interface SectionPlane {
  id: string;
  normal: Vec3;
  point: Vec3;
  active: boolean;
}

export interface SectionPluginOptions {
  /** Default helper plane size multiplier. Default: 1.5. */
  helperScale?: number;
  /** Helper plane colour. Default: 0x1e90ff (dodger blue). */
  helperColor?: number;
  /** Helper plane opacity. Default: 0.12. */
  helperOpacity?: number;
  /** Colour used for the section cap fill rendered via stencil. Default: 0x1e90ff. */
  fillColor?: number;
  /** Opacity for the cap fill. Default: 0.6. */
  fillOpacity?: number;
  /** Show edge lines at section plane intersections. Default: false. */
  showFill?: boolean;
  /** Edge line colour for the section outline. Default: same as helperColor. */
  edgeColor?: number;
}

export interface SectionPluginAPI {
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  planes(): SectionPlane[];
}

interface PlaneEntry {
  id: string;
  plane: THREE.Plane;
  helper: THREE.Group;
  active: boolean;
  normal: THREE.Vector3;
  point: THREE.Vector3;
}

let nextId = 0;

export function sectionPlugin(
  options: SectionPluginOptions = {},
): Plugin & SectionPluginAPI {
  const helperScale = options.helperScale ?? 1.5;
  const helperColor = options.helperColor ?? 0x1e90ff;
  const helperOpacity = options.helperOpacity ?? 0.12;
  const fillColor = options.fillColor ?? helperColor;
  const fillOpacity = options.fillOpacity ?? 0.6;
  const showFill = options.showFill ?? false;
  const edgeColor = options.edgeColor ?? helperColor;

  let ctxRef: ViewerContext | null = null;
  let enabled = true;
  const entries = new Map<string, PlaneEntry>();
  let materialHookDispose: (() => void) | null = null;
  const capFills = new Map<string, THREE.Mesh>();

  // ----- material management -----

  const getActiveClippingPlanes = (): THREE.Plane[] =>
    [...entries.values()]
      .filter((e) => e.active)
      .map((e) => e.plane);

  const applyToMaterial = (mat: THREE.Material): void => {
    const planes = getActiveClippingPlanes();
    mat.clippingPlanes = planes.length > 0 ? planes : null;
    mat.clipShadows = true;
    mat.needsUpdate = true;
  };

  const applyToAllMaterials = (): void => {
    if (!ctxRef) return;
    for (const model of ctxRef.models().values()) {
      model.object.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) {
          if (mat) applyToMaterial(mat);
        }
      });
    }
    ctxRef.renderer.localClippingEnabled = entries.size > 0;
  };

  const removeClippingFromAllMaterials = (): void => {
    if (!ctxRef) return;
    for (const model of ctxRef.models().values()) {
      model.object.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of mats) {
          if (mat) {
            mat.clippingPlanes = null;
            mat.needsUpdate = true;
          }
        }
      });
    }
    ctxRef.renderer.localClippingEnabled = false;
  };

  // ----- helpers -----

  const computeHelperSize = (): number => {
    if (!ctxRef) return 10;
    const box = new THREE.Box3();
    for (const model of ctxRef.models().values()) {
      const mBox = model.box;
      if (mBox && !mBox.isEmpty()) box.union(mBox);
    }
    if (box.isEmpty()) return 10;
    const size = box.getSize(new THREE.Vector3());
    return Math.max(size.x, size.y, size.z) * helperScale;
  };

  const createHelper = (normal: THREE.Vector3, point: THREE.Vector3): THREE.Group => {
    const group = new THREE.Group();
    group.name = 'section-helper';
    const planeSize = computeHelperSize();

    // Translucent fill
    const geo = new THREE.PlaneGeometry(planeSize, planeSize);
    const mat = new THREE.MeshBasicMaterial({
      color: helperColor,
      transparent: true,
      opacity: helperOpacity,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);

    // Border line
    const borderGeo = new THREE.BufferGeometry();
    const half = planeSize / 2;
    const pts = [
      new THREE.Vector3(-half, -half, 0),
      new THREE.Vector3(half, -half, 0),
      new THREE.Vector3(half, half, 0),
      new THREE.Vector3(-half, half, 0),
      new THREE.Vector3(-half, -half, 0),
    ];
    borderGeo.setFromPoints(pts);
    const lineMat = new THREE.LineBasicMaterial({
      color: helperColor,
      transparent: true,
      opacity: 0.5,
    });
    const line = new THREE.Line(borderGeo, lineMat);
    group.add(line);

    // Orient: default PlaneGeometry faces +Z, rotate to match normal
    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      normal.clone().normalize(),
    );
    group.quaternion.copy(quat);
    group.position.copy(point);

    return group;
  };

  const createCapFill = (id: string, normal: THREE.Vector3, point: THREE.Vector3): void => {
    if (!ctxRef || !showFill) return;
    const planeSize = computeHelperSize();
    const geo = new THREE.PlaneGeometry(planeSize, planeSize);
    const mat = new THREE.MeshBasicMaterial({
      color: fillColor,
      transparent: true,
      opacity: fillOpacity,
      side: THREE.DoubleSide,
      depthWrite: false,
      stencilWrite: true,
      stencilRef: 1,
      stencilFunc: THREE.AlwaysStencilFunc,
      stencilZPass: THREE.ReplaceStencilOp,
    });
    const mesh = new THREE.Mesh(geo, mat);
    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      normal.clone().normalize(),
    );
    mesh.quaternion.copy(quat);
    mesh.position.copy(point);
    mesh.renderOrder = 1;
    ctxRef.scene.add(mesh);
    capFills.set(id, mesh);
  };

  const removeCapFill = (id: string): void => {
    const mesh = capFills.get(id);
    if (mesh) {
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      mesh.removeFromParent();
      capFills.delete(id);
    }
  };

  const disposeHelper = (helper: THREE.Group): void => {
    helper.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) m.dispose();
      }
    });
    helper.removeFromParent();
  };

  // ----- emit -----

  const emitChange = (): void => {
    if (!ctxRef) return;
    const planes: SectionPlane[] = [...entries.values()].map((e) => ({
      id: e.id,
      normal: { x: e.normal.x, y: e.normal.y, z: e.normal.z },
      point: { x: e.point.x, y: e.point.y, z: e.point.z },
      active: e.active,
    }));
    ctxRef.events.emit('section:change', { planes });
  };

  // ----- default section point (model center) -----

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

  // ----- commands -----

  const add = (args: unknown): string => {
    if (!ctxRef || !enabled) return '';
    const opts = (args ?? {}) as { normal?: Vec3; point?: Vec3 };
    const normal = opts.normal
      ? new THREE.Vector3(opts.normal.x, opts.normal.y, opts.normal.z).normalize()
      : new THREE.Vector3(0, 1, 0);
    const point = opts.point
      ? new THREE.Vector3(opts.point.x, opts.point.y, opts.point.z)
      : getDefaultPoint();

    const id = `section-${String(++nextId)}`;
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point);

    const helper = createHelper(normal, point);
    ctxRef.scene.add(helper);

    entries.set(id, { id, plane, helper, active: true, normal, point });
    createCapFill(id, normal, point);
    applyToAllMaterials();
    emitChange();
    return id;
  };

  const remove = (args: unknown): void => {
    if (!ctxRef) return;
    const id = typeof args === 'string' ? args : (args as { id?: string })?.id;
    if (!id) return;
    const entry = entries.get(id);
    if (!entry) return;
    disposeHelper(entry.helper);
    removeCapFill(id);
    entries.delete(id);
    applyToAllMaterials();
    emitChange();
  };

  const removeAll = (): void => {
    if (!ctxRef) return;
    for (const entry of entries.values()) {
      disposeHelper(entry.helper);
      removeCapFill(entry.id);
    }
    entries.clear();
    applyToAllMaterials();
    emitChange();
  };

  const toggle = (args: unknown): void => {
    if (!ctxRef || !enabled) return;
    const id = typeof args === 'string' ? args : (args as { id?: string })?.id;
    if (id) {
      const entry = entries.get(id);
      if (!entry) return;
      entry.active = !entry.active;
      entry.helper.visible = entry.active;
    } else {
      // Toggle all
      const allActive = [...entries.values()].every((e) => e.active);
      for (const entry of entries.values()) {
        entry.active = !allActive;
        entry.helper.visible = entry.active;
      }
    }
    applyToAllMaterials();
    emitChange();
  };

  const flip = (args: unknown): void => {
    if (!ctxRef || !enabled) return;
    const id = typeof args === 'string' ? args : (args as { id?: string })?.id;
    if (!id) return;
    const entry = entries.get(id);
    if (!entry) return;
    entry.normal.negate();
    entry.plane.setFromNormalAndCoplanarPoint(entry.normal, entry.point);
    // Re-orient helper
    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      entry.normal.clone().normalize(),
    );
    entry.helper.quaternion.copy(quat);
    applyToAllMaterials();
    emitChange();
  };

  const list = (): SectionPlane[] =>
    [...entries.values()].map((e) => ({
      id: e.id,
      normal: { x: e.normal.x, y: e.normal.y, z: e.normal.z },
      point: { x: e.point.x, y: e.point.y, z: e.point.z },
      active: e.active,
    }));

  const setEnabled = (next: boolean): void => {
    if (enabled === next) return;
    enabled = next;
    if (!enabled) {
      removeClippingFromAllMaterials();
      for (const entry of entries.values()) {
        entry.helper.visible = false;
      }
    } else {
      applyToAllMaterials();
      for (const entry of entries.values()) {
        entry.helper.visible = entry.active;
      }
    }
    ctxRef?.events.emit('feature:enabled', { name: NAME, enabled });
  };

  const api: Plugin & SectionPluginAPI = {
    name: NAME,
    dependencies: ['camera'],

    planes: list,
    setEnabled,
    isEnabled() { return enabled; },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

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

      // Apply clipping planes to new materials that stream in.
      const handler = ({ value: mat }: { value: THREE.Material }): void => {
        if (enabled && entries.size > 0) applyToMaterial(mat);
      };
      ctx.fragments.models.materials.list.onItemSet.add(handler);
      materialHookDispose = () => {
        ctx.fragments.models.materials.list.onItemSet.remove(handler);
      };

      // When a new model loads, inject clipping planes into its materials.
      ctx.events.on('model:loaded', () => {
        if (enabled && entries.size > 0) applyToAllMaterials();
      });
    },

    uninstall() {
      removeClippingFromAllMaterials();
      for (const entry of entries.values()) {
        disposeHelper(entry.helper);
        removeCapFill(entry.id);
      }
      entries.clear();
      materialHookDispose?.();
      materialHookDispose = null;
      ctxRef = null;
    },
  };

  return api;
}
