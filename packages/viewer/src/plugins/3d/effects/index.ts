/**
 * Effects plugin — MSAA + FXAA composite on the idle frame.
 *
 * Pipeline: RenderPass (color, MSAA) → FXAAPass → OutputPass.
 *
 * Silhouette edges used to be drawn here with a normal-buffer Sobel pass,
 * but that screen-space look was replaced by the geometry-based `outline`
 * plugin, which draws real, correctly-occluded edge lines on the idle frame.
 *
 * Render strategy: gated on `viewer:idle` and driven by a small RAF loop so
 * the post composite only runs while the camera is still. During motion the
 * base SimpleRenderer keeps doing its cheap render and post effects cost
 * nothing.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { LAYER_DEFAULT, LAYER_OVERLAY } from '../../../core/layers.js';
import type { Plugin, ViewerContext } from '../../../core/types.js';
import { CustomFXAAPass } from './fxaa.js';
import type { EffectsOptions, EffectsQuality } from './types.js';

const NAME = 'effects' as const;

const DEFAULTS: Required<EffectsOptions> = {
  enabled: true,
  quality: 'medium',
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
  let fxaaPass: CustomFXAAPass | null = null;
  let composerTarget: THREE.WebGLRenderTarget | null = null;

  let isIdle = false;
  let xrayActive = false;
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

  const tuneQuality = (): void => {
    if (fxaaPass) fxaaPass.setQuality(opts.quality);
  };

  const renderCompositeFrame = (): void => {
    if (!composer || !ctxRef) return;
    const { camera, renderer, scene } = ctxRef;
    const savedMask = camera.layers.mask;

    camera.layers.set(LAYER_DEFAULT);
    setShadowLinearBlend(1.0);
    try {
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
    if (!composer || !opts.enabled || xrayActive) return;
    renderCompositeFrame();
  };

  const api: Plugin & EffectsPluginAPI = {
    name: NAME,

    getOptions() {
      return { ...opts };
    },

    setOptions(next: EffectsOptions) {
      opts = { ...opts, ...next };
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

      composer = new EffectComposer(renderer, composerTarget);
      composer.setSize(size.x, size.y);
      composer.setPixelRatio(dpr);

      composer.addPass(new RenderPass(scene, camera));

      fxaaPass = new CustomFXAAPass();
      fxaaPass.setSize(w, h);
      composer.addPass(fxaaPass);

      composer.addPass(new OutputPass());

      tuneQuality();

      const onCamChange = (): void => {
        isIdle = false;
      };
      const onIdle = (): void => {
        isIdle = true;
        requestComposerFrame();
      };

      const offCam = ctx.events.on('camera:change', onCamChange);
      const offIdle = ctx.events.on('viewer:idle', onIdle);
      const offXray = ctx.events.on('xray:change', ({ xrayed }) => {
        const wasActive = xrayActive;
        xrayActive = xrayed.length > 0;
        // Resume the composite when x-ray clears.
        if (wasActive && !xrayActive && isIdle) requestComposerFrame();
      });

      let raf = 0;
      const loop = (): void => {
        raf = requestAnimationFrame(loop);
        if (!opts.enabled || !isIdle || !composer || xrayActive) return;
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
      };
      const ro = new ResizeObserver(onResize);
      ro.observe(ctx.canvas);

      cleanup = (): void => {
        cancelAnimationFrame(raf);
        offCam();
        offIdle();
        offXray();
        ro.disconnect();

        composer?.dispose();
        composer = null;
        fxaaPass?.dispose?.();
        fxaaPass = null;
        composerTarget?.dispose();
        composerTarget = null;
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
