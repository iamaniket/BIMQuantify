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
import { diag } from '../../../core/diagResolution.js'; // DIAG: remove after debugging
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
  /**
   * Paint exactly one idle-quality composite immediately, WITHOUT waking the
   * base renderer (no `markActive`). Returns `true` if it composited, `false`
   * if the composite path is unavailable (effects disabled, x-ray active, or
   * not yet built) — in which case the caller should fall back to a base
   * render. Lets the motion→idle and post-shadow-bake transitions be a single
   * clean frame instead of a base-render burst painted over the composite.
   */
  recomposite(): boolean;
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
    // DIAG: composite frames — base DPR + actual backing-store size on screen.
    diag(
      `composite baseDPR=${renderer.getPixelRatio().toFixed(3)} ` +
        `buf=${renderer.domElement.width}x${renderer.domElement.height}`,
    );
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

  // Paint one composite now if the composite path is live. Returns whether it
  // actually painted, so callers can fall back to a base render when it didn't.
  const composeNow = (): boolean => {
    if (!composer || !opts.enabled || xrayActive) return false;
    renderCompositeFrame();
    return true;
  };

  const requestComposerFrame = (): void => {
    composeNow();
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

    recomposite() {
      return composeNow();
    },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

      const renderer = ctx.renderer;
      const scene = ctx.scene;
      const camera = ctx.camera;

      const size = renderer.getSize(new THREE.Vector2());
      // Size the composite to the stable full-quality DPR, never the live
      // renderer.getPixelRatio() — interactive-performance lowers that during
      // motion, and the composite only ever runs on idle (full quality). Reading
      // the live value here latches the lowered ratio after a mid-motion resize.
      const dpr = ctx.getBasePixelRatio();
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

      // No perpetual rAF: the viewer renders on demand and parks the base
      // renderer in MANUAL once `viewer:idle` fires, so a single composite on
      // idle (and on x-ray clear / resize / setOptions) is enough — nothing
      // overwrites it until the next motion. During motion the cheap base
      // render runs and the composite is skipped (isIdle === false).

      const onResize = (): void => {
        if (!composer || !renderer) return;
        const s = renderer.getSize(new THREE.Vector2());
        // Stable base DPR, not the live (possibly motion-lowered) value.
        const r = ctx.getBasePixelRatio();
        const nw = Math.round(s.x * r);
        const nh = Math.round(s.y * r);
        composer.setSize(s.x, s.y);
        composer.setPixelRatio(r);
        if (fxaaPass) fxaaPass.setSize(nw, nh);
        // Re-composite the resized frame if we're sitting idle.
        if (isIdle) requestComposerFrame();
      };
      const ro = new ResizeObserver(onResize);
      ro.observe(ctx.canvas);

      cleanup = (): void => {
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
      // Paint one idle-quality composite without waking the base renderer.
      // Returns whether it painted (false when suppressed / unavailable).
      ctx.commands.register('effects.recomposite', () => api.recomposite(), {
        title: 'Repaint the idle composite once',
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
