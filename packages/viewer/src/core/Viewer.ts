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
import { computeVisibleSolidBox } from './visibleBox.js';
import { ContactShadowBaker } from './contactShadow.js';
import type { ContactShadowRect } from './contactShadow.js';
import { applyLookToMaterial } from './displayLook.js';
import { modelMap, threeScene } from './fragmentsCompat.js';
import { boxSummary, isViewerDebug, vdump, vlog, vwarn } from './debugLog.js';
import type { CullingMode, ItemId, MaterialLook, Plugin, ViewerContext, ViewerEvents } from './types.js';

type World = SimpleWorld<SimpleScene, OrthoPerspectiveCamera, SimpleRenderer>;

/** Human-readable name for a native `LodMode` value (diagnostic logging). */
function lodName(mode: FRAGS.LodMode | undefined): string {
  if (mode === undefined) return 'unset';
  return (FRAGS.LodMode as unknown as Record<number, string>)[mode as unknown as number] ?? String(mode);
}

export interface ShadowOptions {
  enabled?: boolean;
  /**
   * Square resolution (px) of the baked contact-shadow render target. Default
   * 1024. Lower (e.g. 512) trades a little shadow-edge softness for cheaper
   * bake + sampling — a sensible choice on memory/fill-constrained mobile
   * devices. Does NOT affect model rendering quality.
   */
  resolution?: number;
}

export interface BackgroundOptions {
  /** 0xRRGGBB. Default: 0xffffff. */
  color?: number;
  /**
   * Canvas clear-alpha, 0..1. Default 1 (opaque). Below 1 makes the WebGL
   * canvas transparent so the page background shows through; `scene.background`
   * is left unset in that case. The renderer is constructed with `alpha: true`
   * automatically when this is < 1 (the WebGL alpha context attribute is
   * creation-time only).
   */
  alpha?: number;
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
  /**
   * Wheel dolly sensitivity (camera-controls `dollySpeed`). Default: 1.
   * Higher = faster zoom per wheel notch.
   */
  speed?: number;
  /**
   * Closest-approach distance as a fraction of model size — the orbit
   * `minDistance`. Default: 0.04. With `infinityDolly` this is the threshold at
   * which zoom-in starts pushing the orbit target forward (flying *through* the
   * model) and the per-tick cruise step once inside. Must be non-zero or
   * fly-through never engages and zoom-in stalls at the framed centre.
   */
  minFactor?: number;
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
  /**
   * EXPERIMENTAL, off by default. Fragments LOD detail tier (0–2). Default 2
   * (render every tier). Lowering to 1 reduces tessellation/streaming work on
   * low-end devices but can visibly coarsen geometry — profile before using.
   */
  graphicsQuality?: number;
  /**
   * EXPERIMENTAL, off by default. Element count above which a single model
   * starts frustum-culling under `auto` culling. Default 50_000. Lowering it
   * makes large models cull sooner on low-end devices (fewer resident tiles)
   * at the cost of more streaming as the camera turns — profile before using.
   */
  autoCullElementThreshold?: number;
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
 * Hold used when re-applying culling for a settings-driven policy *toggle*
 * (not an initial load): only the models whose resolved `LodMode` changed
 * re-stream their newly-resident tiles, so a short window suffices. Kept well
 * under MODEL_STREAM_HOLD_MS so the toggle doesn't leave the base renderer
 * painting (un-FXAA'd) over the idle composite for the full streaming hold.
 */
const CULL_TOGGLE_HOLD_MS = 1000;

/**
 * Orbit `minDistance` used before any model is loaded (and the fallback when the
 * scene box is degenerate). Non-zero so `infinityDolly` fly-through engages —
 * see {@link ZoomOptions.minFactor}. Per-model value is `maxDim * minFactor`
 * clamped to {@link ZOOM_IN_DISTANCE_FLOOR}/{@link ZOOM_IN_DISTANCE_CEIL}.
 */
const DEFAULT_MIN_DISTANCE = 1;
/** Lower/upper bounds for the scale-aware orbit `minDistance` (world units). */
const ZOOM_IN_DISTANCE_FLOOR = 0.3;
const ZOOM_IN_DISTANCE_CEIL = 8;
/** Default closest-approach fraction of model size when `zoom.minFactor` is unset. */
const DEFAULT_ZOOM_MIN_FACTOR = 0.04;

/**
 * Under `auto` culling, a single model starts frustum-culling once it exceeds
 * this many elements. Federated scenes (more than one model) always cull under
 * `auto`, regardless of per-model size. Tunable; sized so typical small models
 * keep the always-everything-visible behaviour.
 */
const AUTO_CULL_ELEMENT_THRESHOLD = 50_000;

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
  /** The context handed to plugins — stashed so visibility-driven shadow refits can read `models()`. */
  private ctx: ViewerContext | null = null;
  private sun: THREE.DirectionalLight | null = null;
  private shadowGround: THREE.Mesh | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Set when a tile streams in (new material / LOD view update) while the
   * renderer is parked at rest. Consumed by the rAF tick, which paints exactly
   * one idle composite for it and stays parked — see {@link onStreamedChange}.
   * Coalesces a whole batch of streamed changes into a single repaint per frame.
   */
  private streamRepaintPending = false;
  private shadowsEnabled = true;
  /** Bakes the silhouette mask the ground plane samples (contact-shadow mode). */
  private shadowBaker: ContactShadowBaker | null = null;
  /** Set when geometry/visibility changed; the next idle frame re-bakes once. */
  private shadowDirty = false;
  /** Latest-wins guard so a stale async visible-box result can't clobber the bake. */
  private shadowBakeToken = 0;
  /** Frustum-culling policy (see {@link setCullingMode}). Default `auto`. */
  private cullingMode: CullingMode = 'auto';
  /** Whole-model material look (see {@link setActiveLook}). Default `normal`. */
  private activeLook: MaterialLook = 'normal';
  /** Per-model element count (from `model:elementCount`) feeding the `auto` heuristic. */
  private readonly elementCounts = new Map<string, number>();
  /** Per-model `LodMode` currently applied, so re-resolves skip no-op `setLodMode` calls. */
  private readonly appliedLodMode = new Map<string, FRAGS.LodMode>();
  /** Per-model `onViewUpdated` unsubscribe — wakes the on-demand renderer as tiles stream. */
  private readonly viewUpdatedUnsubs = new Map<string, () => void>();
  /** True while {@link bakeShadow} temporarily un-culls; suppresses renderer wake to avoid a flash. */
  private shadowBaking = false;
  /**
   * Reentrancy guard for {@link bakeShadow}. Two overlapping bakes would
   * concurrently un-cull/re-cull the same models and fire two
   * `fragments.update(true)` calls, racing the fragments worker — which both
   * flashes and can leave {@link shadowBaking} stuck `true` (renderer parked →
   * frozen canvas). Overlapping bakes coalesce: the in-flight one re-dirties so
   * the next idle re-bakes once.
   */
  private shadowBakeInFlight = false;
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
  /**
   * Orbit `minDistance` — the camera-controls fly-through threshold. Recomputed
   * per scene-bounds refresh as a fraction of model size (see
   * `refreshSceneBounds`); seeded non-zero so zoom-in works before a model loads.
   */
  private zoomInDistance = DEFAULT_MIN_DISTANCE;
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
    // While the contact-shadow bake temporarily un-culls geometry, keep the
    // renderer parked so the transient full-geometry pass never reaches the
    // main canvas (no flash). bakeShadow issues one explicit repaint when done.
    if (this.shadowBaking) return;
    const world = this.world;
    if (world === null) return;
    const renderer = world.renderer;
    if (renderer && renderer.mode !== RendererMode.AUTO) {
      renderer.mode = RendererMode.AUTO;
      // Leading edge only (mode flip) — cheap, never per-frame.
      vlog('render', `wake → AUTO (hold ${holdMs}ms)`);
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
        vlog('render', 'idle → park MANUAL');
      }
    }, holdMs);
  }

  /**
   * A tile streamed in (new material via `onItemSet`) or the LOD view updated
   * (`onViewUpdated`). Two regimes:
   *
   * - **Active** (camera moving, or within the post-load / interaction hold —
   *   renderer in AUTO with the idle countdown armed): keep the renderer awake
   *   so streaming geometry paints progressively. Identical to the old
   *   unconditional `markActive()`.
   * - **At rest** (renderer parked in MANUAL, idle already settled): a late tile
   *   from the streaming tail arrived. Flag a single coalesced composite repaint
   *   for the next rAF tick and STAY parked. Flipping to AUTO here would re-run
   *   the whole idle cycle (near/far refit + `viewer:idle` fan-out + composite +
   *   park) per tile batch, and the long streaming tail (graphicsQuality=2 /
   *   maxUpdateRate=0) would churn it forever — the never-settling loop.
   */
  private onStreamedChange(): void {
    // While the contact-shadow bake temporarily un-culls geometry, drop the
    // wake entirely (matches markActive's guard) — bakeShadow issues its own
    // repaint when done, so a stray streamed-change repaint here would flash the
    // transient full-geometry pass.
    if (this.shadowBaking) return;
    const renderer = this.world?.renderer;
    const parked =
      renderer != null &&
      renderer.mode === RendererMode.MANUAL &&
      this.idleTimer === null;
    if (parked) {
      this.streamRepaintPending = true; // painted once on the next tick
      return;
    }
    this.markActive();
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
    const models = modelMap(fragments);
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
    // Transparent framebuffer for embeds (e.g. the marketing 3D showcase). The
    // WebGL `alpha` context attribute is creation-time only, so it must be set
    // here, not in applyBackground. Default path (alpha >= 1) is unchanged.
    const wantAlpha = (this.options.background?.alpha ?? 1) < 1;
    world.renderer = new SimpleRenderer(components, container, {
      antialias: true,
      logarithmicDepthBuffer: true,
      ...(wantAlpha ? { alpha: true } : {}),
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
    world.camera.controls.dollySpeed = this.options.zoom?.speed ?? 1;

    // infinityDolly is what lets the wheel push the orbit TARGET forward once
    // the camera reaches `minDistance`, so you can zoom *through* into interiors
    // instead of asymptotically crawling to a stop at the framed centre. Set it
    // explicitly rather than relying on OrthoPerspectiveCamera's OrbitMode
    // default. CRITICAL: it only engages while `minDistance` is non-zero (the
    // library gates the target-push on `radius <= minDistance`); a zero/EPSILON
    // minDistance is never reached by the multiplicative dolly, so fly-through
    // never fires. `minDistance` is therefore set per scene size in
    // refreshSceneBounds and seeded non-zero here for the pre-model state.
    world.camera.controls.infinityDolly = true;

    // OrthoPerspectiveCamera's default OrbitMode clamps minDistance=1 /
    // maxDistance=300 (FirstPersonMode/OrbitMode swaps mutate these too).
    // SimpleCamera left them at camera-controls' defaults, and large models
    // need to dolly closer/farther than that — zoom-out is otherwise bounded
    // by our own `zoomOutLimit` (see onCamChange). Keep the upper end uncapped;
    // the lower end is the fly-through threshold (see infinityDolly above).
    world.camera.controls.minDistance = this.zoomInDistance;
    world.camera.controls.maxDistance = Infinity;

    this.applyControls(world);
    this.applyBackground(world);
    this.applyLightingAndShadows(world);

    const fragmentsModels = new FRAGS.FragmentsModels(getWorkerUrl());

    // Render all LOD tiers so every element (furniture, fittings, etc.)
    // is visible from the start, not just the coarsest structural shell.
    // Overridable (EXPERIMENTAL) via options.graphicsQuality; defaults to 2 so
    // existing behaviour is byte-for-byte unchanged.
    fragmentsModels.settings.graphicsQuality = this.options.graphicsQuality ?? 2;

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
        // materials that share a program and leak the wrong value. Stored on the
        // material so the active display-mode look can re-compose with it.
        material.userData.dmBias = bias.toFixed(8);
      } else {
        material.userData.dmBias = null;
      }

      // Compose the depth bias with the active whole-model look (monochrome /
      // clay / matcap) into a single onBeforeCompile, and flip needsUpdate.
      // Newly-streamed geometry therefore inherits the current look for free.
      applyLookToMaterial(material, this.activeLook);

      // A freshly-set material almost always means newly-streamed geometry —
      // get the tile drawn even if it lands after the camera/idle settle. While
      // active this wakes the renderer; at rest it paints one composite and
      // stays parked instead of churning the idle cycle (see onStreamedChange).
      this.onStreamedChange();
    });

    // FragmentsModels streams tile data from a worker. Drive `update()`
    // from rAF so visual changes (setColor / setOpacity / streaming LOD)
    // appear on the next frame instead of waiting for a slow timer.
    // `force=false` (default) means we only drain completed batches —
    // no per-frame stall waiting on pending worker work.
    const tick = (): void => {
      fragmentsModels.update().catch(() => undefined);
      // At-rest streaming tail: if a late tile streamed in while parked, paint
      // exactly one idle composite for it this frame (coalescing a whole batch
      // into a single repaint) and stay parked — never flip to AUTO. Re-check
      // the parked state: a real wake between the flag being set and now means
      // the normal AUTO path already covers the repaint, so drop the flag.
      if (this.streamRepaintPending) {
        this.streamRepaintPending = false;
        const renderer = world.renderer;
        if (
          renderer &&
          renderer.mode === RendererMode.MANUAL &&
          this.idleTimer === null &&
          !this.shadowBaking
        ) {
          const effects = this.pluginManager?.get<{ recomposite(): boolean }>(
            'effects',
          );
          // Fall back to a single base-render wake only when the composite path
          // is unavailable (effects disabled / x-ray active).
          if (!(effects?.recomposite() ?? false)) this.markActive();
        }
      }
      this.updateRafId = requestAnimationFrame(tick);
    };
    this.updateRafId = requestAnimationFrame(tick);

    this.components = components;
    this.world = world;
    this.fragmentsModels = fragmentsModels;

    // Build the context once; it's shared by every plugin.
    const ctx: ViewerContext = {
      get scene() {
        return threeScene(world.scene);
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
      models: () => modelMap(fragmentsModels),
      getPrecomputedOutline: (modelId: string) =>
        this.precomputedOutlines.get(modelId),
      requestRender: () => this.markActive(),
      setCullingMode: (mode: CullingMode) => this.setCullingMode(mode),
      getCullingMode: () => this.cullingMode,
      setActiveLook: (look: MaterialLook) => this.setActiveLook(look),
      getActiveLook: () => this.activeLook,
      // Stable full-quality DPR for the idle composite + screen-space overlays.
      // Matches the base SimpleRenderer's clamp (min(dpr, 2)) and is deliberately
      // independent of the live renderer.getPixelRatio(), which interactive-
      // performance lowers during motion — sizing a render target off the live
      // value latches the lowered ratio and renders blurry until the next resize.
      getBasePixelRatio: () =>
        typeof window === 'undefined' ? 1 : Math.min(window.devicePixelRatio || 1, 2),
    };
    this.ctx = ctx;

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
    // Diagnostic drag markers: camera-controls fires `controlstart`/`controlend`
    // exactly around a user-initiated drag (not programmatic moves), so these
    // bracket the "when I drag the model" window the user is debugging. Logging
    // is gated inside vlog, so this costs nothing when debug is off.
    const onControlStart = (): void => vlog('drag', 'pointer drag start');
    const onControlEnd = (): void => vlog('drag', 'pointer drag end');
    const camEvents = camControls as unknown as {
      addEventListener: (t: string, f: () => void) => void;
      removeEventListener: (t: string, f: () => void) => void;
    };
    camEvents.addEventListener('controlstart', onControlStart);
    camEvents.addEventListener('controlend', onControlEnd);
    this.cameraChangeUnsub = () => {
      camControls.removeEventListener('update', onCamChange);
      camEvents.removeEventListener('controlstart', onControlStart);
      camEvents.removeEventListener('controlend', onControlEnd);
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
    // Diagnostic snapshot — run from the console via
    // `__viewer.commands.execute('debug.dump')` when the scene is blank to see,
    // per model, whether it's hidden / frustum-culled / off-screen / missing.
    // Always prints (it is only ever called on purpose) and also returns the
    // object so it can be inspected from the resolved promise.
    this.commands.register('debug.dump', () => this.debugDump(), {
      title: 'Log a diagnostic snapshot of the viewer state',
    });

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
    world.renderer!.onResize.add(() => {
      this.markActive();
    });

    // Silhouette contact shadow: mark the mask dirty on every geometry /
    // isolation / visibility / x-ray change; the next idle frame re-bakes it
    // once (never per frame — the top-down bake is camera-independent). These
    // events already wake the renderer above, so an idle is guaranteed to
    // follow and drive the bake.
    const markShadowDirty = (): void => {
      this.shadowDirty = true;
    };
    this.events.on('visibility:change', markShadowDirty);
    this.events.on('xray:change', markShadowDirty);
    this.events.on('viewer:idle', () => {
      if (this.shadowsEnabled && this.shadowDirty && this.shadowGround !== null) {
        this.shadowDirty = false;
        void this.bakeShadow();
      }
    });

    // Feed the `auto` culling heuristic: cache each model's element count and
    // (under `auto`) re-resolve every model's LodMode — a large single model
    // crosses the threshold here. Cheap: applyCulling no-ops when nothing
    // changed. `model:elementCount` is emitted by the selection plugin on load.
    this.events.on('model:elementCount', ({ modelId, count }) => {
      this.elementCounts.set(modelId, count);
      if (this.cullingMode === 'auto') void this.applyCulling();
    });

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
      modelMap(fragments).size === 0;
    const modelId = opts.modelId ?? `model-${String(Date.now())}`;
    const sceneThree = threeScene(world.scene);

    // `loadFragments` is failure-ATOMIC. A single bad federated model must never
    // blank the whole scene: if `fragments.load` (or any post-load wiring) fails,
    // it can leave a half-registered main-thread entry whose WORKER model never
    // materialized — then a later op (`applyCulling`→`setLodMode`,
    // `onViewUpdated`→`fragments.update`, visibility, …) hits
    // `FragmentsThread.getModel("<id>")` → "Model not found" → render teardown.
    // So `this.modelId`/`precomputedOutlines` are committed only AFTER a
    // successful load, and the catch disposes + unwinds every per-id trace and
    // rethrows so the caller (IfcViewer's federated loop) skips just this model.
    let loaded: FRAGS.FragmentsModel | null = null;
    try {
      const model = await fragments.load(buffer as ArrayBuffer, { modelId });
      loaded = model;

      // Model is now real on BOTH threads — commit the active id and any stashed
      // precomputed outline. The outline must be set before `model:loaded` fires
      // so the outline plugin's handler sees it via ctx.getPrecomputedOutline.
      this.modelId = modelId;
      if (opts.precomputedOutline) {
        this.precomputedOutlines.set(modelId, opts.precomputedOutline);
      }

      // Connect camera so the LOD streaming system knows the viewpoint, can
      // stream ALL tile detail levels (not just the coarsest shell), and — when
      // culling is on — knows which frustum to cull against.
      model.useCamera(world.camera.three);

      // Apply the current culling policy. Under `auto`, a brand-new single model
      // resolves to ALL_VISIBLE (its element count isn't known yet — first-paint
      // safety so the initial stream never shows holes); the `model:elementCount`
      // and federation re-resolves upgrade it to ALL_GEOMETRY when warranted.
      const initialLod = this.resolveLodMode(modelId);
      this.appliedLodMode.set(modelId, initialLod);
      await model.setLodMode(initialLod).catch(() => undefined);

      // With native frustum culling on (ALL_GEOMETRY), tiles stream in/out as the
      // camera turns. `onViewUpdated` fires after each view-update cycle — get the
      // re-shown tiles drawn instead of the renderer parking with holes. (The
      // material `onItemSet` hook covers brand-new tiles; this covers existing
      // tiles re-entering the frustum.) Routed through onStreamedChange so the
      // streaming tail repaints once at rest rather than re-arming AUTO forever.
      const onViewUpdated = (): void => this.onStreamedChange();
      model.onViewUpdated.add(onViewUpdated);
      this.viewUpdatedUnsubs.set(modelId, () =>
        model.onViewUpdated.remove(onViewUpdated),
      );

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
      vlog('load', `model "${modelId}" loaded`, {
        isFirstModel,
        bytes: bytes.byteLength,
        lod: lodName(initialLod),
        modelBox: boxSummary(model.box),
        sceneBox: boxSummary(this.sceneBox),
        totalModels: modelMap(fragments).size,
      });
      // Keep rendering every frame while the model streams in (a few seconds for
      // large models); the trailing `viewer:idle` from this hold kicks the
      // post-processing composite once streaming settles.
      this.markActive(MODEL_STREAM_HOLD_MS);

      this.events.emit('model:loaded', { modelId });

      // This model may have flipped the scene to federated. Under `auto`,
      // re-resolve every model's LodMode now (no-op for a lone small model).
      if (this.cullingMode === 'auto') void this.applyCulling();

      return modelId;
    } catch (err) {
      // Unwind everything for this model so it leaves ZERO main-thread/worker
      // desync (the half-registered entry is what makes later `getModel` blow up
      // and blank the scene). `model:loaded` hasn't fired on this path, so no
      // balancing `model:unloaded` is emitted.
      if (loaded !== null) sceneThree.remove(loaded.object);
      this.viewUpdatedUnsubs.get(modelId)?.();
      this.viewUpdatedUnsubs.delete(modelId);
      this.precomputedOutlines.delete(modelId);
      this.appliedLodMode.delete(modelId);
      this.elementCounts.delete(modelId);
      await fragments.disposeModel(modelId).catch(() => undefined);
      if (this.modelId === modelId) {
        this.modelId = this.getModelIds()[0] ?? null;
      }
      throw err;
    }
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

    // Cache the world-space scene AABB + depth range + zoom limits. Extracted so
    // federated loads can extend the bounds without re-framing the camera. This
    // also (re)applies the scale-aware orbit `minDistance` that drives
    // infinityDolly fly-through; max zoom-out is enforced in the update handler.
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

    // Scale-aware orbit minDistance: the infinityDolly fly-through threshold and
    // the inside-the-model cruise step. Tiny models stay reachable (floor),
    // huge sites get larger steps (ceil). Must be non-zero — see the camera
    // setup block. Re-applied here on every model load / federated add.
    const minF = this.options.zoom?.minFactor ?? DEFAULT_ZOOM_MIN_FACTOR;
    this.zoomInDistance = THREE.MathUtils.clamp(
      maxDim * minF,
      ZOOM_IN_DISTANCE_FLOOR,
      ZOOM_IN_DISTANCE_CEIL,
    );
    world.camera.controls.minDistance = this.zoomInDistance;
    if (isViewerDebug()) this.debugBounds(maxDim);
  }

  /**
   * Diagnostic-only: log the freshly-unioned scene bounds and flag two
   * federated failure modes that present as "a model loaded but nothing shows":
   * an empty model box (won't frame, never streams) and a model whose center
   * sits far from the scene center (coordinate-origin mismatch — it renders
   * off-screen / outside the frustum). Only called when viewer debug is on.
   */
  private debugBounds(maxDim: number): void {
    const scene = this.sceneBox;
    vlog('bounds', 'scene bounds refreshed', {
      sceneBox: boxSummary(scene),
      maxDim: Math.round(maxDim * 1000) / 1000,
      zoomInDistance: Math.round(this.zoomInDistance * 1000) / 1000,
      zoomOutLimit: this.zoomOutLimit === Infinity ? 'Infinity' : Math.round(this.zoomOutLimit),
    });
    if (maxDim > 1e6) {
      vwarn(
        'bounds',
        `scene span is enormous (maxDim≈${Math.round(maxDim)}) — models are likely far apart in world space; framing + near/far fit may misbehave and geometry can look missing`,
      );
    }
    const fragments = this.fragmentsModels;
    if (!fragments || !scene || scene.isEmpty()) return;
    const center = scene.getCenter(new THREE.Vector3());
    for (const [id, model] of modelMap(fragments)) {
      const mb = model.box;
      if (!mb || mb.isEmpty()) {
        vwarn('bounds', `model "${id}" has an EMPTY bounding box — it will not be framed and may appear missing`);
        continue;
      }
      const mc = mb.getCenter(new THREE.Vector3());
      const ms = mb.getSize(new THREE.Vector3());
      const mMax = Math.max(ms.x, ms.y, ms.z, 1);
      const offset = mc.distanceTo(center);
      // Center further than ~2× the larger of (own size, scene span) from the
      // shared center is the signature of an un-aligned coordinate origin.
      if (offset > Math.max(maxDim, mMax) * 2) {
        vwarn(
          'bounds',
          `model "${id}" sits ${Math.round(offset)} units from the scene center (own size ≈${Math.round(mMax)}) — likely a coordinate-origin mismatch; it may render off-screen / outside the frustum and never stream in`,
          { modelCenter: [Math.round(mc.x), Math.round(mc.y), Math.round(mc.z)], sceneCenter: [Math.round(center.x), Math.round(center.y), Math.round(center.z)] },
        );
      }
    }
  }

  /**
   * Build, print, and return the diagnostic snapshot behind the `debug.dump`
   * command: per-model box / visibility / applied LOD / element count, plus the
   * culling mode, scene box, render mode, and camera. The one-call answer to
   * "a model loaded but nothing shows — which one, and why?".
   */
  private debugDump(): Record<string, unknown> {
    const fragments = this.fragmentsModels;
    const world = this.world;
    const round2 = (n: number): number => Math.round(n * 100) / 100;
    const models: Record<string, unknown> = {};
    if (fragments) {
      for (const [id, model] of modelMap(fragments)) {
        models[id] = {
          box: boxSummary(model.box),
          visible: !this.hiddenModelIds.has(id),
          appliedLod: lodName(this.appliedLodMode.get(id)),
          elementCount: this.elementCounts.get(id) ?? null,
        };
      }
    }
    const cam = world?.camera.three ?? null;
    const target = world ? world.camera.controls.getTarget(new THREE.Vector3()) : null;
    const snapshot: Record<string, unknown> = {
      modelCount: fragments ? modelMap(fragments).size : 0,
      cullingMode: this.cullingMode,
      activeLook: this.activeLook,
      renderMode: world?.renderer?.mode === RendererMode.AUTO ? 'AUTO' : 'MANUAL',
      sceneBox: boxSummary(this.sceneBox),
      zoomInDistance: round2(this.zoomInDistance),
      zoomOutLimit: this.zoomOutLimit === Infinity ? 'Infinity' : Math.round(this.zoomOutLimit),
      camera: cam
        ? {
            position: [round2(cam.position.x), round2(cam.position.y), round2(cam.position.z)],
            target: target ? [round2(target.x), round2(target.y), round2(target.z)] : null,
            near: round2(cam.near),
            far: round2(cam.far),
          }
        : null,
      hiddenModels: [...this.hiddenModelIds],
      models,
    };
    vdump('viewer snapshot', snapshot);
    return snapshot;
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
    const alpha = this.options.background?.alpha ?? 1;
    const sceneThree = threeScene(world.scene);
    // Transparent: leave scene.background unset so the clear-alpha shows through.
    sceneThree.background = alpha < 1 ? null : new THREE.Color(color);
    const renderer = world.renderer!.three;
    renderer.setClearColor(color, alpha);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  private applyLightingAndShadows(world: World): void {
    const opts = this.options.shadows ?? {};
    this.shadowsEnabled = opts.enabled ?? true;
    const sceneThree = threeScene(world.scene);

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

    // Silhouette contact-shadow ground plane. A `ContactShadowBaker` renders
    // the model's footprint top-down into a blurred alpha mask (RT + blur,
    // borrowed from three.js' contact-shadow technique); this plane samples it.
    // The bake is re-driven on the idle frame after a load / isolation / x-ray
    // change — never per frame — so it costs nothing while the camera moves
    // and follows the true geometry instead of an ellipse. No shadow-map cost,
    // no dependence on streamed/LOD mesh castShadow flags.
    if (this.shadowsEnabled) {
      const baker = new ContactShadowBaker(
        this.options.shadows?.resolution !== undefined
          ? { resolution: this.options.shadows.resolution }
          : {},
      );
      this.shadowBaker = baker;

      const groundMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          tShadow: { value: baker.texture },
          color: { value: new THREE.Color(0x000000) },
          opacity: { value: 0.45 },
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
          uniform sampler2D tShadow;
          uniform vec3 color;
          uniform float opacity;
          uniform float uLinearBlend;
          varying vec2 vUv;
          void main() {
            #include <logdepthbuf_fragment>
            float rawA = texture2D(tShadow, vUv).a * opacity;
            if (rawA <= 0.001) discard;
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
      // Hidden until the first bake produces a mask (avoids a black square).
      ground.visible = false;
      sceneThree.add(ground);
      this.shadowGround = ground;
    }
  }

  /**
   * Position the sun to the model's bbox and flag the contact shadow for a
   * re-bake on the next idle frame. The silhouette mask itself is rendered by
   * `bakeShadow()` (top-down RT + blur) once streaming/visibility settles —
   * never synchronously here, so a mid-stream load never stalls.
   */
  private fitLightsToScene(): void {
    const sun = this.sun;
    if (sun === null) return;
    // Whole-scene footprint (union of all loaded models) so the sun + shadow
    // cover the entire federation, not just the last-loaded model.
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

    if (this.shadowGround !== null) {
      // Geometry changed — re-bake the silhouette on the next idle.
      this.shadowDirty = true;
      // Coarsely fold the eventual shadow-plane footprint into the depth box so
      // its far edge never clips in grazing/plan views, even before the first
      // bake lands. `bakeShadow` re-folds the exact plane AABB afterwards.
      this.depthBox = this.computeWorldSceneBox();
      this.depthBox.union(this.estimateShadowBox(box));
    }
  }

  /** Square world AABB the baked shadow plane will roughly occupy under `box`. */
  private estimateShadowBox(box: THREE.Box3): THREE.Box3 {
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    // Over-estimate the baker's padded square footprint (pad ≈ 0.15 → 1.3×).
    const half = (Math.max(size.x, size.z, 1) * 1.5) / 2;
    return new THREE.Box3(
      new THREE.Vector3(center.x - half, box.min.y - 1, center.z - half),
      new THREE.Vector3(center.x + half, box.min.y, center.z + half),
    );
  }

  /**
   * Scale + position the shadow plane to the baked region `rect`: a square the
   * width of the (padded) footprint, floating just under the visible floor. The
   * baked texture maps 1:1 onto this square (see `ContactShadowBaker`).
   */
  private fitPlaneToRect(rect: ContactShadowRect): void {
    const ground = this.shadowGround;
    if (ground === null) return;
    // Plane is XY before rotation; after rotation -π/2 around X, local-X maps
    // to world-X and local-Y to world-Z, matching the bake camera's UV mapping.
    ground.scale.set(rect.side, rect.side, 1);
    // Float just under the floor so it never z-fights the slab above it.
    const drop = Math.max(rect.side * 0.0005, 0.002);
    ground.position.set(rect.cx, rect.groundY - drop, rect.cz);
    ground.updateMatrixWorld();
  }

  /**
   * Re-bake the silhouette contact shadow for the currently *visible solid* set
   * (every loaded item minus the hidden and x-rayed sets). Hides the plane when
   * nothing solid remains (everything hidden, or full x-ray). Driven once on the
   * idle frame when `shadowDirty` — never per frame, since the top-down bake is
   * independent of the user's camera.
   */
  private async bakeShadow(): Promise<void> {
    const ground = this.shadowGround;
    const ctx = this.ctx;
    const baker = this.shadowBaker;
    const renderer = this.world?.renderer?.three;
    if (
      !this.shadowsEnabled ||
      ground === null ||
      ctx === null ||
      baker === null ||
      !renderer
    ) {
      return;
    }

    // Never run two bakes at once (see `shadowBakeInFlight`): concurrent
    // un-cull/re-cull + double `fragments.update` on the same models races the
    // worker and can wedge the renderer in the parked `shadowBaking` state.
    // Coalesce — re-dirty so the trailing idle re-bakes after this one settles.
    if (this.shadowBakeInFlight) {
      this.shadowDirty = true;
      vlog('shadow', 'bake already in flight — coalescing (re-dirty for next idle)');
      return;
    }
    this.shadowBakeInFlight = true;
    vlog('shadow', 'bake start');

    const token = ++this.shadowBakeToken;

    // Native frustum culling (ALL_GEOMETRY) leaves only the user-camera frustum
    // resident in `model.object`, but the silhouette bakes the whole footprint
    // from a fixed top-down camera. Temporarily un-cull every culled model so
    // the bake sees all geometry, then restore in `finally`. `shadowBaking`
    // parks the renderer for the duration so the transient full-geometry pass
    // never flashes onto the main canvas (markActive is a no-op while it's set).
    const fragments = this.fragmentsModels;
    const unculled =
      fragments === null
        ? []
        : [
            ...modelMap(fragments),
          ].filter(([id]) => this.appliedLodMode.get(id) === FRAGS.LodMode.ALL_GEOMETRY);
    if (unculled.length > 0 && fragments !== null) {
      this.shadowBaking = true;
      for (const [, model] of unculled) {
        await model.setLodMode(FRAGS.LodMode.ALL_VISIBLE).catch(() => undefined);
      }
      await fragments.update(true).catch(() => undefined);
    }

    try {
      const hidden = this.commands.has('visibility.getHidden')
        ? await this.commands
            .execute<undefined, ItemId[]>('visibility.getHidden')
            .catch(() => [] as ItemId[])
        : [];
      const xrayed =
        this.pluginManager?.get<{ list(): ItemId[] }>('xray')?.list() ?? [];

      let box: THREE.Box3;
      if (hidden.length === 0 && xrayed.length === 0) {
        // Nothing hidden or ghosted — cheap whole-scene box.
        box = this.computeWorldSceneBox();
      } else {
        box = await computeVisibleSolidBox(ctx, { hidden, xrayed });
      }

      // A newer bake started while we awaited the visible-box walk — let it win.
      if (token !== this.shadowBakeToken) return;

      if (box.isEmpty()) {
        // Everything hidden / full x-ray — no solid geometry, so no shadow.
        ground.visible = false;
        return;
      }

      // Only building geometry should cast: collect the model roots so the baker
      // can hide the ground plane, grid, overlays, etc. for the silhouette pass.
      const modelRoots = new Set<THREE.Object3D>();
      for (const model of ctx.models().values()) {
        const obj = (model as unknown as { object?: THREE.Object3D }).object;
        if (obj) modelRoots.add(obj);
      }

      const rect = baker.bake(renderer, ctx.scene, modelRoots, box);
      if (rect === null) {
        ground.visible = false;
        return;
      }

      this.fitPlaneToRect(rect);
      ground.visible = true;

      // Fold the exact plane AABB into the depth box so its far edge never clips.
      this.depthBox = this.computeWorldSceneBox();
      this.depthBox.union(new THREE.Box3().setFromObject(ground));
    } finally {
      // Restore culling for every model we temporarily un-culled — to whatever
      // the policy now resolves (it may have changed mid-bake).
      if (unculled.length > 0 && fragments !== null) {
        for (const [id, model] of unculled) {
          const want = this.resolveLodMode(id);
          await model.setLodMode(want).catch(() => undefined);
          this.appliedLodMode.set(id, want);
        }
        await fragments.update(true).catch(() => undefined);
      }
      // Always clear the park/guard flags — even on an early return or a thrown
      // bake — so this method can never leave the renderer permanently parked
      // (the "frozen a few frames after load" failure). markActive() below is a
      // no-op while shadowBaking is true, so it MUST be cleared first.
      this.shadowBaking = false;
      this.shadowBakeInFlight = false;
      vlog('shadow', 'bake done');
      // Repaint the fresh shadow mask + restored geometry with one idle-quality
      // composite instead of waking the base renderer — markActive() would put
      // the renderer back in AUTO and paint un-FXAA'd frames during the settle
      // (the post-stop "resolution stepping"). The forced fragments.update above
      // already drained the restored geometry, so a single composite is enough.
      // Fall back to markActive when the composite path is unavailable.
      const effects = this.pluginManager?.get<{ recomposite(): boolean }>('effects');
      const composited = effects?.recomposite() ?? false;
      if (!composited) this.markActive();
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
      ...modelMap(fragments).keys(),
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
    const model = modelMap(fragments).get(modelId);
    if (!model) return;
    if (visible) this.hiddenModelIds.delete(modelId);
    else this.hiddenModelIds.add(modelId);
    await model.setVisible(undefined, visible).catch((e: unknown) =>
      vwarn('vis', `setVisible(${String(visible)}) failed for model "${modelId}"`, e),
    );
    vlog('vis', `model "${modelId}" → ${visible ? 'visible' : 'hidden'}`);
    this.events.emit('model:visibility', { modelId, visible });
    // Toggling a model re-streams its tiles — keep drawing while they arrive.
    this.markActive(MODEL_STREAM_HOLD_MS);
  }

  /**
   * Resolve the effective native `LodMode` for one model under the current
   * policy. `off` → ALL_VISIBLE (draw everything); `on` → ALL_GEOMETRY
   * (frustum-cull off-screen, full detail in view); `auto` → cull when the
   * scene is federated (more than one model) or this model is large, else leave
   * it unculled. An unknown element count resolves to ALL_VISIBLE so the initial
   * stream never shows holes — `model:elementCount` upgrades it later.
   */
  private resolveLodMode(modelId: string): FRAGS.LodMode {
    if (this.cullingMode === 'off') return FRAGS.LodMode.ALL_VISIBLE;
    if (this.cullingMode === 'on') return FRAGS.LodMode.ALL_GEOMETRY;
    const modelCount =
      (this.fragmentsModels?.models.list as unknown as Map<string, unknown> | undefined)
        ?.size ?? 0;
    if (modelCount > 1) return FRAGS.LodMode.ALL_GEOMETRY;
    const count = this.elementCounts.get(modelId);
    const cullThreshold =
      this.options.autoCullElementThreshold ?? AUTO_CULL_ELEMENT_THRESHOLD;
    if (count !== undefined && count > cullThreshold) {
      return FRAGS.LodMode.ALL_GEOMETRY;
    }
    return FRAGS.LodMode.ALL_VISIBLE;
  }

  /**
   * Re-resolve and apply the per-model `LodMode` across every loaded model.
   * Skips models whose resolved mode is unchanged (so repeated calls during a
   * federated load stay cheap) and only flushes + repaints when something
   * actually changed. Marks the contact shadow dirty so it re-bakes for the new
   * resident-geometry footprint on the next idle.
   */
  private async applyCulling(holdMs: number = MODEL_STREAM_HOLD_MS): Promise<void> {
    const fragments = this.fragmentsModels;
    if (fragments === null) return;
    const models = modelMap(fragments);
    const federated = models.size > 1;
    let changed = false;
    for (const [id, model] of models) {
      const want = this.resolveLodMode(id);
      const prev = this.appliedLodMode.get(id);
      if (prev === want) continue;
      await model.setLodMode(want).catch((e: unknown) =>
        vwarn('cull', `setLodMode failed for model "${id}"`, e),
      );
      this.appliedLodMode.set(id, want);
      changed = true;
      vlog(
        'cull',
        `model "${id}" LOD ${lodName(prev)} → ${lodName(want)}${
          federated ? ' (federated → frustum-culled)' : ''
        }`,
      );
    }
    if (!changed) return;
    await fragments.update(true).catch(() => undefined);
    this.shadowDirty = true;
    this.markActive(holdMs);
  }

  /**
   * Set the viewer's frustum-culling policy and re-apply it to every loaded
   * model. Driven by the portal's viewer settings via the `performance.setCulling`
   * command (see the performance-culling plugin).
   */
  async setCullingMode(mode: CullingMode): Promise<void> {
    if (this.cullingMode === mode) return;
    this.cullingMode = mode;
    this.events.emit('culling:change', { mode });
    // A settings toggle only re-streams the models whose LodMode changed — use
    // the short hold so the base renderer doesn't paint over the idle composite
    // for the full multi-second streaming window.
    await this.applyCulling(CULL_TOGGLE_HOLD_MS);
  }

  /**
   * Set the whole-model material look and re-apply it across every loaded
   * material (composed with each material's coplanar depth bias). Streamed-in
   * materials inherit the look via the `materials.list.onItemSet` hook, so this
   * only needs to walk what's already resolved. The `display-mode` plugin drives
   * this via `ctx.setActiveLook`; x-ray is a separate (opacity) axis. */
  setActiveLook(look: MaterialLook): void {
    if (this.activeLook === look) return;
    this.activeLook = look;
    const fragments = this.fragmentsModels;
    if (fragments !== null) {
      const modelsList = modelMap(fragments);
      const seen = new Set<THREE.Material>();
      for (const model of modelsList.values()) {
        (model as unknown as { object?: THREE.Object3D }).object?.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (!mesh.isMesh) return;
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const mat of mats) {
            if (mat && !seen.has(mat)) {
              seen.add(mat);
              applyLookToMaterial(mat, look);
            }
          }
        });
      }
    }
    this.markActive();
  }

  /** The current whole-model material look. */
  getActiveLook(): MaterialLook {
    return this.activeLook;
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
    const modelsList = modelMap(fragments);
    const model = modelsList.get(modelId);
    if (model === undefined) return;

    const sceneThree = threeScene(world.scene);
    sceneThree.remove(model.object);
    await fragments.disposeModel(modelId).catch(() => undefined);

    this.hiddenModelIds.delete(modelId);
    this.precomputedOutlines.delete(modelId);
    this.elementCounts.delete(modelId);
    this.appliedLodMode.delete(modelId);
    this.viewUpdatedUnsubs.get(modelId)?.();
    this.viewUpdatedUnsubs.delete(modelId);
    if (this.modelId === modelId) {
      this.modelId = this.getModelIds()[0] ?? null;
    }

    // Re-union bounds + relight, but do NOT re-frame — the user is mid-view.
    this.refreshSceneBounds();
    this.fitLightsToScene();
    vlog('load', `model "${modelId}" unloaded`, { remaining: this.getModelIds() });
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
    for (const unsub of this.viewUpdatedUnsubs.values()) unsub();
    this.viewUpdatedUnsubs.clear();
    this.appliedLodMode.clear();
    this.elementCounts.clear();
    this.fragmentsModels?.dispose().catch(() => undefined);
    this.fragmentsModels = null;
    if (this.shadowGround !== null) {
      (this.shadowGround.geometry as THREE.BufferGeometry).dispose();
      (this.shadowGround.material as THREE.Material).dispose();
      this.shadowGround = null;
    }
    if (this.shadowBaker !== null) {
      this.shadowBaker.dispose();
      this.shadowBaker = null;
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
