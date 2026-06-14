// @vitest-environment happy-dom
import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventBus } from '../../../core/EventBus';
import type { ViewerContext, ViewerEvents } from '../../../core/types';
import { acquireCss2dOverlay, releaseCss2dOverlay } from './css2d-overlay';

/**
 * On-demand rendering coverage for the shared CSS2D overlay. The overlay used
 * to run a perpetual rAF loop per consuming plugin; it now repaints only when
 * the camera moves (one `camera:change` subscription for all consumers) or when
 * a plugin pokes a coalesced `requestRender()`. These tests pin that contract:
 * render on camera:change, coalesce requestRender to one rAF, and stop entirely
 * after release.
 *
 * Note: three's CSS2DRenderer defines `render` as an instance property (not on
 * the prototype), so we spy on `overlay.renderer.render` after acquiring.
 */
function makeCtx(): { ctx: ViewerContext; events: EventBus<ViewerEvents> } {
  const events = new EventBus<ViewerEvents>();
  const ctx = {
    container: document.createElement('div'),
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    events,
  } as unknown as ViewerContext;
  return { ctx, events };
}

const CAM_PAYLOAD = {
  position: { x: 0, y: 0, z: 0 },
  target: { x: 0, y: 0, z: 0 },
} as const;

describe('css2d-overlay (on-demand rendering)', () => {
  beforeEach(() => {
    // happy-dom has no ResizeObserver; the overlay constructs one.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe(): void {}
        unobserve(): void {}
        disconnect(): void {}
      },
    );
  });

  afterEach(() => {
    // Drop the singleton so each test starts clean (idempotent if already freed).
    releaseCss2dOverlay();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('repaints once per camera:change', () => {
    const { ctx, events } = makeCtx();
    const overlay = acquireCss2dOverlay(ctx);
    const spy = vi
      .spyOn(overlay.renderer, 'render')
      .mockImplementation(() => undefined);

    events.emit('camera:change', CAM_PAYLOAD);
    expect(spy).toHaveBeenCalledTimes(1);

    events.emit('camera:change', CAM_PAYLOAD);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('stops repainting after the last release (camera:change unsubscribed)', () => {
    const { ctx, events } = makeCtx();
    const overlay = acquireCss2dOverlay(ctx);
    const spy = vi
      .spyOn(overlay.renderer, 'render')
      .mockImplementation(() => undefined);

    releaseCss2dOverlay();
    events.emit('camera:change', CAM_PAYLOAD);
    expect(spy).not.toHaveBeenCalled();
  });

  it('coalesces multiple requestRender() calls into a single rAF render', () => {
    const cbs: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cbs.push(cb);
      return cbs.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});

    const { ctx } = makeCtx();
    const overlay = acquireCss2dOverlay(ctx);
    const spy = vi
      .spyOn(overlay.renderer, 'render')
      .mockImplementation(() => undefined);

    overlay.requestRender();
    overlay.requestRender();
    overlay.requestRender();
    expect(cbs).toHaveLength(1); // three pokes, one scheduled frame
    expect(spy).not.toHaveBeenCalled(); // nothing until the frame fires

    cbs[0]!(0); // flush the scheduled frame
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
