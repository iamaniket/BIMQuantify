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
import { LAYER_DEFAULT, LAYER_OVERLAY } from '../../core/layers.js';
import type { Plugin, ViewerContext } from '../../core/types.js';
import { CustomFXAAPass } from './fxaa.js';
import type { EffectsOptions, EffectsQuality } from './types.js';

const NAME = 'effects' as const;

const DEFAULTS: Required<EffectsOptions> = {
  enabled: true,
  edges: true,
  quality: 'medium',
  debugView: 0,
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
    uEdgeColor: { value: new THREE.Color(0.05, 0.05, 0.08) },
    uDebugView: { value: 0 },
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
    uniform int uDebugView;
    varying vec2 vUv;

    vec3 decN(vec4 s) { return normalize(s.rgb * 2.0 - 1.0); }

    void main() {
      vec4 col = texture2D(tDiffuse, vUv);

      // Debug 3: pass-through (no edges)
      if (uDebugView == 3) { gl_FragColor = col; return; }

      vec2 texel = 1.0 / resolution;
      vec4 sC = texture2D(tNormal, vUv);

      // Debug 1: show raw normal buffer
      if (uDebugView == 1) { gl_FragColor = vec4(sC.rgb, 1.0); return; }

      // Inner ring: 1-texel cross-difference
      vec4 s10 = texture2D(tNormal, vUv + texel * vec2( 0.0, -1.0));
      vec4 s01 = texture2D(tNormal, vUv + texel * vec2(-1.0,  0.0));
      vec4 s21 = texture2D(tNormal, vUv + texel * vec2( 1.0,  0.0));
      vec4 s12 = texture2D(tNormal, vUv + texel * vec2( 0.0,  1.0));
      vec4 s00 = texture2D(tNormal, vUv + texel * vec2(-1.0, -1.0));
      vec4 s22 = texture2D(tNormal, vUv + texel * vec2( 1.0,  1.0));
      vec4 s20 = texture2D(tNormal, vUv + texel * vec2( 1.0, -1.0));
      vec4 s02 = texture2D(tNormal, vUv + texel * vec2(-1.0,  1.0));

      // Outer ring: 2-texel cross-difference — reaches past the
      // MSAA blend zone so edges that fall exactly on pixel
      // boundaries still produce a solid signal.
      vec4 wL = texture2D(tNormal, vUv + texel * vec2(-2.0,  0.0));
      vec4 wR = texture2D(tNormal, vUv + texel * vec2( 2.0,  0.0));
      vec4 wU = texture2D(tNormal, vUv + texel * vec2( 0.0, -2.0));
      vec4 wD = texture2D(tNormal, vUv + texel * vec2( 0.0,  2.0));

      float aMin = min(min(min(min(sC.a, s01.a), s21.a), s10.a), s12.a);
      if (aMin < 0.001) {
        gl_FragColor = col;
        return;
      }

      // Normal cross-difference at both scales
      float nH1  = 1.0 - dot(decN(s01), decN(s21));
      float nV1  = 1.0 - dot(decN(s10), decN(s12));
      float nD1  = 1.0 - dot(decN(s00), decN(s22));
      float nD2  = 1.0 - dot(decN(s20), decN(s02));
      float nH2  = 1.0 - dot(decN(wL),  decN(wR));
      float nV2  = 1.0 - dot(decN(wU),  decN(wD));
      float gN   = max(max(max(nH1, nV1), max(nD1, nD2)),
                       max(nH2, nV2)) * uNormalStrength;

      // Depth cross-difference at both scales
      float dH1  = abs(s01.a - s21.a);
      float dV1  = abs(s10.a - s12.a);
      float dD1d = abs(s00.a - s22.a);
      float dD2d = abs(s20.a - s02.a);
      float dH2  = abs(wL.a  - wR.a);
      float dV2  = abs(wU.a  - wD.a);
      float gD   = max(max(max(dH1, dV1), max(dD1d, dD2d)),
                       max(dH2, dV2)) * uDepthScale;

      float g = max(gN, gD);
      // Tight smoothstep: MSAA gives smooth edge placement,
      // narrow window snaps it to a crisp ~1px line.
      float edge = smoothstep(uEdgeLow, uEdgeLow + 0.05, g);

      // Debug 2: show edge mask only (white = edge)
      if (uDebugView == 2) { gl_FragColor = vec4(vec3(edge), 1.0); return; }

      gl_FragColor = vec4(mix(col.rgb, uEdgeColor, edge * 0.75), col.a);
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
  let fxaaPass: CustomFXAAPass | null = null;
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
    // lo = edge threshold (higher = fewer edges, only strong discontinuities).
    // The shader uses smoothstep(lo, lo+0.05, g) for a near-binary cutoff.
    const preset =
      q === 'high'
        ? { ns: 1.2, ds: 3.0, lo: 0.2, hi: 0.25 }
        : q === 'low'
          ? { ns: 0.8, ds: 1.8, lo: 0.35, hi: 0.4 }
          : { ns: 1.0, ds: 2.5, lo: 0.25, hi: 0.3 };
    const u = edgesPass.uniforms as {
      uNormalStrength: { value: number };
      uDepthScale: { value: number };
      uEdgeLow: { value: number };
      uEdgeHigh: { value: number };
      uDebugView: { value: number };
    };
    u.uNormalStrength.value = preset.ns;
    u.uDepthScale.value = preset.ds;
    u.uEdgeLow.value = preset.lo;
    u.uEdgeHigh.value = preset.hi;
    u.uDebugView.value = opts.debugView;
    if (fxaaPass) fxaaPass.setQuality(q);
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
    let sectionPlanes: THREE.Plane[] | null = null;
    scene.traverse((obj) => {
      if ((obj.name === 'shadow-ground' || obj.name === 'section-helper') && obj.visible) {
        obj.visible = false;
        tempHidden.push(obj);
      }
      // Section back-face cap meshes (added by section plugin to fill the
      // clipped interior) must not contribute to the normal buffer — their
      // back-facing normals make the Sobel pass paint outlines on the cut.
      if (obj.userData['__sectionBackface'] === true && obj.visible) {
        obj.visible = false;
        tempHidden.push(obj);
        return;
      }
      if (sectionPlanes === null && (obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        const cp = (mat as THREE.Material | undefined)?.clippingPlanes;
        if (cp && cp.length > 0) sectionPlanes = cp;
      }
    });

    // Sync section planes so the normal buffer only captures visible geometry.
    // Reference comparison: needsUpdate fires only when the array is replaced
    // (count changed); moved planes update uniforms automatically each frame.
    const nextPlanes: THREE.Plane[] | null = renderer.localClippingEnabled ? sectionPlanes : null;
    if (normalMaterial.clippingPlanes !== nextPlanes) {
      normalMaterial.clippingPlanes = nextPlanes;
      normalMaterial.needsUpdate = true;
    }

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

  const renderCompositeFrame = (): void => {
    if (!composer || !ctxRef) return;
    const { camera, renderer, scene } = ctxRef;
    const savedMask = camera.layers.mask;

    camera.layers.set(LAYER_DEFAULT);
    setShadowLinearBlend(1.0);
    try {
      if (opts.edges) renderNormalBuffer();
      composer.render();
    } catch {
      // Render targets may not be ready on first frame.
    }
    setShadowLinearBlend(0.0);

    camera.layers.set(LAYER_OVERLAY);
    const prevAutoClear = renderer.autoClear;
    const prevBg = scene.background;
    scene.background = null;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(scene, camera);
    renderer.autoClear = prevAutoClear;
    scene.background = prevBg;

    camera.layers.mask = savedMask;
  };

  const requestComposerFrame = (): void => {
    if (!composer || !opts.enabled) return;
    renderCompositeFrame();
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

      const msaaSamples = opts.quality === 'high' ? 8 : 4;

      composerTarget = new THREE.WebGLRenderTarget(w, h, {
        samples: msaaSamples,
        type: THREE.HalfFloatType,
      });

      // Normal buffer at 2x resolution, no MSAA. The 2x super-sample
      // eliminates the dotted-line artifact: sub-pixel edge positions
      // that fall between display pixels are captured at half-pixel
      // precision, producing solid continuous edges once the edge
      // shader samples back at display resolution.
      const normalScale = 2;
      normalTarget = new THREE.WebGLRenderTarget(w * normalScale, h * normalScale, {
        type: THREE.HalfFloatType,
      });

      normalMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uCameraNear: { value: 0.1 },
          uCameraFar: { value: 1000.0 },
        },
        vertexShader: /* glsl */ `
          #include <clipping_planes_pars_vertex>
          varying vec3 vWorldNormal;
          varying float vViewZ;
          void main() {
            vWorldNormal = normalize(mat3(modelMatrix) * normal);
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            vViewZ = -mvPosition.z;
            gl_Position = projectionMatrix * mvPosition;
            #include <clipping_planes_vertex>
          }
        `,
        fragmentShader: /* glsl */ `
          #include <clipping_planes_pars_fragment>
          uniform float uCameraNear;
          uniform float uCameraFar;
          varying vec3 vWorldNormal;
          varying float vViewZ;
          void main() {
            #include <clipping_planes_fragment>
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
      eu.resolution.value = new THREE.Vector2(w * normalScale, h * normalScale);
      eu.tNormal.value = normalTarget.texture;
      composer.addPass(edgesPass);

      fxaaPass = new CustomFXAAPass();
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
        renderCompositeFrame();
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
        if (normalTarget) normalTarget.setSize(nw * normalScale, nh * normalScale);
        if (edgesPass) {
          const u = edgesPass.uniforms as {
            resolution: { value: THREE.Vector2 };
          };
          u.resolution.value.set(nw * normalScale, nh * normalScale);
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
      ctx.commands.register('effects.debugView', () => {
        const next = ((opts.debugView + 1) % 4) as 0 | 1 | 2 | 3;
        const labels = ['normal', 'normals buffer', 'edge mask', 'no edges'] as const;
        api.setOptions({ debugView: next });
        // eslint-disable-next-line no-console
        console.log(`[effects] debug view: ${next} (${labels[next]})`);
        return next;
      }, { title: 'Cycle debug view (0=normal, 1=normals, 2=edge mask, 3=off)' });

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
