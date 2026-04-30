/**
 * Effects plugin — silhouette edge lines via Sobel on a normal buffer.
 *
 * Pipeline:
 *   RenderPass (color, MSAA) → NormalEdgePass (custom; detects edges from a
 *   normal+depth buffer and darkens color where they break) → SMAAPass →
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
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';

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
    uNormalStrength: { value: 2.0 },
    uDepthScale: { value: 14.0 },
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

    void main() {
      vec4 col = texture2D(tDiffuse, vUv);
      vec2 texel = 1.0 / resolution;

      vec4 sC = texture2D(tNormal, vUv);
      vec4 sL = texture2D(tNormal, vUv + texel * vec2(-1.0, 0.0));
      vec4 sR = texture2D(tNormal, vUv + texel * vec2( 1.0, 0.0));
      vec4 sU = texture2D(tNormal, vUv + texel * vec2( 0.0,-1.0));
      vec4 sD = texture2D(tNormal, vUv + texel * vec2( 0.0, 1.0));

      // Background pixels have alpha == 0 (cleared). Geometry has a small
      // epsilon-biased linearDepth in alpha. If any of the 5 taps is
      // background, skip — silhouette against the background gets handled
      // by the normal-Sobel naturally without polluting the depth term.
      float aMin = min(min(min(min(sC.a, sL.a), sR.a), sU.a), sD.a);
      if (aMin < 0.001) {
        gl_FragColor = col;
        return;
      }

      // Normal-discontinuity term (silhouettes & creases).
      vec3 nL = normalize(sL.rgb * 2.0 - 1.0);
      vec3 nR = normalize(sR.rgb * 2.0 - 1.0);
      vec3 nU = normalize(sU.rgb * 2.0 - 1.0);
      vec3 nD = normalize(sD.rgb * 2.0 - 1.0);
      float dx = 1.0 - dot(nL, nR);
      float dy = 1.0 - dot(nU, nD);
      float gN = (dx + dy) * uNormalStrength;

      // Depth-discontinuity term, second-derivative style. A continuously
      // tilted surface gives ~0 because dC = 0.5*(dL+dR); only true depth
      // jumps (where dC departs from the neighbour midpoint) survive.
      float dC = sC.a;
      float gDx = abs(dC - 0.5 * (sL.a + sR.a));
      float gDy = abs(dC - 0.5 * (sU.a + sD.a));
      float gD = (gDx + gDy) * uDepthScale;

      float g = max(gN, gD);
      float edge = smoothstep(uEdgeLow, uEdgeHigh, g);

      // Mix toward a tinted dark gray instead of pure darkening — keeps
      // lines readable on bright surfaces and avoids the "muddy" look.
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
  let smaaPass: SMAAPass | null = null;
  let composerTarget: THREE.WebGLRenderTarget | null = null;
  let normalTarget: THREE.WebGLRenderTarget | null = null;
  let normalMaterial: THREE.ShaderMaterial | null = null;

  let isIdle = false;

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
        ? { ns: 2.6, ds: 22.0, lo: 0.1, hi: 0.5 }
        : q === 'low'
          ? { ns: 1.4, ds: 8.0, lo: 0.2, hi: 0.7 }
          : { ns: 2.0, ds: 14.0, lo: 0.15, hi: 0.6 };
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
    try {
      if (opts.edges) renderNormalBuffer();
      composer.render();
    } catch {
      // Render targets may not be ready on first frame.
    }
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

      smaaPass = new SMAAPass();
      smaaPass.setSize(w, h);
      composer.addPass(smaaPass);

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
        try {
          if (opts.edges) renderNormalBuffer();
          composer.render();
        } catch {
          // ignore
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
        ro.disconnect();

        composer?.dispose();
        composer = null;
        edgesPass?.dispose?.();
        smaaPass?.dispose?.();
        edgesPass = null;
        smaaPass = null;
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
    },
  };

  return api;
}

export type { EffectsOptions, EffectsQuality } from './types.js';
