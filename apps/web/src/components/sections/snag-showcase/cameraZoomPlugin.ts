import type { Plugin, ViewerContext } from '@bimstitch/viewer';

export type CameraZoomOptions = {
  /**
   * Dolly fraction on narrow (mobile) screens, where the model is centered.
   * Positive = closer. Default 0.15 — a gentle fill of the shorter canvas.
   */
  factor?: number;
  /**
   * Dolly fraction on wide (desktop) screens. Positive = closer/larger. Default
   * 0.2 — the model reads a bit larger than the raw zoom-extents framing while
   * still sitting clear of the overlaid text on the left. Use 0 to keep the
   * zoom-extents size, or a negative value to push it further away / smaller.
   */
  factorWide?: number;
  /** Animate the camera moves (false under prefers-reduced-motion). Default true. */
  animate?: boolean;
  /**
   * On wide screens, shift the model to the RIGHT in screen space, as a fraction
   * of the visible half-width (so it clears the text overlaid on the left).
   * 0 = centered. Default 0.4 → model center lands at ~70% of the width.
   */
  panFraction?: number;
};

/**
 * Marketing-showcase camera helper. The built-in `camera` plugin frames the
 * model with a fixed padding and always centered (no prop to change either).
 * This registers `showcase.zoomIn` — issued in `onReady` right after
 * `camera.zoomExtents` settles — which:
 *   - (mobile) dollies the camera closer so the model fills the shorter canvas;
 *   - (desktop) shifts the model to the right via a horizontal focal offset so
 *     it clears the text overlaid on the left, while the full-bleed canvas stays
 *     fully interactive underneath.
 *
 * `setFocalOffset` only moves the camera EYE (not the orbit target), so idle
 * auto-rotate keeps spinning the model in place — it just renders off to the
 * right. Per camera-controls, +x moves the eye right → subject moves LEFT, so a
 * NEGATIVE x offset is what pushes the model right. Must run AFTER framing
 * (`camera.zoomExtents` resets the focal offset to 0). Kept dependency-free
 * (no `three` import) like the sibling `autoRotatePlugin` / `monochromeLookPlugin`.
 */
export function cameraZoomPlugin(options: CameraZoomOptions = {}): Plugin {
  const factor = options.factor ?? 0.15;
  const factorWide = options.factorWide ?? 0.2;
  const animate = options.animate ?? true;
  const panFraction = options.panFraction ?? 0.4;

  let ctx: ViewerContext | null = null;

  return {
    name: 'showcase-camera-zoom',
    install(context: ViewerContext): void {
      ctx = context;
      context.commands.register(
        'showcase.zoomIn',
        () => {
          if (ctx === null) return;
          const cc = ctx.cameraControls;
          const wide = typeof window !== 'undefined' && window.innerWidth >= 1024;

          const f = wide ? factorWide : factor;
          // Positive distance dollies toward the target (zoom in). Relative to
          // the settled framing distance, so it's model-size agnostic.
          if (f !== 0) void cc.dolly(cc.distance * f, animate);

          // Desktop: push the model to the right so it clears the left text.
          const cam = ctx.camera as unknown as {
            isPerspectiveCamera?: boolean;
            fov: number;
            aspect: number;
          };
          if (wide && panFraction !== 0 && cam.isPerspectiveCamera) {
            const halfV = (cam.fov * Math.PI) / 180 / 2;
            const halfH = Math.atan(Math.tan(halfV) * cam.aspect);
            const halfWidthWorld = cc.distance * Math.tan(halfH);
            // Negative x → eye moves left → model renders to the right.
            void cc.setFocalOffset(-halfWidthWorld * panFraction, 0, 0, animate);
          }

          ctx.requestRender();
        },
        { title: 'Frame the showcase camera (zoom + right-shift)' },
      );
    },
    uninstall(): void {
      ctx = null;
    },
  };
}
