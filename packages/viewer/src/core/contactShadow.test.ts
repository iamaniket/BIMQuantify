import * as THREE from 'three';
import { describe, expect, it } from 'vitest';

import { ContactShadowBaker } from './contactShadow.js';

/**
 * A GL-free stand-in for WebGLRenderer that records each `render` call's
 * target, the scene's `overrideMaterial`, and a snapshot of every scene
 * child's `visible` flag at call time — enough to assert the silhouette pass
 * isolates building geometry and that all mutated state is restored.
 */
function makeFakeRenderer(): {
  renderer: THREE.WebGLRenderer;
  sceneRenderCalls: Array<{
    override: THREE.Material | null;
    visibleByName: Record<string, boolean>;
  }>;
} {
  const sceneRenderCalls: Array<{
    override: THREE.Material | null;
    visibleByName: Record<string, boolean>;
  }> = [];
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
      for (const child of scene.children) {
        if (child.name) visibleByName[child.name] = child.visible;
      }
      sceneRenderCalls.push({
        override: scene.overrideMaterial,
        visibleByName,
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
