/**
 * Effects plugin — silhouette edge lines via Sobel on a normal buffer.
 *
 * Pipeline:
 *   RenderPass (color, MSAA) → NormalEdgePass (custom; dual-scale Sobel on
 *   a normal+depth buffer, darkens color where edges break) → FXAAPass →
 *   OutputPass.
 *
 * Why a normal-buffer Sobel instead of luminance Sobel: BIM models have
 * large flat-coloured regions where luminance Sobel misses real geometric
 * edges, and noisy textures where it produces phantom edges. Sampling
 * the *normal* buffer (and depth as a tie-break for far-apart but parallel
 * surfaces) detects exactly the silhouettes and hard creases Forge draws.
 *
 * Render strategy: gated on `viewer:idle` and driven by a small RAF loop
 * so post passes only run while the camera is still. During motion the
 * base SimpleRenderer keeps doing its cheap render and post effects cost
 * nothing.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { FXAAPass } from 'three/examples/jsm/postprocessing/FXAAPass.js';

import type { Plugin, ViewerContext } from '../../core/types.js';
import type { EffectsOptions, EffectsQuality } from './types.js';

const NAME = 'effects' as const;

const DEFAULTS: Required<EffectsOptions> = {
  enabled: true,
  edges: true,
  quality: 'medium',
};

/**
 * Reads a packed normal+linearDepth buffer (RGB = view-space normal,
 * A = linear depth in [0,1] with a small epsilon bias so background
 * stays at exactly 0). Computes two edge terms:
 *
 *   - normal-discontinuity (silhouettes & sharp creases)
 *   - depth-discontinuity using a second-derivative kernel so gentle
 *     slopes don't fire false edges, only true depth jumps do.
 *
 * The two terms are combined with a max(), passed through smoothstep,
 * and used to mix the source color toward a tinted edge color.
 */
const NormalEdgeShader = {
  name: 'NormalEdgeShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    tNormal: { value: null as THREE.Texture | null },
    resolution: { value: new THREE.Vector2() },
    uNormalStrength: { value: 1.0 },
    uDepthScale: { value: 2.5 },
    uEdgeLow: { value: 0.15 },
    uEdgeHigh: { value: 0.6 },
    uEdgeColor: { value: new THREE.Color(0.18, 0.2, 0.24) },
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
    uniform float uNormalStrength;
    uniform float uDepthScale;
    uniform float uEdgeLow;
    uniform float uEdgeHigh;
    uniform vec3 uEdgeColor;
    varying vec2 vUv;

    vec3 decN(vec4 s) { return normalize(s.rgb * 2.0 - 1.0); }

    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      vec2 texel = 1.0 / resolution;

      // --- Inner ring: 3x3 Sobel at 1x texel spacing ---
      vec4 s00 = texture2D(tNormal, vUv + texel * vec2(-1.0, -1.0));
      vec4 s10 = texture2D(tNormal, vUv + texel * vec2( 0.0, -1.0));
      vec4 s20 = texture2D(tNormal, vUv + texel * vec2( 1.0, -1.0));
      vec4 s01 = texture2D(tNormal, vUv + texel * vec2(-1.0,  0.0));
      vec4 sC  = texture2D(tNormal, vUv);
      vec4 s21 = texture2D(tNormal, vUv + texel * vec2( 1.0,  0.0));
      vec4 s02 = texture2D(tNormal, vUv + texel * vec2(-1.0,  1.0));
      vec4 s12 = texture2D(tNormal, vUv + texel * vec2( 0.0,  1.0));
      vec4 s22 = texture2D(tNormal, vUv + texel * vec2( 1.0,  1.0));

      // --- Outer ring: cross at 2x texel spacing (wider, softer) ---
      vec4 wL = texture2D(tNormal, vUv + texel * vec2(-2.0,  0.0));
      vec4 wR = texture2D(tNormal, vUv + texel * vec2( 2.0,  0.0));
      vec4 wU = texture2D(tNormal, vUv + texel * vec2( 0.0, -2.0));
      vec4 wD = texture2D(tNormal, vUv + texel * vec2( 0.0,  2.0));

      float aMin = min(min(min(min(min(min(min(min(
        sC.a, s00.a), s10.a), s20.a), s01.a), s21.a), s02.a), s12.a), s22.a);
      if (aMin < 0.001) {
        gl_FragColor = col;
        return;
      }

      vec3 nC = decN(sC);
      float d00 = 1.0 - dot(nC, decN(s00));
      float d10 = 1.0 - dot(nC, decN(s10));
      float d20 = 1.0 - dot(nC, decN(s20));
      float d01 = 1.0 - dot(nC, decN(s01));
      float d21 = 1.0 - dot(nC, decN(s21));
      float d02 = 1.0 - dot(nC, decN(s02));
      float d12 = 1.0 - dot(nC, decN(s12));
      float d22 = 1.0 - dot(nC, decN(s22));

      // Inner Sobel 3x3
      float gnX = -d00 + d20 - 2.0*d01 + 2.0*d21 - d02 + d22;
      float gnY = -d00 - 2.0*d10 - d20 + d02 + 2.0*d12 + d22;
      float gN1 = sqrt(gnX * gnX + gnY * gnY);

      // Outer cross — extends the edge footprint to ~5 px so the
      // transition spans multiple pixels instead of a hard 1-px step.
      float wdx = 1.0 - dot(decN(wL), decN(wR));
      float wdy = 1.0 - dot(decN(wU), decN(wD));
      float gN2 = wdx + wdy;

      float gN = max(gN1, gN2 * 0.75) * uNormalStrength;

      // Depth — Laplacian inner + wide cross second-derivative
      float lap = s00.a + s10.a + s20.a + s01.a + s21.a
                + s02.a + s12.a + s22.a - 8.0 * sC.a;
      float gD1 = abs(lap);
      float gD2 = abs(sC.a - 0.5*(wL.a + wR.a))
                + abs(sC.a - 0.5*(wU.a + wD.a));
      float gD = max(gD1, gD2 * 0.75) * uDepthScale;

      float g = max(gN, gD);
      float edge = smoothstep(uEdgeLow, uEdgeHigh, g);

      vec3 edgeRgb = mix(col.rgb * 0.15, uEdgeColor, 0.35);
      gl_FragColor = vec4(mix(col.rgb, edgeRgb, edge), col.a);
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
  let edgesPass: ShaderPass | null = null;
  let fxaaPass: FXAAPass | null = null;
  let composerTarget: THREE.WebGLRenderTarget | null = null;
  let normalTarget: THREE.WebGLRenderTarget | null = null;
  let normalMaterial: THREE.ShaderMaterial | null = null;

  let isIdle = false;
  let shadowMat: THREE.ShaderMaterial | null = null;

  const setShadowLinearBlend = (v: number): void => {
    if (!shadowMat && ctxRef) {
      ctxRef.scene.traverse((obj) => {
        if (obj.name === 'shadow-ground' && (obj as THREE.Mesh).material) {
          shadowMat = (obj as THREE.Mesh).material as THREE.ShaderMaterial;
        }
      });
    }
    const u = shadowMat?.uniforms as
      | { uLinearBlend?: { value: number } }
      | undefined;
    if (u?.uLinearBlend) u.uLinearBlend.value = v;
  };

  const applyPassToggles = (): void => {
    if (edgesPass) edgesPass.enabled = opts.enabled && opts.edges;
  };

  const tuneQuality = (): void => {
    if (!edgesPass) return;
    const q: EffectsQuality = opts.quality;
    // Tuple per preset: (normalStrength, depthScale, edgeLow, edgeHigh).
    // Higher quality widens the smoothstep window and increases sensitivity
    // to both normal and depth gradients, picking up more subtle edges.
    const preset =
      q === 'high'
        ? { ns: 1.3, ds: 3.5, lo: 0.1, hi: 0.5 }
        : q === 'low'
          ? { ns: 0.7, ds: 1.4, lo: 0.2, hi: 0.7 }
          : { ns: 1.0, ds: 2.5, lo: 0.15, hi: 0.6 };
    const u = edgesPass.uniforms as {
      uNormalStrength: { value: number };
      uDepthScale: { value: number };
      uEdgeLow: { value: number };
      uEdgeHigh: { value: number };
    };
    u.uNormalStrength.value = preset.ns;
    u.uDepthScale.value = preset.ds;
    u.uEdgeLow.value = preset.lo;
    u.uEdgeHigh.value = preset.hi;
  };

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

    const tempHidden: THREE.Object3D[] = [];
    scene.traverse((obj) => {
      if (obj.name === 'shadow-ground' && obj.visible) {
        obj.visible = false;
        tempHidden.push(obj);
      }
    });

    // Push current camera near/far so the normal material can compute a
    // linearised depth into alpha. Both PerspectiveCamera and
    // OrthographicCamera expose `near`/`far`.
    const nu = normalMaterial.uniforms as {
      uCameraNear: { value: number };
      uCameraFar: { value: number };
    };
    nu.uCameraNear.value = camera.near;
    nu.uCameraFar.value = camera.far;

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
    setShadowLinearBlend(1.0);
    try {
      if (opts.edges) renderNormalBuffer();
      composer.render();
    } catch {
      // Render targets may not be ready on first frame.
    }
    setShadowLinearBlend(0.0);
  };

  const api: Plugin & EffectsPluginAPI = {
    name: NAME,

    getOptions() {
      return { ...opts };
    },

    setOptions(next: EffectsOptions) {
      opts = { ...opts, ...next };
      applyPassToggles();
      tuneQuality();
      requestComposerFrame();
    },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      const renderer = ctx.renderer;
      const scene = ctx.scene;
      const camera = ctx.camera;

      const size = renderer.getSize(new THREE.Vector2());
      const dpr = renderer.getPixelRatio();
      const w = Math.round(size.x * dpr);
      const h = Math.round(size.y * dpr);

      composerTarget = new THREE.WebGLRenderTarget(w, h, {
        samples: 4,
        type: THREE.HalfFloatType,
      });

      // HalfFloat for the normal+depth target so the alpha channel can carry
      // ~16-bit linearised depth (8-bit was too coarse for the depth-Sobel
      // second-derivative term).
      normalTarget = new THREE.WebGLRenderTarget(w, h, {
        samples: 4,
        type: THREE.HalfFloatType,
      });

      normalMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uCameraNear: { value: 0.1 },
          uCameraFar: { value: 1000.0 },
        },
        vertexShader: /* glsl */ `
          varying vec3 vWorldNormal;
          varying float vViewZ;
          void main() {
            vWorldNormal = normalize(mat3(modelMatrix) * normal);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vViewZ = -mv.z;
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uCameraNear;
          uniform float uCameraFar;
          varying vec3 vWorldNormal;
          varying float vViewZ;
          void main() {
            float linearDepth = (vViewZ - uCameraNear) / max(uCameraFar - uCameraNear, 1e-6);
            // Bias into [0.005, 1.0] so geometry never has alpha == 0 (which
            // is the "background" sentinel the edge shader checks for).
            float depthA = clamp(linearDepth, 0.0, 1.0) * 0.995 + 0.005;
            gl_FragColor = vec4(normalize(vWorldNormal) * 0.5 + 0.5, depthA);
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

      fxaaPass = new FXAAPass();
      fxaaPass.setSize(w, h);
      composer.addPass(fxaaPass);

      composer.addPass(new OutputPass());

      tuneQuality();
      applyPassToggles();

      const onCamChange = (): void => {
        isIdle = false;
      };
      const onIdle = (): void => {
        isIdle = true;
        requestComposerFrame();
      };

      const offCam = ctx.events.on('camera:change', onCamChange);
      const offIdle = ctx.events.on('viewer:idle', onIdle);

      let raf = 0;
      const loop = (): void => {
        raf = requestAnimationFrame(loop);
        if (!opts.enabled || !isIdle || !composer) return;
        setShadowLinearBlend(1.0);
        try {
          if (opts.edges) renderNormalBuffer();
          composer.render();
        } catch {
          // ignore
        }
        setShadowLinearBlend(0.0);
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
        if (fxaaPass) fxaaPass.setSize(nw, nh);
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
        ro.disconnect();

        composer?.dispose();
        composer = null;
        edgesPass?.dispose?.();
        fxaaPass?.dispose?.();
        edgesPass = null;
        fxaaPass = null;
        composerTarget?.dispose();
        composerTarget = null;
        normalTarget?.dispose();
        normalTarget = null;
        normalMaterial?.dispose();
        normalMaterial = null;
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
      shadowMat = null;
    },
  };

  return api;
}

export type { EffectsOptions, EffectsQuality } from './types.js';
