import * as THREE from 'three';

import type { Plugin, ViewerContext } from '../../../core/types.js';
import type { ClassifierPluginAPI, ClassificationGroup } from '../classifier/index.js';

const NAME = 'exploder' as const;

export type ExplodeMode = 'spatialStructure' | 'category';

export interface ExploderPluginOptions {
  animationDuration?: number;
  defaultFactor?: number;
}

export interface ExploderPluginAPI {
  explode(mode?: ExplodeMode, factor?: number): Promise<void>;
  setFactor(factor: number): void;
  reset(): Promise<void>;
  isExploded(): boolean;
  factor(): number;
}

interface MeshGroup {
  wrapper: THREE.Group;
  meshes: THREE.Object3D[];
  center: THREE.Vector3;
  offset: THREE.Vector3;
}

const animate = (
  duration: number,
  onUpdate: (t: number) => void,
): Promise<void> =>
  new Promise((resolve) => {
    const start = performance.now();
    const tick = (now: number): void => {
      const t = Math.min((now - start) / duration, 1);
      const eased = t * (2 - t);
      onUpdate(eased);
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });

export function exploderPlugin(
  options: ExploderPluginOptions = {},
): Plugin & ExploderPluginAPI {
  const animDuration = options.animationDuration ?? 600;
  const defaultFactor = options.defaultFactor ?? 1.0;

  let ctxRef: ViewerContext | null = null;
  let exploded = false;
  let activeMode: ExplodeMode | null = null;
  let currentFactor = 0;
  let meshGroups: MeshGroup[] = [];
  let modelCenter = new THREE.Vector3();
  let modelSpan = 1;

  const emitChange = (): void => {
    ctxRef?.events.emit('exploder:change', {
      active: exploded,
      mode: activeMode,
      factor: currentFactor,
    });
  };

  const collectMeshes = (root: THREE.Object3D): THREE.Object3D[] => {
    const meshes: THREE.Object3D[] = [];
    root.traverse((child) => {
      if (child === root) return;
      if ((child as THREE.Mesh).isMesh) meshes.push(child);
    });
    return meshes;
  };

  const computeModelBounds = (ctx: ViewerContext): THREE.Box3 => {
    const box = new THREE.Box3();
    for (const [, model] of ctx.models()) {
      const mb = new THREE.Box3().setFromObject(model.object);
      box.union(mb);
    }
    return box;
  };

  const buildSpatialGroups = (
    meshes: THREE.Object3D[],
    groups: ClassificationGroup[],
  ): { center: THREE.Vector3; meshes: THREE.Object3D[] }[] => {
    // Compute Y-range per storey from group names sorted by mesh center Y.
    const storeyBands: { name: string; minY: number; maxY: number; centerY: number }[] = [];

    // We don't have direct element→mesh mapping, so bucket meshes by their
    // bounding-box center Y into N evenly-spaced bands (one per storey).
    const meshCenters = meshes.map((m) => {
      const box = new THREE.Box3().setFromObject(m);
      return { mesh: m, center: box.getCenter(new THREE.Vector3()) };
    });

    if (meshCenters.length === 0 || groups.length === 0) return [];

    const allYs = meshCenters.map((mc) => mc.center.y);
    const minY = Math.min(...allYs);
    const maxY = Math.max(...allYs);
    const bandCount = Math.max(groups.length, 1);
    const bandHeight = (maxY - minY) / bandCount || 1;

    // Create bands.
    for (let i = 0; i < bandCount; i++) {
      storeyBands.push({
        name: groups[i]?.name ?? `band-${String(i)}`,
        minY: minY + i * bandHeight,
        maxY: minY + (i + 1) * bandHeight,
        centerY: minY + (i + 0.5) * bandHeight,
      });
    }

    // Assign meshes to bands.
    const bandMeshes: Map<number, THREE.Object3D[]> = new Map();
    for (const mc of meshCenters) {
      let bandIdx = Math.floor((mc.center.y - minY) / bandHeight);
      bandIdx = Math.min(bandIdx, bandCount - 1);
      let arr = bandMeshes.get(bandIdx);
      if (!arr) { arr = []; bandMeshes.set(bandIdx, arr); }
      arr.push(mc.mesh);
    }

    const result: { center: THREE.Vector3; meshes: THREE.Object3D[] }[] = [];
    for (let i = 0; i < bandCount; i++) {
      const bm = bandMeshes.get(i);
      if (!bm || bm.length === 0) continue;
      result.push({
        center: new THREE.Vector3(0, storeyBands[i]!.centerY, 0),
        meshes: bm,
      });
    }
    return result;
  };

  const buildCategoryGroups = (
    meshes: THREE.Object3D[],
    _groups: ClassificationGroup[],
  ): { center: THREE.Vector3; meshes: THREE.Object3D[] }[] => {
    // For category mode, cluster meshes radially by their bounding-box
    // center angle relative to the model center (XZ plane).
    const meshCenters = meshes.map((m) => {
      const box = new THREE.Box3().setFromObject(m);
      return { mesh: m, center: box.getCenter(new THREE.Vector3()) };
    });

    if (meshCenters.length === 0) return [];

    // Use a simple spatial clustering: divide 360° into N sectors.
    const sectorCount = Math.max(_groups.length, 4);
    const sectorAngle = (Math.PI * 2) / sectorCount;

    const sectorMeshes = new Map<number, { meshes: THREE.Object3D[]; centers: THREE.Vector3[] }>();

    for (const mc of meshCenters) {
      const dx = mc.center.x - modelCenter.x;
      const dz = mc.center.z - modelCenter.z;
      let angle = Math.atan2(dz, dx);
      if (angle < 0) angle += Math.PI * 2;
      let sector = Math.floor(angle / sectorAngle);
      sector = Math.min(sector, sectorCount - 1);
      let entry = sectorMeshes.get(sector);
      if (!entry) { entry = { meshes: [], centers: [] }; sectorMeshes.set(sector, entry); }
      entry.meshes.push(mc.mesh);
      entry.centers.push(mc.center);
    }

    const result: { center: THREE.Vector3; meshes: THREE.Object3D[] }[] = [];
    for (const [, entry] of sectorMeshes) {
      const avg = new THREE.Vector3();
      for (const c of entry.centers) avg.add(c);
      avg.divideScalar(entry.centers.length);
      result.push({ center: avg, meshes: entry.meshes });
    }
    return result;
  };

  const applyPositions = (t: number): void => {
    for (const mg of meshGroups) {
      mg.wrapper.position.copy(mg.offset).multiplyScalar(t * currentFactor);
    }
  };

  const doExplode = async (
    mode: ExplodeMode,
    factor: number,
  ): Promise<void> => {
    if (!ctxRef) return;

    // Clean up any previous explosion.
    if (exploded) await doReset(false);

    const classifier = ctxRef.plugins.get<ClassifierPluginAPI>('classifier');
    if (!classifier) return;

    const strategy = mode === 'spatialStructure' ? 'spatialStructure' : 'category';
    const groups = classifier.groups();
    if (!groups.has(strategy)) {
      await classifier.classify(strategy);
    }

    const classGroups = classifier.groups().get(strategy) ?? [];

    // Gather all meshes from all models.
    const allMeshes: THREE.Object3D[] = [];
    for (const [, model] of ctxRef.models()) {
      allMeshes.push(...collectMeshes(model.object));
    }

    if (allMeshes.length === 0) return;

    const modelBox = computeModelBounds(ctxRef);
    modelCenter = modelBox.getCenter(new THREE.Vector3());
    modelSpan = modelBox.getSize(new THREE.Vector3()).length();

    const grouped = mode === 'spatialStructure'
      ? buildSpatialGroups(allMeshes, classGroups)
      : buildCategoryGroups(allMeshes, classGroups);

    if (grouped.length === 0) return;

    // Compute overall group center for offset directions.
    const overallGroupCenter = new THREE.Vector3();
    for (const g of grouped) overallGroupCenter.add(g.center);
    overallGroupCenter.divideScalar(grouped.length);

    meshGroups = [];

    for (const g of grouped) {
      const wrapper = new THREE.Group();
      wrapper.name = `${NAME}-group`;

      // Compute offset direction.
      const dir = g.center.clone().sub(overallGroupCenter);
      if (dir.length() < 0.001) dir.set(0, 1, 0);
      else dir.normalize();

      const offset = dir.multiplyScalar(modelSpan * 0.3);

      // Reparent meshes under the wrapper, preserving world transform.
      for (const mesh of g.meshes) {
        const parent = mesh.parent;
        if (parent) {
          const worldPos = new THREE.Vector3();
          mesh.getWorldPosition(worldPos);
          const worldQuat = new THREE.Quaternion();
          mesh.getWorldQuaternion(worldQuat);
          const worldScale = new THREE.Vector3();
          mesh.getWorldScale(worldScale);

          parent.remove(mesh);
          wrapper.add(mesh);

          mesh.position.copy(worldPos);
          mesh.quaternion.copy(worldQuat);
          mesh.scale.copy(worldScale);
        }
      }

      ctxRef.scene.add(wrapper);
      meshGroups.push({ wrapper, meshes: g.meshes, center: g.center, offset });
    }

    currentFactor = factor;
    activeMode = mode;
    exploded = true;

    await animate(animDuration, (t) => { applyPositions(t); });
    emitChange();
  };

  const doReset = async (emitEvent = true): Promise<void> => {
    if (!ctxRef || !exploded) return;

    await animate(animDuration, (t) => { applyPositions(1 - t); });

    // Reparent meshes back: move them to the scene root level so the
    // model can reclaim them, then remove wrappers.
    for (const mg of meshGroups) {
      for (const mesh of mg.meshes) {
        const worldPos = new THREE.Vector3();
        mesh.getWorldPosition(worldPos);
        const worldQuat = new THREE.Quaternion();
        mesh.getWorldQuaternion(worldQuat);
        const worldScale = new THREE.Vector3();
        mesh.getWorldScale(worldScale);

        mg.wrapper.remove(mesh);

        // Re-add to the first model object — meshes originally came from
        // model objects and need a parent in the scene graph.
        for (const [, model] of ctxRef!.models()) {
          model.object.add(mesh);
          break;
        }

        mesh.position.copy(worldPos);
        mesh.quaternion.copy(worldQuat);
        mesh.scale.copy(worldScale);
      }
      ctxRef!.scene.remove(mg.wrapper);
    }

    meshGroups = [];
    exploded = false;
    activeMode = null;
    currentFactor = 0;

    if (emitEvent) emitChange();
  };

  const setFactor = (factor: number): void => {
    if (!exploded) return;
    currentFactor = factor;
    applyPositions(1);
    emitChange();
  };

  const toggle = async (mode?: ExplodeMode): Promise<void> => {
    if (exploded) {
      await doReset();
    } else {
      await doExplode(mode ?? 'spatialStructure', defaultFactor);
    }
  };

  const api: Plugin & ExploderPluginAPI = {
    name: NAME,
    dependencies: ['classifier'],

    explode: (mode, factor) => doExplode(mode ?? 'spatialStructure', factor ?? defaultFactor),
    setFactor,
    reset: () => doReset(),
    isExploded: () => exploded,
    factor: () => currentFactor,

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      ctx.commands.register(
        'exploder.explode',
        (args: unknown) => {
          const a = args as { mode?: ExplodeMode; factor?: number } | undefined;
          return doExplode(a?.mode ?? 'spatialStructure', a?.factor ?? defaultFactor);
        },
        { title: 'Explode model' },
      );

      ctx.commands.register(
        'exploder.setFactor',
        (args: unknown) => {
          const a = args as { factor: number };
          setFactor(a.factor);
        },
        { title: 'Set explosion factor' },
      );

      ctx.commands.register('exploder.reset', () => doReset(), {
        title: 'Reset explosion',
      });

      ctx.commands.register(
        'exploder.toggle',
        (args: unknown) => {
          const a = args as { mode?: ExplodeMode } | undefined;
          return toggle(a?.mode);
        },
        { title: 'Toggle explosion' },
      );

      ctx.commands.register('exploder.isExploded', () => exploded, {
        title: 'Check explosion state',
      });

      ctx.events.on('model:loaded', () => {
        if (exploded) {
          meshGroups = [];
          exploded = false;
          activeMode = null;
          currentFactor = 0;
          emitChange();
        }
      });
    },

    uninstall() {
      if (exploded && ctxRef) {
        // Immediate cleanup without animation.
        for (const mg of meshGroups) {
          for (const mesh of mg.meshes) {
            mg.wrapper.remove(mesh);
            for (const [, model] of ctxRef.models()) {
              model.object.add(mesh);
              break;
            }
          }
          ctxRef.scene.remove(mg.wrapper);
        }
      }
      meshGroups = [];
      exploded = false;
      activeMode = null;
      currentFactor = 0;
      ctxRef = null;
    },
  };

  return api;
}
