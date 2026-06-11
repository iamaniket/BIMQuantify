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
  OrthoPerspectiveCamera,
  SimpleRenderer,
  SimpleScene,
  SimpleWorld,
  Worlds,
} from '@thatopen/components';

import { getWorkerUrl } from '../wasm.js';
import { CommandRegistry } from './CommandRegistry.js';
import { EventBus } from './EventBus.js';
import { PluginManager } from './PluginManager.js';
import { frameView } from './framing.js';
import { LAYER_OVERLAY } from './layers.js';
import type { Plugin, ViewerContext, ViewerEvents } from './types.js';

type World = SimpleWorld<SimpleScene, OrthoPerspectiveCamera, SimpleRenderer>;

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

export interface ZoomOptions {
  /** Max dolly distance as multiple of model size. Default: 4. */
  maxFactor?: number;
  /**
   * Zoom toward the cursor (Forge/Navisworks-style) rather than the orbit
   * centre. Default: true. When false, the wheel dollies toward the current
   * camera target, which makes it hard to zoom into off-centre objects.
   */
  toCursor?: boolean;
}

export interface LoadFragmentsOptions {
  /**
   * In-flight fetch of the processor-precomputed outline artifact
   * (compressed bytes). Never blocks or fails the model load — the outline
   * plugin awaits it and falls back to client-side edge extraction when it
   * resolves null.
   */
  precomputedOutline?: Promise<Uint8Array | null>;
}

export interface ViewerOptions {
  /** Plugins to register at construction. Order matters for dependencies. */
  plugins?: Plugin[];
  background?: BackgroundOptions;
  shadows?: ShadowOptions;
  /** Drag-mouse-button assignments (rotate/pan/zoom). */
  controls?: ControlsOptions;
  /** Min/max zoom (dolly) distance limits. */
  zoom?: ZoomOptions;
}

/** Camera idle window after which the `viewer:idle` event fires. */
const IDLE_MS = 150;

/**
 * X-ray fades items to near-zero opacity. Any material arriving below this
 * opacity is treated as an x-ray fade and rendered with alpha-to-coverage
 * (dithered, opaque pass) instead of alpha blending — see the material hook in
 * `mount()`. Genuinely translucent BIM materials (glass, ~0.2+) stay above the
 * threshold and keep true alpha blending.
 */
const XRAY_DITHER_MAX_OPACITY = 0.12;

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
  /** World-space AABB of all loaded models. */
  private sceneBox: THREE.Box3 | null = null;
  /**
   * World-space AABB the near/far planes are fitted to: the model bbox unioned
   * with the blob-shadow ground plane (3× the model footprint) so the shadow's
   * far edge never clips at the far plane.
   */
  private depthBox: THREE.Box3 | null = null;
  private lastAppliedNear = 0.01;
  private lastAppliedFar = 2000;
  private zoomOutLimit = Infinity;
  /** Reused scratch vectors for the per-frame near/far fit (no per-call alloc). */
  private readonly forwardAxis = new THREE.Vector3();
  private readonly depthBoxSize = new THREE.Vector3();
  private readonly precomputedOutlines = new Map<
    string,
    Promise<Uint8Array | null>
  >();
  modelId: string | null = null;

  constructor(private readonly options: ViewerOptions = {}) {}

  private updateDynamicNearFar(): void {
    const world = this.world;
    if (!world) return;
    const cam = world.camera.three;
    if (!(cam instanceof THREE.PerspectiveCamera)) return;

    const box = this.depthBox;
    if (!box || box.isEmpty()) return;

    // Fit near/far to the model's actual depth range as seen from the current
    // viewpoint: project the 8 bbox corners onto the camera's forward axis and
    // take the min/max depth. This keeps the whole model inside the frustum
    // from any distance — so distant geometry no longer clips when zoomed in —
    // while tracking the camera so the depth budget stays as tight as the
    // geometry allows (good precision, minimal z-fighting). Coplanar BIM
    // surfaces are handled separately by per-material polygonOffset.
    const forward = cam.getWorldDirection(this.forwardAxis);
    const px = cam.position.x;
    const py = cam.position.y;
    const pz = cam.position.z;

    let minDepth = Infinity;
    let maxDepth = -Infinity;
    for (let i = 0; i < 8; i++) {
      const cx = i & 1 ? box.max.x : box.min.x;
      const cy = i & 2 ? box.max.y : box.min.y;
      const cz = i & 4 ? box.max.z : box.min.z;
      const depth = (cx - px) * forward.x + (cy - py) * forward.y + (cz - pz) * forward.z;
      if (depth < minDepth) minDepth = depth;
      if (depth > maxDepth) maxDepth = depth;
    }

    // Entire model is behind the camera — leave the planes untouched.
    if (maxDepth <= 0) return;

    // Near tracks the nearest geometry, pulled back 10% so a wall viewed
    // head-on (its whole face at one depth) never sits exactly on the near
    // plane and flickers. minDepth goes negative inside the model; the absolute
    // floor (5 mm, scaled down for sub-metre models) takes over there, so the
    // camera can approach and pass through surfaces without near-clipping.
    // Keeping near close to the actual geometry means the near/far ratio is
    // small at normal viewing distance — crisp depth, no back-of-model
    // z-fighting (the original 5000:1 floor caused that).
    const size = box.getSize(this.depthBoxSize);
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const nearFloor = Math.min(0.005, maxDim * 1e-4);
    const near = Math.max(minDepth * 0.9, nearFloor);

    // Far always reaches the back of the scene (+2% slack) — NOT capped to a
    // ratio of near. Capping far to near pulled the far plane in whenever any
    // geometry was close to the eye, making the model you were flying toward
    // vanish. When the eye is millimetres from a surface the ratio does grow,
    // but the resulting far-end z-fighting is hidden behind the near geometry
    // filling the screen, so it's never actually visible.
    const far = maxDepth * 1.02;

    const nearChanged = Math.abs(near - this.lastAppliedNear) > 1e-6;
    const farChanged = Math.abs(far - this.lastAppliedFar) > 1e-4;
    if (nearChanged || farChanged) {
      cam.near = near;
      cam.far = far;
      cam.updateProjectionMatrix();
      this.lastAppliedNear = near;
      this.lastAppliedFar = far;
    }
  }

  /** Union of every loaded model's world-space AABB (empty Box3 if none). */
  private computeWorldSceneBox(): THREE.Box3 {
    const box = new THREE.Box3();
    const fragments = this.fragmentsModels;
    if (!fragments) return box;
    const models = fragments.models.list as unknown as Map<string, FRAGS.FragmentsModel>;
    for (const model of models.values()) {
      let mb = model.box;
      if (!mb || mb.isEmpty()) {
        mb = new THREE.Box3().setFromObject(model.object);
      }
      if (!mb.isEmpty()) box.union(mb);
    }
    return box;
  }

  async mount(container: HTMLElement): Promise<void> {
    if (this.components !== null) {
      throw new Error('Viewer is already mounted');
    }

    const components = new Components();
    const worlds = components.get(Worlds);
    const world = worlds.create<SimpleScene, OrthoPerspectiveCamera, SimpleRenderer>();

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
    world.renderer.showLogo = false;
    world.camera = new OrthoPerspectiveCamera(components);
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

    // Zoom toward the cursor (Forge/Navisworks-style) instead of the orbit
    // centre, so scrolling in over an off-centre object actually approaches
    // that object rather than flying past it toward the model centre. Matches
    // the 2D viewer and the pivot-rotate orbit behaviour. Configurable via
    // `zoom.toCursor` (default on).
    world.camera.controls.dollyToCursor = this.options.zoom?.toCursor ?? true;

    // OrthoPerspectiveCamera's default OrbitMode clamps minDistance=1 /
    // maxDistance=300 (FirstPersonMode/OrbitMode swaps mutate these too).
    // SimpleCamera left them at camera-controls' defaults, and large models
    // need to dolly closer/farther than that — zoom-out is otherwise bounded
    // by our own `zoomOutLimit` (see onCamChange). Restore the uncapped range.
    world.camera.controls.minDistance = Number.EPSILON;
    world.camera.controls.maxDistance = Infinity;

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
    // surfaces (slab-on-wall, glazing/frame) resolve deterministically
    // instead of z-fighting.
    fragmentsModels.models.materials.list.onItemSet.add(({ value: material }) => {
      if ('isLodMaterial' in material && material.isLodMaterial) return;
      material.polygonOffset = true;
      // BIM authoring tools export geometry with inconsistent face winding.
      // Without DoubleSide, back-facing triangles are culled and entire
      // elements disappear even though their geometry is present.
      material.side = THREE.DoubleSide;

      // X-ray fade materials arrive as transparent with near-zero opacity.
      // Render them as dithered-opaque (alpha-to-coverage) so they keep
      // early-Z and don't trigger blend overdraw / transparent sorting — the
      // FPS killer on large models. If ThatOpen recreates the material, this
      // hook fires again and re-applies the flags.
      if (material.transparent && material.opacity <= XRAY_DITHER_MAX_OPACITY) {
        material.transparent = false;
        material.alphaToCoverage = true;
        material.depthWrite = true;
        material.polygonOffsetFactor = 4 + Math.random();
        material.polygonOffsetUnits = 4;
        material.needsUpdate = true;
      } else if (material.transparent && material.opacity < 0.65) {
        // IFC Space-like geometry: very translucent, sits perfectly coplanar
        // on slabs. Disable depth writing entirely so it never wins depth
        // against the slab beneath — renders as a pure see-through overlay.
        material.depthWrite = false;
        material.depthTest = true;
        material.polygonOffset = false;
        material.needsUpdate = true;
      } else if (material.transparent) {
        // Semi-transparent BIM materials (glass, curtain walls) at higher
        // opacity. Keep depth writing but push behind opaque surfaces.
        material.depthWrite = true;
        material.polygonOffsetFactor = 3 + Math.random();
        material.polygonOffsetUnits = 16;
        material.needsUpdate = true;
      } else {
        // Opaque BIM surfaces: small random offset so coplanar faces
        // (slab-on-wall, glazing-on-frame) resolve deterministically.
        material.polygonOffsetFactor = 1 + Math.random();
        material.polygonOffsetUnits = 4;
      }
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
      get obcCamera() {
        return world.camera!;
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
      getPrecomputedOutline: (modelId: string) =>
        this.precomputedOutlines.get(modelId),
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

      // Clamp zoom-out: with infinityDolly the target shifts, so measure
      // the actual camera-to-scene-origin distance instead of controls.distance.
      if (this.zoomOutLimit < Infinity) {
        const dist = pos.distanceTo(target);
        if (dist > this.zoomOutLimit) {
          const dir = pos.clone().sub(target).normalize();
          const clampedPos = target.clone().addScaledVector(dir, this.zoomOutLimit);
          camControls.setPosition(clampedPos.x, clampedPos.y, clampedPos.z, false);
        }
      }

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

  async loadFragments(
    bytes: Uint8Array,
    opts: LoadFragmentsOptions = {},
  ): Promise<string> {
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
    // Stash before `model:loaded` fires so the outline plugin's handler
    // sees the supply via ctx.getPrecomputedOutline.
    if (opts.precomputedOutline) {
      this.precomputedOutlines.set(modelId, opts.precomputedOutline);
    }
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
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);

    // Iso direction [1,1,1], centered on the box, sized from the box's
    // projected width AND height against the live FOV/aspect — matches
    // camera.home. Models of any proportion frame to the same on-screen
    // size and sit centered. Padding 1.2 matches the camera plugin default.
    await frameView(
      world.camera.controls,
      world.camera.three,
      box,
      new THREE.Vector3(1, 1, 1),
      1.2,
      false,
    );

    // Cache the world-space scene AABB and fit the depth range to it. The
    // per-frame updater (updateDynamicNearFar) projects this box onto the view
    // axis so the entire model always stays inside the frustum — distant
    // geometry no longer clips when zoomed in — while staying tight enough
    // (with polygonOffset) to avoid z-fighting on coplanar BIM surfaces.
    this.sceneBox = this.computeWorldSceneBox();
    // Seed depthBox from the model bbox so near/far works before
    // fitLightsToModel runs (and stays correct when shadows are disabled).
    // fitLightsToModel unions the shadow ground plane into it afterwards.
    this.depthBox = this.sceneBox.clone();
    if (world.camera.three instanceof THREE.PerspectiveCamera) {
      this.updateDynamicNearFar();
    }

    const controls = world.camera.controls;
    // ThatOpen sets infinityDolly=true and minDistance=6. Keep infinityDolly
    // so the orbit target shifts forward on zoom-in (needed to go inside the
    // model). Max zoom-out is enforced manually in the camera update handler.
    controls.minDistance = 0;
    const maxF = this.options.zoom?.maxFactor ?? 4;
    this.zoomOutLimit = maxDim * maxF;
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

      // Fold the shadow plane's world AABB into the depth box so its far edge
      // never clips at the far plane (grazing/plan views). setFromObject reads
      // the transform just applied above, so the box can't drift from the
      // shadow geometry. Re-derive from the model union to stay idempotent.
      this.depthBox = this.computeWorldSceneBox();
      this.depthBox.union(new THREE.Box3().setFromObject(ground));
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
    this.sceneBox = null;
    this.depthBox = null;
    this.precomputedOutlines.clear();
    this.modelId = null;
    this.events.emit('viewer:unmounted', undefined);
    this.events.clear();
  }
}
