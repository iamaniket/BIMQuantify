import type { Plugin, ViewerContext } from '@bimstitch/viewer';

export type AutoRotateOptions = {
  /** Azimuth radians per second. Default 0.18 — a slow turntable. */
  speed?: number;
  /** Resume this many ms after the user stops dragging. Default 2000. */
  resumeDelayMs?: number;
};

/**
 * Gentle idle auto-rotate for the marketing 3D showcase. The viewer renders
 * on-demand (parks in MANUAL mode when idle), so each frame advances the camera
 * azimuth and calls `ctx.requestRender()` to wake it. Spinning pauses while the
 * user is dragging (camera-controls `controlstart`) and while the host signals a
 * hover via the `auto-rotate.setPaused` command, resuming after a short idle so
 * manual orbit always wins. Registered through `<IfcViewer plugins={[...]}>`;
 * omit it entirely to disable (e.g. `prefers-reduced-motion`).
 */
export function autoRotatePlugin(options: AutoRotateOptions = {}): Plugin {
  const speed = options.speed ?? 0.18;
  const resumeDelayMs = options.resumeDelayMs ?? 2000;

  let ctx: ViewerContext | null = null;
  let raf = 0;
  let last = 0;
  let hoverPaused = false;
  let interacting = false;
  let resumeTimer: ReturnType<typeof setTimeout> | null = null;
  const onStart = (): void => {
    interacting = true;
    if (resumeTimer) {
      clearTimeout(resumeTimer);
      resumeTimer = null;
    }
  };
  const onEnd = (): void => {
    if (resumeTimer) clearTimeout(resumeTimer);
    resumeTimer = setTimeout(() => {
      interacting = false;
    }, resumeDelayMs);
  };

  const tick = (now: number): void => {
    raf = requestAnimationFrame(tick);
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    if (ctx === null || hoverPaused || interacting || dt <= 0) return;
    // Azimuth only → a clean turntable. Fire-and-forget, then wake the renderer.
    void ctx.cameraControls.rotate(speed * dt, 0, false);
    ctx.requestRender();
  };

  return {
    name: 'auto-rotate',
    install(context: ViewerContext): void {
      ctx = context;
      context.cameraControls.addEventListener('controlstart', onStart);
      context.cameraControls.addEventListener('controlend', onEnd);
      context.commands.register(
        'auto-rotate.setPaused',
        (args: unknown) => {
          hoverPaused = Boolean((args as { paused?: boolean } | undefined)?.paused);
        },
        { title: 'Pause or resume idle auto-rotate' },
      );
      last = 0;
      raf = requestAnimationFrame(tick);
    },
    uninstall(): void {
      cancelAnimationFrame(raf);
      if (resumeTimer) clearTimeout(resumeTimer);
      if (ctx !== null) {
        ctx.cameraControls.removeEventListener('controlstart', onStart);
        ctx.cameraControls.removeEventListener('controlend', onEnd);
      }
      ctx = null;
    },
  };
}
