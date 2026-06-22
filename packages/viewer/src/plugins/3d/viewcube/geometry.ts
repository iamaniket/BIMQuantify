/**
 * GeometryBuilder — owns the Three.js side of the nav-cube widget: the
 * scene/group, the 26 pickable region meshes (6 faces, 12 edges, 8 corners),
 * the raycaster, and region lookup/picking. Extracted verbatim from
 * `ViewCubeWidget` so the widget can hold a builder ref and stay focused on
 * DOM/pointer/orbit state. No behavior change.
 *
 * The builder must NOT import `ViewCubeWidget.ts` — shared refs (the renderer,
 * face labels) are passed in via the constructor to avoid a circular import.
 */

import * as THREE from 'three';

import type { Region } from './ViewCubeWidget.js';

export const FACE_COLOR = 0xffffff;
export const EDGE_COLOR = 0xeef0f4;
export const CORNER_COLOR = 0xe4e7ed;
// Face plane is inset *inside* the cube face: 0.45 means the labeled
// plane covers 90% of the cube's face (a ~5% margin on each side).
// Anything ≥ 0.5 makes the plane bigger than the cube and the overflow
// renders as a visible shelf at view angles.
export const HIGHLIGHT_COLOR = 0xcfe4ff;

export const CUBE_SIZE = 1.4;
const FACE_INSET = CUBE_SIZE * 0.45;
const EDGE_THICKNESS = CUBE_SIZE * 0.18;
const CORNER_SIZE = CUBE_SIZE * 0.22;

export interface RegionMesh {
  mesh: THREE.Mesh;
  region: Region;
  baseColor: number;
  highlighted: boolean;
}

/** Face labels the builder bakes onto the six face textures. */
type FaceLabels = Record<'top' | 'bottom' | 'front' | 'back' | 'left' | 'right', string>;

export class GeometryBuilder {
  readonly scene = new THREE.Scene();
  readonly group: THREE.Group;
  readonly raycaster = new THREE.Raycaster();
  readonly regionMeshes: RegionMesh[] = [];
  readonly meshById = new Map<string, RegionMesh>();
  private readonly renderer: THREE.WebGLRenderer;
  private readonly faceLabels: FaceLabels;

  constructor(renderer: THREE.WebGLRenderer, faceLabels: FaceLabels) {
    this.renderer = renderer;
    this.faceLabels = faceLabels;

    this.group = new THREE.Group();
    this.scene.add(this.group);

    const bgGeom = new THREE.BoxGeometry(CUBE_SIZE, CUBE_SIZE, CUBE_SIZE);
    const bgMat = new THREE.MeshBasicMaterial({ color: FACE_COLOR });
    this.group.add(new THREE.Mesh(bgGeom, bgMat));

    this.buildRegions();
    this.scene.add(new THREE.AmbientLight(0xffffff, 1));
  }

  /** Raycast against the cube regions for the given NDC pointer + camera. */
  pickRegion(pointer: THREE.Vector2, camera: THREE.PerspectiveCamera): RegionMesh | null {
    this.raycaster.setFromCamera(pointer, camera);
    const hits = this.raycaster.intersectObjects(this.group.children, false);
    if (!hits.length) return null;
    const data = hits[0]!.object.userData as { region?: Region };
    if (!data.region) return null;
    return this.meshById.get(data.region.id) ?? null;
  }

  dispose(): void {
    for (const r of this.regionMeshes) {
      (r.mesh.geometry as THREE.BufferGeometry).dispose();
      const m = r.mesh.material as THREE.Material | THREE.Material[];
      if (Array.isArray(m)) for (const mm of m) mm.dispose();
      else m.dispose();
    }
  }

  // ─── geometry construction ────────────────────────────────────────

  private buildRegions(): void {
    const f = this.faceLabels;
    const faceLabels: { id: string; dir: [number, number, number]; label: string }[] = [
      { id: 'face:right', dir: [1, 0, 0], label: f.right },
      { id: 'face:left', dir: [-1, 0, 0], label: f.left },
      { id: 'face:top', dir: [0, 1, 0], label: f.top },
      { id: 'face:bottom', dir: [0, -1, 0], label: f.bottom },
      { id: 'face:front', dir: [0, 0, 1], label: f.front },
      { id: 'face:back', dir: [0, 0, -1], label: f.back },
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
