import type { Plugin, ViewerContext, Vec3 } from '@bimdossier/viewer';

/** A placed snag: its anchor in the model's LOCAL frame + which model it's on. */
export type SnagAnchor = { id: string; position: Vec3; modelId: string };

/**
 * The current "spotlit" snag — the one closest to the camera — and where its pin
 * projects on screen (CSS px relative to the canvas/container top-left). `null`
 * when there are no anchors yet.
 */
export type SnagSpotlight = { id: string; x: number; y: number };

export type SnagSpotlightOptions = {
  /** Reported on every camera move with the frontmost snag + its screen position. */
  onSpotlight: (spotlight: SnagSpotlight | null) => void;
};

// The frontmost snag must be at least this much closer than the current active
// one to steal the spotlight. Stops the popover flickering between two snags at
// near-equal depth as the turntable spins. 0.9 = "10% closer wins".
const SWITCH_MARGIN = 0.9;

/**
 * Marketing-showcase snag spotlight. Sibling of `snagPlacementPlugin` — once the
 * snags are placed (SnagViewer calls `showcase.setSnagAnchors`), this watches the
 * camera and, on every `camera:change` (the idle turntable spins continuously),
 * reports the snag whose pin is CLOSEST to the camera — i.e. the one currently
 * facing the viewer — plus where that pin projects on screen.
 *
 * SnagViewer renders a single popover card over that pin (it pulses, and closes
 * when the next snag rotates to the front). All the per-frame camera math lives
 * here because only a plugin has `ctx.camera` / `ctx.canvas`; the host just gets a
 * snag id + screen point and positions a React card.
 */
export function snagSpotlightPlugin(options: SnagSpotlightOptions): Plugin {
  let ctx: ViewerContext | null = null;
  let anchors: SnagAnchor[] = [];
  let activeId: string | null = null;
  let offCameraChange: (() => void) | null = null;

  const recompute = (): void => {
    if (ctx === null) return;
    if (anchors.length === 0) {
      activeId = null;
      options.onSpotlight(null);
      return;
    }
    const { camera } = ctx;
    const camPos = camera.position;

    // Single demo model — read its (static) world matrix to re-base the LOCAL
    // anchors. Identity for the coordinate-base model; correct if it ever shifts.
    const first = anchors[0];
    if (first === undefined) {
      options.onSpotlight(null);
      return;
    }
    const model = ctx.models().get(first.modelId);
    const obj = model ? model.object : null;
    if (obj) obj.updateWorldMatrix(true, false);

    // World position + camera distance for every anchor. Borrow the camera's
    // Vector3 as scratch so we don't import three (matches the sibling plugins).
    const worlds = anchors.map((a) => {
      const v = camPos.clone();
      v.set(a.position.x, a.position.y, a.position.z);
      if (obj) v.applyMatrix4(obj.matrixWorld);
      return {
        id: a.id, wx: v.x, wy: v.y, wz: v.z, d: v.distanceTo(camPos),
      };
    });

    let closest = worlds[0];
    if (!closest) {
      options.onSpotlight(null);
      return;
    }
    for (const w of worlds) {
      if (w.d < closest.d) closest = w;
    }

    // Hysteresis: hold the current active snag until another is decisively closer.
    let chosen = closest;
    if (activeId !== null) {
      const active = worlds.find((w) => w.id === activeId);
      if (active) {
        if (closest.id === activeId) chosen = active;
        else if (closest.d < active.d * SWITCH_MARGIN) chosen = closest;
        else chosen = active;
      }
    }
    activeId = chosen.id;

    // Project the chosen pin to screen px relative to the canvas top-left (which,
    // with the full-bleed canvas, equals the container the popover lives in).
    const ndc = camPos.clone();
    ndc.set(chosen.wx, chosen.wy, chosen.wz).project(camera);
    const rect = ctx.canvas.getBoundingClientRect();
    options.onSpotlight({
      id: chosen.id,
      x: (ndc.x * 0.5 + 0.5) * rect.width,
      y: (-ndc.y * 0.5 + 0.5) * rect.height,
    });
  };

  return {
    name: 'showcase-snag-spotlight',
    install(context: ViewerContext): void {
      ctx = context;
      context.commands.register(
        'showcase.setSnagAnchors',
        (args: unknown) => {
          anchors = Array.isArray(args) ? (args as SnagAnchor[]) : [];
          activeId = null;
          recompute();
        },
        { title: 'Set the demo snag anchors for the camera spotlight' },
      );
      // The idle turntable spins the camera continuously, so `camera:change`
      // fires every frame — re-pick the frontmost snag each time.
      offCameraChange = context.events.on('camera:change', recompute);
    },
    uninstall(): void {
      if (offCameraChange !== null) offCameraChange();
      offCameraChange = null;
      anchors = [];
      activeId = null;
      ctx = null;
    },
  };
}
