/**
 * `document-camera-pose` — renders a "you are here" camera marker on a PDF page,
 * the DocumentViewer counterpart to the floor-plan plugin's `setCameraPose`. The
 * host (portal) projects the live 3D camera pose through the active sheet
 * transform (`minimap.projectPoints` → normalized page coords) and feeds it via
 * the `document.setCameraPose` command. Display-only (no drag-to-reposition).
 */

import * as THREE from 'three';

import type { DocumentContext, DocumentPlugin } from '../../../pdf-core/documentTypes.js';
import type { SceneAPI } from '../scene/index.js';
import { applyConstantScale } from '../shared/screenConstant.js';

const NAME = 'document-camera-pose' as const;
const LAYER = 'camera-pose' as const;
const RENDER_ORDER = 28; // above markup(20), below entity markers(30)

/** A camera pose in normalized page coords (0..1, top-left origin, Y-down). */
export interface DocumentCameraPose {
  hereX: number;
  hereY: number;
  lookX: number;
  lookY: number;
}

export interface DocumentCameraPoseOptions {
  /** Marker color (theme-resolved by the host). Defaults to a blue accent. */
  color?: THREE.ColorRepresentation;
}

// Camera-marker geometry (authored in px, pointing +X) — mirrors the floor-plan
// marker so 2D plan and aligned PDF read identically.
const CAM_FOV_RADIUS_PX = 28;
const CAM_FOV_HALF_ANGLE = THREE.MathUtils.degToRad(30);
const CAM_BODY_HALF_PX = 6;
const CAM_HANDLE_R_PX = 4;

function circleShape(cx: number, cy: number, r: number, segments = 20): THREE.Shape {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < segments; i += 1) {
    const t = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector2(cx + Math.cos(t) * r, cy + Math.sin(t) * r));
  }
  return new THREE.Shape(pts);
}

function buildCameraMarker(color: THREE.ColorRepresentation): THREE.Group {
  const group = new THREE.Group();
  const solid = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true });

  const wedgeShape = new THREE.Shape();
  wedgeShape.moveTo(0, 0);
  const STEPS = 16;
  for (let i = 0; i <= STEPS; i += 1) {
    const a = -CAM_FOV_HALF_ANGLE + (CAM_FOV_HALF_ANGLE * 2 * i) / STEPS;
    wedgeShape.lineTo(Math.cos(a) * CAM_FOV_RADIUS_PX, Math.sin(a) * CAM_FOV_RADIUS_PX);
  }
  wedgeShape.lineTo(0, 0);
  const wedgeMat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.18 });
  const wedge = new THREE.Mesh(new THREE.ShapeGeometry(wedgeShape), wedgeMat);
  wedge.renderOrder = RENDER_ORDER + 1;
  wedge.frustumCulled = false;

  const b = CAM_BODY_HALF_PX;
  const bodyShape = new THREE.Shape([
    new THREE.Vector2(-b, -b),
    new THREE.Vector2(b * 0.4, -b),
    new THREE.Vector2(b * 0.4, -b * 0.5),
    new THREE.Vector2(b * 1.1, -b * 0.5),
    new THREE.Vector2(b * 1.1, b * 0.5),
    new THREE.Vector2(b * 0.4, b * 0.5),
    new THREE.Vector2(b * 0.4, b),
    new THREE.Vector2(-b, b),
  ]);
  const body = new THREE.Mesh(new THREE.ShapeGeometry(bodyShape), solid);
  body.material.opacity = 0.95;
  body.renderOrder = RENDER_ORDER + 2;
  body.frustumCulled = false;

  const handle = new THREE.Mesh(
    new THREE.ShapeGeometry(circleShape(CAM_FOV_RADIUS_PX, 0, CAM_HANDLE_R_PX)),
    solid,
  );
  handle.renderOrder = RENDER_ORDER + 3;
  handle.frustumCulled = false;

  group.add(wedge, body, handle);
  return group;
}

export function documentCameraPosePlugin(opts: DocumentCameraPoseOptions = {}): DocumentPlugin {
  const color = opts.color ?? 0x2563eb;
  let ctx: DocumentContext | null = null;
  let sceneApi: SceneAPI | null = null;
  let layer: THREE.Group | null = null;
  let group: THREE.Group | null = null;
  let offCamera: (() => void) | null = null;

  function setPose(pose: DocumentCameraPose | null): void {
    if (!ctx || !sceneApi || !group) return;
    const unscaled = ctx.getUnscaledViewport();
    if (!pose || !unscaled) {
      group.visible = false;
      sceneApi.requestRender();
      return;
    }
    // Normalized [0..1] top-left → PDF page world (Y-up, origin bottom-left) —
    // the same mapping the entity-marker layer uses, so the marker and the pins
    // share one frame.
    const wx = pose.hereX * unscaled.width;
    const wy = (1 - pose.hereY) * unscaled.height;
    const lx = pose.lookX * unscaled.width;
    const ly = (1 - pose.lookY) * unscaled.height;
    group.visible = true;
    group.position.set(wx, wy, 0);
    group.rotation.z = Math.atan2(ly - wy, lx - wx);
    applyConstantScale(group, sceneApi);
    sceneApi.requestRender();
  }

  return {
    name: NAME,
    dependencies: ['scene'],

    install(context: DocumentContext): void {
      ctx = context;
      sceneApi = context.plugins.get<SceneAPI>('scene');
      if (!sceneApi) throw new Error('document-camera-pose requires the scene plugin');
      layer = sceneApi.addLayer(LAYER, RENDER_ORDER);
      group = buildCameraMarker(color);
      group.visible = false;
      layer.add(group);

      context.commands.register(
        'document.setCameraPose',
        (a: unknown) => setPose((a as DocumentCameraPose | null) ?? null),
        { title: 'Set the you-are-here camera marker' },
      );

      // Keep the marker constant-size on zoom (rotation/position are pose-driven).
      offCamera = context.events.on('camera:change', () => {
        if (group?.visible && sceneApi) applyConstantScale(group, sceneApi);
      });
    },

    uninstall(): void {
      offCamera?.();
      offCamera = null;
      if (layer && group) layer.remove(group);
      ctx = null;
      sceneApi = null;
      layer = null;
      group = null;
    },
  };
}
