/**
 * Effects plugin — Forge/APS-style visual polish on top of the base scene.
 *
 * Pipeline:
 *   RenderPass (color, MSAA) → NormalEdgePass (custom; detects edges from a
 *   normal+depth buffer and darkens color where they break) → OutlinePass
 *   (selection glow) → SMAAPass → OutputPass.
 *
 * Why a normal-buffer Sobel instead of luminance Sobel: BIM models have
 * large flat-coloured regions where luminance Sobel misses real geometric
 * edges, and noisy textures where it produces phantom edges. Sampling
 * the *normal* buffer (and depth as a tie-break for far-apart but parallel
 * surfaces) detects exactly the silhouettes and hard creases Forge draws.
 *
 * Why not extract geometric LineSegments via THREE.EdgesGeometry: fragments
 * keeps its mesh data on the GPU and exposes BufferAttributes whose
 * `.array` is null on the CPU side, so EdgesGeometry throws. Geometric
 * edges would need to be done inside fragments' worker pipeline.
 *
 * Render strategy: gated on `viewer:idle` and driven by a small RAF loop
 * so post passes only run while the camera is still. During motion the
 * base SimpleRenderer keeps doing its cheap render and post effects cost
 * nothing.
 *
 * Notes:
 *   - The base renderer enables `logarithmicDepthBuffer` (eliminates BIM
 *     z-fighting). Three.js' built-in SAOPass / SSAOPass don't support
 *     log depth, so the `ssao` option is API-stable but not yet wired.
 *     Adding GTAOPass (which handles log depth) is a follow-up.
 */

import * as THREE from 'three';
import * as FRAGS from '@thatopen/fragments';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutlinePass } from 'three/examples/jsm/postprocessing/OutlinePass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import type { ItemId, Plugin, ViewerContext } from '../../core/types.js';
import type { SelectionPluginAPI } from '../selection/index.js';
import type { EffectsOptions, EffectsQuality, GhostMode } from './types.js';

const NAME = 'effects' as const;
const GHOST_CUSTOM_ID = 'ghost' as const;

const DEFAULTS: Required<EffectsOptions> = {
  enabled: true,
  edges: true,
  ssao: false,
  outline: true,
  ghost: 'on-selection',
  environment: true,
  quality: 'medium',
};

/**
 * Reads a normal buffer (RGB-encoded view-space normals) and detects edges
 * via Sobel on the normal channels. Output: original color, darkened
 * proportional to the edge magnitude. With smoothstep + MSAA on the
 * input buffers this produces clean Forge-style silhouettes.
 */
const NormalEdgeShader = {
  name: 'NormalEdgeShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tNormal: { value: null as THREE.Texture | null },
    resolution: { value: new THREE.Vector2() },
    strength: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D tNormal;
    uniform vec2 resolution;
    uniform float strength;
    varying vec2 vUv;

    // Squared magnitude of (a - b) — cheap proxy for vector difference.
    float ndiff(vec3 a, vec3 b) {
      vec3 d = a - b;
      return dot(d, d);
    }

    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      vec2 texel = 1.0 / resolution;

      vec4 sC = texture2D(tNormal, vUv);
      vec4 sL = texture2D(tNormal, vUv + texel * vec2(-1.0, 0.0));
      vec4 sR = texture2D(tNormal, vUv + texel * vec2( 1.0, 0.0));
      vec4 sU = texture2D(tNormal, vUv + texel * vec2( 0.0,-1.0));
      vec4 sD = texture2D(tNormal, vUv + texel * vec2( 0.0, 1.0));

      // Mask out background pixels (no geometry). MeshNormalMaterial
      // writes alpha=1; the cleared target stays alpha=0. If any of the
      // 5-tap samples is on background, we're at the silhouette of a
      // far surface meeting the sky — drop the edge to avoid drawing
      // the horizon line where the ground plane ends.
      float aMin = min(min(min(min(sC.a, sL.a), sR.a), sU.a), sD.a);
      if (aMin < 0.5) {
        gl_FragColor = col;
        return;
      }

      // Decode encoded normals (MeshNormalMaterial writes n*0.5+0.5).
      // Compare neighbor pairs by their actual normal angle — squared
      // chord length = 2 - 2*cos(angle). Threshold ~0.3 corresponds to
      // ~32° which is typical Forge "hard edge" angle.
      vec3 nL = normalize(sL.rgb * 2.0 - 1.0);
      vec3 nR = normalize(sR.rgb * 2.0 - 1.0);
      vec3 nU = normalize(sU.rgb * 2.0 - 1.0);
      vec3 nD = normalize(sD.rgb * 2.0 - 1.0);

      float dx = 1.0 - dot(nL, nR);
      float dy = 1.0 - dot(nU, nD);
      float g = (dx + dy) * strength;

      // Wider smoothstep band kills the stipple from coplanar-triangle
      // normal noise (slab tessellation, etc.) while still catching real
      // silhouettes / hard creases.
      float edge = smoothstep(0.15, 0.6, g);

      gl_FragColor = vec4(col.rgb * (1.0 - edge), col.a);
    }
  `,
};

export interface EffectsPluginAPI {
  setOptions(next: EffectsOptions): void;
  getOptions(): Required<EffectsOptions>;
}

export function effectsPlugin(
  options: EffectsOptions = {},
): Plugin & EffectsPluginAPI {
  let opts: Required<EffectsOptions> = { ...DEFAULTS, ...options };

  let cleanup: (() => void) | null = null;
  let ctxRef: ViewerContext | null = null;

  let composer: EffectComposer | null = null;
  let outlinePass: OutlinePass | null = null;
  let edgesPass: ShaderPass | null = null;
  let smaaPass: SMAAPass | null = null;
  let composerTarget: THREE.WebGLRenderTarget | null = null;
  let normalTarget: THREE.WebGLRenderTarget | null = null;
  // Custom material that writes WORLD-space normals (instead of MeshNormalMaterial's
  // view-space normals). View-space normals vary across a flat surface due to
  // perspective, producing spurious dotted edges on large ground planes.
  let normalMaterial: THREE.ShaderMaterial | null = null;
  let envTexture: THREE.Texture | null = null;
  let pmremGen: THREE.PMREMGenerator | null = null;

  let isIdle = false;

  const ghostedByModel = new Map<string, number[]>();

  const ghostMaterial: FRAGS.MaterialDefinition = {
    color: new THREE.Color(0xcccccc),
    opacity: 0.15,
    transparent: true,
    renderedFaces: FRAGS.RenderedFaces.TWO,
    customId: GHOST_CUSTOM_ID,
  };

  const applyPassToggles = (): void => {
    if (outlinePass) outlinePass.enabled = opts.enabled && opts.outline;
    if (edgesPass) edgesPass.enabled = opts.enabled && opts.edges;
  };

  const applyEnvironment = (scene: THREE.Scene): void => {
    if (opts.enabled && opts.environment) {
      if (envTexture === null && pmremGen !== null) {
        const env = new RoomEnvironment();
        envTexture = pmremGen.fromScene(env, 0.04).texture;
      }
      scene.environment = envTexture;
    } else {
      scene.environment = null;
    }
  };

  const tuneQuality = (): void => {
    const q: EffectsQuality = opts.quality;
    if (outlinePass) {
      outlinePass.edgeThickness = q === 'high' ? 2 : 1;
      outlinePass.edgeStrength = q === 'high' ? 5 : 3;
      outlinePass.edgeGlow = 0.5;
      outlinePass.visibleEdgeColor.set(0xff8a3d);
      outlinePass.hiddenEdgeColor.set(0x4a2510);
    }
    if (edgesPass) {
      const u = edgesPass.uniforms as { strength: { value: number } };
      u.strength.value = q === 'high' ? 2.5 : q === 'low' ? 1.4 : 2.0;
    }
  };

  /**
   * Render the scene with a MeshNormalMaterial override into the normal
   * render target. Called inside our composer-render path so the normal
   * buffer is fresh before NormalEdgePass samples it.
   */
  const renderNormalBuffer = (): void => {
    if (!ctxRef || !normalTarget || !normalMaterial) return;
    const renderer = ctxRef.renderer;
    const scene = ctxRef.scene;
    const camera = ctxRef.camera;
    const prevTarget = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    const prevBackground = scene.background;
    const prevClearColor = new THREE.Color();
    renderer.getClearColor(prevClearColor);
    const prevClearAlpha = renderer.getClearAlpha();

    // Hide the shadow-ground plane during the normal pass: it contributes
    // nothing to silhouettes (it's just a flat shadow receiver) but its
    // edge against the cleared background draws a spurious horizon line.
    const tempHidden: THREE.Object3D[] = [];
    scene.traverse((obj) => {
      if (obj.name === 'shadow-ground' && obj.visible) {
        obj.visible = false;
        tempHidden.push(obj);
      }
    });

    scene.overrideMaterial = normalMaterial;
    scene.background = null;
    renderer.setRenderTarget(normalTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);

    for (const obj of tempHidden) obj.visible = true;
    scene.overrideMaterial = prevOverride;
    scene.background = prevBackground;
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClearColor, prevClearAlpha);
  };

  const requestComposerFrame = (): void => {
    if (!composer || !opts.enabled) return;
    try {
      if (opts.edges) renderNormalBuffer();
      composer.render();
    } catch {
      // Render targets may not be ready on first frame; the RAF loop
      // (and subsequent idle ticks) will retry.
    }
  };

  const collectSelectedObjects = (selection: ItemId[]): THREE.Object3D[] => {
    if (!ctxRef) return [];
    const modelIds = new Set(selection.map((s) => s.modelId));
    if (modelIds.size === 0) return [];
    const objs: THREE.Object3D[] = [];
    for (const id of modelIds) {
      const model = ctxRef.models().get(id);
      if (model) objs.push(model.object);
    }
    return objs;
  };

  const repaintGhost = async (selection: ItemId[]): Promise<void> => {
    if (!ctxRef) return;
    const wantGhost = opts.enabled && opts.ghost === 'on-selection' && selection.length > 0;

    for (const [modelId, ids] of ghostedByModel) {
      const model = ctxRef.models().get(modelId);
      if (model && ids.length > 0) {
        await model.resetHighlight(ids).catch(() => undefined);
      }
    }
    ghostedByModel.clear();

    if (!wantGhost) return;

    const selectedByModel = new Map<string, Set<number>>();
    for (const it of selection) {
      let set = selectedByModel.get(it.modelId);
      if (!set) {
        set = new Set();
        selectedByModel.set(it.modelId, set);
      }
      set.add(it.localId);
    }

    for (const [modelId, model] of ctxRef.models()) {
      const visible = await model.getItemsByVisibility(true).catch(() => [] as number[]);
      const selectedIds = selectedByModel.get(modelId) ?? new Set<number>();
      const ghostIds = visible.filter((id) => !selectedIds.has(id));
      if (ghostIds.length === 0) continue;
      await model.highlight(ghostIds, ghostMaterial).catch(() => undefined);
      ghostedByModel.set(modelId, ghostIds);
    }
  };

  const api: Plugin & EffectsPluginAPI = {
    name: NAME,
    dependencies: ['selection'],

    getOptions() {
      return { ...opts };
    },

    setOptions(next: EffectsOptions) {
      opts = { ...opts, ...next };
      applyPassToggles();
      tuneQuality();
      if (ctxRef) applyEnvironment(ctxRef.scene);
      requestComposerFrame();
    },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      const renderer = ctx.renderer;
      const scene = ctx.scene;
      const camera = ctx.camera;

      pmremGen = new THREE.PMREMGenerator(renderer);
      pmremGen.compileEquirectangularShader();

      const size = renderer.getSize(new THREE.Vector2());
      const dpr = renderer.getPixelRatio();
      const w = Math.round(size.x * dpr);
      const h = Math.round(size.y * dpr);

      // MSAA target so scene render going into the composer is already
      // anti-aliased.
      composerTarget = new THREE.WebGLRenderTarget(w, h, {
        samples: 4,
        type: THREE.HalfFloatType,
      });

      // Separate target for the normal buffer (also MSAA so edge detection
      // sees smooth normal transitions).
      normalTarget = new THREE.WebGLRenderTarget(w, h, {
        samples: 4,
      });

      normalMaterial = new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `
          varying vec3 vWorldNormal;
          void main() {
            vWorldNormal = normalize(mat3(modelMatrix) * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vWorldNormal;
          void main() {
            // Encode (-1..1) → (0..1) so we can read back through an
            // RGBA8 target. Alpha=1 marks "geometry here" so the edge
            // pass can mask out empty background.
            gl_FragColor = vec4(normalize(vWorldNormal) * 0.5 + 0.5, 1.0);
          }
        `,
      });

      composer = new EffectComposer(renderer, composerTarget);
      composer.setSize(size.x, size.y);
      composer.setPixelRatio(dpr);

      composer.addPass(new RenderPass(scene, camera));

      edgesPass = new ShaderPass(NormalEdgeShader);
      const eu = edgesPass.uniforms as {
        resolution: { value: THREE.Vector2 };
        tNormal: { value: THREE.Texture | null };
      };
      eu.resolution.value = new THREE.Vector2(w, h);
      eu.tNormal.value = normalTarget.texture;
      composer.addPass(edgesPass);

      outlinePass = new OutlinePass(size, scene, camera);
      composer.addPass(outlinePass);

      smaaPass = new SMAAPass();
      smaaPass.setSize(w, h);
      composer.addPass(smaaPass);

      composer.addPass(new OutputPass());

      tuneQuality();
      applyPassToggles();
      applyEnvironment(scene);

      const onCamChange = (): void => {
        isIdle = false;
      };
      const onIdle = (): void => {
        isIdle = true;
        requestComposerFrame();
      };
      const onSelectionChange = (e: { selected: ItemId[] }): void => {
        if (outlinePass) {
          outlinePass.selectedObjects = opts.enabled && opts.outline
            ? collectSelectedObjects(e.selected)
            : [];
        }
        void repaintGhost(e.selected).then(() => {
          requestComposerFrame();
        });
      };
      const onModelLoaded = (): void => {
        const sel = ctx.plugins.get<SelectionPluginAPI>('selection');
        if (outlinePass && sel) {
          outlinePass.selectedObjects = opts.enabled && opts.outline
            ? collectSelectedObjects(sel.list())
            : [];
        }
        requestComposerFrame();
      };

      const offCam = ctx.events.on('camera:change', onCamChange);
      const offIdle = ctx.events.on('viewer:idle', onIdle);
      const offSel = ctx.events.on('selection:change', onSelectionChange);
      const offModel = ctx.events.on('model:loaded', onModelLoaded);

      // Composer drives every frame *while idle* — the base SimpleRenderer
      // keeps painting cheap frames in between, which would otherwise
      // erase our composer output 16ms later.
      let raf = 0;
      const loop = (): void => {
        raf = requestAnimationFrame(loop);
        if (!opts.enabled || !isIdle || !composer) return;
        try {
          if (opts.edges) renderNormalBuffer();
          composer.render();
        } catch {
          // ignore — see requestComposerFrame
        }
      };
      raf = requestAnimationFrame(loop);

      const onResize = (): void => {
        if (!composer || !renderer) return;
        const s = renderer.getSize(new THREE.Vector2());
        const r = renderer.getPixelRatio();
        const nw = Math.round(s.x * r);
        const nh = Math.round(s.y * r);
        composer.setSize(s.x, s.y);
        composer.setPixelRatio(r);
        if (outlinePass) outlinePass.setSize(s.x, s.y);
        if (smaaPass) smaaPass.setSize(nw, nh);
        if (normalTarget) normalTarget.setSize(nw, nh);
        if (edgesPass) {
          const u = edgesPass.uniforms as {
            resolution: { value: THREE.Vector2 };
          };
          u.resolution.value.set(nw, nh);
        }
      };
      const ro = new ResizeObserver(onResize);
      ro.observe(ctx.canvas);

      cleanup = (): void => {
        cancelAnimationFrame(raf);
        offCam();
        offIdle();
        offSel();
        offModel();
        ro.disconnect();

        for (const [modelId, ids] of ghostedByModel) {
          const model = ctxRef?.models().get(modelId);
          if (model && ids.length > 0) {
            void model.resetHighlight(ids).catch(() => undefined);
          }
        }
        ghostedByModel.clear();

        if (ctxRef) ctxRef.scene.environment = null;

        composer?.dispose();
        composer = null;
        outlinePass?.dispose?.();
        edgesPass?.dispose?.();
        smaaPass?.dispose?.();
        outlinePass = null;
        edgesPass = null;
        smaaPass = null;
        composerTarget?.dispose();
        composerTarget = null;
        normalTarget?.dispose();
        normalTarget = null;
        normalMaterial?.dispose();
        normalMaterial = null;
        envTexture?.dispose();
        envTexture = null;
        pmremGen?.dispose();
        pmremGen = null;
      };

      ctx.commands.register(
        'effects.set',
        (args: unknown) => {
          if (!args || typeof args !== 'object') return false;
          api.setOptions(args as EffectsOptions);
          return true;
        },
        { title: 'Update visual effects' },
      );
      ctx.commands.register('effects.get', () => api.getOptions(), {
        title: 'Get visual effects state',
      });

      requestComposerFrame();
    },

    uninstall() {
      cleanup?.();
      cleanup = null;
      ctxRef = null;
    },
  };

  return api;
}

export type { EffectsOptions, EffectsQuality, GhostMode } from './types.js';
