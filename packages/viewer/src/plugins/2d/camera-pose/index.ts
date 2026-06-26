/**
 * `document-camera-pose` — renders a draggable "you are here" camera marker on a
 * PDF page, the DocumentViewer counterpart to the floor-plan plugin's
 * `setCameraPose`. The host (portal) projects the live 3D camera pose through the
 * active sheet transform (`minimap.projectPoints` → normalized page coords) and
 * feeds it via the `document.setCameraPose` command.
 *
 * Dragging the marker (move the body / aim the handle) emits `document:cameraPose`
 * in normalized page coords — the same frame `document:pick` uses — so the host
 * bridges it to the 3D camera (`minimap.placeCamera`) exactly as the floor-plan
 * pane does for `floorplan:cameraPose`. Mirrors the floor-plan plugin's drag so a
 * plan and an aligned PDF read and behave identically.
 */

import * as THREE from 'three';

import type { DocumentContext, DocumentPlugin } from '../../../pdf-core/documentTypes.js';
import type { SceneAPI } from '../scene/index.js';
import { applyConstantScale } from '../shared/screenConstant.js';
import { screenToPagePoint } from '../shared/screenToPage.js';

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
// marker so 2D plan and aligned PDF read identically. These px constants are also
// the source of truth for drag hit-testing — keep them in sync.
const CAM_FOV_RADIUS_PX = 28;
const CAM_FOV_HALF_ANGLE = THREE.MathUtils.degToRad(30);
const CAM_BODY_HALF_PX = 6;
const CAM_HANDLE_PX = CAM_FOV_RADIUS_PX; // rotate handle sits at the wedge tip (+X)
const CAM_HANDLE_R_PX = 4;
const CAM_MOVE_HIT_PX = 14; // grab radius for the body (move drag)
const CAM_AIM_HIT_PX = 13; // grab radius for the rotate handle (aim drag)

function circleShape(cx: number, cy: number, r: number, segments = 20): THREE.Shape {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < segments; i += 1) {
    const t = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector2(cx + Math.cos(t) * r, cy + Math.sin(t) * r));
  }
  return new THREE.Shape(pts);
}

const SELECT_R_PX = 12; // px radius of the persistent selection ring

/** Persistent selection-highlight marker (ring + dot, px-authored). */
function buildSelectionMarker(color: THREE.ColorRepresentation): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true });
  const ring = new THREE.Mesh(new THREE.RingGeometry(SELECT_R_PX - 2, SELECT_R_PX, 32), mat);
  ring.renderOrder = RENDER_ORDER + 1;
  ring.frustumCulled = false;
  const dot = new THREE.Mesh(new THREE.ShapeGeometry(circleShape(0, 0, 2.5)), mat);
  dot.renderOrder = RENDER_ORDER + 2;
  dot.frustumCulled = false;
  group.add(ring, dot);
  return group;
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
    new THREE.ShapeGeometry(circleShape(CAM_HANDLE_PX, 0, CAM_HANDLE_R_PX)),
    solid,
  );
  handle.renderOrder = RENDER_ORDER + 3;
  handle.frustumCulled = false;

  group.add(wedge, body, handle);
  return group;
}

/** Augment the document event map with the PDF camera-pose drag event. */
declare module '../../../pdf-core/documentTypes.js' {
  interface DocumentEvents {
    /**
     * The user dragged the "you are here" camera marker (move or aim).
     * Normalized page coords (0..1, top-left, Y-down) — the same frame
     * `document:pick` uses. The host bridges this to the 3D camera
     * (`minimap.placeCamera`), exactly as the floor plan bridges
     * `floorplan:cameraPose`.
     */
    'document:cameraPose': { hereX: number; hereY: number; lookX: number; lookY: number };
  }
}

export function documentCameraPosePlugin(opts: DocumentCameraPoseOptions = {}): DocumentPlugin {
  const color = opts.color ?? 0x2563eb;
  let ctx: DocumentContext | null = null;
  let sceneApi: SceneAPI | null = null;
  let layer: THREE.Group | null = null;
  let group: THREE.Group | null = null;
  let selectGroup: THREE.Group | null = null; // persistent selection highlight
  let offCamera: (() => void) | null = null;

  /** Latest pose in normalized page coords (drives the marker + seeds drag math). */
  let lastPose: DocumentCameraPose | null = null;
  /** While the user drags the marker, ignore host-echoed poses so they don't fight it. */
  let draggingCamera = false;
  let dragMode: 'aim' | 'move' | null = null;

  /** Apply a pose to the marker visuals (normalized → page world). */
  function applyPose(pose: DocumentCameraPose | null): void {
    if (!ctx || !sceneApi || !group) return;
    const unscaled = ctx.getUnscaledViewport();
    if (!pose || !unscaled) {
      lastPose = pose ?? null;
      group.visible = false;
      sceneApi.requestRender();
      return;
    }
    lastPose = pose;
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

  /** Event client coords → container-relative px. */
  function toContainer(ev: PointerEvent): { x: number; y: number } {
    const rect = ctx!.container.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  /** Which part of the marker (if any) the cursor is over. */
  function hitTestMarker(containerX: number, containerY: number): 'aim' | 'move' | null {
    if (!sceneApi || !group?.visible || !lastPose) return null;
    const c = group.position;
    const wpp = sceneApi.worldPerPx();
    const rot = group.rotation.z;
    const hWorld = sceneApi.worldToScreen(
      c.x + Math.cos(rot) * CAM_HANDLE_PX * wpp,
      c.y + Math.sin(rot) * CAM_HANDLE_PX * wpp,
    );
    if (Math.hypot(hWorld.x - containerX, hWorld.y - containerY) <= CAM_AIM_HIT_PX) return 'aim';
    const cScreen = sceneApi.worldToScreen(c.x, c.y);
    if (Math.hypot(cScreen.x - containerX, cScreen.y - containerY) <= CAM_MOVE_HIT_PX) return 'move';
    return null;
  }

  function onDragMove(ev: PointerEvent): void {
    if (!ctx || !sceneApi || !lastPose || !dragMode) return;
    const { x, y } = toContainer(ev);
    const page = screenToPagePoint(ctx, sceneApi, x, y);
    if (!page) return;
    if (dragMode === 'move') {
      // Reposition; keep the current heading (carry the here→look delta).
      const dx = lastPose.lookX - lastPose.hereX;
      const dy = lastPose.lookY - lastPose.hereY;
      lastPose = { hereX: page.x, hereY: page.y, lookX: page.x + dx, lookY: page.y + dy };
    } else {
      // Aim: keep position, point toward the cursor.
      lastPose = { hereX: lastPose.hereX, hereY: lastPose.hereY, lookX: page.x, lookY: page.y };
    }
    applyPose(lastPose);
    ctx.events.emit('document:cameraPose', { ...lastPose });
  }

  function endDrag(): void {
    if (!dragMode) return;
    dragMode = null;
    draggingCamera = false;
    window.removeEventListener('pointermove', onDragMove, true);
    window.removeEventListener('pointerup', endDrag, true);
  }

  function onMarkerPointerDown(ev: PointerEvent): void {
    if (ev.button !== 0 || !ctx) return;
    const { x, y } = toContainer(ev);
    const mode = hitTestMarker(x, y);
    if (!mode) return; // not on the marker — let camera-controls / pick handle it
    ev.preventDefault();
    ev.stopPropagation();
    dragMode = mode;
    draggingCamera = true;
    window.addEventListener('pointermove', onDragMove, true);
    window.addEventListener('pointerup', endDrag, true);
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
      selectGroup = buildSelectionMarker(color);
      selectGroup.visible = false;
      layer.add(group, selectGroup);

      context.commands.register(
        'document.setCameraPose',
        (a: unknown) => {
          // A live drag owns the marker — ignore echoed poses (the camera move →
          // minimap:pose round-trip) until the drag ends.
          if (draggingCamera) return;
          applyPose((a as DocumentCameraPose | null) ?? null);
        },
        { title: 'Set the you-are-here camera marker' },
      );

      // Persistent selection highlight at a normalized page point (0..1, top-left,
      // Y-down — the frame `document:pick` uses). Null clears it. The host drives
      // this from the 3D selection projected through the active sheet transform.
      context.commands.register(
        'document.setSelectionMarker',
        (a: unknown) => {
          if (!ctx || !sceneApi || !selectGroup) return;
          const p = (a as { nx: number; ny: number } | null) ?? null;
          const unscaled = ctx.getUnscaledViewport();
          if (!p || !unscaled) {
            selectGroup.visible = false;
            sceneApi.requestRender();
            return;
          }
          selectGroup.position.set(p.nx * unscaled.width, (1 - p.ny) * unscaled.height, 0);
          selectGroup.visible = true;
          applyConstantScale(selectGroup, sceneApi);
          sceneApi.requestRender();
        },
        { title: 'Set/clear the persistent PDF selection highlight' },
      );

      // Grab the camera marker on pointerdown (capture phase) so a drag on it
      // pre-empts camera-controls truck / document.pick. Mirrors the floor-plan
      // plugin's pattern.
      context.container.addEventListener('pointerdown', onMarkerPointerDown, true);

      // Keep the markers constant-size on zoom (rotation/position are pose-driven).
      offCamera = context.events.on('camera:change', () => {
        if (!sceneApi) return;
        if (group?.visible) applyConstantScale(group, sceneApi);
        if (selectGroup?.visible) applyConstantScale(selectGroup, sceneApi);
      });
    },

    uninstall(): void {
      offCamera?.();
      offCamera = null;
      endDrag();
      ctx?.container.removeEventListener('pointerdown', onMarkerPointerDown, true);
      if (layer && group) layer.remove(group);
      if (layer && selectGroup) layer.remove(selectGroup);
      ctx = null;
      sceneApi = null;
      layer = null;
      group = null;
      selectGroup = null;
      lastPose = null;
    },
  };
}
