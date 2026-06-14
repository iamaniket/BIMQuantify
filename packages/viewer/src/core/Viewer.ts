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
  RendererMode,
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
import { COPLANAR_BIAS_EPS, COPLANAR_BIAS_LEVELS } from './depth-bias.js';
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
  /**
   * Stable model id. Federated callers pass a deterministic id (e.g.
   * `file-<fileId>`) so model↔file mapping is stable and the per-model
   * `precomputedOutlines` map keys correctly. Omitted for the single-file
   * path, which falls back to a timestamp id (unchanged behaviour).
   */
  modelId?: string;
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

/**
 * How long the renderer keeps drawing every frame after the last activity
 * (camera move, selection, streamed change, …) before it parks itself in
 * on-demand (MANUAL) mode and stops rendering. Must comfortably outlast the
 * brief LOD-streaming tail that arrives just after the camera stops, so a late
 * tile is never left undrawn. `viewer:idle` fires when this elapses, which is
 * also the moment the effects composite + interactive-performance restore run.
 */
const ACTIVE_HOLD_MS = 250;
/**
 * Longer hold used while a model streams in (load / unload / whole-model
 * visibility toggle): the initial tile stream can take a few seconds, during
 * which we keep rendering every frame so geometry appears as it arrives rather
 * than waiting for the next user interaction.
 */
const MODEL_STREAM_HOLD_MS = 4000;

/**
 * Visual-change events that should wake the renderer. `camera:change` is
 * handled inline (it also clamps zoom + refits near/far), and the `model:*`
 * events get a longer hold from their own methods — both are intentionally
 * absent here. Anything a plugin emits that isn't covered can call
 * `ctx.requestRender()` directly.
 */
const RENDER_DIRTY_EVENTS = [
  'selection:change',
  'hover:change',
  'visibility:change',
  'xray:change',
  'section:change',
  'section:select',
  'outline:ready',
  'outline:change',
  'colorCoding:change',
  'measurement:change',
  'measurement:axisLock',
  'classification:change',
  'finder:results',
  'wireframe:change',
  'grid:change',
  'exploder:change',
  'navmode:change',
  'marker:change',
  'snapping:change',
  'eraser:change',
] as const;

/**
 * X-ray fades items to near-zero opacity. Any material arriving below this
 * opacity is treated as an x-ray fade and rendered with alpha-to-coverage
 * (dithered, opaque pass) instead of alpha blending — see the material hook in
 * `mount()`. Genuinely translucent BIM materials (glass, ~0.2+) stay above the
 * threshold and keep true alpha blending.
 */
const XRAY_DITHER_MAX_OPACITY = 0.12;

// Coplanar separation under the logarithmic depth buffer (constants in
// `depth-bias.ts`). Log depth writes `gl_FragDepth` in the fragment shader,
// bypassing the rasterizer's `polygonOffset`, so coplanar opaque faces (floor
// finish on slab, ceiling under the slab above) z-fight. We re-create polygon
// offset *in log space* by nudging each material's `gl_FragDepth` toward the
// camera by a tiny amount. Coincident faces are separated by giving adjacent
// materials *different* bias levels: we cycle through `COPLANAR_BIAS_LEVELS`
// distinct steps so two overlapping surfaces almost always land on different
// levels and get a stable depth winner. The bias is baked into the shader as a
// literal (not a uniform) because custom `onBeforeCompile` uniforms are shared
// across materials that share a compiled program — a per-material uniform value
// would silently leak.

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
  /** Reused scratch vectors for the per-event camera-change handler. */
  private readonly camTarget = new THREE.Vector3();
  private readonly camClampedPos = new THREE.Vector3();
  private readonly camDir = new THREE.Vector3();
  private readonly precomputedOutlines = new Map<
    string,
    Promise<Uint8Array | null>
  >();
  /** Last-loaded model id (back-compat single-model accessor). */
  modelId: string | null = null;
  /**
   * Whole-model visibility layer for the federated viewer — model ids the user
   * has toggled off. Separate from element-level isolation so a hidden model
   * survives element show-all; the outline plugin and any future show-all path
   * consult this via the `model:visibility` event.
   */
  private readonly hiddenModelIds = new Set<string>();

  constructor(private readonly options: ViewerOptions = {}) {}

  /**
   * Mark the scene dirty: resume continuous rendering (renderer → AUTO) and
   * (re)arm the idle countdown. When the countdown elapses with no further
   * activity, `viewer:idle` fires and the renderer parks in MANUAL mode — at
   * which point nothing repaints until the next `markActive()`. This is the
   * single chokepoint that turns the viewer from "always rendering" into
   * "render only when something changed": every visual-change source (camera,
   * selection, streaming, animations) routes through here, and plugins reach
   * it via `ctx.requestRender()`.
   *
   * Active periods are byte-for-byte the old behaviour (renderer in AUTO,
   * drawing every frame); the only new behaviour is parking on idle.
   */
  private markActive(holdMs: number = ACTIVE_HOLD_MS): void {
    const world = this.world;
    if (world === null) return;
    const renderer = world.renderer;
    if (renderer && renderer.mode !== RendererMode.AUTO) {
      renderer.mode = RendererMode.AUTO;
    }
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      // Final near/far fit for the resting viewpoint, emit idle (effects
      // composites here, interactive-performance restores quality), then park.
      this.updateDynamicNearFar();
      this.events.emit('viewer:idle', undefined);
      // A `viewer:idle` handler may have called markActive() (e.g. restoring
      // motion-reduced DPR needs one more full-quality frame) — that re-arms
      // the timer. Only park in MANUAL if nothing requested more rendering, so
      // we never stop a frame a handler just asked for.
      if (this.idleTimer === null && this.world?.renderer) {
        this.world.renderer.mode = RendererMode.MANUAL;
      }
    }, holdMs);
  }

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
    // plane and flickers. Keeping near close to the actual geometry means the
    // near/far ratio is small at normal viewing distance — crisp depth, no
    // back-of-model z-fighting (the original 5000:1 floor caused that).
    //
    // The floor that takes over once minDepth goes negative has two regimes:
    //   - Outside the model (minDepth >= 0, normal orbit): a tiny 5 mm floor
    //     (scaled down for sub-metre models) lets a camera pressed right up
    //     against a surface keep approaching it. Any far-end z-fighting the
    //     small near induces is genuinely hidden behind that near surface
    //     filling the screen.
    //   - Inside the model (minDepth < 0, i.e. fly / first-person walkthrough
    //     or orbit-dolly-inside): the nearest AABB corner is behind the eye, so
    //     the tiny floor would pin near to 5 mm while far still spans the whole
    //     building (~20,000:1). That wastes the log-depth budget on the empty
    //     space in front of the eye and z-fights distant coplanar surfaces.
    //     A scale-relative floor (~0.1 m for a typical building) keeps the
    //     budget on the visible depth range. Trade-off: geometry within ~10 cm
    //     of the eye may clip — negligible (and arguably desirable) in BIM
    //     walkthrough.
    const size = box.getSize(this.depthBoxSize);
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const insideModel = minDepth < 0;
    const nearFloor = insideModel
      ? Math.min(Math.max(maxDim * 1e-3, 0.05), 0.5)
      : Math.min(0.005, maxDim * 1e-4);
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
    // Logarithmic depth buffer: BIM models span a huge depth range (whole
    // building) yet must allow close inspection, which linear 24-bit depth
    // can't do without either near-plane clipping or far-end z-fighting. Log
    // depth gives uniform precision across the range, killing both.
    //
    // Trade-off: log depth writes gl_FragDepth in the fragment shader, AFTER
    // the rasterizer stage where polygonOffset applies — so the per-material
    // polygonOffset set up below is silently ignored. We keep those flags as a
    // harmless fallback (they re-activate if log depth is ever disabled), but
    // log depth's far superior precision is what now resolves near-coplanar
    // BIM faces (glazing/frame, slab/wall). Truly-coincident faces are handled
    // case-by-case via depthWrite/renderOrder (IFC Spaces, the shadow plane).
    //
    // Every custom in-scene shader must include the <logdepthbuf_*> chunks or
    // it depth-tests in the wrong space: the forked outline material reuses the
    // stock line shader's chunks (kept intact); the shadow-ground shader adds
    // them explicitly (see applyLightingAndShadows). The post FX pipeline reads
    // no depth (RenderPass → FXAA → OutputPass), so it is unaffected.
    world.renderer = new SimpleRenderer(components, container, {
      antialias: true,
      logarithmicDepthBuffer: true,
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
    // instead of z-fighting. Because the logarithmic depth buffer makes that
    // polygonOffset a no-op, the same offset is also applied in log space via a
    // baked shader bias (see COPLANAR_BIAS_EPS and applyCoplanarBias below).
    let coplanarBiasSeq = 0;
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

      // Re-create the polygon offset above in logarithmic-depth space. Materials
      // with depth writing + polygonOffset (every branch except the IfcSpace
      // overlay, which disables both) get a baked per-material depth bias so
      // coplanar faces separate even though the rasterizer's polygonOffset is
      // bypassed under logarithmicDepthBuffer. The IfcSpace branch leaves
      // polygonOffset=false, so it is skipped — it relies on depthWrite=false.
      if (material.polygonOffset) {
        const level = coplanarBiasSeq++ % COPLANAR_BIAS_LEVELS;
        const bias = (level + 1) * COPLANAR_BIAS_EPS;
        // Bake the bias as a GLSL literal so distinct values produce distinct
        // programs automatically — a custom uniform would be shared across
        // materials that share a program and leak the wrong value.
        const biasLiteral = bias.toFixed(8);
        material.onBeforeCompile = (shader): void => {
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <logdepthbuf_fragment>',
            `#include <logdepthbuf_fragment>
#if defined( USE_LOGARITHMIC_DEPTH_BUFFER )
\tgl_FragDepth -= ${biasLiteral};
#endif`,
          );
        };
        material.needsUpdate = true;
      }

      // A freshly-set material almost always means newly-streamed geometry —
      // wake the renderer so the tile is drawn even if it lands after the
      // camera/idle settle (on-demand rendering safety net for streaming).
      this.markActive();
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
      requestRender: () => this.markActive(),
    };

    this.pluginManager = new PluginManager(ctx, this.commands, this.events);

    // Bridge camera-controls events to a typed viewer event so plugins
    // (e.g. ViewCube) can react without poking three.js directly.
    const camControls = world.camera.controls;
    const camThree = world.camera.three;
    const onCamChange = (): void => {
      const pos = camThree.position;
      const target = camControls.getTarget(this.camTarget);

      // Clamp zoom-out: with infinityDolly the target shifts, so measure
      // the actual camera-to-scene-origin distance instead of controls.distance.
      if (this.zoomOutLimit < Infinity) {
        const dist = pos.distanceTo(target);
        if (dist > this.zoomOutLimit) {
          const dir = this.camDir.copy(pos).sub(target).normalize();
          const clamped = this.camClampedPos
            .copy(target)
            .addScaledVector(dir, this.zoomOutLimit);
          camControls.setPosition(clamped.x, clamped.y, clamped.z, false);
        }
      }

      this.events.emit('camera:change', {
        position: { x: pos.x, y: pos.y, z: pos.z },
        target: { x: target.x, y: target.y, z: target.z },
      });
      this.updateDynamicNearFar();
      // Keep rendering while the camera moves; park on idle. markActive() also
      // (re)arms the countdown that emits `viewer:idle` once the camera has been
      // still for ACTIVE_HOLD_MS, so the effects composite runs on the final
      // frame and a final near/far fit is applied for the resting viewpoint.
      this.markActive();
    };
    camControls.addEventListener('update', onCamChange);
    this.cameraChangeUnsub = () => {
      camControls.removeEventListener('update', onCamChange);
    };

    // Core command (no owner / no default shortcut): whole-model visibility for
    // the federated viewer's layer panel. Registered before plugins so it's
    // available the moment the viewer mounts.
    this.commands.register<{ modelId: string; visible: boolean }, void>(
      'model:setVisible',
      ({ modelId, visible }) => this.setModelVisible(modelId, visible),
      { title: 'Toggle model visibility' },
    );
    // Incremental unload — remove one model from a federated scene without
    // remounting the viewer (the dropdown's no-flash remove).
    this.commands.register<{ modelId: string }, void>(
      'model:unload',
      ({ modelId }) => this.unloadModel(modelId),
      { title: 'Unload model' },
    );

    // On-demand rendering: park the renderer in MANUAL and only resume on a
    // visual change. Each event below means "something changed on screen" —
    // route it through markActive() so a frame (and the idle composite) is
    // produced, then the renderer settles back to MANUAL. Plugins with
    // non-evented changes (animation ticks, etc.) call ctx.requestRender().
    world.renderer!.mode = RendererMode.MANUAL;
    for (const name of RENDER_DIRTY_EVENTS) {
      this.events.on(name, () => this.markActive());
    }
    // A canvas resize needs a repaint too (MANUAL won't redraw on its own).
    world.renderer!.onResize.add(() => this.markActive());

    this.events.emit('viewer:mounted', { container });

    for (const plugin of this.options.plugins ?? []) {
      await this.pluginManager.register(plugin);
    }

    // Draw the initial frame(s), then settle to idle.
    this.markActive();
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
    // First model into an empty world frames the camera (the single-file
    // behaviour). Subsequent models in a federation only extend the bounds —
    // the host re-frames once via `camera.zoomExtents` after all loads, so a
    // late-arriving model never yanks the camera off what the user is viewing.
    const isFirstModel =
      (fragments.models.list as unknown as Map<string, FRAGS.FragmentsModel>).size === 0;
    const modelId = opts.modelId ?? `model-${String(Date.now())}`;
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

    if (isFirstModel) {
      await this.frameModel(model);
    } else {
      // Extend the scene/depth bounds + zoom limit to include the new model
      // without moving the camera.
      this.refreshSceneBounds();
    }
    // Position sun + size the blob shadow plane to the whole-scene footprint.
    this.fitLightsToScene();
    // Keep rendering every frame while the model streams in (a few seconds for
    // large models); the trailing `viewer:idle` from this hold kicks the
    // post-processing composite once streaming settles.
    this.markActive(MODEL_STREAM_HOLD_MS);

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

    const controls = world.camera.controls;
    // ThatOpen sets infinityDolly=true and minDistance=6. Keep infinityDolly
    // so the orbit target shifts forward on zoom-in (needed to go inside the
    // model). Max zoom-out is enforced manually in the camera update handler.
    controls.minDistance = 0;
    // Cache the world-space scene AABB + depth range + zoom limit. Extracted so
    // federated loads can extend the bounds without re-framing the camera.
    this.refreshSceneBounds();
  }

  /**
   * Recompute the world-space scene AABB (union of all loaded models), the
   * depth box the per-frame near/far fit projects against, and the max
   * zoom-out limit. Camera-position-agnostic — safe to call after every model
   * load. `fitLightsToScene` later unions the shadow ground plane into
   * `depthBox`.
   */
  private refreshSceneBounds(): void {
    const world = this.world;
    if (world === null) return;
    this.sceneBox = this.computeWorldSceneBox();
    this.depthBox = this.sceneBox.clone();
    if (world.camera.three instanceof THREE.PerspectiveCamera) {
      this.updateDynamicNearFar();
    }
    const size = this.sceneBox.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1);
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
        // The <logdepthbuf_*> chunks make this hand-written shader write its
        // fragment depth in the same logarithmic space as the rest of the
        // scene (the renderer has logarithmicDepthBuffer on). Without them the
        // plane depth-tests against the model in a mismatched space and can
        // punch through or vanish. three injects the USE_LOGDEPTHBUF define +
        // logDepthBufFC uniform automatically for ShaderMaterial.
        vertexShader: /* glsl */ `
          #include <common>
          #include <logdepthbuf_pars_vertex>
          varying vec2 vUv;
          void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            #include <logdepthbuf_vertex>
          }
        `,
        fragmentShader: /* glsl */ `
          #include <logdepthbuf_pars_fragment>
          uniform vec3 color;
          uniform float opacity;
          uniform float coreRadius;
          uniform float uLinearBlend;
          varying vec2 vUv;
          void main() {
            #include <logdepthbuf_fragment>
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
  private fitLightsToScene(): void {
    const sun = this.sun;
    if (sun === null) return;
    // Whole-scene footprint (union of all loaded models) so the sun + blob
    // shadow cover the entire federation, not just the last-loaded model.
    const box = this.computeWorldSceneBox();
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

  /** Ids of all currently loaded models, in load order. */
  getModelIds(): string[] {
    const fragments = this.fragmentsModels;
    if (fragments === null) return [];
    return [
      ...(fragments.models.list as unknown as Map<string, FRAGS.FragmentsModel>).keys(),
    ];
  }

  /** False once a model has been hidden via the federated layer toggle. */
  isModelVisible(modelId: string): boolean {
    return !this.hiddenModelIds.has(modelId);
  }

  /**
   * Toggle a whole model's visibility (federated layer panel). Bulk-toggles
   * every item in the model and tracks the off-state in `hiddenModelIds` so it
   * is a layer distinct from element isolation. Emits `model:visibility` so the
   * outline plugin hides/shows that model's edges in step, then nudges a
   * repaint. NOTE: showing re-reveals every item in the model, overriding any
   * element-level isolation on it — a known v1 coarseness of the layer toggle.
   */
  async setModelVisible(modelId: string, visible: boolean): Promise<void> {
    const fragments = this.fragmentsModels;
    if (fragments === null) return;
    const model = (
      fragments.models.list as unknown as Map<string, FRAGS.FragmentsModel>
    ).get(modelId);
    if (!model) return;
    if (visible) this.hiddenModelIds.delete(modelId);
    else this.hiddenModelIds.add(modelId);
    await model.setVisible(undefined, visible).catch(() => undefined);
    this.events.emit('model:visibility', { modelId, visible });
    // Toggling a model re-streams its tiles — keep drawing while they arrive.
    this.markActive(MODEL_STREAM_HOLD_MS);
  }

  /**
   * Unload a single model from a federated scene WITHOUT remounting the viewer
   * or moving the camera. Mirror of the per-model load path: removes the model
   * from the scene, disposes it in the fragments runtime, drops its
   * outline/visibility bookkeeping, re-unions the scene bounds, and emits
   * `model:unloaded` so plugins tear down their per-model caches.
   */
  async unloadModel(modelId: string): Promise<void> {
    const fragments = this.fragmentsModels;
    const world = this.world;
    if (fragments === null || world === null) return;
    const modelsList = fragments.models.list as unknown as Map<string, FRAGS.FragmentsModel>;
    const model = modelsList.get(modelId);
    if (model === undefined) return;

    const sceneThree = (world.scene as unknown as { three: THREE.Scene }).three;
    sceneThree.remove(model.object);
    await fragments.disposeModel(modelId).catch(() => undefined);

    this.hiddenModelIds.delete(modelId);
    this.precomputedOutlines.delete(modelId);
    if (this.modelId === modelId) {
      this.modelId = this.getModelIds()[0] ?? null;
    }

    // Re-union bounds + relight, but do NOT re-frame — the user is mid-view.
    this.refreshSceneBounds();
    this.fitLightsToScene();
    this.events.emit('model:unloaded', { modelId });
    this.markActive(MODEL_STREAM_HOLD_MS);
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
    this.hiddenModelIds.clear();
    this.modelId = null;
    this.events.emit('viewer:unmounted', undefined);
    this.events.clear();
  }
}
