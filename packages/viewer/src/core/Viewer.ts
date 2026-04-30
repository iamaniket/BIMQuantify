/**
 * Viewer — per-mount singleton. Owns the three.js scene, the FragmentsModels
 * loader, the typed event bus, the command registry, and the plugin manager.
 *
 * This is the file that knows about ThatOpen's `SimpleWorld`. Everything
 * else in the package talks to the viewer through `ViewerContext`, so a
 * future swap to xeokit or vanilla three.js means rewriting only this file.
 */

import * as THREE from 'three';
import * as FRAGS from '@thatopen/fragments';
import {
  Components,
  SimpleCamera,
  SimpleRenderer,
  SimpleScene,
  SimpleWorld,
  Worlds,
} from '@thatopen/components';

import { getWorkerUrl } from '../wasm.js';
import { CommandRegistry } from './CommandRegistry.js';
import { EventBus } from './EventBus.js';
import { PluginManager } from './PluginManager.js';
import type { Plugin, ViewerContext, ViewerEvents } from './types.js';

type World = SimpleWorld<SimpleScene, SimpleCamera, SimpleRenderer>;

export type ShadowQuality = 'low' | 'medium' | 'high';

export interface ShadowOptions {
  enabled?: boolean;
  quality?: ShadowQuality;
}

export interface BackgroundOptions {
  /** 0xRRGGBB. Default: 0xffffff. */
  color?: number;
}

export interface ViewerOptions {
  /** Plugins to register at construction. Order matters for dependencies. */
  plugins?: Plugin[];
  background?: BackgroundOptions;
  shadows?: ShadowOptions;
}

const SHADOW_MAP_SIZE: Record<ShadowQuality, number> = {
  low: 1024,
  medium: 2048,
  high: 4096,
};

/** Camera idle window after which the shadow map is refreshed. */
const SHADOW_IDLE_MS = 150;

export class Viewer {
  readonly events = new EventBus<ViewerEvents>();
  readonly commands = new CommandRegistry();

  private components: Components | null = null;
  private world: World | null = null;
  private fragmentsModels: FRAGS.FragmentsModels | null = null;
  private updateTimer: ReturnType<typeof setInterval> | null = null;
  private cameraChangeUnsub: (() => void) | null = null;
  private pluginManager: PluginManager | null = null;
  private sun: THREE.DirectionalLight | null = null;
  private shadowGround: THREE.Mesh | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private shadowsEnabled = true;

  constructor(private readonly options: ViewerOptions = {}) {}

  async mount(container: HTMLElement): Promise<void> {
    if (this.components !== null) {
      throw new Error('Viewer is already mounted');
    }

    const components = new Components();
    const worlds = components.get(Worlds);
    const world = worlds.create<SimpleScene, SimpleCamera, SimpleRenderer>();

    world.scene = new SimpleScene(components);
    // logarithmicDepthBuffer is constructor-only on WebGLRenderer; enabling
    // it eliminates z-fighting on coplanar BIM geometry (slabs/floors,
    // wall/glazing) that depth-range tuning alone cannot fully resolve.
    world.renderer = new SimpleRenderer(components, container, {
      antialias: true,
      logarithmicDepthBuffer: true,
    });
    world.camera = new SimpleCamera(components);
    world.scene.setup();

    components.init();
    world.camera.controls.setLookAt(15, 15, 15, 0, 0, 0);

    this.applyBackground(world);
    this.applyLightingAndShadows(world);

    const fragmentsModels = new FRAGS.FragmentsModels(getWorkerUrl());
    // FragmentsModels streams tile data from a worker; pull updates on a
    // gentle 200ms interval (force=false to avoid a per-frame stall).
    this.updateTimer = setInterval(() => {
      fragmentsModels.update().catch(() => undefined);
    }, 200);

    this.components = components;
    this.world = world;
    this.fragmentsModels = fragmentsModels;

    // Build the context once; it's shared by every plugin.
    const ctx: ViewerContext = {
      get scene() {
        return (world.scene as unknown as { three: THREE.Scene }).three;
      },
      get camera() {
        return world.camera!.three;
      },
      get cameraControls() {
        return world.camera!.controls;
      },
      get renderer() {
        return world.renderer!.three;
      },
      get canvas() {
        return world.renderer!.three.domElement;
      },
      container,
      fragments: fragmentsModels,
      events: this.events,
      commands: this.commands,
      plugins: {
        get: <T = Plugin>(name: string): T | null =>
          this.pluginManager?.get<T>(name) ?? null,
        has: (name: string) => this.pluginManager?.has(name) ?? false,
      },
      models: () => fragmentsModels.models.list as unknown as Map<string, FRAGS.FragmentsModel>,
    };

    this.pluginManager = new PluginManager(ctx, this.commands, this.events);

    // Bridge camera-controls events to a typed viewer event so plugins
    // (e.g. ViewCube) can react without poking three.js directly.
    const camControls = world.camera.controls;
    const camThree = world.camera.three;
    const onCamChange = (): void => {
      const pos = camThree.position;
      const target = new THREE.Vector3();
      camControls.getTarget(target);
      this.events.emit('camera:change', {
        position: { x: pos.x, y: pos.y, z: pos.z },
        target: { x: target.x, y: target.y, z: target.z },
      });
      this.scheduleShadowRefresh();
    };
    camControls.addEventListener('update', onCamChange);
    this.cameraChangeUnsub = () => {
      camControls.removeEventListener('update', onCamChange);
    };

    this.events.emit('viewer:mounted', { container });

    for (const plugin of this.options.plugins ?? []) {
      await this.pluginManager.register(plugin);
    }
  }

  async loadFragments(bytes: Uint8Array): Promise<string> {
    const world = this.world;
    const fragments = this.fragmentsModels;
    if (world === null || fragments === null) {
      throw new Error('mount() must be called before loadFragments()');
    }

    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    const modelId = `model-${String(Date.now())}`;
    const model = await fragments.load(buffer as ArrayBuffer, { modelId });

    const sceneThree = (world.scene as unknown as { three: THREE.Scene }).three;
    sceneThree.add(model.object);

    // Every mesh in the loaded fragment should both cast and receive
    // shadows so the contact-shadow pass under the model is meaningful.
    if (this.shadowsEnabled) {
      model.object.traverse((obj) => {
        if ((obj as THREE.Mesh).isMesh) {
          obj.castShadow = true;
          obj.receiveShadow = true;
        }
      });
    }

    await this.frameModel(model);
    // After framing, fit lights/ground to the model so the shadow camera
    // wraps the bbox tightly (large frustums waste shadow-map resolution).
    this.fitLightsToModel(model);
    // Force one fresh shadow render now that geometry exists.
    this.requestShadowRender();

    this.events.emit('model:loaded', { modelId });
    return modelId;
  }

  /**
   * Initial frame after a model loads. The reusable "frame everything"
   * is exposed as a `camera.zoomExtents` command by the camera plugin;
   * we duplicate the math here only so the viewer is still useful before
   * any plugin is installed.
   */
  private async frameModel(model: FRAGS.FragmentsModel): Promise<void> {
    const world = this.world;
    if (world === null) return;
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

    // Tighten depth range to the model's scale. Default near=0.1/far=2000
    // wastes precision over BIM-scale geometry and produces z-fighting on
    // coplanar surfaces.
    const cam = world.camera.three;
    if (cam instanceof THREE.PerspectiveCamera) {
      cam.near = Math.max(maxDim / 1000, 0.01);
      cam.far = maxDim * 100;
      cam.updateProjectionMatrix();
    }
  }

  private applyBackground(world: World): void {
    const color = this.options.background?.color ?? 0xffffff;
    const sceneThree = (world.scene as unknown as { three: THREE.Scene }).three;
    sceneThree.background = new THREE.Color(color);
    const renderer = world.renderer!.three;
    renderer.setClearColor(color, 1);
  }

  private applyLightingAndShadows(world: World): void {
    const opts = this.options.shadows ?? {};
    this.shadowsEnabled = opts.enabled ?? true;
    const quality: ShadowQuality = opts.quality ?? 'medium';
    const renderer = world.renderer!.three;
    const sceneThree = (world.scene as unknown as { three: THREE.Scene }).three;

    if (this.shadowsEnabled) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type =
        quality === 'high' ? THREE.VSMShadowMap : THREE.PCFSoftShadowMap;
      // Shadow map only refreshes when we explicitly flag it dirty — the
      // idle-render loop drives this. Cheap moving frames, full-quality
      // shadows once motion stops.
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = true;
    } else {
      renderer.shadowMap.enabled = false;
    }

    // Forge-style neutral studio lighting: a hemisphere ambient + a soft
    // directional sun. SimpleScene.setup() may have already added its own
    // lights; we add ours alongside — three.js sums them.
    const hemi = new THREE.HemisphereLight(0xffffff, 0xdcdcdc, 0.6);
    hemi.position.set(0, 1, 0);
    sceneThree.add(hemi);

    const ambient = new THREE.AmbientLight(0xffffff, 0.25);
    sceneThree.add(ambient);

    const sun = new THREE.DirectionalLight(0xffffff, 1.0);
    sun.position.set(50, 100, 50);
    sun.target.position.set(0, 0, 0);
    sun.castShadow = this.shadowsEnabled;
    if (this.shadowsEnabled) {
      const mapSize = SHADOW_MAP_SIZE[quality];
      sun.shadow.mapSize.set(mapSize, mapSize);
      // Generous default — fitLightsToModel tightens this once geometry loads.
      sun.shadow.camera.near = 0.5;
      sun.shadow.camera.far = 500;
      sun.shadow.camera.left = -100;
      sun.shadow.camera.right = 100;
      sun.shadow.camera.top = 100;
      sun.shadow.camera.bottom = -100;
      sun.shadow.bias = -0.0005;
      sun.shadow.normalBias = 0.02;
    }
    sceneThree.add(sun);
    sceneThree.add(sun.target);
    this.sun = sun;

    // Ground plane that only receives shadows (transparent material).
    // Sized large up-front; repositioned per-model in fitLightsToModel.
    if (this.shadowsEnabled) {
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.ShadowMaterial({ opacity: 0.25 }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      ground.name = 'shadow-ground';
      // Push ground rendering before opaque so shadow doesn't z-fight.
      ground.renderOrder = -1;
      sceneThree.add(ground);
      this.shadowGround = ground;
    }
  }

  /**
   * Fit the directional light's shadow camera tightly to the model's
   * bbox, and place the ground plane just under it. Tight frustum =
   * sharper, less-wasted shadow texels.
   */
  private fitLightsToModel(model: FRAGS.FragmentsModel): void {
    const sun = this.sun;
    if (sun === null) return;
    let box = model.box;
    if (!box || box.isEmpty()) {
      box = new THREE.Box3().setFromObject(model.object);
    }
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);

    // Sun up-and-to-the-side, distance scaled to model.
    const sunDir = new THREE.Vector3(0.6, 1, 0.5).normalize();
    sun.position.copy(center).addScaledVector(sunDir, maxDim * 2);
    sun.target.position.copy(center);
    sun.target.updateMatrixWorld();

    if (this.shadowsEnabled) {
      const half = maxDim * 1.2;
      sun.shadow.camera.left = -half;
      sun.shadow.camera.right = half;
      sun.shadow.camera.top = half;
      sun.shadow.camera.bottom = -half;
      sun.shadow.camera.near = Math.max(maxDim * 0.1, 0.1);
      sun.shadow.camera.far = maxDim * 8;
      sun.shadow.camera.updateProjectionMatrix();
    }

    const ground = this.shadowGround;
    if (ground !== null) {
      const planeSize = maxDim * 6;
      ground.scale.set(planeSize, planeSize, 1);
      ground.position.set(center.x, box.min.y - maxDim * 0.001, center.z);
      ground.updateMatrixWorld();
    }
  }

  /**
   * Request a fresh shadow-map render on the next frame. Called by the
   * idle timer (after camera stops) and once after each model load.
   */
  private requestShadowRender(): void {
    if (!this.shadowsEnabled) return;
    const renderer = this.world?.renderer?.three;
    if (!renderer) return;
    renderer.shadowMap.needsUpdate = true;
    this.events.emit('viewer:idle', undefined);
  }

  /**
   * Reset the idle countdown — called on every camera change. When the
   * camera has been still for SHADOW_IDLE_MS the shadow map is refreshed
   * exactly once. This is the "last frame" balance: zero shadow cost
   * during motion, full-quality shadow on the first idle frame.
   */
  private scheduleShadowRefresh(): void {
    if (!this.shadowsEnabled) return;
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.requestShadowRender();
    }, SHADOW_IDLE_MS);
  }

  async registerPlugin(plugin: Plugin): Promise<void> {
    if (!this.pluginManager) throw new Error('Viewer is not mounted');
    await this.pluginManager.register(plugin);
  }

  async unregisterPlugin(name: string): Promise<void> {
    if (!this.pluginManager) return;
    await this.pluginManager.unregister(name);
  }

  getPlugin<T extends Plugin = Plugin>(name: string): T | null {
    return this.pluginManager?.get<T>(name) ?? null;
  }

  async unmount(): Promise<void> {
    if (this.pluginManager) {
      await this.pluginManager.disposeAll();
      this.pluginManager = null;
    }
    this.cameraChangeUnsub?.();
    this.cameraChangeUnsub = null;
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.updateTimer !== null) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
    this.fragmentsModels?.dispose().catch(() => undefined);
    this.fragmentsModels = null;
    if (this.shadowGround !== null) {
      (this.shadowGround.geometry as THREE.BufferGeometry).dispose();
      (this.shadowGround.material as THREE.Material).dispose();
      this.shadowGround = null;
    }
    this.sun = null;
    if (this.components !== null) {
      this.components.dispose();
      this.components = null;
    }
    this.world = null;
    this.events.emit('viewer:unmounted', undefined);
    this.events.clear();
  }
}
