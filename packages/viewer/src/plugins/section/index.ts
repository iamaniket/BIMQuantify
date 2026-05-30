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
import { pick } from '../../core/Raycaster.js';
import { SectionGizmo } from './gizmo.js';

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

export interface SectionConfig {
  helperScale: number;
  helperColor: number;
  helperOpacity: number;
  fillColor: number;
  fillOpacity: number;
  showFill: boolean;
  edgeColor: number;
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
  let helperScale = options.helperScale ?? 0.4;
  let helperColor = options.helperColor ?? 0x1e90ff;
  let helperOpacity = options.helperOpacity ?? 0.12;
  let fillColor = options.fillColor ?? helperColor;
  let fillOpacity = options.fillOpacity ?? 0.6;
  let showFill = options.showFill ?? true;
  let edgeColor = options.edgeColor ?? helperColor;

  let ctxRef: ViewerContext | null = null;
  let enabled = true;
  const entries = new Map<string, PlaneEntry>();
  let materialHookDispose: (() => void) | null = null;

  let placementActive = false;
  let clickUnsub: (() => void) | null = null;
  let moveUnsub: (() => void) | null = null;
  let selectedId: string | null = null;
  let previewHelper: THREE.Group | null = null;
  let modelLoadUnsub: (() => void) | null = null;
  let selectionClickUnsub: (() => void) | null = null;
  let gizmo: SectionGizmo | null = null;

  // ----- material management -----

  const getActiveClippingPlanes = (): THREE.Plane[] =>
    [...entries.values()]
      .filter((e) => e.active)
      .map((e) => e.plane);

  // ----- back-face cap rendering -----
  // To avoid seeing through the clipped model interior, we add a back-face
  // mesh for each model mesh. When the front face is clipped away, the back
  // face renders as a solid cap in `fillColor`. This is the standard technique
  // used by xeokit, Forge, and other BIM viewers.
  const backfaceMeshes = new Map<THREE.Mesh, THREE.Mesh>();

  const createBackfaceMaterial = (): THREE.MeshBasicMaterial => {
    const planes = getActiveClippingPlanes();
    return new THREE.MeshBasicMaterial({
      color: fillColor,
      side: THREE.BackSide,
      clippingPlanes: planes.length > 0 ? planes : null,
      clipShadows: true,
      transparent: fillOpacity < 1,
      opacity: fillOpacity,
      depthWrite: true,
    });
  };

  const BACKFACE_TAG = '__sectionBackface';

  const addBackfaceMeshes = (): void => {
    if (!ctxRef || !showFill) return;
    for (const model of ctxRef.models().values()) {
      model.object.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh || backfaceMeshes.has(mesh) || mesh.userData[BACKFACE_TAG]) return;
        const backMesh = new THREE.Mesh(mesh.geometry, createBackfaceMaterial());
        backMesh.renderOrder = -1;
        backMesh.matrixAutoUpdate = false;
        backMesh.userData[BACKFACE_TAG] = true;
        mesh.add(backMesh);
        backfaceMeshes.set(mesh, backMesh);
      });
    }
  };

  const removeBackfaceMeshes = (): void => {
    for (const [, backMesh] of backfaceMeshes) {
      backMesh.removeFromParent();
      (backMesh.material as THREE.Material).dispose();
    }
    backfaceMeshes.clear();
  };

  const updateBackfacePlanes = (): void => {
    const planes = getActiveClippingPlanes();
    const planesList = planes.length > 0 ? planes : null;
    for (const [, backMesh] of backfaceMeshes) {
      const mat = backMesh.material as THREE.MeshBasicMaterial;
      mat.clippingPlanes = planesList;
      mat.needsUpdate = true;
    }
  };

  const refreshBackfaceMeshes = (): void => {
    removeBackfaceMeshes();
    if (showFill && entries.size > 0) addBackfaceMeshes();
  };

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
    updateBackfacePlanes();
    // Clip the shadow-ground so the drop shadow only shows under visible geometry.
    const planes = getActiveClippingPlanes();
    const planesList = planes.length > 0 ? planes : null;
    ctxRef.scene.traverse((obj) => {
      if (obj.name !== 'shadow-ground') return;
      const mat = (obj as THREE.Mesh).material as THREE.Material | undefined;
      if (mat) { mat.clippingPlanes = planesList; mat.needsUpdate = true; }
    });
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
    removeBackfaceMeshes();
    ctxRef.scene.traverse((obj) => {
      if (obj.name !== 'shadow-ground') return;
      const mat = (obj as THREE.Mesh).material as THREE.Material | undefined;
      if (mat) { mat.clippingPlanes = null; mat.needsUpdate = true; }
    });
  };

  // ----- helpers -----

  const computeHelperSize = (): number => {
    if (!ctxRef) return 10;
    const camera = ctxRef.camera;
    const h = ctxRef.canvas.clientHeight || 1;

    if (camera instanceof THREE.PerspectiveCamera) {
      const target = new THREE.Vector3();
      ctxRef.cameraControls.getTarget(target);
      const dist = camera.position.distanceTo(target);
      const fovRad = (camera.fov * Math.PI) / 180;
      return 2 * Math.tan(fovRad / 2) * dist * helperScale;
    }
    // Orthographic fallback
    const ortho = camera as THREE.OrthographicCamera;
    const worldPerPixel = (ortho.top - ortho.bottom) / Math.max(h * ortho.zoom, 1e-6);
    return worldPerPixel * h * helperScale;
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

  // ----- selection -----

  const highlightEntry = (entry: PlaneEntry): void => {
    entry.helper.traverse((obj) => {
      const line = obj as THREE.Line;
      if (line.isLine && line.material) {
        const mat = line.material as THREE.LineBasicMaterial;
        mat.color.set(0xffffff);
        mat.opacity = 1;
        mat.needsUpdate = true;
      }
    });
  };

  const unhighlightEntry = (entry: PlaneEntry): void => {
    entry.helper.traverse((obj) => {
      const line = obj as THREE.Line;
      if (line.isLine && line.material) {
        const mat = line.material as THREE.LineBasicMaterial;
        mat.color.set(helperColor);
        mat.opacity = 0.5;
        mat.needsUpdate = true;
      }
    });
  };

  const selectPlane = (id: string | null): void => {
    if (selectedId === id) return;
    if (selectedId) {
      const prev = entries.get(selectedId);
      if (prev) unhighlightEntry(prev);
    }
    if (gizmo) {
      gizmo.dispose();
      gizmo = null;
    }
    selectedId = id;
    if (id && ctxRef) {
      const entry = entries.get(id);
      if (entry) {
        highlightEntry(entry);
        gizmo = new SectionGizmo(ctxRef, entry, (update) => {
          const patch: { point?: THREE.Vector3; normal?: THREE.Vector3 } = {};
          if (update.point) patch.point = new THREE.Vector3(update.point.x, update.point.y, update.point.z);
          if (update.normal) patch.normal = new THREE.Vector3(update.normal.x, update.normal.y, update.normal.z);
          updatePlane(id, patch);
          gizmo?.attach(entry);
        }, computeHelperSize());
      }
    }
    ctxRef?.events.emit('section:select', { id });
  };

  // ----- update plane (consolidates move/rotate/set) -----

  const updatePlane = (id: string, patch: { point?: THREE.Vector3; normal?: THREE.Vector3 }): void => {
    if (!ctxRef) return;
    const entry = entries.get(id);
    if (!entry) return;

    if (patch.normal) {
      entry.normal.copy(patch.normal).normalize();
    }
    if (patch.point) {
      entry.point.copy(patch.point);
    }
    entry.plane.setFromNormalAndCoplanarPoint(entry.normal, entry.point);

    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      entry.normal.clone().normalize(),
    );
    entry.helper.quaternion.copy(quat);
    entry.helper.position.copy(entry.point);

    applyToAllMaterials();
    emitChange();
  };

  // ----- helper raycast (shared by placement + persistent selection) -----

  const raycastHelpers = (ndc: { x: number; y: number }): string | null => {
    if (!ctxRef || entries.size === 0) return null;
    const camera = ctxRef.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);

    // Skip clicks that land on a gizmo element (arrows or rings)
    const gizmoTargets: THREE.Object3D[] = [];
    const g1 = ctxRef.scene.getObjectByName('section-gizmo');
    const g2 = ctxRef.scene.getObjectByName('section-gizmo-rings');
    if (g1) gizmoTargets.push(g1);
    if (g2) gizmoTargets.push(g2);
    if (gizmoTargets.length > 0) {
      const gizmoHits = rc.intersectObjects(gizmoTargets, true);
      if (gizmoHits.length > 0) return null;
    }

    const helpers = [...entries.values()].map((e) => e.helper);
    const hits = rc.intersectObjects(helpers, true);
    if (hits.length === 0) return null;
    const hitObj = hits[0]!.object;
    for (const [id, entry] of entries) {
      if (entry.helper === hitObj || entry.helper.children.includes(hitObj)) {
        return id;
      }
    }
    return null;
  };

  // ----- placement mode -----

  const clearPreview = (): void => {
    if (previewHelper) {
      disposeHelper(previewHelper);
      previewHelper = null;
    }
  };

  const handlePlacementMove = async (payload: {
    ndc: { x: number; y: number };
  }): Promise<void> => {
    if (!ctxRef || !placementActive) return;
    const result = await pick(ctxRef, payload.ndc);
    if (!result) {
      clearPreview();
      return;
    }

    const point = new THREE.Vector3(result.point.x, result.point.y, result.point.z);
    let normal: THREE.Vector3;
    if (result.raw.normal) {
      // Negate the surface normal so the clicked side (the one the user
      // is looking at) is the side that gets clipped away. Three.js keeps
      // the side the plane normal points to; flipping makes the section
      // "cut into" the surface instead of "cut behind" it.
      normal = result.raw.normal.clone().normalize().negate();
    } else {
      normal = ctxRef.camera.getWorldDirection(new THREE.Vector3());
    }

    if (!previewHelper) {
      previewHelper = createHelper(normal, point);
      previewHelper.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh && mesh.material) {
          (mesh.material as THREE.MeshBasicMaterial).opacity = 0.06;
          (mesh.material as THREE.Material).needsUpdate = true;
        }
        const line = obj as THREE.Line;
        if (line.isLine && line.material) {
          (line.material as THREE.LineBasicMaterial).opacity = 0.25;
          (line.material as THREE.Material).needsUpdate = true;
        }
      });
      ctxRef.scene.add(previewHelper);
    } else {
      const quat = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        normal,
      );
      previewHelper.quaternion.copy(quat);
      previewHelper.position.copy(point);
    }
  };

  const handlePlacementClick = async (payload: {
    ndc: { x: number; y: number };
    button: number;
  }): Promise<void> => {
    if (!ctxRef || !placementActive || payload.button !== 0) return;
    if (gizmo?.isDragging()) return;

    // Check if user clicked an existing helper mesh → toggle selection
    const hitId = raycastHelpers(payload.ndc);
    if (hitId) {
      selectPlane(selectedId === hitId ? null : hitId);
      return;
    }

    const result = await pick(ctxRef, payload.ndc);
    if (!result) return;

    const point = new THREE.Vector3(result.point.x, result.point.y, result.point.z);
    let normal: THREE.Vector3;
    if (result.raw.normal) {
      // Match the preview: negate so the clicked side is the side cut away.
      normal = result.raw.normal.clone().normalize().negate();
    } else {
      normal = ctxRef.camera.getWorldDirection(new THREE.Vector3());
    }

    clearPreview();
    add({ normal: { x: normal.x, y: normal.y, z: normal.z }, point: { x: point.x, y: point.y, z: point.z } });

    // Single-shot: exit placement mode after placing a plane.
    deactivate().catch(() => undefined);
  };

  const cleanupPlacement = (): void => {
    clearPreview();
    clickUnsub?.();
    clickUnsub = null;
    moveUnsub?.();
    moveUnsub = null;
    placementActive = false;
  };

  const activate = async (): Promise<void> => {
    if (!ctxRef || !enabled || placementActive) return;
    placementActive = true;

    clickUnsub = ctxRef.events.on('pointer:click', (p) => {
      handlePlacementClick(p).catch(() => undefined);
    });
    moveUnsub = ctxRef.events.on('pointer:move', (p) => {
      handlePlacementMove(p).catch(() => undefined);
    });

    await ctxRef.commands.execute('mode.enter', {
      name: 'section.place',
      label: 'Section Plane',
      cancel: (): boolean => {
        clearPreview();
        return false;
      },
      onExit: () => { cleanupPlacement(); },
    });
  };

  const deactivate = async (): Promise<void> => {
    if (!ctxRef || !placementActive) return;
    await ctxRef.commands.execute('mode.exit');
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
    applyToAllMaterials();
    refreshBackfaceMeshes();
    emitChange();
    selectPlane(id);
    return id;
  };

  const remove = (args: unknown): void => {
    if (!ctxRef) return;
    const id = typeof args === 'string' ? args : (args as { id?: string })?.id;
    if (!id) return;
    const entry = entries.get(id);
    if (!entry) return;
    if (selectedId === id) selectPlane(null);
    disposeHelper(entry.helper);
    entries.delete(id);
    applyToAllMaterials();
    refreshBackfaceMeshes();
    emitChange();
  };

  const removeAll = (): void => {
    if (!ctxRef) return;
    selectPlane(null);
    for (const entry of entries.values()) {
      disposeHelper(entry.helper);
    }
    entries.clear();
    applyToAllMaterials();
    refreshBackfaceMeshes();
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
    dependencies: ['camera', 'mode'],

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
        const entry = entries.get(id);
        if (!entry) return;
        const newPoint = entry.point.clone().addScaledVector(entry.normal, offset);
        updatePlane(id, { point: newPoint });
      }, { title: 'Slide section plane along its normal' });

      ctx.commands.register('section.setNormal', (args: unknown) => {
        const { id, normal: n } = args as { id: string; normal: Vec3 };
        updatePlane(id, { normal: new THREE.Vector3(n.x, n.y, n.z) });
      }, { title: 'Set section plane orientation' });

      ctx.commands.register('section.setPoint', (args: unknown) => {
        const { id, point: p } = args as { id: string; point: Vec3 };
        updatePlane(id, { point: new THREE.Vector3(p.x, p.y, p.z) });
      }, { title: 'Set section plane position' });

      ctx.commands.register('section.rotate', (args: unknown) => {
        const { id, axis: a, angle } = args as { id: string; axis: Vec3; angle: number };
        const entry = entries.get(id);
        if (!entry) return;
        const axisVec = new THREE.Vector3(a.x, a.y, a.z).normalize();
        const quat = new THREE.Quaternion().setFromAxisAngle(axisVec, angle);
        const newNormal = entry.normal.clone().applyQuaternion(quat);
        updatePlane(id, { normal: newNormal });
      }, { title: 'Rotate section plane normal around axis' });

      ctx.commands.register('section.getExtent', (args: unknown) => {
        const id = typeof args === 'string' ? args : (args as { id?: string })?.id;
        if (!id || !ctxRef) return null;
        const entry = entries.get(id);
        if (!entry) return null;
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
        const projections = corners.map((c) => c.dot(entry.normal));
        const min = Math.min(...projections);
        const max = Math.max(...projections);
        const current = entry.point.dot(entry.normal);
        return { min, max, current };
      }, { title: 'Get slider range for a section plane' });

      ctx.commands.register('section.getConfig', (): SectionConfig => ({
        helperScale, helperColor, helperOpacity,
        fillColor, fillOpacity, showFill, edgeColor,
      }), { title: 'Get section display config' });

      ctx.commands.register('section.setConfig', (args: unknown) => {
        const cfg = args as Partial<SectionConfig>;
        if (cfg.helperScale !== undefined) helperScale = cfg.helperScale;
        if (cfg.helperColor !== undefined) helperColor = cfg.helperColor;
        if (cfg.helperOpacity !== undefined) helperOpacity = cfg.helperOpacity;
        if (cfg.fillColor !== undefined) fillColor = cfg.fillColor;
        if (cfg.fillOpacity !== undefined) fillOpacity = cfg.fillOpacity;
        if (cfg.showFill !== undefined) showFill = cfg.showFill;
        if (cfg.edgeColor !== undefined) edgeColor = cfg.edgeColor;
        // Rebuild all helpers with new config
        for (const entry of entries.values()) {
          disposeHelper(entry.helper);
          entry.helper = createHelper(entry.normal, entry.point);
          ctxRef?.scene.add(entry.helper);
          entry.helper.visible = entry.active;
        }
        refreshBackfaceMeshes();
        if (selectedId) {
          const sel = entries.get(selectedId);
          if (sel) highlightEntry(sel);
        }
        emitChange();
      }, { title: 'Update section display config' });

      // Apply clipping planes to new materials that stream in.
      const handler = ({ value: mat }: { value: THREE.Material }): void => {
        if (enabled && entries.size > 0) applyToMaterial(mat);
      };
      ctx.fragments.models.materials.list.onItemSet.add(handler);
      materialHookDispose = () => {
        ctx.fragments.models.materials.list.onItemSet.remove(handler);
      };

      // When a new model loads, inject clipping planes into its materials
      // and add back-face cap meshes for the new geometry.
      modelLoadUnsub = ctx.events.on('model:loaded', () => {
        if (enabled && entries.size > 0) {
          applyToAllMaterials();
          refreshBackfaceMeshes();
        }
      });

      // Persistent click handler: click a section helper in the 3D viewport
      // to select it (or click the selected one to deselect). Active at all
      // times except during placement mode (which has its own handler).
      selectionClickUnsub = ctx.events.on('pointer:click', (payload) => {
        if (placementActive || !enabled || payload.button !== 0) return;
        if (entries.size === 0) return;
        const hitId = raycastHelpers(payload.ndc);
        if (hitId) {
          selectPlane(selectedId === hitId ? null : hitId);
        }
      });
    },

    uninstall() {
      cleanupPlacement();
      selectPlane(null);
      clearPreview();
      removeClippingFromAllMaterials();
      for (const entry of entries.values()) {
        disposeHelper(entry.helper);
      }
      entries.clear();
      materialHookDispose?.();
      materialHookDispose = null;
      modelLoadUnsub?.();
      modelLoadUnsub = null;
      selectionClickUnsub?.();
      selectionClickUnsub = null;
      ctxRef = null;
    },
  };

  return api;
}
