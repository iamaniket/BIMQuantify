/**
 * CAD-style navigation-cube widget. Cube has 26 pickable regions
 * (6 faces, 12 edges, 8 corners). Each region maps to a direction
 * vector the host can use to frame the model.
 *
 * The widget is composed of layered DOM:
 *   wrapper (div)
 *   ├── compass ring (svg)        — drag to spin azimuth
 *   ├── cube canvas (three.js)    — pick or drag to orbit
 *   ├── home button (div)         — reset to iso
 *   └── tooltip (div)             — hover label
 *
 * Communication is callback-based — the widget never touches the main
 * camera controls. The plugin (`./index.ts`) wires callbacks to the
 * `camera.*` commands.
 */

import * as THREE from 'three';

import { GeometryBuilder, HIGHLIGHT_COLOR, type RegionMesh } from './geometry.js';

export type RegionKind = 'face' | 'edge' | 'corner';

export interface Region {
  kind: RegionKind;
  /** Stable id like 'face:top' or 'edge:top-front' or 'corner:top-front-right'. */
  id: string;
  /** Normalised direction the camera should look FROM (relative to model centre). */
  direction: THREE.Vector3;
}

export type ViewCubeLocale = 'en' | 'nl';

interface ViewCubeLabels {
  faces: Record<'top' | 'bottom' | 'front' | 'back' | 'left' | 'right', string>;
  home: string;
  homeAria: string;
}

const LABELS: Record<ViewCubeLocale, ViewCubeLabels> = {
  en: {
    faces: { top: 'TOP', bottom: 'BOTTOM', front: 'FRONT', back: 'BACK', left: 'LEFT', right: 'RIGHT' },
    home: 'Home',
    homeAria: 'Home view',
  },
  nl: {
    faces: { top: 'BOVEN', bottom: 'ONDER', front: 'VOOR', back: 'ACHTER', left: 'LINKS', right: 'RECHTS' },
    home: 'Home',
    homeAria: 'Thuisweergave',
  },
};

export interface ViewCubeWidgetOptions {
  size: number;
  showCompass: boolean;
  showHomeButton: boolean;
  locale: ViewCubeLocale;
  onPick: (region: Region) => void;
  /** Called continuously while dragging the cube body (radians). */
  onOrbit: (deltaAzimuth: number, deltaPolar: number) => void;
  /** Called when the home button is clicked. */
  onHome: () => void;
}

const HOVER_COLOR = 0x6cb4ff;

const DRAG_DEADZONE = 4;
const ORBIT_RADIANS_PER_PX = 0.01;

export class ViewCubeWidget {
  readonly element: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly builder: GeometryBuilder;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly pointer = new THREE.Vector2();
  // Reused scratch for the per-camera:change syncTo (no per-frame alloc).
  private readonly _dir = new THREE.Vector3();
  private readonly _dirN = new THREE.Vector3();
  private readonly options: ViewCubeWidgetOptions;
  private readonly labels: ViewCubeLabels;
  private readonly tooltip: HTMLDivElement;
  private readonly compassSvg: SVGSVGElement | null = null;
  private readonly compassLabels: SVGGElement | null = null;
  private hovered: RegionMesh | null = null;
  private currentHighlight: RegionMesh | null = null;
  private pendingNdc: { x: number; y: number } | null = null;
  private hoverRaf = 0;

  // Cube drag state
  private cubeDragging = false;
  private cubeDownX = 0;
  private cubeDownY = 0;
  private cubeLastX = 0;
  private cubeLastY = 0;
  private cubeMaxDelta = 0;
  private cubePointerId = -1;

  // Compass drag state
  private ringDragging = false;
  private ringPointerId = -1;
  private ringLastAngle = 0;

  private disposed = false;

  constructor(options: ViewCubeWidgetOptions) {
    this.options = options;
    this.labels = LABELS[options.locale] ?? LABELS.en;

    this.element = document.createElement('div');
    this.element.dataset.viewcube = 'true';
    this.applyWrapperStyles();

    this.canvas = document.createElement('canvas');
    this.canvas.width = options.size;
    this.canvas.height = options.size;
    this.applyCanvasStyles();
    this.element.appendChild(this.canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      alpha: true,
      antialias: true,
    });
    // Cap at 2 to match the main 3D renderer (core/Viewer.ts getBasePixelRatio):
    // this is a second, always-present WebGL context, so there's no reason to
    // render the small cube at a phone's full 3× ratio.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(options.size, options.size, false);
    this.renderer.setClearColor(0x000000, 0);

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    this.camera.position.set(0, 0, 4.6);
    this.camera.lookAt(0, 0, 0);

    this.builder = new GeometryBuilder(this.renderer, this.labels.faces);

    if (options.showCompass) {
      const ring = this.buildCompass();
      this.compassSvg = ring.svg;
      this.compassLabels = ring.labels;
      this.element.insertBefore(ring.svg, this.canvas);
    }

    if (options.showHomeButton) {
      const home = this.buildHomeButton();
      this.element.appendChild(home);
    }

    this.tooltip = this.buildTooltip();
    this.element.appendChild(this.tooltip);

    this.canvas.addEventListener('pointerdown', this.onCubePointerDown);
    this.canvas.addEventListener('pointermove', this.onCubePointerMove);
    this.canvas.addEventListener('pointerup', this.onCubePointerUp);
    this.canvas.addEventListener('pointercancel', this.onCubePointerUp);
    this.canvas.addEventListener('pointerleave', this.onCubePointerLeave);
  }

  /** Slave the cube to the main camera's orientation + update ring + highlight. */
  syncTo(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, target: THREE.Vector3): void {
    if (this.disposed) return;
    const dir = this._dir.copy(camera.position).sub(target);
    if (dir.lengthSq() === 0) dir.set(0, 0, 1);
    const dirN = this._dirN.copy(dir).normalize();
    // copy dirN into position then scale in place — leaves dirN intact for the
    // updateHighlight / updateCompassRotation reads below.
    this.camera.position.copy(dirN).multiplyScalar(4.6);
    this.camera.up.copy(camera.up);
    this.camera.lookAt(0, 0, 0);

    this.updateHighlight(dirN);
    this.updateCompassRotation(dirN);
    this.render();
  }

  render(): void {
    if (this.disposed) return;
    this.renderer.render(this.builder.scene, this.camera);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('pointerdown', this.onCubePointerDown);
    this.canvas.removeEventListener('pointermove', this.onCubePointerMove);
    this.canvas.removeEventListener('pointerup', this.onCubePointerUp);
    this.canvas.removeEventListener('pointercancel', this.onCubePointerUp);
    this.canvas.removeEventListener('pointerleave', this.onCubePointerLeave);
    if (this.hoverRaf) cancelAnimationFrame(this.hoverRaf);
    this.renderer.dispose();
    this.builder.dispose();
    this.element.remove();
  }

  // ─── compass / arrows / home / tooltip construction ──────────────

  private buildCompass(): { svg: SVGSVGElement; labels: SVGGElement } {
    const SVG = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(SVG, 'svg');
    const size = this.options.size;
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', `0 0 ${String(size)} ${String(size)}`);
    Object.assign(svg.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'auto',
      cursor: 'grab',
      touchAction: 'none',
    } as Partial<CSSStyleDeclaration>);

    const cx = size / 2;
    const cy = size / 2;
    const rx = size * 0.46;
    const ry = size * 0.13;
    const ringY = size * 0.78;

    // Ellipse (perspective ring) — sits visually under the cube base.
    const ellipse = document.createElementNS(SVG, 'ellipse');
    ellipse.setAttribute('cx', String(cx));
    ellipse.setAttribute('cy', String(ringY));
    ellipse.setAttribute('rx', String(rx));
    ellipse.setAttribute('ry', String(ry));
    ellipse.setAttribute('fill', 'rgba(245,247,250,0.85)');
    ellipse.setAttribute('stroke', '#c8cfd8');
    ellipse.setAttribute('stroke-width', '1.5');
    svg.appendChild(ellipse);

    // Inner arc accent
    const inner = document.createElementNS(SVG, 'ellipse');
    inner.setAttribute('cx', String(cx));
    inner.setAttribute('cy', String(ringY));
    inner.setAttribute('rx', String(rx * 0.78));
    inner.setAttribute('ry', String(ry * 0.78));
    inner.setAttribute('fill', 'none');
    inner.setAttribute('stroke', '#dde2ea');
    inner.setAttribute('stroke-width', '1');
    svg.appendChild(inner);

    // Group of N/S/E/W labels — rotated as one unit when camera azimuth changes.
    const labels = document.createElementNS(SVG, 'g');
    labels.setAttribute('transform-origin', `${String(cx)} ${String(ringY)}`);
    labels.setAttribute('font-family', 'system-ui, -apple-system, sans-serif');
    labels.setAttribute('font-size', '11');
    labels.setAttribute('font-weight', '600');
    labels.setAttribute('fill', '#4b5563');
    labels.setAttribute('text-anchor', 'middle');
    const dirs: { l: string; ax: number; ay: number }[] = [
      { l: 'N', ax: 0, ay: -1 },
      { l: 'E', ax: 1, ay: 0 },
      { l: 'S', ax: 0, ay: 1 },
      { l: 'W', ax: -1, ay: 0 },
    ];
    for (const d of dirs) {
      const t = document.createElementNS(SVG, 'text');
      t.textContent = d.l;
      t.setAttribute('x', String(cx + d.ax * (rx + 8)));
      t.setAttribute('y', String(ringY + d.ay * (ry + 8) + 4));
      labels.appendChild(t);
    }
    svg.appendChild(labels);

    svg.addEventListener('pointerdown', this.onRingPointerDown);
    svg.addEventListener('pointermove', this.onRingPointerMove);
    svg.addEventListener('pointerup', this.onRingPointerUp);
    svg.addEventListener('pointercancel', this.onRingPointerUp);

    return { svg, labels };
  }

  private buildHomeButton(): HTMLDivElement {
    const btn = document.createElement('div');
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', this.labels.homeAria);
    btn.setAttribute('title', this.labels.home);
    btn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>';
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
      color: '#4b5563',
      background: 'rgba(255,255,255,0.85)',
      border: '1px solid #d1d6df',
      borderRadius: '50%',
      pointerEvents: 'auto',
      transition: 'background 120ms, color 120ms',
      zIndex: '2',
    } as Partial<CSSStyleDeclaration>);
    btn.addEventListener('pointerenter', () => {
      btn.style.background = '#6cb4ff';
      btn.style.color = '#ffffff';
    });
    btn.addEventListener('pointerleave', () => {
      btn.style.background = 'rgba(255,255,255,0.85)';
      btn.style.color = '#4b5563';
    });
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.options.onHome();
    });
    return btn;
  }

  private buildTooltip(): HTMLDivElement {
    const tip = document.createElement('div');
    Object.assign(tip.style, {
      position: 'absolute',
      pointerEvents: 'none',
      background: 'rgba(31,41,55,0.92)',
      color: '#ffffff',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '11px',
      fontWeight: '500',
      padding: '3px 7px',
      borderRadius: '4px',
      whiteSpace: 'nowrap',
      transform: 'translate(-50%, -130%)',
      opacity: '0',
      transition: 'opacity 120ms',
      zIndex: '3',
    } as Partial<CSSStyleDeclaration>);
    return tip;
  }

  // ─── orientation sync helpers ────────────────────────────────────

  private updateHighlight(_viewDir: THREE.Vector3): void {
    if (this.currentHighlight) {
      this.currentHighlight.highlighted = false;
      this.applyRegionColor(this.currentHighlight);
      this.currentHighlight = null;
    }
  }

  private updateCompassRotation(viewDir: THREE.Vector3): void {
    if (!this.compassLabels) return;
    // Azimuth around Y axis: angle of the camera direction projected onto XZ.
    const azimuth = Math.atan2(viewDir.x, viewDir.z); // 0 when looking along +Z (front)
    const deg = -azimuth * (180 / Math.PI);
    const size = this.options.size;
    const cx = size / 2;
    const ringY = size * 0.78;
    this.compassLabels.setAttribute('transform', `rotate(${deg.toFixed(2)} ${String(cx)} ${String(ringY)})`);
  }

  private applyRegionColor(r: RegionMesh): void {
    const mat = r.mesh.material as THREE.MeshBasicMaterial;
    const isOverlay = r.region.kind === 'edge' || r.region.kind === 'corner';
    if (this.hovered === r) {
      mat.color.setHex(HOVER_COLOR);
      if (isOverlay) mat.opacity = 1;
    } else if (r.highlighted) {
      mat.color.setHex(HIGHLIGHT_COLOR);
      if (isOverlay) mat.opacity = 1;
    } else {
      mat.color.setHex(r.baseColor);
      if (isOverlay) mat.opacity = 0;
    }
  }

  // ─── pointer handling — cube ─────────────────────────────────────

  private setPointerNdc(ev: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
  }

  private pickRegion(): RegionMesh | null {
    return this.builder.pickRegion(this.pointer, this.camera);
  }

  private setHovered(next: RegionMesh | null): void {
    if (this.hovered === next) return;
    const prev = this.hovered;
    this.hovered = next;
    if (prev) this.applyRegionColor(prev);
    if (next) {
      this.applyRegionColor(next);
      this.canvas.style.cursor = 'pointer';
      this.showTooltip(next.region);
    } else {
      this.canvas.style.cursor = 'default';
      this.hideTooltip();
    }
    this.render();
  }

  private showTooltip(region: Region): void {
    this.tooltip.textContent = this.friendlyLabel(region);
    this.tooltip.style.opacity = '1';
    // Position above the cube center
    this.tooltip.style.left = `${String(this.options.size / 2)}px`;
    this.tooltip.style.top = `${String(this.options.size * 0.18)}px`;
  }

  private hideTooltip(): void {
    this.tooltip.style.opacity = '0';
  }

  private friendlyLabel(region: Region): string {
    const f = this.labels.faces;
    const wordMap: Record<string, string> = {
      top: titleCase(f.top),
      bottom: titleCase(f.bottom),
      front: titleCase(f.front),
      back: titleCase(f.back),
      left: titleCase(f.left),
      right: titleCase(f.right),
    };
    const after = region.id.split(':')[1] ?? region.id;
    return after
      .split('-')
      .map((w) => wordMap[w] ?? titleCase(w))
      .join(' ');
  }

  private onCubePointerDown = (ev: PointerEvent): void => {
    this.cubeDragging = true;
    this.cubePointerId = ev.pointerId;
    this.cubeDownX = this.cubeLastX = ev.clientX;
    this.cubeDownY = this.cubeLastY = ev.clientY;
    this.cubeMaxDelta = 0;
    this.canvas.setPointerCapture(ev.pointerId);
  };

  private onCubePointerMove = (ev: PointerEvent): void => {
    if (this.cubeDragging && ev.pointerId === this.cubePointerId) {
      const dx = ev.clientX - this.cubeLastX;
      const dy = ev.clientY - this.cubeLastY;
      this.cubeLastX = ev.clientX;
      this.cubeLastY = ev.clientY;
      const totalDx = ev.clientX - this.cubeDownX;
      const totalDy = ev.clientY - this.cubeDownY;
      this.cubeMaxDelta = Math.max(this.cubeMaxDelta, Math.hypot(totalDx, totalDy));
      if (this.cubeMaxDelta > DRAG_DEADZONE) {
        // Live orbit: drag-x → azimuth (around Y), drag-y → polar.
        // Negative so dragging right rotates the model right.
        this.options.onOrbit(-dx * ORBIT_RADIANS_PER_PX, -dy * ORBIT_RADIANS_PER_PX);
        this.hideTooltip();
      }
      return;
    }
    // Hover (no drag in progress)
    this.setPointerNdc(ev);
    this.pendingNdc = { x: this.pointer.x, y: this.pointer.y };
    if (!this.hoverRaf) {
      this.hoverRaf = requestAnimationFrame(this.runHover);
    }
  };

  private onCubePointerUp = (ev: PointerEvent): void => {
    if (this.cubeDragging && ev.pointerId === this.cubePointerId) {
      const wasClick = this.cubeMaxDelta <= DRAG_DEADZONE;
      this.cubeDragging = false;
      this.cubePointerId = -1;
      try {
        this.canvas.releasePointerCapture(ev.pointerId);
      } catch {
        // already released
      }
      if (wasClick) {
        this.setPointerNdc(ev);
        const hit = this.pickRegion();
        if (hit) {
          this.setHovered(null);
          this.options.onPick(hit.region);
        }
      }
    }
  };

  private onCubePointerLeave = (): void => {
    this.pendingNdc = null;
    if (this.hoverRaf) {
      cancelAnimationFrame(this.hoverRaf);
      this.hoverRaf = 0;
    }
    if (!this.cubeDragging) this.setHovered(null);
  };

  private runHover = (): void => {
    this.hoverRaf = 0;
    if (this.disposed || !this.pendingNdc || this.cubeDragging) return;
    this.pointer.set(this.pendingNdc.x, this.pendingNdc.y);
    this.pendingNdc = null;
    const hit = this.pickRegion();
    this.setHovered(hit);
  };

  // ─── pointer handling — compass ring ─────────────────────────────

  private ringAngleFromEvent(ev: PointerEvent): number {
    if (!this.compassSvg) return 0;
    const rect = this.compassSvg.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height * 0.78;
    return Math.atan2(ev.clientX - cx, -(ev.clientY - cy));
  }

  private onRingPointerDown = (ev: PointerEvent): void => {
    if (!this.compassSvg) return;
    this.ringDragging = true;
    this.ringPointerId = ev.pointerId;
    this.ringLastAngle = this.ringAngleFromEvent(ev);
    this.compassSvg.setPointerCapture(ev.pointerId);
    this.compassSvg.style.cursor = 'grabbing';
  };

  private onRingPointerMove = (ev: PointerEvent): void => {
    if (!this.ringDragging || ev.pointerId !== this.ringPointerId) return;
    const angle = this.ringAngleFromEvent(ev);
    let delta = angle - this.ringLastAngle;
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    this.ringLastAngle = angle;
    if (delta !== 0) this.options.onOrbit(delta, 0);
  };

  private onRingPointerUp = (ev: PointerEvent): void => {
    if (!this.compassSvg || ev.pointerId !== this.ringPointerId) return;
    this.ringDragging = false;
    this.ringPointerId = -1;
    try {
      this.compassSvg.releasePointerCapture(ev.pointerId);
    } catch {
      // already released
    }
    this.compassSvg.style.cursor = 'grab';
  };

  // ─── styling ─────────────────────────────────────────────────────

  private applyWrapperStyles(): void {
    const s = this.element.style;
    s.position = 'absolute';
    s.width = `${String(this.options.size)}px`;
    s.height = `${String(this.options.size)}px`;
    s.pointerEvents = 'none';
    s.zIndex = '10';
    s.filter = 'drop-shadow(0 8px 20px rgba(0,0,0,0.35))';
    s.userSelect = 'none';
    s.top = '9px';
    s.left = '9px';
  }

  private applyCanvasStyles(): void {
    const c = this.canvas.style;
    c.position = 'absolute';
    c.inset = '0';
    c.width = `${String(this.options.size)}px`;
    c.height = `${String(this.options.size)}px`;
    c.pointerEvents = 'auto';
    c.cursor = 'default';
    c.touchAction = 'none';
    c.zIndex = '1';
  }
}

function titleCase(s: string): string {
  if (!s.length) return s;
  return (s[0]?.toUpperCase() ?? '') + s.slice(1).toLowerCase();
}
