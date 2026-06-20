import type { Plugin, ViewerContext } from '@bimstitch/viewer';

export type CameraZoomOptions = {
  /**
   * Dolly fraction on narrow (mobile) screens, where the model is centered.
   * Positive = closer/bigger, as a fraction of the auto-fit distance. Default 0.2.
   */
  factor?: number;
  /**
   * Dolly fraction on wide (desktop) screens. Positive = closer/bigger. Default
   * 0.3 — the model reads clearly larger than a plain fit while still clearing
   * the text overlaid on the left.
   */
  factorWide?: number;
  /**
   * Animate the camera move. Default FALSE — the model just appears already
   * framed, then the idle turntable takes over. Instant framing is robust: it
   * lands before the auto-rotate starts spinning (an animated transition can be
   * snapped by the per-frame `cc.rotate`), and it doesn't depend on rAF.
   */
  animate?: boolean;
  /**
   * Extra "make it bigger" multiplier on top of the dolly framing — the model's
   * on-screen size is scaled by this (distance ÷ sizeBoost). Default 1.2 (20%
   * bigger). The right-shift is NOT done here: it's a CSS `padding-left` on the
   * canvas in SnagViewer (desktop only), so the model stays camera-centered and
   * the focal offset is always cleared.
   */
  sizeBoost?: number;
  /**
   * Camera tilt in degrees (polar angle: 0 = top-down, 90 = dead-on side).
   * Default 90 — dead-level, looking at the building straight from the side.
   */
  polarDeg?: number;
  /**
   * Horizontal facing in degrees (azimuth). Default 45 — a 3/4 corner view. The
   * idle turntable spins this, so it only sets the first frame.
   */
  azimuthDeg?: number;
};

/** camera-controls `ACTION` enum, read off the controls' constructor so we don't
 *  import the library (keeps this plugin dependency-free like its siblings). */
type ActionEnum = Record<string, number>;
const actionEnum = (cc: unknown): ActionEnum | null =>
  (cc as { constructor?: { ACTION?: ActionEnum } }).constructor?.ACTION ?? null;

type Box = { min: { x: number; y: number; z: number }; max: { x: number; y: number; z: number } };

/**
 * Marketing-showcase camera setup. The built-in `camera` plugin only frames the
 * model centered with a fixed padding; this plugin tailors that into the hero
 * look and locks the controls to a rotate-only turntable.
 *
 * `showcase.zoomIn` (issued once in `onReady`) frames the model in a SINGLE,
 * self-contained move computed from the model's world box — it does NOT depend on
 * a prior `camera.zoomExtents` settling (awaiting that animated command is
 * fragile: if it resolves before the box is ready, or its transition is
 * interrupted, the refinement never lands and the model shows the raw centered
 * framing). It:
 *   - puts the orbit TARGET on the model center (so the idle auto-rotate spins
 *     the model about its own center);
 *   - places the eye at `polarDeg` tilt / `azimuthDeg` facing, at a distance that
 *     fits the model then dollies in by `factorWide`/`factor` × `sizeBoost`
 *     (bigger); the model stays CAMERA-CENTERED (focal offset always 0).
 *
 * The right-shift is done in CSS (a `padding-left` on the canvas, desktop only —
 * see SnagViewer), not the camera, so it never pushes the model off a phone
 * screen and the turntable keeps spinning about the model's own center.
 *
 * `install` also locks TOUCH input to one-finger-rotate only (two/three-finger =
 * none), disabling pinch-zoom and two-finger pan on mobile. Mouse buttons are
 * locked to rotate-only via the `<IfcViewer controls>` prop in SnagViewer (the
 * prop covers mouse but not touch — hence the touch lock here).
 */
export function cameraZoomPlugin(options: CameraZoomOptions = {}): Plugin {
  const factor = options.factor ?? 0.2;
  const factorWide = options.factorWide ?? 0.3;
  const animate = options.animate ?? false;
  const sizeBoost = options.sizeBoost ?? 1.2;
  const polarRad = ((options.polarDeg ?? 90) * Math.PI) / 180;
  const azimuthRad = ((options.azimuthDeg ?? 45) * Math.PI) / 180;

  let ctx: ViewerContext | null = null;
  let offModelLoaded: (() => void) | null = null;

  return {
    name: 'showcase-camera-zoom',
    install(context: ViewerContext): void {
      ctx = context;

      // Rotate-only on touch: one finger orbits, two/three fingers do nothing
      // (no pinch-zoom, no two-finger pan). Mirrors the mouse lock set via the
      // controls prop, which can't reach touch.
      const cc = context.cameraControls as unknown as {
        touches: { one: number; two: number; three: number };
      };
      const ACTION = actionEnum(context.cameraControls);
      if (ACTION) {
        cc.touches.one = ACTION['TOUCH_ROTATE'] ?? cc.touches.one;
        cc.touches.two = ACTION['NONE'] ?? cc.touches.two;
        cc.touches.three = ACTION['NONE'] ?? cc.touches.three;
      }

      const frame = async (): Promise<void> => {
          if (ctx === null) return;
          const controls = ctx.cameraControls;
          const box = await ctx.commands.execute<undefined, Box | null>('camera.getSceneBox');
          if (!box) return;

          // Model center + bounding-sphere radius.
          const cx = (box.min.x + box.max.x) / 2;
          const cy = (box.min.y + box.max.y) / 2;
          const cz = (box.min.z + box.max.z) / 2;
          const r =
            Math.hypot(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z) / 2;
          if (r <= 0) return;

          const wide = typeof window !== 'undefined' && window.innerWidth >= 1024;
          const cam = ctx.camera as unknown as { fov: number; aspect: number };
          const halfV = ((cam.fov ?? 60) * Math.PI) / 180 / 2;
          const halfH = Math.atan(Math.tan(halfV) * (cam.aspect ?? 1));
          // Distance that fits the sphere in the limiting (smaller) half-angle.
          const fitHalf = Math.min(halfV, halfH);
          const d0 = r / Math.sin(fitHalf);
          const f = wide ? factorWide : factor;
          // Dolly in by the framing fraction, then divide by sizeBoost so the
          // model reads `sizeBoost`× bigger (1.12 → +12%).
          const dd = (d0 * (1 - f)) / sizeBoost;

          // Eye on the (azimuth, polar) sphere around the center, distance dd.
          // camera-controls / three Spherical, Y-up:
          //   x = sinφ·sinθ, y = cosφ, z = sinφ·cosθ.
          const sinP = Math.sin(polarRad);
          const ex = cx + dd * sinP * Math.sin(azimuthRad);
          const ey = cy + dd * Math.cos(polarRad);
          const ez = cz + dd * sinP * Math.cos(azimuthRad);
          void controls.setLookAt(ex, ey, ez, cx, cy, cz, animate);
          // Keep the model camera-centered; the right-shift is the CSS
          // padding-left on the canvas (SnagViewer, desktop only).
          void controls.setFocalOffset(0, 0, 0, animate);

          ctx.requestRender();
      };

      context.commands.register('showcase.zoomIn', frame, {
        title: 'Frame the showcase camera (center pivot + tilt + zoom)',
      });

      // Frame on every model load. `model:loaded` is emitted inside the viewer's
      // loadFragments AFTER its built-in centered `frameModel`, so framing here
      // reliably overrides that fit — and unlike the host's `onReady`, it always
      // runs (no race, survives the streaming model load) and re-applies on any
      // remount. This is what actually makes the tilt/zoom stick.
      offModelLoaded = context.events.on('model:loaded', () => {
        void frame();
      });
    },
    uninstall(): void {
      offModelLoaded?.();
      offModelLoaded = null;
      ctx = null;
    },
  };
}
