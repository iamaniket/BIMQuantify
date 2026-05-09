import * as THREE from 'three';

import { LAYER_OVERLAY } from '../../core/layers.js';
import type { SnapCandidate, SnapType } from './snap-engine.js';

const COLORS: Record<SnapType, number> = {
  vertex: 0x00cc66,
  midpoint: 0x00cccc,
  edge: 0xff9933,
};

const DOT_GEO = new THREE.SphereGeometry(0.05, 12, 12);

export class SnapIndicator {
  private dot: THREE.Mesh | null = null;
  private edgeLine: THREE.LineSegments | null = null;
  private dotMat: THREE.MeshBasicMaterial | null = null;
  private edgeMat: THREE.LineBasicMaterial | null = null;
  private visible = false;

  show(
    scene: THREE.Scene,
    candidate: SnapCandidate,
    modelScale: number,
  ): void {
    const color = COLORS[candidate.type];

    // --- dot ---
    if (!this.dot) {
      this.dotMat = new THREE.MeshBasicMaterial({ color, depthTest: false });
      this.dot = new THREE.Mesh(DOT_GEO, this.dotMat);
      this.dot.renderOrder = 998;
      this.dot.layers.set(LAYER_OVERLAY);
    }
    this.dotMat!.color.setHex(color);
    this.dot.position.copy(candidate.point);
    const dotScale = Math.max(modelScale / 200, 0.02);
    this.dot.scale.setScalar(dotScale / 0.05);

    if (!this.visible) {
      scene.add(this.dot);
    }

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
    if (this.dot?.parent) scene.remove(this.dot);
    if (this.edgeLine?.parent) scene.remove(this.edgeLine);
    this.visible = false;
  }

  dispose(): void {
    this.dotMat?.dispose();
    this.edgeMat?.dispose();
    this.edgeLine?.geometry.dispose();
    this.dot = null;
    this.edgeLine = null;
    this.dotMat = null;
    this.edgeMat = null;
    this.visible = false;
  }
}
