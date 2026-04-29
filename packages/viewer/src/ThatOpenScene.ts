/**
 * Bare-minimum ThatOpen scene wrapper.
 *
 * Uses `@thatopen/components` 2.4 for the SimpleScene/Camera/Renderer
 * boilerplate, and `@thatopen/fragments` 3.x's `FragmentsModels` (the new
 * worker-backed loader) for the actual `.frag` parsing. The two are kept
 * decoupled — swapping in xeokit or a vanilla three.js setup later means
 * rewriting only this file.
 */

import * as FRAGS from '@thatopen/fragments';
import {
  Components,
  SimpleCamera,
  SimpleRenderer,
  SimpleScene,
  SimpleWorld,
  Worlds,
} from '@thatopen/components';

import { getWorkerUrl } from './wasm.js';

type World = SimpleWorld<SimpleScene, SimpleCamera, SimpleRenderer>;

export class ThatOpenScene {
  private components: Components | null = null;
  private world: World | null = null;
  private fragments: FRAGS.FragmentsModels | null = null;
  private updateTimer: ReturnType<typeof setInterval> | null = null;

  mount(container: HTMLElement): void {
    if (this.components !== null) {
      throw new Error('ThatOpenScene is already mounted');
    }
    const components = new Components();

    const worlds = components.get(Worlds);
    const world = worlds.create<SimpleScene, SimpleCamera, SimpleRenderer>();

    world.scene = new SimpleScene(components);
    world.renderer = new SimpleRenderer(components, container);
    world.camera = new SimpleCamera(components);
    world.scene.setup();

    components.init();
    world.camera.controls.setLookAt(15, 15, 15, 0, 0, 0);

    this.fragments = new FRAGS.FragmentsModels(getWorkerUrl());
    // FragmentsModels streams tile data from a worker; pull updates on a
    // gentle 200ms interval (force=false to avoid a per-frame stall).
    this.updateTimer = setInterval(() => {
      this.fragments?.update().catch(() => undefined);
    }, 200);

    this.components = components;
    this.world = world;
  }

  async loadFragments(bytes: Uint8Array): Promise<void> {
    const components = this.components;
    const world = this.world;
    const fragments = this.fragments;
    if (components === null || world === null || fragments === null) {
      throw new Error('mount() must be called before loadFragments()');
    }

    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    const modelId = `model-${String(Date.now())}`;
    const model = await fragments.load(buffer as ArrayBuffer, { modelId });

    const sceneThree = (world.scene as unknown as {
      three: import('three').Scene;
    }).three;
    sceneThree.add(model.object);

    await this.frameCamera(model);
  }

  private async frameCamera(model: FRAGS.FragmentsModel): Promise<void> {
    const world = this.world;
    if (world === null) return;
    const THREE = await import('three');
    // model.box is computed once tiles load; if it's empty, fall back to the
    // object's THREE-derived bounds.
    let box = model.box;
    if (!box || box.isEmpty()) {
      box = new THREE.Box3().setFromObject(model.object);
    }
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const distance = maxDim * 1.8;
    world.camera.controls.setLookAt(
      center.x + distance,
      center.y + distance,
      center.z + distance,
      center.x,
      center.y,
      center.z,
      false,
    );
  }

  unmount(): void {
    if (this.updateTimer !== null) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
    this.fragments?.dispose().catch(() => undefined);
    this.fragments = null;
    if (this.components !== null) {
      this.components.dispose();
      this.components = null;
    }
    this.world = null;
  }
}
