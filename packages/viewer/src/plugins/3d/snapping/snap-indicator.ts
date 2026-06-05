import * as THREE from 'three';

import { LAYER_OVERLAY } from '../../../core/layers.js';
import type { SnapCandidate, SnapType } from './snap-engine.js';

const COLORS: Record<SnapType, number> = {
  vertex: 0x00cc66,
  midpoint: 0x00cccc,
  edge: 0xff9933,
  intersection: 0xcc66ff,
};

const SNAP_LABELS: Record<SnapType, string> = {
  vertex: 'Vertex',
  midpoint: 'Midpoint',
  edge: 'Edge',
  intersection: 'Intersection',
};

const CROSSHAIR_HALF = 0.5;
const RING_INNER = 0.12;
const RING_OUTER = 0.18;

function buildCrosshairGeometry(): THREE.BufferGeometry {
  const positions = new Float32Array([
    -CROSSHAIR_HALF, 0, 0,   CROSSHAIR_HALF, 0, 0,
    0, -CROSSHAIR_HALF, 0,   0, CROSSHAIR_HALF, 0,
  ]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geo;
}

const CROSSHAIR_GEO = buildCrosshairGeometry();
const RING_GEO = new THREE.RingGeometry(RING_INNER, RING_OUTER, 16);

export class SnapIndicator {
  private group: THREE.Group | null = null;
  private crosshair: THREE.LineSegments | null = null;
  private ring: THREE.Mesh | null = null;
  private crosshairMat: THREE.LineBasicMaterial | null = null;
  private ringMat: THREE.MeshBasicMaterial | null = null;
  private edgeLine: THREE.LineSegments | null = null;
  private edgeMat: THREE.LineBasicMaterial | null = null;
  private labelEl: HTMLDivElement | null = null;
  private visible = false;

  show(
    scene: THREE.Scene,
    candidate: SnapCandidate,
    modelScale: number,
    camera?: THREE.Camera,
  ): void {
    const color = COLORS[candidate.type];

    if (!this.group) {
      this.group = new THREE.Group();
      this.group.renderOrder = 998;
      this.group.layers.set(LAYER_OVERLAY);

      this.crosshairMat = new THREE.LineBasicMaterial({
        color,
        depthTest: false,
        linewidth: 2,
      });
      this.crosshair = new THREE.LineSegments(CROSSHAIR_GEO, this.crosshairMat);
      this.crosshair.renderOrder = 998;
      this.crosshair.layers.set(LAYER_OVERLAY);
      this.group.add(this.crosshair);

      this.ringMat = new THREE.MeshBasicMaterial({
        color,
        depthTest: false,
        side: THREE.DoubleSide,
      });
      this.ring = new THREE.Mesh(RING_GEO, this.ringMat);
      this.ring.renderOrder = 998;
      this.ring.layers.set(LAYER_OVERLAY);
      this.group.add(this.ring);
    }

    this.crosshairMat!.color.setHex(color);
    this.ringMat!.color.setHex(color);
    this.group.position.copy(candidate.point);

    // Screen-constant size: scale based on distance to camera
    let scale = Math.max(modelScale / 200, 0.02);
    if (camera) {
      const dist = camera.position.distanceTo(candidate.point);
      scale = dist * 0.012;
    }
    this.group.scale.setScalar(scale);

    // Billboard: always face camera
    if (camera) {
      this.group.quaternion.copy(camera.quaternion);
    }

    if (!this.visible) {
      scene.add(this.group);
    }

    // --- snap type label ---
    this.updateLabel(candidate.type, candidate.point, camera, scene);

    // --- edge highlight ---
    if (candidate.edge) {
      const [a, b] = candidate.edge;
      if (!this.edgeLine) {
        this.edgeMat = new THREE.LineBasicMaterial({ color, depthTest: false });
        const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
        this.edgeLine = new THREE.LineSegments(geo, this.edgeMat);
        this.edgeLine.renderOrder = 998;
        this.edgeLine.layers.set(LAYER_OVERLAY);
      } else {
        this.edgeMat!.color.setHex(color);
        const geo = this.edgeLine.geometry;
        const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
        posAttr.setXYZ(0, a.x, a.y, a.z);
        posAttr.setXYZ(1, b.x, b.y, b.z);
        posAttr.needsUpdate = true;
        geo.computeBoundingSphere();
      }

      if (!this.visible || !this.edgeLine.parent) {
        scene.add(this.edgeLine);
      }
    } else if (this.edgeLine?.parent) {
      scene.remove(this.edgeLine);
    }

    this.visible = true;
  }

  hide(scene: THREE.Scene): void {
    if (!this.visible) return;
    if (this.group?.parent) scene.remove(this.group);
    if (this.edgeLine?.parent) scene.remove(this.edgeLine);
    this.hideLabel();
    this.visible = false;
  }

  dispose(): void {
    this.crosshairMat?.dispose();
    this.ringMat?.dispose();
    this.edgeMat?.dispose();
    this.edgeLine?.geometry.dispose();
    this.hideLabel();
    this.group = null;
    this.crosshair = null;
    this.ring = null;
    this.crosshairMat = null;
    this.ringMat = null;
    this.edgeLine = null;
    this.edgeMat = null;
    this.visible = false;
  }

  private updateLabel(
    type: SnapType,
    worldPos: THREE.Vector3,
    camera: THREE.Camera | undefined,
    scene: THREE.Scene,
  ): void {
    if (!camera) {
      this.hideLabel();
      return;
    }

    if (!this.labelEl) {
      this.labelEl = document.createElement('div');
      this.labelEl.style.cssText =
        'position:fixed;pointer-events:none;user-select:none;' +
        'font-family:system-ui,sans-serif;font-size:10px;font-weight:600;' +
        'padding:1px 5px;border-radius:3px;white-space:nowrap;' +
        'z-index:10000;transition:opacity 100ms;';
      document.body.appendChild(this.labelEl);
    }

    const color = COLORS[type];
    const r = (color >> 16) & 0xff;
    const g = (color >> 8) & 0xff;
    const b = color & 0xff;
    this.labelEl.style.background = `rgba(${r},${g},${b},0.85)`;
    this.labelEl.style.color = '#fff';
    this.labelEl.textContent = SNAP_LABELS[type];
    this.labelEl.style.opacity = '1';

    // Project world position to screen
    const ndc = worldPos.clone().project(camera);
    const canvas = scene.userData['__canvas'] as HTMLCanvasElement | undefined;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      const sx = ((ndc.x + 1) / 2) * rect.width + rect.left;
      const sy = ((1 - ndc.y) / 2) * rect.height + rect.top;
      this.labelEl.style.left = `${sx + 12}px`;
      this.labelEl.style.top = `${sy - 8}px`;
    }
  }

  private hideLabel(): void {
    if (this.labelEl) {
      this.labelEl.remove();
      this.labelEl = null;
    }
  }
}
