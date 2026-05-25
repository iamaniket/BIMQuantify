import * as THREE from 'three';
import type { Vec3, ViewerContext } from '../../core/types.js';

interface PlaneRef {
  normal: THREE.Vector3;
  point: THREE.Vector3;
}

export type GizmoUpdateCallback = (update: { point?: Vec3; normal?: Vec3 }) => void;

const ARROW_COLOR = 0x1e90ff;
const ARROW_HOVER = 0x60b0ff;
const RING_COLORS = { x: 0xe74c3c, y: 0x2ecc71, z: 0x3498db } as const;
const RING_HOVER_ALPHA = 0.9;
const RING_ALPHA = 0.6;
const SNAP_ANGLE = Math.PI / 12; // 15°

export class SectionGizmo {
  private readonly group = new THREE.Group();
  private readonly ctx: ViewerContext;
  private readonly onUpdate: GizmoUpdateCallback;
  private readonly helperSize: number;

  private arrowPos: THREE.Mesh | null = null;
  private arrowNeg: THREE.Mesh | null = null;
  private arrowLine: THREE.Line | null = null;
  private rings: Array<{ mesh: THREE.Mesh; axis: THREE.Vector3; key: 'x' | 'y' | 'z' }> = [];

  private dragging: 'translate' | 'rotate' | null = null;
  private dragAxis = new THREE.Vector3();
  private dragStartPoint = new THREE.Vector3();
  private dragStartNormal = new THREE.Vector3();
  private dragPlaneRef = new THREE.Vector3();
  private hoveredObj: THREE.Object3D | null = null;
  private entry: PlaneRef;
  private shiftHeld = false;

  private readonly raycaster = new THREE.Raycaster();
  private readonly onPointerDown: (e: PointerEvent) => void;
  private readonly onPointerMove: (e: PointerEvent) => void;
  private readonly onPointerUp: (e: PointerEvent) => void;
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;

  /**
   * @param ctx Viewer context
   * @param entry Plane position and normal
   * @param onUpdate Callback when plane is moved/rotated
   * @param helperSize The current section plane helper size (world units).
   *                   Gizmo dimensions are derived from this so they stay
   *                   proportional to the visible plane.
   */
  constructor(ctx: ViewerContext, entry: PlaneRef, onUpdate: GizmoUpdateCallback, helperSize?: number) {
    this.ctx = ctx;
    this.entry = entry;
    this.onUpdate = onUpdate;
    this.helperSize = helperSize ?? this.fallbackScale();

    this.group.name = 'section-gizmo';
    this.buildArrows();
    this.buildRings();
    this.syncTransform();
    ctx.scene.add(this.group);

    this.onPointerDown = (e) => { this.handlePointerDown(e); };
    this.onPointerMove = (e) => { this.handlePointerMove(e); };
    this.onPointerUp = () => { this.handlePointerUp(); };
    this.onKeyDown = (e) => { if (e.key === 'Shift') this.shiftHeld = true; };
    this.onKeyUp = (e) => { if (e.key === 'Shift') this.shiftHeld = false; };

    ctx.canvas.addEventListener('pointerdown', this.onPointerDown);
    ctx.canvas.addEventListener('pointermove', this.onPointerMove);
    ctx.canvas.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  attach(entry: PlaneRef): void {
    this.entry = entry;
    this.syncTransform();
  }

  detach(): void {
    this.group.removeFromParent();
  }

  dispose(): void {
    this.detach();
    this.ctx.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.ctx.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.ctx.canvas.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.group.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      if (m.material) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) mat.dispose();
      }
    });
  }

  isDragging(): boolean {
    return this.dragging !== null;
  }

  // ----- build geometry -----

  /** Fallback scale from model bounding box (used when no helperSize is given). */
  private fallbackScale(): number {
    const box = new THREE.Box3();
    for (const model of this.ctx.models().values()) {
      const mBox = model.box;
      if (mBox && !mBox.isEmpty()) box.union(mBox);
    }
    if (box.isEmpty()) return 10;
    const size = box.getSize(new THREE.Vector3());
    return Math.max(size.x, size.y, size.z);
  }

  /** Gizmo element scale — derived from the helper plane size. */
  private getGizmoScale(): number {
    return this.helperSize * 0.15;
  }

  private buildArrows(): void {
    const scale = this.getGizmoScale();
    const coneGeo = new THREE.ConeGeometry(scale * 0.15, scale * 0.4, 12);
    const lineMat = new THREE.LineBasicMaterial({ color: ARROW_COLOR, depthTest: false });

    const makeCone = (dir: number): THREE.Mesh => {
      const mat = new THREE.MeshBasicMaterial({
        color: ARROW_COLOR,
        depthTest: false,
        transparent: true,
        opacity: 0.85,
      });
      const mesh = new THREE.Mesh(coneGeo, mat);
      mesh.renderOrder = 999;
      mesh.position.set(0, 0, dir * scale * 1.5);
      // ConeGeometry points along +Y by default; rotate so it aligns with ±Z.
      mesh.rotation.x = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      mesh.userData = { gizmoType: 'translate', dir };
      return mesh;
    };

    this.arrowPos = makeCone(1);
    this.arrowNeg = makeCone(-1);

    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, -scale * 1.5),
      new THREE.Vector3(0, 0, scale * 1.5),
    ]);
    this.arrowLine = new THREE.Line(lineGeo, lineMat);
    this.arrowLine.renderOrder = 999;

    this.group.add(this.arrowPos, this.arrowNeg, this.arrowLine);
  }

  private buildRings(): void {
    const scale = this.getGizmoScale();
    const radius = scale * 1.2;
    const axes: Array<{ key: 'x' | 'y' | 'z'; axis: THREE.Vector3; color: number }> = [
      { key: 'x', axis: new THREE.Vector3(1, 0, 0), color: RING_COLORS.x },
      { key: 'y', axis: new THREE.Vector3(0, 1, 0), color: RING_COLORS.y },
      { key: 'z', axis: new THREE.Vector3(0, 0, 1), color: RING_COLORS.z },
    ];

    for (const { key, axis, color } of axes) {
      const ringGeo = new THREE.TorusGeometry(radius, scale * 0.03, 8, 48);
      const mat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: RING_ALPHA,
        depthTest: false,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.renderOrder = 999;
      mesh.userData = { gizmoType: 'rotate', axis: key };

      // Orient ring so it lies in a plane perpendicular to the axis
      if (key === 'x') mesh.rotation.y = Math.PI / 2;
      else if (key === 'y') mesh.rotation.x = Math.PI / 2;
      // z ring is already in the XY plane

      this.group.add(mesh);
      this.rings.push({ mesh, axis, key });
    }
  }

  private syncTransform(): void {
    const quat = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      this.entry.normal.clone().normalize(),
    );
    this.group.quaternion.copy(quat);
    this.group.position.copy(this.entry.point);
  }

  // ----- pointer helpers -----

  private ndcFromEvent(e: PointerEvent): THREE.Vector2 {
    const rect = this.ctx.canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -(((e.clientY - rect.top) / rect.height) * 2 - 1),
    );
  }

  private hitTest(ndc: THREE.Vector2): THREE.Intersection | null {
    const camera = this.ctx.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
    this.raycaster.setFromCamera(ndc, camera);
    const targets = [this.arrowPos, this.arrowNeg, ...this.rings.map((r) => r.mesh)].filter(Boolean) as THREE.Object3D[];
    const hits = this.raycaster.intersectObjects(targets, false);
    return hits.length > 0 ? hits[0]! : null;
  }

  private setHover(obj: THREE.Object3D | null): void {
    if (this.hoveredObj === obj) return;

    // Restore previous
    if (this.hoveredObj) {
      const mat = (this.hoveredObj as THREE.Mesh).material as THREE.MeshBasicMaterial;
      if (this.hoveredObj.userData.gizmoType === 'translate') {
        mat.color.set(ARROW_COLOR);
      } else {
        mat.opacity = RING_ALPHA;
      }
      mat.needsUpdate = true;
    }

    this.hoveredObj = obj;

    // Apply hover
    if (obj) {
      const mat = (obj as THREE.Mesh).material as THREE.MeshBasicMaterial;
      if (obj.userData.gizmoType === 'translate') {
        mat.color.set(ARROW_HOVER);
      } else {
        mat.opacity = RING_HOVER_ALPHA;
      }
      mat.needsUpdate = true;
    }
  }

  // ----- drag: translate -----

  private projectOnNormalAxis(ndc: THREE.Vector2): number | null {
    const camera = this.ctx.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
    this.raycaster.setFromCamera(ndc, camera);
    const ray = this.raycaster.ray;

    const worldNormal = this.entry.normal.clone().normalize();
    const origin = this.entry.point.clone();

    // Closest point on normal axis to camera ray
    const w0 = ray.origin.clone().sub(origin);
    const a = ray.direction.dot(ray.direction);
    const b = ray.direction.dot(worldNormal);
    const c = worldNormal.dot(worldNormal);
    const d = ray.direction.dot(w0);
    const e = worldNormal.dot(w0);
    const denom = a * c - b * b;
    if (Math.abs(denom) < 1e-8) return null;
    const t = (b * e - c * d) / denom;
    const closestOnRay = ray.origin.clone().add(ray.direction.clone().multiplyScalar(t));
    return closestOnRay.clone().sub(origin).dot(worldNormal);
  }

  // ----- drag: rotate -----

  private projectOnRotationPlane(ndc: THREE.Vector2, axis: THREE.Vector3): THREE.Vector3 | null {
    const camera = this.ctx.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
    this.raycaster.setFromCamera(ndc, camera);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(axis, this.entry.point);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, hit)) return null;
    return hit.sub(this.entry.point);
  }

  // ----- event handlers -----

  private handlePointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    const ndc = this.ndcFromEvent(e);
    const hit = this.hitTest(ndc);
    if (!hit) return;

    const obj = hit.object;
    e.stopPropagation();
    this.ctx.canvas.setPointerCapture(e.pointerId);

    if (obj.userData.gizmoType === 'translate') {
      this.dragging = 'translate';
      const proj = this.projectOnNormalAxis(ndc);
      this.dragStartPoint.copy(this.entry.point);
      this.dragPlaneRef.set(proj ?? 0, 0, 0);
    } else if (obj.userData.gizmoType === 'rotate') {
      this.dragging = 'rotate';
      const key = obj.userData.axis as 'x' | 'y' | 'z';
      const worldAxis = key === 'x' ? new THREE.Vector3(1, 0, 0) : key === 'y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
      this.dragAxis.copy(worldAxis);
      this.dragStartNormal.copy(this.entry.normal);
      const refVec = this.projectOnRotationPlane(ndc, worldAxis);
      if (refVec) this.dragPlaneRef.copy(refVec);
    }
  }

  private handlePointerMove(e: PointerEvent): void {
    const ndc = this.ndcFromEvent(e);

    if (this.dragging === 'translate') {
      e.stopPropagation();
      const proj = this.projectOnNormalAxis(ndc);
      if (proj === null) return;
      const delta = proj - this.dragPlaneRef.x;
      const newPoint = this.dragStartPoint.clone().addScaledVector(this.entry.normal, delta);
      this.onUpdate({ point: { x: newPoint.x, y: newPoint.y, z: newPoint.z } });
      return;
    }

    if (this.dragging === 'rotate') {
      e.stopPropagation();
      const curVec = this.projectOnRotationPlane(ndc, this.dragAxis);
      if (!curVec || curVec.length() < 1e-6 || this.dragPlaneRef.length() < 1e-6) return;
      let angle = this.dragPlaneRef.angleTo(curVec);
      const cross = new THREE.Vector3().crossVectors(this.dragPlaneRef, curVec);
      if (cross.dot(this.dragAxis) < 0) angle = -angle;
      if (this.shiftHeld) angle = Math.round(angle / SNAP_ANGLE) * SNAP_ANGLE;
      const quat = new THREE.Quaternion().setFromAxisAngle(this.dragAxis, angle);
      const newNormal = this.dragStartNormal.clone().applyQuaternion(quat).normalize();
      this.onUpdate({ normal: { x: newNormal.x, y: newNormal.y, z: newNormal.z } });
      return;
    }

    // Hover highlight
    const hit = this.hitTest(ndc);
    this.setHover(hit ? hit.object : null);
  }

  private handlePointerUp(): void {
    if (this.dragging) {
      this.dragging = null;
      this.syncTransform();
    }
  }
}
