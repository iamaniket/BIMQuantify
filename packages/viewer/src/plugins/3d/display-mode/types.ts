/**
 * The single mutually-exclusive viewer display mode surfaced by the
 * `display-mode` plugin. `xray` is delegated to the `xray` plugin; the other
 * non-`normal` values are {@link MaterialLook}s applied via `ctx.setActiveLook`.
 */
export type DisplayMode = 'normal' | 'xray' | 'monochrome' | 'clay' | 'matcap';

/** Every selectable mode, in cycle order (`display.cycle`). */
export const DISPLAY_MODES: readonly DisplayMode[] = [
  'normal',
  'xray',
  'monochrome',
  'clay',
  'matcap',
] as const;
