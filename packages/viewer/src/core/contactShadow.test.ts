import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { ContactShadowBaker } from './contactShadow.js';

/**
 * A GL-free stand-in for WebGLRenderer that records each `render` call's
 * target, the scene's `overrideMaterial`, and a snapshot of every scene
 * child's `visible` flag at call time — enough to assert the silhouette pass
 * isolates building geometry and that all mutated state is restored.
 */
interface SceneRenderCall {
  override: THREE.Material | null;
  visibleByName: Record<string, boolean>;
  /** Instance count of the first InstancedMesh in the rendered scene (box path), else null. */
  instanceCount: number | null;
  /** Material of the first InstancedMesh in the rendered scene (box path), else null. */
  instanceMaterial: THREE.Material | THREE.Material[] | null;
  /** Transform of the first instance of the first InstancedMesh (box path), else null. */
  instanceMatrix0: THREE.Matrix4 | null;
}

function makeFakeRenderer(): {
  renderer: THREE.WebGLRenderer;
  sceneRenderCalls: SceneRenderCall[];
} {
  const sceneRenderCalls: SceneRenderCall[] = [];
  let target: THREE.WebGLRenderTarget | null = null;
  const renderer = {
    autoClear: true,
    getRenderTarget: () => target,
    setRenderTarget: (t: THREE.WebGLRenderTarget | null) => {
      target = t;
    },
    getClearAlpha: () => 1,
    getClearColor: (c: THREE.Color) => c.set(0xffffff),
    setClearColor: () => undefined,
    render: (obj: THREE.Object3D) => {
      // Only the silhouette pass renders an actual Scene; blur passes render
      // the FullScreenQuad's mesh.
      const scene = obj as THREE.Scene;
      if (!scene.isScene) return;
      const visibleByName: Record<string, boolean> = {};
      let instanceCount: number | null = null;
      let instanceMaterial: THREE.Material | THREE.Material[] | null = null;
      let instanceMatrix0: THREE.Matrix4 | null = null;
      for (const child of scene.children) {
        if (child.name) visibleByName[child.name] = child.visible;
        const im = child as THREE.InstancedMesh;
        if (im.isInstancedMesh) {
          instanceCount = im.count;
          instanceMaterial = im.material;
          if (im.count > 0) {
            instanceMatrix0 = new THREE.Matrix4();
            im.getMatrixAt(0, instanceMatrix0);
          }
        }
      }
      sceneRenderCalls.push({
        override: scene.overrideMaterial,
        visibleByName,
        instanceCount,
        instanceMaterial,
        instanceMatrix0,
      });
    },
  } as unknown as THREE.WebGLRenderer;
  return { renderer, sceneRenderCalls };
}

function makeScene(): {
  scene: THREE.Scene;
  modelRoot: THREE.Object3D;
} {
  const scene = new THREE.Scene();
  const modelRoot = new THREE.Object3D();
  modelRoot.name = 'model';

  const light = new THREE.DirectionalLight();
  light.name = 'light';

  const overlay = new THREE.Mesh(); // ground plane / grid / pins stand-in
  overlay.name = 'overlay';

  scene.add(modelRoot, light, overlay);
  return { scene, modelRoot };
}

describe('ContactShadowBaker', () => {
  it('frames a square, padded footprint at the box floor', () => {
    const baker = new ContactShadowBaker(); // pad = 0.15
    const { renderer } = makeFakeRenderer();
    const { scene, modelRoot } = makeScene();
    const box = new THREE.Box3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(10, 4, 6),
    );

    const rect = baker.bake(renderer, scene, new Set([modelRoot]), box);

    expect(rect).not.toBeNull();
    // center (5,2,3); footprint = max(10,6) = 10; side = 10 * 1.3 = 13.
    expect(rect!.cx).toBeCloseTo(5);
    expect(rect!.cz).toBeCloseTo(3);
    expect(rect!.side).toBeCloseTo(13);
    expect(rect!.groundY).toBeCloseTo(0);
    baker.dispose();
  });

  it('returns null for an empty box (nothing visible)', () => {
    const baker = new ContactShadowBaker();
    const { renderer } = makeFakeRenderer();
    const { scene, modelRoot } = makeScene();

    const rect = baker.bake(renderer, scene, new Set([modelRoot]), new THREE.Box3());

    expect(rect).toBeNull();
    baker.dispose();
  });

  it('isolates building geometry during the silhouette pass', () => {
    const baker = new ContactShadowBaker();
    const { renderer, sceneRenderCalls } = makeFakeRenderer();
    const { scene, modelRoot } = makeScene();
    const box = new THREE.Box3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(8, 3, 8),
    );

    baker.bake(renderer, scene, new Set([modelRoot]), box);

    expect(sceneRenderCalls).toHaveLength(1);
    const pass = sceneRenderCalls[0]!;
    // Depth override is applied so every fragment writes a flat silhouette.
    expect((pass.override as THREE.MeshDepthMaterial).isMeshDepthMaterial).toBe(
      true,
    );
    // Model + light cast/illuminate; the overlay (plane/grid/pins) is hidden.
    expect(pass.visibleByName.model).toBe(true);
    expect(pass.visibleByName.light).toBe(true);
    expect(pass.visibleByName.overlay).toBe(false);
    baker.dispose();
  });

  it('restores all mutated renderer/scene state after baking', () => {
    const baker = new ContactShadowBaker();
    const { renderer } = makeFakeRenderer();
    const { scene, modelRoot } = makeScene();
    const overlay = scene.getObjectByName('overlay')!;
    const box = new THREE.Box3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(8, 3, 8),
    );

    baker.bake(renderer, scene, new Set([modelRoot]), box);

    expect(scene.overrideMaterial).toBeNull();
    expect(renderer.getRenderTarget()).toBeNull();
    expect(renderer.autoClear).toBe(true);
    expect(overlay.visible).toBe(true); // hidden during, restored after
    expect(modelRoot.visible).toBe(true);
    baker.dispose();
  });
});

describe('ContactShadowBaker.bakeBoxes', () => {
  it('frames a square, padded footprint from the union of boxes', () => {
    const baker = new ContactShadowBaker(); // pad = 0.15
    const { renderer } = makeFakeRenderer();
    const boxes = [
      new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(4, 3, 6)),
      new THREE.Box3(new THREE.Vector3(6, 0, 0), new THREE.Vector3(10, 3, 6)),
    ];
    const framing = new THREE.Box3();
    for (const b of boxes) framing.union(b); // (0..10, 0..3, 0..6)

    const rect = baker.bakeBoxes(renderer, boxes, framing);

    expect(rect).not.toBeNull();
    // center (5,1.5,3); footprint = max(10,6) = 10; side = 10 * 1.3 = 13.
    expect(rect!.cx).toBeCloseTo(5);
    expect(rect!.cz).toBeCloseTo(3);
    expect(rect!.side).toBeCloseTo(13);
    expect(rect!.groundY).toBeCloseTo(0);
    baker.dispose();
  });

  it('returns null for an empty framing box (nothing visible)', () => {
    const baker = new ContactShadowBaker();
    const { renderer } = makeFakeRenderer();

    const rect = baker.bakeBoxes(renderer, [], new THREE.Box3());

    expect(rect).toBeNull();
    baker.dispose();
  });

  it('rasterises one instanced footprint per non-empty box', () => {
    const baker = new ContactShadowBaker();
    const { renderer, sceneRenderCalls } = makeFakeRenderer();
    const boxes = [
      new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(2, 2, 2)),
      new THREE.Box3(), // empty — skipped
      new THREE.Box3(new THREE.Vector3(3, 0, 3), new THREE.Vector3(5, 2, 5)),
    ];
    const framing = new THREE.Box3();
    for (const b of boxes) if (!b.isEmpty()) framing.union(b);

    baker.bakeBoxes(renderer, boxes, framing);

    expect(sceneRenderCalls).toHaveLength(1);
    const pass = sceneRenderCalls[0]!;
    expect(pass.instanceCount).toBe(2);
    // The footprints carry the flat-alpha depth override so the result is a
    // pure silhouette independent of depth.
    expect(
      (pass.instanceMaterial as THREE.MeshDepthMaterial).isMeshDepthMaterial,
    ).toBe(true);
    baker.dispose();
  });

  it('lays each footprint flat in the XZ plane at the box centre/floor', () => {
    // Regression guard: the footprint must stay HORIZONTAL. A stray rotation in
    // the instance matrix (e.g. double-rotating the already-XZ unit quad) stands
    // it up vertically — edge-on to the top-down bake camera → empty silhouette.
    const baker = new ContactShadowBaker();
    const { renderer, sceneRenderCalls } = makeFakeRenderer();
    const box = new THREE.Box3(
      new THREE.Vector3(2, 5, 4),
      new THREE.Vector3(8, 9, 10),
    ); // size (6,4,6); centre (5,7,7); floor y = 5

    baker.bakeBoxes(renderer, [box], box.clone());

    const m = sceneRenderCalls[0]!.instanceMatrix0!;
    expect(m).not.toBeNull();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    m.decompose(pos, quat, scale);
    // Sits at the box's XZ centre on its own floor.
    expect(pos.x).toBeCloseTo(5);
    expect(pos.y).toBeCloseTo(5);
    expect(pos.z).toBeCloseTo(7);
    // No rotation — the unit quad is pre-rotated flat; instances only scale/move.
    expect(Math.abs(quat.x)).toBeCloseTo(0);
    expect(Math.abs(quat.y)).toBeCloseTo(0);
    expect(Math.abs(quat.z)).toBeCloseTo(0);
    // Covers the box's XZ footprint (X and Z extents), flat in Y.
    expect(scale.x).toBeCloseTo(6);
    expect(scale.z).toBeCloseTo(6);
    baker.dispose();
  });

  it('restores renderer state and leaves nothing in its transient scene', () => {
    const baker = new ContactShadowBaker();
    const { renderer } = makeFakeRenderer();
    const box = new THREE.Box3(
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(2, 2, 2),
    );

    baker.bakeBoxes(renderer, [box], box.clone());

    expect(renderer.getRenderTarget()).toBeNull();
    expect(renderer.autoClear).toBe(true);
    // A second bake must still render exactly one instanced mesh — proving the
    // first didn't leak its mesh into the reused transient scene.
    const { renderer: r2, sceneRenderCalls } = makeFakeRenderer();
    baker.bakeBoxes(r2, [box], box.clone());
    expect(sceneRenderCalls).toHaveLength(1);
    expect(sceneRenderCalls[0]!.instanceCount).toBe(1);
    baker.dispose();
  });
});
