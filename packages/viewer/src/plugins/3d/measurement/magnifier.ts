/**
 * Magnifier loupe — renders a zoomed-in view of the cursor area during
 * measurement point picking. Shows a 200x200px square overlay positioned
 * at top-left or bottom-left, flipping when cursor approaches.
 */

import * as THREE from 'three';

export interface MagnifierOptions {
  size?: number;
  zoom?: number;
}

const DEFAULT_SIZE = 400;
const DEFAULT_ZOOM = 5;
const MARGIN = 12;
const FLIP_THRESHOLD = 430;

type Corner = 'top-left' | 'bottom-left';

export class Magnifier {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  private renderTarget: THREE.WebGLRenderTarget;
  private loupeCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera | null = null;

  private el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx2d: CanvasRenderingContext2D;

  /**
   * Render-target resolution (px). Fixed at construction (the RT never resizes),
   * so the GPU readback buffer and the canvas ImageData below are allocated once
   * and reused every {@link update} — previously each pointer-move allocated a
   * fresh ~2.5 MB Uint8Array + ImageData, the dominant GC source while measuring.
   */
  private readonly res: number;
  private readonly readbackBuf: Uint8Array;
  private readonly loupeImageData: ImageData;

  private size: number;
  private zoom: number;
  private corner: Corner = 'top-left';
  private active = false;
  private lastCursorWorld: THREE.Vector3 | null = null;

  constructor(
    container: HTMLElement,
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
    options?: MagnifierOptions,
  ) {
    this.container = container;
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.size = options?.size ?? DEFAULT_SIZE;
    this.zoom = options?.zoom ?? DEFAULT_ZOOM;

    const res = this.size * Math.min(window.devicePixelRatio, 2);
    this.res = res;
    this.renderTarget = new THREE.WebGLRenderTarget(res, res, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
    });
    // Reused every frame (see field docs) — sized once to the fixed RT.
    this.readbackBuf = new Uint8Array(res * res * 4);

    this.el = document.createElement('div');
    this.el.style.cssText =
      `position:absolute;width:${this.size}px;height:${this.size}px;` +
      `border:2px solid rgba(150,150,150,0.5);border-radius:4px;` +
      `box-shadow:0 4px 16px rgba(0,0,0,0.2);overflow:hidden;` +
      `pointer-events:none;z-index:100;transition:top 200ms ease,left 200ms ease;` +
      `background:#111;`;

    this.canvas = document.createElement('canvas');
    this.canvas.width = res;
    this.canvas.height = res;
    this.canvas.style.cssText = `width:100%;height:100%;display:block;`;
    this.el.appendChild(this.canvas);
    this.ctx2d = this.canvas.getContext('2d')!;
    // Reused every frame (see field docs) — sized once to the fixed RT.
    this.loupeImageData = this.ctx2d.createImageData(res, res);

    this.setCorner('top-left');
  }

  show(): void {
    if (this.active) return;
    this.active = true;
    this.container.appendChild(this.el);
  }

  hide(): void {
    if (!this.active) return;
    this.active = false;
    this.el.remove();
    this.lastCursorWorld = null;
  }

  update(
    cursorWorld: THREE.Vector3 | null,
    cursorScreenX: number,
    cursorScreenY: number,
  ): void {
    if (!this.active || !cursorWorld) return;

    this.lastCursorWorld = cursorWorld;
    this.updateCorner(cursorScreenX, cursorScreenY);
    this.renderLoupe(cursorWorld);
  }

  dispose(): void {
    this.hide();
    this.renderTarget.dispose();
    this.loupeCamera = null;
  }

  private updateCorner(cx: number, cy: number): void {
    const rect = this.container.getBoundingClientRect();
    const relX = cx - rect.left;
    const relY = cy - rect.top;

    if (this.corner === 'top-left' && relX < FLIP_THRESHOLD && relY < FLIP_THRESHOLD) {
      this.setCorner('bottom-left');
    } else if (this.corner === 'bottom-left' && relX < FLIP_THRESHOLD && relY > rect.height - FLIP_THRESHOLD) {
      this.setCorner('top-left');
    }
  }

  private setCorner(c: Corner): void {
    this.corner = c;
    this.el.style.left = `${MARGIN}px`;
    if (c === 'top-left') {
      this.el.style.top = `${MARGIN}px`;
      this.el.style.bottom = '';
    } else {
      this.el.style.top = '';
      this.el.style.bottom = `${MARGIN}px`;
    }
  }

  private renderLoupe(target: THREE.Vector3): void {
    const cam = this.camera;

    if (cam instanceof THREE.PerspectiveCamera) {
      if (!this.loupeCamera || !(this.loupeCamera instanceof THREE.PerspectiveCamera)) {
        this.loupeCamera = cam.clone();
      }
      const lc = this.loupeCamera as THREE.PerspectiveCamera;
      lc.position.copy(cam.position);
      lc.quaternion.copy(cam.quaternion);
      lc.fov = cam.fov / this.zoom;
      lc.aspect = 1;
      lc.near = cam.near;
      lc.far = cam.far;

      // Offset to center on cursor target
      const dir = new THREE.Vector3().subVectors(target, cam.position).normalize();
      const camDir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const dist = cam.position.distanceTo(target);

      // Compute offset needed to center the target in the narrow FOV
      const offset = new THREE.Vector3().subVectors(dir, camDir).multiplyScalar(dist);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);

      const halfFovRad = THREE.MathUtils.degToRad(lc.fov / 2);
      const viewHeight = 2 * Math.tan(halfFovRad) * dist;
      const viewWidth = viewHeight;

      const shiftX = offset.dot(right) / (viewWidth / 2);
      const shiftY = offset.dot(up) / (viewHeight / 2);

      lc.setViewOffset(1, 1, -shiftX * 0.5, -shiftY * 0.5, 1, 1);
      lc.updateProjectionMatrix();

      // Simpler: just look at target
      lc.clearViewOffset();
      lc.lookAt(target);
      lc.updateProjectionMatrix();
    } else {
      // Orthographic
      if (!this.loupeCamera || !(this.loupeCamera instanceof THREE.OrthographicCamera)) {
        this.loupeCamera = cam.clone();
      }
      const lc = this.loupeCamera as THREE.OrthographicCamera;
      lc.position.copy(cam.position);
      lc.quaternion.copy(cam.quaternion);

      const halfW = (cam.right - cam.left) / 2 / this.zoom;
      const halfH = (cam.top - cam.bottom) / 2 / this.zoom;

      // Center on target
      const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(cam.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
      const toTarget = new THREE.Vector3().subVectors(target, cam.position);
      const cx = toTarget.dot(right);
      const cy = toTarget.dot(up);

      lc.left = cx - halfW;
      lc.right = cx + halfW;
      lc.top = cy + halfH;
      lc.bottom = cy - halfH;
      lc.near = cam.near;
      lc.far = cam.far;
      lc.updateProjectionMatrix();
    }

    // Render to off-screen target
    const currentTarget = this.renderer.getRenderTarget();
    const currentXrEnabled = this.renderer.xr.enabled;
    this.renderer.xr.enabled = false;

    this.renderer.setRenderTarget(this.renderTarget);
    this.renderer.render(this.scene, this.loupeCamera!);
    this.renderer.setRenderTarget(currentTarget);
    this.renderer.xr.enabled = currentXrEnabled;

    // Read pixels and draw to canvas — buffer + ImageData are reused across
    // frames (allocated once in the constructor) to avoid ~5 MB of per-move GC.
    const res = this.res;
    const buf = this.readbackBuf;
    this.renderer.readRenderTargetPixels(this.renderTarget, 0, 0, res, res, buf);

    const imageData = this.loupeImageData;
    // WebGL readPixels is bottom-up, flip vertically
    for (let y = 0; y < res; y++) {
      const srcRow = (res - 1 - y) * res * 4;
      const dstRow = y * res * 4;
      imageData.data.set(buf.subarray(srcRow, srcRow + res * 4), dstRow);
    }
    this.ctx2d.putImageData(imageData, 0, 0);

    // Draw crosshair
    this.ctx2d.strokeStyle = 'rgba(255,255,255,0.5)';
    this.ctx2d.lineWidth = 1;
    const half = res / 2;
    this.ctx2d.beginPath();
    this.ctx2d.moveTo(half, 0);
    this.ctx2d.lineTo(half, res);
    this.ctx2d.moveTo(0, half);
    this.ctx2d.lineTo(res, half);
    this.ctx2d.stroke();
  }
}
