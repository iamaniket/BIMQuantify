/**
 * 3D ViewCube widget — Revit/Forge-style. The cube has 26 pickable
 * regions: 6 faces, 12 edges, 8 corners. Each region maps to a direction
 * vector the host can use to frame the model. The widget is rendered in
 * its own canvas overlay (separate scene + renderer) so it stays
 * decoupled from the main render loop.
 *
 * Hover feedback: the region under the pointer is tinted; restoring on
 * leave. Pointer cursor is set on the canvas.
 *
 * Orientation tracking: `syncTo(camera, target)` is called from the
 * plugin on every `camera:change` event so the cube mirrors the main
 * camera direction.
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
  onPick: (region: Region) => void;
}

const FACE_COLOR = 0xf6f7f9;
const EDGE_COLOR = 0xe2e6ec;
const CORNER_COLOR = 0xd1d6df;
const HOVER_COLOR = 0x6cb4ff;
const OUTLINE_COLOR = 0x8a93a3;

const CUBE_SIZE = 1.4;
const FACE_INSET = CUBE_SIZE * 0.62;
const EDGE_THICKNESS = CUBE_SIZE * 0.18;
const CORNER_SIZE = CUBE_SIZE * 0.22;

interface RegionMesh {
  mesh: THREE.Mesh;
  region: Region;
  baseColor: number;
}

export class ViewCubeWidget {
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
  private hovered: RegionMesh | null = null;
  private pendingNdc: { x: number; y: number } | null = null;
  private hoverRaf = 0;
  private downX = 0;
  private downY = 0;
  private disposed = false;

  constructor(options: ViewCubeWidgetOptions) {
    this.options = options;
    this.canvas = document.createElement('canvas');
    this.canvas.width = options.size;
    this.canvas.height = options.size;
    this.applyCornerStyles();

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
    this.buildRegions();

    this.scene.add(new THREE.AmbientLight(0xffffff, 1));

    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
  }

  /** Slave the cube to the main camera's orientation. */
  syncTo(camera: THREE.PerspectiveCamera | THREE.OrthographicCamera, target: THREE.Vector3): void {
    if (this.disposed) return;
    const dir = camera.position.clone().sub(target).normalize();
    if (dir.lengthSq() === 0) dir.set(0, 0, 1);
    this.camera.position.copy(dir.multiplyScalar(4.6));
    this.camera.up.copy(camera.up);
    this.camera.lookAt(0, 0, 0);
    this.render();
  }

  render(): void {
    if (this.disposed) return;
    this.renderer.render(this.scene, this.camera);
  }

  setCorner(corner: ViewCubeCorner): void {
    this.options.corner = corner;
    this.applyCornerStyles();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    if (this.hoverRaf) cancelAnimationFrame(this.hoverRaf);
    this.renderer.dispose();
    for (const r of this.regionMeshes) {
      (r.mesh.geometry as THREE.BufferGeometry).dispose();
      const m = r.mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(m)) for (const mm of m) mm.dispose();
      else m.dispose();
    }
    this.canvas.remove();
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

    for (const f of faceLabels) {
      this.addFace(f.id, f.dir, f.label);
    }

    // 12 edges — pairs of axes (x±y, x±z, y±z), midpoint at the cube edge.
    const edgeDirs: { id: string; dir: [number, number, number] }[] = [
      // top-* (y=+1 with one other axis)
      { id: 'edge:top-front', dir: [0, 1, 1] },
      { id: 'edge:top-back', dir: [0, 1, -1] },
      { id: 'edge:top-right', dir: [1, 1, 0] },
      { id: 'edge:top-left', dir: [-1, 1, 0] },
      // bottom-*
      { id: 'edge:bottom-front', dir: [0, -1, 1] },
      { id: 'edge:bottom-back', dir: [0, -1, -1] },
      { id: 'edge:bottom-right', dir: [1, -1, 0] },
      { id: 'edge:bottom-left', dir: [-1, -1, 0] },
      // vertical edges (front/back × left/right)
      { id: 'edge:front-right', dir: [1, 0, 1] },
      { id: 'edge:front-left', dir: [-1, 0, 1] },
      { id: 'edge:back-right', dir: [1, 0, -1] },
      { id: 'edge:back-left', dir: [-1, 0, -1] },
    ];
    for (const e of edgeDirs) this.addEdge(e.id, e.dir);

    // 8 corners (signs of x,y,z)
    for (const sx of [1, -1])
      for (const sy of [1, -1])
        for (const sz of [1, -1]) {
          const id = `corner:${sy === 1 ? 'top' : 'bottom'}-${sz === 1 ? 'front' : 'back'}-${sx === 1 ? 'right' : 'left'}`;
          this.addCorner(id, [sx, sy, sz]);
        }
  }

  private addFace(id: string, dir: [number, number, number], label: string): void {
    const geom = new THREE.PlaneGeometry(FACE_INSET * 2, FACE_INSET * 2);
    const mat = new THREE.MeshBasicMaterial({
      map: makeFaceTexture(label),
      color: FACE_COLOR,
      transparent: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    // Position at the centre of each cube face, pushed out to the cube
    // surface (CUBE_SIZE / 2). Plane geometry default normal is +Z, so
    // we orient it for each axis.
    const half = CUBE_SIZE / 2 + 0.001;
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

    // Faint outline frame around each face for the Forge "compass" look.
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(geom),
      new THREE.LineBasicMaterial({ color: OUTLINE_COLOR }),
    );
    mesh.add(outline);
  }

  private addEdge(id: string, dir: [number, number, number]): void {
    // An edge is a thin rectangular plate centred on the midpoint of the
    // cube edge, oriented along the third (zero) axis.
    const half = CUBE_SIZE / 2;
    const v = new THREE.Vector3(dir[0] * half, dir[1] * half, dir[2] * half);
    let dimX = CUBE_SIZE - EDGE_THICKNESS * 2;
    let dimY = EDGE_THICKNESS;
    let dimZ = EDGE_THICKNESS;
    // Choose orientation: the axis with dir==0 is the "long" axis.
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
    const mat = new THREE.MeshBasicMaterial({ color: EDGE_COLOR });
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
    const mat = new THREE.MeshBasicMaterial({ color: CORNER_COLOR });
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
    const entry: RegionMesh = { mesh, region, baseColor };
    this.regionMeshes.push(entry);
    this.meshById.set(region.id, entry);
  }

  // ─── pointer handling ─────────────────────────────────────────────

  private applyCornerStyles(): void {
    const c = this.canvas.style;
    c.position = 'absolute';
    c.width = `${String(this.options.size)}px`;
    c.height = `${String(this.options.size)}px`;
    c.pointerEvents = 'auto';
    c.zIndex = '10';
    c.cursor = 'default';
    c.top = c.bottom = c.left = c.right = '';
    const pad = '12px';
    switch (this.options.corner) {
      case 'top-left':
        c.top = pad;
        c.left = pad;
        break;
      case 'bottom-right':
        c.bottom = pad;
        c.right = pad;
        break;
      case 'bottom-left':
        c.bottom = pad;
        c.left = pad;
        break;
      case 'top-right':
      default:
        c.top = pad;
        c.right = pad;
        break;
    }
  }

  private setPointer(ev: PointerEvent): void {
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
    if (this.hovered) {
      (this.hovered.mesh.material as THREE.MeshBasicMaterial).color.setHex(
        this.hovered.baseColor,
      );
    }
    this.hovered = next;
    if (next) {
      (next.mesh.material as THREE.MeshBasicMaterial).color.setHex(HOVER_COLOR);
      this.canvas.style.cursor = 'pointer';
    } else {
      this.canvas.style.cursor = 'default';
    }
    this.render();
  }

  private onPointerDown = (ev: PointerEvent): void => {
    this.downX = ev.clientX;
    this.downY = ev.clientY;
  };

  private onPointerUp = (ev: PointerEvent): void => {
    const dx = ev.clientX - this.downX;
    const dy = ev.clientY - this.downY;
    if (Math.hypot(dx, dy) > 4) return;
    this.setPointer(ev);
    const hit = this.pickRegion();
    if (hit) this.options.onPick(hit.region);
  };

  private onPointerMove = (ev: PointerEvent): void => {
    this.setPointer(ev);
    this.pendingNdc = { x: this.pointer.x, y: this.pointer.y };
    if (!this.hoverRaf) {
      this.hoverRaf = requestAnimationFrame(this.runHover);
    }
  };

  private onPointerLeave = (): void => {
    this.pendingNdc = null;
    if (this.hoverRaf) {
      cancelAnimationFrame(this.hoverRaf);
      this.hoverRaf = 0;
    }
    this.setHovered(null);
  };

  private runHover = (): void => {
    this.hoverRaf = 0;
    if (this.disposed || !this.pendingNdc) return;
    this.pointer.set(this.pendingNdc.x, this.pendingNdc.y);
    this.pendingNdc = null;
    const hit = this.pickRegion();
    this.setHovered(hit);
  };
}

function makeFaceTexture(label: string): THREE.CanvasTexture {
  const size = 256;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = '#f6f7f9';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = '#8a93a3';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, size - 4, size - 4);
  ctx.fillStyle = '#1f2937';
  ctx.font = 'bold 52px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, size / 2, size / 2);
  const texture = new THREE.CanvasTexture(cv);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
