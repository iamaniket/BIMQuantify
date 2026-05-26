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
  FragmentsManager,
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
import { LAYER_OVERLAY } from './layers.js';
import type { Plugin, ViewerContext, ViewerEvents } from './types.js';

type World = SimpleWorld<SimpleScene, SimpleCamera, SimpleRenderer>;

export interface ShadowOptions {
  enabled?: boolean;
}

export interface BackgroundOptions {
  /** 0xRRGGBB. Default: 0xffffff. */
  color?: number;
}

/**
 * Symbolic camera-drag actions. Maps 1:1 onto camera-controls' ACTION
 * enum without requiring the consumer to import that package.
 */
export type CameraAction =
  | 'rotate'
  | 'truck'
  | 'dolly'
  | 'zoom'
  | 'offset'
  | 'none';

/**
 * Mouse-button → camera-drag action assignments. Anything left undefined
 * inherits camera-controls' default (left=rotate, middle=dolly,
 * right=truck, wheel=dolly).
 */
export interface ControlsOptions {
  left?: CameraAction;
  middle?: CameraAction;
  right?: CameraAction;
  wheel?: CameraAction;
}

export interface ViewerOptions {
  /** Plugins to register at construction. Order matters for dependencies. */
  plugins?: Plugin[];
  background?: BackgroundOptions;
  shadows?: ShadowOptions;
  /** Drag-mouse-button assignments (rotate/pan/zoom). */
  controls?: ControlsOptions;
}

/** Camera idle window after which the `viewer:idle` event fires. */
const IDLE_MS = 150;

export class Viewer {
  readonly events = new EventBus<ViewerEvents>();
  readonly commands = new CommandRegistry();

  private components: Components | null = null;
  private world: World | null = null;
  private fragmentsModels: FRAGS.FragmentsModels | null = null;
  private updateRafId: number | null = null;
  private cameraChangeUnsub: (() => void) | null = null;
  private pluginManager: PluginManager | null = null;
  private sun: THREE.DirectionalLight | null = null;
  private shadowGround: THREE.Mesh | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private shadowsEnabled = true;
  private baseNear = 0.01;
  private baseFar = 2000;
  private modelMaxDim = 1;
  private lastAppliedNear = 0.01;
  private lastAppliedFar = 2000;
  modelId: string | null = null;

  constructor(private readonly options: ViewerOptions = {}) {}

  private updateDynamicNearFar(): void {
    const world = this.world;
    if (!world) return;
    const cam = world.camera.three;
    if (!(cam instanceof THREE.PerspectiveCamera)) return;

    const target = new THREE.Vector3();
    world.camera.controls.getTarget(target);
    const distance = cam.position.distanceTo(target);

    const dynamicNear = Math.min(
      Math.max(distance * 0.001, 0.001),
      this.baseNear,
    );
    const dynamicFar = Math.min(
      Math.max(distance * 100, this.modelMaxDim * 3),
      this.baseFar,
    );

    const nearChanged = Math.abs(dynamicNear - this.lastAppliedNear) > 1e-6;
    const farChanged = Math.abs(dynamicFar - this.lastAppliedFar) > 1e-4;
    if (nearChanged || farChanged) {
      cam.near = dynamicNear;
      cam.far = dynamicFar;
      cam.updateProjectionMatrix();
      this.lastAppliedNear = dynamicNear;
      this.lastAppliedFar = dynamicFar;
    }
  }

  async mount(container: HTMLElement): Promise<void> {
    if (this.components !== null) {
      throw new Error('Viewer is already mounted');
    }

    const components = new Components();
    const worlds = components.get(Worlds);
    const world = worlds.create<SimpleScene, SimpleCamera, SimpleRenderer>();

    world.scene = new SimpleScene(components);
    // Z-fighting on coplanar BIM geometry (slab/wall, glazing/frame) is
    // handled by per-material polygonOffset wired up below — NOT by
    // logarithmicDepthBuffer. The two conflict: log depth writes
    // gl_FragDepth in the fragment shader, which runs after the rasterizer
    // state polygonOffset operates on, so the offset is silently ignored.
    // Linear depth + tight near/far (frameModel) + polygonOffset is the
    // ThatOpen-recommended combo and preserves early-Z performance.
    world.renderer = new SimpleRenderer(components, container, {
      antialias: true,
    });
    world.camera = new SimpleCamera(components);
    world.scene.setup();

    components.init();

    // OBC built-in components (Classifier, Viewpoints, etc.) read
    // `components.get(FragmentsManager)` in their constructors and access
    // `.list` immediately, which throws "FragmentsManager not initialized.
    // Call init() first." until FragmentsManager is initialized. We construct
    // our own FRAGS.FragmentsModels below for the actual model load path,
    // but the OBC manager still needs its own init so its dependents work.
    const fragmentsManager = components.get(FragmentsManager);
    fragmentsManager.init(getWorkerUrl());

    world.camera.controls.setLookAt(15, 15, 15, 0, 0, 0);
    world.camera.three.layers.enable(LAYER_OVERLAY);

    this.applyControls(world);
    this.applyBackground(world);
    this.applyLightingAndShadows(world);

    const fragmentsModels = new FRAGS.FragmentsModels(getWorkerUrl());

    // Render all LOD tiers so every element (furniture, fittings, etc.)
    // is visible from the start, not just the coarsest structural shell.
    fragmentsModels.settings.graphicsQuality = 2;

    // Default maxUpdateRate is 100ms — way too slow for selection/highlight
    // changes. Lowering to 0 lets every rAF tick drain pending tile updates.
    // MeshManager's own updateThreshold (4ms) already caps per-frame cost.
    fragmentsModels.settings.maxUpdateRate = 0;

    // Give every non-LOD material a unique polygon offset so coplanar BIM
    // surfaces (slab-on-wall, glazing-on-frame) resolve deterministically
    // instead of z-fighting.
    fragmentsModels.models.materials.list.onItemSet.add(({ value: material }) => {
      if ('isLodMaterial' in material && material.isLodMaterial) return;
      material.polygonOffset = true;
      material.polygonOffsetUnits = 1;
      material.polygonOffsetFactor = Math.random();
      // BIM authoring tools export geometry with inconsistent face winding.
      // Without DoubleSide, back-facing triangles are culled and entire
      // elements disappear even though their geometry is present.
      material.side = THREE.DoubleSide;
    });

    // FragmentsModels streams tile data from a worker. Drive `update()`
    // from rAF so visual changes (setColor / setOpacity / streaming LOD)
    // appear on the next frame instead of waiting for a slow timer.
    // `force=false` (default) means we only drain completed batches —
    // no per-frame stall waiting on pending worker work.
    const tick = (): void => {
      fragmentsModels.update().catch(() => undefined);
      this.updateRafId = requestAnimationFrame(tick);
    };
    this.updateRafId = requestAnimationFrame(tick);

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
      components,
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
      this.updateDynamicNearFar();
      // Reset the idle countdown — fires `viewer:idle` once the camera
      // has been still for IDLE_MS so plugins (effects composer) can
      // run their expensive frame.
      if (this.idleTimer !== null) clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => {
        this.idleTimer = null;
        this.events.emit('viewer:idle', undefined);
        // Re-apply after plugins (e.g. interactive-performance) restore
        // their saved far on idle — ensures correct values for the final
        // camera position.
        this.updateDynamicNearFar();
      }, IDLE_MS);
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
    this.modelId = modelId;
    const model = await fragments.load(buffer as ArrayBuffer, { modelId });

    // Connect camera so the LOD streaming system knows the viewpoint and
    // can stream ALL tile detail levels, not just the coarsest shell.
    model.useCamera(world.camera.three);

    // Default LodMode culls items outside the camera frustum, making
    // elements behind the initial viewpoint invisible. ALL_VISIBLE
    // forces every item to render as full geometry regardless of view.
    await model.setLodMode(FRAGS.LodMode.ALL_VISIBLE);

    const sceneThree = (world.scene as unknown as { three: THREE.Scene }).three;
    sceneThree.add(model.object);

    await this.frameModel(model);
    // Position sun + size the blob shadow plane to the model's footprint.
    this.fitLightsToModel(model);
    // Trigger an immediate idle frame so post-processing kicks in.
    this.events.emit('viewer:idle', undefined);

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
    // Padding 1.8 matches camera plugin's default framePadding.
    const distance = maxDim * 1.8;

    // Iso direction: top-front-right [1,1,1] normalised — matches camera.home.
    const len = Math.sqrt(3);
    const nx = 1 / len;
    const ny = 1 / len;
    const nz = 1 / len;

    world.camera.controls.setLookAt(
      center.x + nx * distance,
      center.y + ny * distance,
      center.z + nz * distance,
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
      this.baseNear = cam.near;
      this.baseFar = cam.far;
      this.modelMaxDim = maxDim;
      this.lastAppliedNear = cam.near;
      this.lastAppliedFar = cam.far;
      cam.updateProjectionMatrix();
    }
  }

  /**
   * Apply user-configured drag-button assignments to the live
   * camera-controls instance. We reach the ACTION enum via the
   * controls' constructor so we don't take a direct dependency on
   * `camera-controls` in this package's `package.json`.
   */
  private applyControls(world: World): void {
    const opts = this.options.controls;
    if (!opts) return;
    const controls = world.camera!.controls;
    const ctor = controls.constructor as { ACTION?: Record<string, number> };
    const action = ctor.ACTION;
    if (!action) return;
    const map: Record<CameraAction, number | undefined> = {
      rotate: action.ROTATE,
      truck: action.TRUCK,
      dolly: action.DOLLY,
      zoom: action.ZOOM,
      offset: action.OFFSET,
      none: action.NONE,
    };
    const buttons = controls.mouseButtons;
    if (opts.left !== undefined && map[opts.left] !== undefined) {
      buttons.left = map[opts.left] as typeof buttons.left;
    }
    if (opts.middle !== undefined && map[opts.middle] !== undefined) {
      buttons.middle = map[opts.middle] as typeof buttons.middle;
    }
    if (opts.right !== undefined && map[opts.right] !== undefined) {
      buttons.right = map[opts.right] as typeof buttons.right;
    }
    if (opts.wheel !== undefined && map[opts.wheel] !== undefined) {
      buttons.wheel = map[opts.wheel] as typeof buttons.wheel;
    }
  }

  private applyBackground(world: World): void {
    const color = this.options.background?.color ?? 0xffffff;
    const sceneThree = (world.scene as unknown as { three: THREE.Scene }).three;
    sceneThree.background = new THREE.Color(color);
    const renderer = world.renderer!.three;
    renderer.setClearColor(color, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  private applyLightingAndShadows(world: World): void {
    const opts = this.options.shadows ?? {};
    this.shadowsEnabled = opts.enabled ?? true;
    const sceneThree = (world.scene as unknown as { three: THREE.Scene }).three;

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
    sceneThree.add(sun);
    sceneThree.add(sun.target);
    this.sun = sun;

    // Custom-shader "blob shadow" ground plane. A soft elliptical dark
    // gradient below the model — always visible, no shadow-map cost,
    // no dependence on streamed/LOD mesh castShadow flags.
    //
    // Layout (in plane-local UV space, 0..1):
    //   r=0..coreRadius          → full shadow opacity
    //   r=coreRadius..1          → smooth falloff to transparent
    if (this.shadowsEnabled) {
      const groundMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          color: { value: new THREE.Color(0x000000) },
          opacity: { value: 0.3 },
          coreRadius: { value: 0.35 },
          uLinearBlend: { value: 0.0 },
        },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform vec3 color;
          uniform float opacity;
          uniform float coreRadius;
          uniform float uLinearBlend;
          varying vec2 vUv;
          void main() {
            vec2 d = vUv - 0.5;
            float r = length(d) * 2.0;
            float a = 1.0 - smoothstep(coreRadius, 1.0, r);
            a = a * a;
            float rawA = a * opacity;
            // When the EffectComposer renders to a linear target, alpha
            // blending produces a lighter shadow than the sRGB canvas
            // path. Compensate by boosting alpha so the perceptual result
            // matches: alpha_adj = 1 - (1 - alpha)^gamma.
            float finalA = mix(rawA, 1.0 - pow(1.0 - rawA, 2.2), uLinearBlend);
            gl_FragColor = vec4(color, finalA);
          }
        `,
      });
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), groundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.name = 'shadow-ground';
      // Render before opaque geometry so the model itself draws over us.
      ground.renderOrder = -1;
      sceneThree.add(ground);
      this.shadowGround = ground;
    }
  }

  /**
   * Position the sun and the blob-shadow plane based on the model's bbox.
   * The blob plane is sized to roughly 2.5× the model footprint so the
   * gradient extends well beyond the model's edges.
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

    const ground = this.shadowGround;
    if (ground !== null) {
      // Size the plane to match the model's XZ footprint independently,
      // so the elliptical gradient stretches to fit a rectangular model.
      // Pad by 3× so the soft falloff has plenty of room to fade out.
      const padX = Math.max(size.x, 1) * 3.0;
      const padZ = Math.max(size.z, 1) * 3.0;
      // Plane is XY before rotation; after rotation -π/2 around X,
      // local-X maps to world-X and local-Y maps to world-Z. So scale.x
      // controls world-X span and scale.y controls world-Z span.
      ground.scale.set(padX, padZ, 1);
      ground.position.set(center.x, box.min.y - maxDim * 0.05, center.z);
      ground.updateMatrixWorld();
    }
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
    if (this.updateRafId !== null) {
      cancelAnimationFrame(this.updateRafId);
      this.updateRafId = null;
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
    this.modelId = null;
    this.events.emit('viewer:unmounted', undefined);
    this.events.clear();
  }
}
