/**
 * Nav-compass widget — the 2D analog of the 3D ViewCube. A small fixed-corner
 * orientation dial for the PDF viewer, composed of layered DOM:
 *   element (div)
 *   ├── svg
 *   │   ├── face + inner ring        — drag to rotate (snaps on release)
 *   │   ├── <g class="dial">         — rotating North pointer (current page top)
 *   │   ├── <g class="cardinals">    — fixed N/E/S/W snap buttons
 *   │   └── <text> readout           — current angle, e.g. "90°"
 *   └── home button (div)            — reset to 0° (North-up)
 *
 * Communication is callback-based — the widget never touches engine state. The
 * plugin (`./index.ts`) wires the callbacks to the `rotate.to` command, mirroring
 * how `ViewCubeWidget` is wired to `camera.*`. Page rotation is 90°-only, so the
 * drag previews a continuous angle and commits the nearest quarter-turn.
 */

import type { DocumentRotation } from '../../../pdf-core/documentTypes.js';
import {
  cardinalToRotation,
  pointerAngleDeg,
  rotationLabel,
  rotationToCardinal,
  shortestAngleDelta,
  snapToQuarter,
  type Cardinal,
} from './geometry.js';

export type NavCompassLocale = 'en' | 'nl';

interface NavCompassLabels {
  cardinals: Record<Cardinal, string>;
  home: string;
  homeAria: string;
  ringAria: string;
}

const LABELS: Record<NavCompassLocale, NavCompassLabels> = {
  en: {
    cardinals: { N: 'N', E: 'E', S: 'S', W: 'W' },
    home: 'Reset rotation',
    homeAria: 'Reset rotation',
    ringAria: 'Drag to rotate the page',
  },
  // Dutch cardinals: Noord / Oost / Zuid / West.
  nl: {
    cardinals: { N: 'N', E: 'O', S: 'Z', W: 'W' },
    home: 'Rotatie herstellen',
    homeAria: 'Rotatie herstellen',
    ringAria: 'Sleep om de pagina te draaien',
  },
};

export interface NavCompassWidgetOptions {
  size: number;
  locale: NavCompassLocale;
  /** Cardinal click + drag-release commit. Omit for a static north compass. */
  onRotateTo?: (rotation: DocumentRotation) => void;
  /** Center home button → reset to 0°. Omit for a static north compass. */
  onHome?: () => void;
  /**
   * Static true-north mode: when set, the widget is non-interactive and the
   * whole rose (North pointer + cardinals) is oriented so N points at this
   * bearing (degrees clockwise from up). Used by the floor plan, which never
   * rotates — so the dial shows the building's true north rather than page
   * rotation. The center readout shows the bearing.
   */
  northDeg?: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

const FACE_FILL = 'rgba(245,247,250,0.95)';
const FACE_STROKE = '#c8cfd8';
const INNER_STROKE = '#dde2ea';
const TEXT_COLOR = '#4b5563';
const ACCENT = '#2563eb'; // North pointer + active cardinal
const HOVER = '#6cb4ff'; // matches ViewCubeWidget hover accent
const FONT = 'system-ui, -apple-system, sans-serif';

/** Angular movement (deg) past which a ring gesture counts as a drag, not a tap. */
const DRAG_DEADZONE_DEG = 4;

function svgEl<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

export class NavCompassWidget {
  readonly element: HTMLDivElement;

  private readonly options: NavCompassWidgetOptions;
  private readonly labels: NavCompassLabels;
  private readonly size: number;
  private readonly cx: number;
  private readonly cy: number;

  private readonly svg: SVGSVGElement;
  private readonly dial: SVGGElement;
  private cardinalsGroup: SVGGElement | null = null;
  private readonly readout: SVGTextElement;
  private readonly cardinalText = new Map<Cardinal, SVGTextElement>();

  private readonly cleanups: Array<() => void> = [];

  /** Static true-north mode (non-interactive; the rose points at a fixed bearing). */
  private readonly isStatic: boolean;

  private rotation: DocumentRotation = 0;

  // Ring-drag state.
  private ringDragging = false;
  private ringPointerId = -1;
  private ringLastAngle = 0;
  private previewDeg = 0;
  private dragStartRotation: DocumentRotation = 0;
  private dragMoved = false;

  private disposed = false;

  constructor(options: NavCompassWidgetOptions) {
    this.options = options;
    this.labels = LABELS[options.locale] ?? LABELS.en;
    this.size = options.size;
    this.cx = options.size / 2;
    this.cy = options.size / 2;
    this.isStatic = options.northDeg !== undefined;

    this.element = document.createElement('div');
    this.element.dataset.navCompass = 'true';
    this.applyWrapperStyles();

    this.svg = this.buildSvg();
    this.element.appendChild(this.svg);

    this.buildFace();
    this.dial = this.buildDial();
    this.svg.appendChild(this.dial);
    this.cardinalsGroup = this.buildCardinals();
    this.readout = this.buildReadout();
    this.svg.appendChild(this.readout);

    if (this.isStatic) {
      // Non-interactive true-north dial: no ring drag / home button, cursor
      // stays default, and the rose is oriented to the bearing once.
      this.svg.style.cursor = 'default';
      this.applyRotation(options.northDeg ?? 0);
    } else {
      this.element.appendChild(this.buildHomeButton());
      this.attachRingHandlers();
      this.applyRotation(0);
    }
  }

  /** Reflect the engine's rotation. No-ops mid-drag so the echo can't fight the preview. */
  syncTo(rotation: DocumentRotation): void {
    if (this.disposed || this.ringDragging || this.isStatic) return;
    this.rotation = rotation;
    this.applyRotation(rotation);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.cleanups.splice(0)) off();
    this.element.remove();
  }

  // ─── construction ────────────────────────────────────────────────

  private buildSvg(): SVGSVGElement {
    const svg = svgEl('svg', {
      width: this.size,
      height: this.size,
      viewBox: `0 0 ${String(this.size)} ${String(this.size)}`,
    });
    Object.assign(svg.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'auto',
      touchAction: 'none',
      cursor: 'grab',
    } as Partial<CSSStyleDeclaration>);
    return svg;
  }

  private buildFace(): void {
    this.svg.appendChild(
      svgEl('circle', {
        cx: this.cx,
        cy: this.cy,
        r: this.size * 0.46,
        fill: FACE_FILL,
        stroke: FACE_STROKE,
        'stroke-width': 1.5,
      }),
    );
    this.svg.appendChild(
      svgEl('circle', {
        cx: this.cx,
        cy: this.cy,
        r: this.size * 0.34,
        fill: 'none',
        stroke: INNER_STROKE,
        'stroke-width': 1,
      }),
    );
  }

  /**
   * The rotating orientation marker. It is a triangle that rides a circular track
   * centred on the pivot `(cx, cy)` — pointing outward (North/up at 0°). Because
   * every vertex sits on that centred track, rotating the group around `(cx, cy)`
   * keeps the marker on the ring: it can never drift off-centre or swing outside
   * the dial. The centre is left free for the readout.
   */
  private buildDial(): SVGGElement {
    const g = svgEl('g', {});
    g.style.pointerEvents = 'none';
    const tipR = this.size * 0.33; // outer vertex (just inside the cardinals)
    const baseR = this.size * 0.22; // inner edge of the marker
    const halfW = this.size * 0.05;
    g.appendChild(
      svgEl('polygon', {
        points: [
          `${String(this.cx)},${String(this.cy - tipR)}`,
          `${String(this.cx - halfW)},${String(this.cy - baseR)}`,
          `${String(this.cx + halfW)},${String(this.cy - baseR)}`,
        ].join(' '),
        fill: ACCENT,
      }),
    );
    return g;
  }

  private buildCardinals(): SVGGElement {
    const g = svgEl('g', {});
    const r = this.size * 0.38;
    const positions: { c: Cardinal; x: number; y: number }[] = [
      { c: 'N', x: this.cx, y: this.cy - r },
      { c: 'E', x: this.cx + r, y: this.cy },
      { c: 'S', x: this.cx, y: this.cy + r },
      { c: 'W', x: this.cx - r, y: this.cy },
    ];
    for (const p of positions) {
      const node = svgEl('g', {});
      node.dataset.cardinal = p.c;

      const hit = svgEl('circle', { cx: p.x, cy: p.y, r: this.size * 0.1, fill: 'transparent' });
      // Static mode is non-interactive — the cardinals must not eat pointer events.
      hit.style.pointerEvents = this.isStatic ? 'none' : 'all';

      const text = svgEl('text', {
        x: p.x,
        y: p.y,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        'font-family': FONT,
        'font-size': String(Math.round(this.size * 0.085)),
        'font-weight': '600',
        fill: TEXT_COLOR,
      });
      text.textContent = this.labels.cardinals[p.c];
      text.style.pointerEvents = 'none';

      node.appendChild(hit);
      node.appendChild(text);
      g.appendChild(node);
      this.cardinalText.set(p.c, text);

      if (this.isStatic) continue; // no snap/hover wiring on a static dial

      node.style.cursor = 'pointer';
      const onDown = (ev: PointerEvent): void => ev.stopPropagation();
      const onEnter = (): void => {
        if (rotationToCardinal(this.rotation) !== p.c) text.setAttribute('fill', HOVER);
      };
      const onLeave = (): void => this.paintCardinal(p.c);
      const onClick = (ev: MouseEvent): void => {
        ev.stopPropagation();
        if (this.dragMoved) {
          this.dragMoved = false;
          return;
        }
        this.options.onRotateTo?.(cardinalToRotation(p.c));
      };
      node.addEventListener('pointerdown', onDown);
      node.addEventListener('pointerenter', onEnter);
      node.addEventListener('pointerleave', onLeave);
      node.addEventListener('click', onClick);
      this.cleanups.push(() => {
        node.removeEventListener('pointerdown', onDown);
        node.removeEventListener('pointerenter', onEnter);
        node.removeEventListener('pointerleave', onLeave);
        node.removeEventListener('click', onClick);
      });
    }
    this.svg.appendChild(g);
    return g;
  }

  private buildReadout(): SVGTextElement {
    const text = svgEl('text', {
      x: this.cx,
      y: this.cy,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-family': FONT,
      'font-size': String(Math.round(this.size * 0.12)),
      'font-weight': '600',
      fill: TEXT_COLOR,
    });
    text.style.pointerEvents = 'none';
    return text;
  }

  private buildHomeButton(): HTMLDivElement {
    const btn = document.createElement('div');
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', this.labels.homeAria);
    btn.setAttribute('title', this.labels.home);
    btn.innerHTML =
      '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>';
    Object.assign(btn.style, {
      position: 'absolute',
      bottom: '0px',
      right: '0px',
      width: '22px',
      height: '22px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      color: TEXT_COLOR,
      background: 'rgba(255,255,255,0.85)',
      border: '1px solid #d1d6df',
      borderRadius: '50%',
      pointerEvents: 'auto',
      transition: 'background 120ms, color 120ms',
      zIndex: '2',
    } as Partial<CSSStyleDeclaration>);
    const onEnter = (): void => {
      btn.style.background = HOVER;
      btn.style.color = '#ffffff';
    };
    const onLeave = (): void => {
      btn.style.background = 'rgba(255,255,255,0.85)';
      btn.style.color = TEXT_COLOR;
    };
    const onClick = (ev: MouseEvent): void => {
      ev.stopPropagation();
      this.options.onHome?.();
    };
    btn.addEventListener('pointerenter', onEnter);
    btn.addEventListener('pointerleave', onLeave);
    btn.addEventListener('click', onClick);
    this.cleanups.push(() => {
      btn.removeEventListener('pointerenter', onEnter);
      btn.removeEventListener('pointerleave', onLeave);
      btn.removeEventListener('click', onClick);
    });
    return btn;
  }

  // ─── rotation rendering ──────────────────────────────────────────

  private applyRotation(deg: number): void {
    const transform = `rotate(${String(deg)} ${String(this.cx)} ${String(this.cy)})`;
    this.dial.setAttribute('transform', transform);
    if (this.isStatic) {
      // True-north dial: the whole rose (pointer + cardinals) turns to the
      // bearing; the upright readout shows it. North is emphasized.
      this.cardinalsGroup?.setAttribute('transform', transform);
      const norm = (((Math.round(deg) % 360) + 360) % 360);
      this.readout.textContent = `${String(norm)}°`;
      for (const c of ['N', 'E', 'S', 'W'] as Cardinal[]) {
        this.cardinalText.get(c)?.setAttribute('fill', c === 'N' ? ACCENT : TEXT_COLOR);
      }
      return;
    }
    const snap = snapToQuarter(deg);
    this.readout.textContent = rotationLabel(snap);
    const active = rotationToCardinal(snap);
    for (const c of ['N', 'E', 'S', 'W'] as Cardinal[]) this.paintCardinal(c, active);
  }

  private paintCardinal(c: Cardinal, active = rotationToCardinal(this.rotation)): void {
    this.cardinalText.get(c)?.setAttribute('fill', c === active ? ACCENT : TEXT_COLOR);
  }

  // ─── ring drag ───────────────────────────────────────────────────

  private ringCenterClient(): { x: number; y: number } {
    const rect = this.svg.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  private attachRingHandlers(): void {
    const onDown = (ev: PointerEvent): void => {
      this.ringDragging = true;
      this.ringPointerId = ev.pointerId;
      this.dragMoved = false;
      this.dragStartRotation = this.rotation;
      this.previewDeg = this.rotation;
      const c = this.ringCenterClient();
      this.ringLastAngle = pointerAngleDeg(ev.clientX, ev.clientY, c.x, c.y);
      this.svg.setPointerCapture(ev.pointerId);
      this.svg.style.cursor = 'grabbing';
    };
    const onMove = (ev: PointerEvent): void => {
      if (!this.ringDragging || ev.pointerId !== this.ringPointerId) return;
      const c = this.ringCenterClient();
      const angle = pointerAngleDeg(ev.clientX, ev.clientY, c.x, c.y);
      this.previewDeg += shortestAngleDelta(this.ringLastAngle, angle);
      this.ringLastAngle = angle;
      if (Math.abs(this.previewDeg - this.dragStartRotation) > DRAG_DEADZONE_DEG) {
        this.dragMoved = true;
      }
      this.applyRotation(this.previewDeg);
    };
    const onUp = (ev: PointerEvent): void => {
      if (ev.pointerId !== this.ringPointerId) return;
      this.ringDragging = false;
      this.ringPointerId = -1;
      try {
        this.svg.releasePointerCapture(ev.pointerId);
      } catch {
        // already released
      }
      this.svg.style.cursor = 'grab';
      if (!this.dragMoved) {
        // A tap on the face — restore the committed orientation, do nothing.
        this.applyRotation(this.rotation);
        return;
      }
      const snapped = snapToQuarter(this.previewDeg);
      this.rotation = snapped; // optimistic; the rotation:change echo reconciles
      this.applyRotation(snapped);
      this.options.onRotateTo?.(snapped);
    };
    this.svg.addEventListener('pointerdown', onDown);
    this.svg.addEventListener('pointermove', onMove);
    this.svg.addEventListener('pointerup', onUp);
    this.svg.addEventListener('pointercancel', onUp);
    this.cleanups.push(() => {
      this.svg.removeEventListener('pointerdown', onDown);
      this.svg.removeEventListener('pointermove', onMove);
      this.svg.removeEventListener('pointerup', onUp);
      this.svg.removeEventListener('pointercancel', onUp);
    });
  }

  // ─── styling ─────────────────────────────────────────────────────

  private applyWrapperStyles(): void {
    Object.assign(this.element.style, {
      position: 'absolute',
      top: '12px',
      left: '12px',
      width: `${String(this.size)}px`,
      height: `${String(this.size)}px`,
      pointerEvents: 'none',
      zIndex: '10',
      filter: 'drop-shadow(0 8px 20px rgba(0,0,0,0.35))',
      userSelect: 'none',
    } as Partial<CSSStyleDeclaration>);
  }
}
