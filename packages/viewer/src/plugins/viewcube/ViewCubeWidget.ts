/**
 * Revit/Forge-style nav-cube widget. Cube has 26 pickable regions
 * (6 faces, 12 edges, 8 corners). Each region maps to a direction
 * vector the host can use to frame the model.
 *
 * The widget is composed of layered DOM:
 *   wrapper (div)
 *   ├── compass ring (svg)        — drag to spin azimuth
 *   ├── cube canvas (three.js)    — pick or drag to orbit
 *   ├── home button (div)         — reset to iso
 *   ├── snap-rotate buttons (div) — animated ±90° azimuth
 *   └── tooltip (div)             — hover label
 *
 * Communication is callback-based — the widget never touches the main
 * camera controls. The plugin (`./index.ts`) wires callbacks to the
 * `camera.*` commands.
 */

import * as THREE from 'three';

import type { ViewCubeCorner } from '../../types.js';

export type RegionKind = 'face' | 'edge' | 'corner';

export interface Region {
  kind: RegionKind;
  /** Stable id like 'face:top' or 'edge:top-front' or 'corner:top-front-right'. */
  id: string;
  /** Normalised direction the camera should look FROM (relative to model centre). */
  direction: THREE.Vector3;
}

export interface ViewCubeWidgetOptions {
  size: number;
  corner: ViewCubeCorner;
  showCompass: boolean;
  showSnapArrows: boolean;
  showHomeButton: boolean;
  onPick: (region: Region) => void;
  /** Called continuously while dragging the cube body (radians). */
  onOrbit: (deltaAzimuth: number, deltaPolar: number) => void;
  /** Called for snap-rotate buttons. dir = -1 left, +1 right (radians applied by host). */
  onSnapRotate: (dir: -1 | 1) => void;
  /** Called when the home button is clicked. */
  onHome: () => void;
}

const FACE_COLOR = 0xffffff;
const EDGE_COLOR = 0xeef0f4;
const CORNER_COLOR = 0xe4e7ed;
const HOVER_COLOR = 0x6cb4ff;
// Face plane is inset *inside* the cube face: 0.45 means the labeled
// plane covers 90% of the cube's face (a ~5% margin on each side).
// Anything ≥ 0.5 makes the plane bigger than the cube and the overflow
// renders as a visible shelf at view angles.
const HIGHLIGHT_COLOR = 0xcfe4ff;

const CUBE_SIZE = 1.4;
const FACE_INSET = CUBE_SIZE * 0.45;
const EDGE_THICKNESS = CUBE_SIZE * 0.18;
const CORNER_SIZE = CUBE_SIZE * 0.22;

const DRAG_DEADZONE = 4;
const ORBIT_RADIANS_PER_PX = 0.01;

interface RegionMesh {
  mesh: THREE.Mesh;
  region: Region;
  baseColor: number;
  highlighted: boolean;
}

export class ViewCubeWidget {
  readonly element: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly group: THREE.Group;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly options: ViewCubeWidgetOptions;
  private readonly regionMeshes: RegionMesh[] = [];
  private readonly meshById = new Map<string, RegionMesh>();
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
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(options.size, options.size, false);
    this.renderer.setClearColor(0x000000, 0);

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    this.camera.position.set(0, 0, 4.6);
    this.camera.lookAt(0, 0, 0);

    this.group = new THREE.Group();
    this.scene.add(this.group);

    const bgGeom = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
    const bgMat = new THREE.MeshBasicMaterial({ color: FACE_COLOR });
    this.group.add(new THREE.Mesh(bgGeom, bgMat));

    this.buildRegions();
    this.scene.add(new THREE.AmbientLight(0xffffff, 1));

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

    if (options.showSnapArrows) {
      const left = this.buildSnapArrow(-1);
      const right = this.buildSnapArrow(1);
      this.element.appendChild(left);
      this.element.appendChild(right);
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
    const dir = camera.position.clone().sub(target);
    if (dir.lengthSq() === 0) dir.set(0, 0, 1);
    const dirN = dir.clone().normalize();
    this.camera.position.copy(dirN.clone().multiplyScalar(4.6));
    this.camera.up.copy(camera.up);
    this.camera.lookAt(0, 0, 0);

    this.updateHighlight(dirN);
    this.updateCompassRotation(dirN);
    this.render();
  }

  render(): void {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
  }

  setCorner(corner: ViewCubeCorner): void {
    this.options.corner = corner;
    this.applyWrapperStyles();
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
    for (const r of this.regionMeshes) {
      (r.mesh.geometry as THREE.BufferGeometry).dispose();
      const m = r.mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(m)) for (const mm of m) mm.dispose();
      else m.dispose();
    }
    this.element.remove();
  }

  // ─── geometry construction ────────────────────────────────────────

  private buildRegions(): void {
    const faceLabels: { id: string; dir: [number, number, number]; label: string }[] = [
      { id: 'face:right', dir: [1, 0, 0], label: 'RIGHT' },
      { id: 'face:left', dir: [-1, 0, 0], label: 'LEFT' },
      { id: 'face:top', dir: [0, 1, 0], label: 'TOP' },
      { id: 'face:bottom', dir: [0, -1, 0], label: 'BOTTOM' },
      { id: 'face:front', dir: [0, 0, 1], label: 'FRONT' },
      { id: 'face:back', dir: [0, 0, -1], label: 'BACK' },
    ];
    for (const f of faceLabels) this.addFace(f.id, f.dir, f.label);

    const edgeDirs: { id: string; dir: [number, number, number] }[] = [
      { id: 'edge:top-front', dir: [0, 1, 1] },
      { id: 'edge:top-back', dir: [0, 1, -1] },
      { id: 'edge:top-right', dir: [1, 1, 0] },
      { id: 'edge:top-left', dir: [-1, 1, 0] },
      { id: 'edge:bottom-front', dir: [0, -1, 1] },
      { id: 'edge:bottom-back', dir: [0, -1, -1] },
      { id: 'edge:bottom-right', dir: [1, -1, 0] },
      { id: 'edge:bottom-left', dir: [-1, -1, 0] },
      { id: 'edge:front-right', dir: [1, 0, 1] },
      { id: 'edge:front-left', dir: [-1, 0, 1] },
      { id: 'edge:back-right', dir: [1, 0, -1] },
      { id: 'edge:back-left', dir: [-1, 0, -1] },
    ];
    for (const e of edgeDirs) this.addEdge(e.id, e.dir);

    for (const sx of [1, -1])
      for (const sy of [1, -1])
        for (const sz of [1, -1]) {
          const id = `corner:${sy === 1 ? 'top' : 'bottom'}-${sz === 1 ? 'front' : 'back'}-${sx === 1 ? 'right' : 'left'}`;
          this.addCorner(id, [sx, sy, sz]);
        }
  }

  private addFace(id: string, dir: [number, number, number], label: string): void {
    const geom = new THREE.PlaneGeometry(FACE_INSET * 2, FACE_INSET * 2);
    const tex = makeFaceTexture(label);
    tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      color: 0xffffff,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = 1;
    const half = CUBE_SIZE / 2 + 0.01;
    const v = new THREE.Vector3(...dir);
    mesh.position.copy(v).multiplyScalar(half);
    if (dir[0] !== 0) {
      mesh.rotation.y = dir[0] === 1 ? Math.PI / 2 : -Math.PI / 2;
    } else if (dir[1] !== 0) {
      mesh.rotation.x = dir[1] === 1 ? -Math.PI / 2 : Math.PI / 2;
    } else if (dir[2] === -1) {
      mesh.rotation.y = Math.PI;
    }
    const region: Region = { kind: 'face', id, direction: v.clone().normalize() };
    this.attach(mesh, region, FACE_COLOR);
  }

  private addEdge(id: string, dir: [number, number, number]): void {
    const half = CUBE_SIZE / 2;
    const v = new THREE.Vector3(dir[0] * half, dir[1] * half, dir[2] * half);
    let dimX: number;
    let dimY: number;
    let dimZ: number;
    if (dir[0] === 0) {
      dimX = CUBE_SIZE - EDGE_THICKNESS * 2;
      dimY = EDGE_THICKNESS;
      dimZ = EDGE_THICKNESS;
    } else if (dir[1] === 0) {
      dimX = EDGE_THICKNESS;
      dimY = CUBE_SIZE - EDGE_THICKNESS * 2;
      dimZ = EDGE_THICKNESS;
    } else {
      dimX = EDGE_THICKNESS;
      dimY = EDGE_THICKNESS;
      dimZ = CUBE_SIZE - EDGE_THICKNESS * 2;
    }
    const geom = new THREE.BoxGeometry(dimX, dimY, dimZ);
    const mat = new THREE.MeshBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(v);
    const region: Region = {
      kind: 'edge',
      id,
      direction: new THREE.Vector3(...dir).normalize(),
    };
    this.attach(mesh, region, EDGE_COLOR);
  }

  private addCorner(id: string, dir: [number, number, number]): void {
    const half = CUBE_SIZE / 2;
    const geom = new THREE.BoxGeometry(CORNER_SIZE, CORNER_SIZE, CORNER_SIZE);
    const mat = new THREE.MeshBasicMaterial({ color: CORNER_COLOR, transparent: true, opacity: 0 });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(dir[0] * half, dir[1] * half, dir[2] * half);
    const region: Region = {
      kind: 'corner',
      id,
      direction: new THREE.Vector3(...dir).normalize(),
    };
    this.attach(mesh, region, CORNER_COLOR);
  }

  private attach(mesh: THREE.Mesh, region: Region, baseColor: number): void {
    mesh.userData = { region };
    this.group.add(mesh);
    const entry: RegionMesh = { mesh, region, baseColor, highlighted: false };
    this.regionMeshes.push(entry);
    this.meshById.set(region.id, entry);
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
    btn.setAttribute('aria-label', 'Home view');
    btn.setAttribute('title', 'Home');
    btn.innerHTML =
      '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>';
    Object.assign(btn.style, {
      position: 'absolute',
      top: '0px',
      left: '0px',
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

  private buildSnapArrow(direction: -1 | 1): HTMLDivElement {
    const btn = document.createElement('div');
    btn.setAttribute('role', 'button');
    btn.setAttribute('aria-label', direction === -1 ? 'Rotate left' : 'Rotate right');
    btn.setAttribute('title', direction === -1 ? 'Rotate left 90°' : 'Rotate right 90°');
    // Curved arrow icon — flipped via inner <g> for the "right" variant.
    const inner = direction === 1
      ? '<g transform="scale(-1,1) translate(-24,0)"><path d="M3 12a9 9 0 0 1 15.5-6.3"/><polyline points="19 3 19 8 14 8"/></g>'
      : '<path d="M3 12a9 9 0 0 1 15.5-6.3"/><polyline points="19 3 19 8 14 8"/>';
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
    const ringY = this.options.size * 0.78;
    const offsetX = direction === -1 ? 4 : this.options.size - 4 - 22;
    Object.assign(btn.style, {
      position: 'absolute',
      top: `${String(ringY - 11)}px`,
      left: `${String(offsetX)}px`,
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
      this.options.onSnapRotate(direction);
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
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObjects(this.group.children, false);
    if (!hits.length) return null;
    const data = hits[0]!.object.userData as { region?: Region };
    if (!data.region) return null;
    return this.meshById.get(data.region.id) ?? null;
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
    this.tooltip.textContent = friendlyLabel(region);
    this.tooltip.style.opacity = '1';
    // Position above the cube center
    this.tooltip.style.left = `${String(this.options.size / 2)}px`;
    this.tooltip.style.top = `${String(this.options.size * 0.18)}px`;
  }

  private hideTooltip(): void {
    this.tooltip.style.opacity = '0';
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
    s.top = s.bottom = s.left = s.right = '';
    const pad = '12px';
    switch (this.options.corner) {
      case 'top-left':
        s.top = pad;
        s.left = pad;
        break;
      case 'bottom-right':
        s.bottom = pad;
        s.right = pad;
        break;
      case 'bottom-left':
        s.bottom = pad;
        s.left = pad;
        break;
      case 'top-right':
      default:
        s.top = pad;
        s.right = pad;
        break;
    }
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

function makeFaceTexture(label: string): THREE.CanvasTexture {
  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#e4e8ee';
  ctx.fillRect(0, 0, size, size);
  const r = 36;
  roundedRect(ctx, 6, 6, size - 12, size - 12, r);
  ctx.fill();
  ctx.fillStyle = '#1f2937';
  ctx.font = '600 88px "Inter", system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, size / 2, size / 2);
  const texture = new THREE.CanvasTexture(cv);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function friendlyLabel(region: Region): string {
  // 'face:top' → 'Top'; 'corner:top-front-right' → 'Top Front Right'.
  const after = region.id.split(':')[1] ?? region.id;
  return after
    .split('-')
    .map((w) => (w.length ? (w[0]?.toUpperCase() ?? '') + w.slice(1) : ''))
    .join(' ');
}
