/**
 * Framework-free DOM controller for the interaction / selection overlay — the
 * shared piece behind the 3D `interaction` and 2D `interaction` plugins.
 *
 * When a host arms a pick ("Select the element to attach …"), this renders a
 * dimming scrim over the whole window that blocks pointer events on everything
 * EXCEPT the model viewport (the `holeEl`), plus a top-center instruction banner
 * with a cancel (×) button. The user can only click inside the model, so they
 * can't misclick the app chrome mid-pick.
 *
 * The scrim is built from rectangles (a four-rect frame around `holeEl` + one
 * rect re-covering each `blockedSelectors` match that overlaps the hole) rather
 * than a single transparent-window element, because the interactive region can
 * be non-rectangular: the portal's side panel sits ON TOP of the right edge of
 * the canvas, so "canvas minus panel" is an L-shape. Re-covering blocked
 * selectors keeps this layout-agnostic — the caller passes selectors, this knows
 * nothing about "SidePanel".
 *
 * No THREE, no React, no design tokens — viewer-internal DOM uses raw inline
 * styles (see `css2d-overlay.ts`, the entity-marker-2d tooltip). It appends to
 * `document.body` (NOT the viewer container) so it can cover host chrome that
 * lives outside the viewer's element.
 */

/** Common API the 3D + 2D interaction plugins both expose. */
export interface InteractionPluginAPI {
  isActive(): boolean;
}

export interface OverlayOptions {
  /** Instruction text — already translated; this module is string-agnostic. */
  message: string;
  /** Optional secondary line under the message. */
  hint?: string;
  /** Cursor applied to the hole element while armed. Default `'crosshair'`. */
  cursor?: string;
  /**
   * CSS selectors whose matched elements, where they overlap the hole, are
   * re-covered by scrim so they're dimmed AND inert (e.g. a side panel that
   * floats over the canvas). Matched fresh on every relayout.
   */
  blockedSelectors?: string[];
  /** Called on Esc or the banner × button. */
  onCancel: () => void;
}

export interface OverlayController {
  /** Update the banner text in place (e.g. multi-step picks). */
  setMessage(message: string, hint?: string): void;
  /** Remove all DOM, observers and listeners; restore the cursor. Idempotent. */
  destroy(): void;
}

/** Above app chrome but below the absolute max so devtools/portals can layer. */
const Z_INDEX = 2147483600;
const DIM = 'rgba(15,23,42,0.45)';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Intersection of a DOMRect with a box, or null if they don't overlap. */
function intersect(
  a: DOMRect,
  b: { left: number; top: number; right: number; bottom: number },
): Rect | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}

export function mountInteractionOverlay(
  holeEl: HTMLElement,
  opts: OverlayOptions,
): OverlayController {
  let destroyed = false;
  const prevCursor = holeEl.style.cursor;
  holeEl.style.cursor = opts.cursor ?? 'crosshair';

  const root = document.createElement('div');
  root.style.cssText = `position:fixed;inset:0;z-index:${Z_INDEX};pointer-events:none;`;

  const mkDim = (): HTMLDivElement => {
    const d = document.createElement('div');
    d.style.cssText = `position:fixed;background:${DIM};pointer-events:auto;`;
    root.appendChild(d);
    return d;
  };
  // Static four-rect frame around the hole; blocked rects are pooled per layout.
  const frameTop = mkDim();
  const frameBottom = mkDim();
  const frameLeft = mkDim();
  const frameRight = mkDim();
  let blockDivs: HTMLDivElement[] = [];

  // Thin ring just inside the hole edge — a visual cue for the active area.
  const ring = document.createElement('div');
  ring.style.cssText =
    'position:fixed;pointer-events:none;box-sizing:border-box;' +
    'border:2px solid rgba(96,165,250,0.9);box-shadow:0 0 0 1px rgba(15,23,42,0.35);';
  root.appendChild(ring);

  // Instruction banner, top-center over the hole.
  const banner = document.createElement('div');
  banner.style.cssText =
    'position:fixed;transform:translateX(-50%);display:flex;align-items:center;gap:12px;' +
    'max-width:80vw;padding:9px 10px 9px 16px;border-radius:9px;pointer-events:auto;' +
    'background:rgba(15,23,42,0.94);color:#fff;box-shadow:0 6px 20px rgba(0,0,0,0.35);' +
    'font:500 13px/1.3 ui-sans-serif,system-ui,-apple-system,sans-serif;';
  const textWrap = document.createElement('div');
  textWrap.style.cssText = 'display:flex;flex-direction:column;gap:2px;min-width:0;';
  const msgEl = document.createElement('span');
  msgEl.style.cssText =
    'font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  const hintEl = document.createElement('span');
  hintEl.style.cssText =
    'font-weight:400;font-size:11px;color:rgba(226,232,240,0.85);' +
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  textWrap.appendChild(msgEl);
  textWrap.appendChild(hintEl);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Cancel');
  closeBtn.style.cssText =
    'flex:none;display:inline-flex;align-items:center;justify-content:center;' +
    'width:22px;height:22px;border:0;border-radius:6px;cursor:pointer;' +
    'background:rgba(255,255,255,0.14);color:#fff;font-size:13px;line-height:1;';
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    opts.onCancel();
  });

  banner.appendChild(textWrap);
  banner.appendChild(closeBtn);
  root.appendChild(banner);

  const setText = (message: string, hint?: string): void => {
    msgEl.textContent = message;
    msgEl.style.display = message ? '' : 'none';
    if (hint) {
      hintEl.textContent = hint;
      hintEl.style.display = '';
    } else {
      hintEl.textContent = '';
      hintEl.style.display = 'none';
    }
  };
  setText(opts.message, opts.hint);

  const place = (d: HTMLElement, r: Rect): void => {
    d.style.left = `${r.left}px`;
    d.style.top = `${r.top}px`;
    d.style.width = `${Math.max(0, r.width)}px`;
    d.style.height = `${Math.max(0, r.height)}px`;
  };

  let rafId = 0;
  const layout = (): void => {
    rafId = 0;
    if (destroyed) return;
    const h = holeEl.getBoundingClientRect();
    const W = window.innerWidth;
    const H = window.innerHeight;

    place(frameTop, { left: 0, top: 0, width: W, height: h.top });
    place(frameBottom, { left: 0, top: h.bottom, width: W, height: H - h.bottom });
    place(frameLeft, { left: 0, top: h.top, width: h.left, height: h.height });
    place(frameRight, { left: h.right, top: h.top, width: W - h.right, height: h.height });
    place(ring, { left: h.left, top: h.top, width: h.width, height: h.height });

    // Re-cover blocked selectors that overlap the hole (rebuilt each layout so
    // a panel that opens/resizes mid-pick is tracked).
    for (const d of blockDivs) d.remove();
    blockDivs = [];
    for (const sel of opts.blockedSelectors ?? []) {
      for (const el of Array.from(document.querySelectorAll(sel))) {
        const clip = intersect((el as HTMLElement).getBoundingClientRect(), {
          left: h.left,
          top: h.top,
          right: h.right,
          bottom: h.bottom,
        });
        if (!clip) continue;
        const bd = document.createElement('div');
        bd.style.cssText = `position:fixed;background:${DIM};pointer-events:auto;`;
        place(bd, clip);
        root.appendChild(bd);
        blockDivs.push(bd);
      }
    }

    banner.style.left = `${h.left + h.width / 2}px`;
    banner.style.top = `${h.top + 16}px`;
  };

  const schedule = (): void => {
    if (!rafId && !destroyed) rafId = requestAnimationFrame(layout);
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      opts.onCancel();
    }
  };

  const ro = new ResizeObserver(schedule);
  ro.observe(holeEl);
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, true);
  window.addEventListener('keydown', onKey, true);

  document.body.appendChild(root);
  layout();

  return {
    setMessage(message: string, hint?: string): void {
      if (destroyed) return;
      setText(message, hint);
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      if (rafId) cancelAnimationFrame(rafId);
      ro.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('keydown', onKey, true);
      root.remove();
      holeEl.style.cursor = prevCursor;
    },
  };
}
