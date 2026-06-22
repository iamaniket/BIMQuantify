/**
 * `floorplan` — renders a decoded BIMFPLN2 floor plan as world-space line work
 * in the shared 2D scene, so the whole 2D annotation stack (camera / measure /
 * entity-marker) runs over a storey plan exactly as it does over a PDF page.
 *
 * World space here is the `FloorPlanEngine`'s synthetic page box: the UNION
 * extent across all levels, origin at the union min. A plan point `(px,py)`
 * maps to world `(px − minX, py − minY)`; Y is already plan-up == world Y-up,
 * so there is no Y flip (unlike the canvas minimap). Switching level only
 * swaps the drawn line set — the coordinate frame is stable, so measure / marker
 * anchors stay valid across levels.
 *
 * Walls carry no element ids (the artifact concatenates anonymous segments);
 * only rooms (IfcSpace) carry a `spaceId`. Picking therefore resolves to the
 * nearest room within a screen-space threshold (see `floorplan.pick`).
 */

import * as THREE from 'three';

import type {
  DocumentContext,
  DocumentPlugin,
} from '../../../pdf-core/documentTypes.js';
import type { DecodedFloorPlans, FloorPlanLevel } from '../../3d/shared/floorplan-codec.js';
import { unionBbox, type PlanBbox } from '../../3d/shared/floorplanBbox.js';
import type { CameraPluginAPI } from '../camera/index.js';
import type { SceneAPI } from '../scene/index.js';
import { applyConstantScale, clearGroup, containerPointToWorld } from '../shared/screenConstant.js';

const NAME = 'floorplan' as const;
const LAYER = 'floorplan' as const;
const RENDER_ORDER = 5; // below measure(10)/markup(20)/markers(30)
const PICK_THRESHOLD_PX = 40;
const LABEL_MIN_PX_PER_UNIT = 0.18; // hide room labels when zoomed too far out
const PULSE_MS = 1200;
const PULSE_R = 14; // px radius of the focus pulse ring

/** Colors for the plan line work + labels. Portal passes theme-resolved values. */
export interface FloorPlanColors {
  /** Wall lines — any THREE color (hex number or CSS string). */
  wall: THREE.ColorRepresentation;
  /** Room outlines (subtle). */
  room: THREE.ColorRepresentation;
  /** Room label text — CSS color string (drawn to a 2D canvas). */
  label: string;
  /** Focus-pulse ring + accents. */
  accent: THREE.ColorRepresentation;
}

const DEFAULT_COLORS: FloorPlanColors = {
  wall: 0x111827,
  room: 0x9ca3af,
  label: '#6b7280',
  accent: 0x2563eb,
};

export interface FloorPlanPluginOptions {
  data: DecodedFloorPlans;
  /** spaceId → room label (joined from model metadata in the portal). */
  roomNames?: Map<number, string>;
  colors?: Partial<FloorPlanColors>;
}

export interface FloorPlanPluginAPI {
  setLevel(index: number): void;
  getLevels(): FloorPlanLevel[];
  /** plan = world + offset; offset = unionBbox.min. */
  planOffset(): { x: number; y: number };
  /** Pan/center the camera on a plan point. */
  focusPlanPoint(planX: number, planY: number): void;
  /** Flash a transient ring at a plan point (used by 3D→2D selection sync). */
  pulseAt(planX: number, planY: number): void;
  /**
   * Position the "you are here" camera marker (a view cone + dot) at a plan
   * point, oriented from `here` toward `look`. Driven by the 3D `minimap:pose`
   * event. Pass null to hide it.
   */
  setCameraPose(pose: { hereX: number; hereY: number; lookX: number; lookY: number } | null): void;
}

/** Augment the document event map with the floor-plan pick event. */
declare module '../../../pdf-core/documentTypes.js' {
  interface DocumentEvents {
    /** A left-click on the plan, resolved to a plan point + nearest room (or null). */
    'floorplan:pick': { planX: number; planY: number; spaceId: number | null };
    /**
     * The user dragged the "you are here" camera marker (move or aim). Plan
     * coords — the host bridges this to the 3D camera (`minimap.placeCamera`).
     */
    'floorplan:cameraPose': { hereX: number; hereY: number; lookX: number; lookY: number };
  }
}

/** Build a constant-size text sprite for a room label. */
function makeLabelSprite(text: string, color: string): THREE.Sprite | null {
  const canvas = document.createElement('canvas');
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const fontPx = 12;
  const pad = 4;
  const measureCtx = canvas.getContext('2d');
  if (!measureCtx) return null;
  measureCtx.font = `500 ${fontPx}px ui-sans-serif, system-ui, sans-serif`;
  const textW = Math.ceil(measureCtx.measureText(text).width);
  const w = textW + pad * 2;
  const h = fontPx + pad * 2;
  canvas.width = Math.ceil(w * dpr);
  canvas.height = Math.ceil(h * dpr);
  const c = canvas.getContext('2d');
  if (!c) return null;
  c.scale(dpr, dpr);
  c.font = `500 ${fontPx}px ui-sans-serif, system-ui, sans-serif`;
  c.textBaseline = 'middle';
  c.textAlign = 'center';
  c.fillStyle = color;
  c.fillText(text, w / 2, h / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true });
  const sprite = new THREE.Sprite(material);
  // Stash the px size; the sprite is scaled per-frame to base × worldPerPx so it
  // stays a constant size on screen. (Sprites can't live in a constant-scaled
  // group — the group scale would also shrink their world positions.)
  sprite.userData['baseW'] = w;
  sprite.userData['baseH'] = h;
  sprite.renderOrder = RENDER_ORDER + 2;
  return sprite;
}

// Camera-marker geometry (authored in px, pointing +X). These px constants are
// also the source of truth for drag hit-testing — keep them in sync.
const CAM_FOV_RADIUS_PX = 28; // length of the field-of-view wedge
const CAM_FOV_HALF_ANGLE = THREE.MathUtils.degToRad(30); // wedge half-spread
const CAM_BODY_HALF_PX = 6; // camera-body half-extent
const CAM_HANDLE_PX = CAM_FOV_RADIUS_PX; // rotate handle sits at the wedge tip (+X)
const CAM_HANDLE_R_PX = 4; // rotate-handle dot radius
const CAM_MOVE_HIT_PX = 14; // grab radius for the body (move drag)
const CAM_AIM_HIT_PX = 13; // grab radius for the rotate handle (aim drag)

/** Filled circle of `r` px centred at `(cx, cy)`. */
function circleShape(cx: number, cy: number, r: number, segments = 20): THREE.Shape {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < segments; i += 1) {
    const t = (i / segments) * Math.PI * 2;
    pts.push(new THREE.Vector2(cx + Math.cos(t) * r, cy + Math.sin(t) * r));
  }
  return new THREE.Shape(pts);
}

/**
 * Build the "you are here" camera marker — a translucent field-of-view wedge
 * (conveys aim), a small camera body at the origin, a center dot, and a rotate
 * handle at the wedge tip (the drag affordance for aiming). Authored in px,
 * pointing +X, in a group the caller scales by worldPerPx and rotates to the
 * camera heading (constant size on screen, like the canvas minimap's marker).
 */
function buildCameraMarker(color: THREE.ColorRepresentation): THREE.Group {
  const group = new THREE.Group();
  const solid = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true });

  // Field-of-view wedge (sector from the origin), low opacity.
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
  wedge.renderOrder = RENDER_ORDER + 4;
  wedge.frustumCulled = false;

  // Camera body — a small rounded square with a lens nub poking toward +X.
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
  body.renderOrder = RENDER_ORDER + 5;
  body.frustumCulled = false;

  // Rotate handle at the wedge tip (white-ringed dot for affordance).
  const handle = new THREE.Mesh(
    new THREE.ShapeGeometry(circleShape(CAM_HANDLE_PX, 0, CAM_HANDLE_R_PX)),
    solid,
  );
  handle.renderOrder = RENDER_ORDER + 6;
  handle.frustumCulled = false;

  group.add(wedge, body, handle);
  return group;
}

export function floorPlanPlugin(
  options: FloorPlanPluginOptions,
): DocumentPlugin & FloorPlanPluginAPI {
  const colors: FloorPlanColors = { ...DEFAULT_COLORS, ...(options.colors ?? {}) };
  const levels = options.data.levels;
  const roomNames = options.roomNames ?? new Map<number, string>();
  const union: PlanBbox = unionBbox(levels) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const offset = { x: union.minX, y: union.minY };

  let ctx: DocumentContext | null = null;
  let sceneApi: SceneAPI | null = null;
  let layer: THREE.Group | null = null;
  let lineGroup: THREE.Group | null = null; // walls + rooms (document-scaled)
  let labelGroup: THREE.Group | null = null; // room labels (constant screen size)
  let pulseGroup: THREE.Group | null = null; // transient focus ring (constant size)
  let cameraGroup: THREE.Group | null = null; // "you are here" view cone (constant size)
  /** Latest camera pose in plan coords (drives the marker + seeds drag math). */
  let lastPose: { hereX: number; hereY: number; lookX: number; lookY: number } | null = null;
  /** While the user drags the marker, ignore echoed poses so they don't fight it. */
  let draggingCamera = false;
  let pulseTimer: ReturnType<typeof setTimeout> | null = null;
  let firstFit = true; // fit the camera once on the first render (pdf-underlay's job for PDFs)
  const cleanups: Array<() => void> = [];

  /** Map a flat plan-coord segment buffer to world-space line vertices. */
  function segmentsToPositions(segs: Float32Array): Float32Array {
    const out = new Float32Array((segs.length / 2) * 3);
    let o = 0;
    for (let i = 0; i + 1 < segs.length; i += 2) {
      out[o++] = segs[i]! - offset.x;
      out[o++] = segs[i + 1]! - offset.y;
      out[o++] = 0;
    }
    return out;
  }

  function buildLineSegments(positions: Float32Array, color: THREE.ColorRepresentation, opacity: number): THREE.LineSegments {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: opacity < 1,
      opacity,
      depthTest: false,
    });
    const seg = new THREE.LineSegments(geo, mat);
    seg.renderOrder = RENDER_ORDER;
    seg.frustumCulled = false;
    return seg;
  }

  function rebuild(): void {
    if (!ctx || !sceneApi || !lineGroup || !labelGroup) return;
    clearGroup(lineGroup);
    clearGroup(labelGroup);

    const index = ctx.getCurrentPage() - 1;
    const level = levels[index];
    if (!level) {
      sceneApi.requestRender();
      return;
    }

    // Rooms first (subtle, below walls).
    let roomFloats = 0;
    for (const r of level.rooms) roomFloats += r.segments.length;
    if (roomFloats > 0) {
      const merged = new Float32Array(roomFloats);
      let o = 0;
      for (const r of level.rooms) {
        merged.set(r.segments, o);
        o += r.segments.length;
      }
      lineGroup.add(buildLineSegments(segmentsToPositions(merged), colors.room, 0.5));
    }

    // Walls on top.
    if (level.wallSegments.length > 0) {
      lineGroup.add(buildLineSegments(segmentsToPositions(level.wallSegments), colors.wall, 1));
    }

    // Room labels (constant screen size sprites at centroids).
    for (const r of level.rooms) {
      const name = roomNames.get(r.spaceId);
      if (!name) continue;
      const sprite = makeLabelSprite(name, colors.label);
      if (!sprite) continue;
      sprite.position.set(r.centroid[0] - offset.x, r.centroid[1] - offset.y, 0);
      labelGroup.add(sprite);
    }
    rescaleLabels();
    updateLabelVisibility();
    sceneApi.requestRender();

    // Fit the camera to the plan on the first render. The PDF path gets this
    // from pdf-underlay; floor plans have no underlay, so do it here.
    if (firstFit && ctx.commands.has('camera.fitPage')) {
      firstFit = false;
      void ctx.commands.execute('camera.fitPage', { animate: false });
    }
  }

  /** Scale each label sprite to its px size so it stays constant on screen. */
  function rescaleLabels(): void {
    if (!labelGroup || !sceneApi) return;
    const s = sceneApi.worldPerPx();
    for (const child of labelGroup.children) {
      const baseW = child.userData['baseW'];
      const baseH = child.userData['baseH'];
      if (typeof baseW === 'number' && typeof baseH === 'number') {
        child.scale.set(baseW * s, baseH * s, 1);
      }
    }
  }

  function updateLabelVisibility(): void {
    if (!labelGroup || !sceneApi) return;
    labelGroup.visible = sceneApi.pxPerWorldUnit() >= LABEL_MIN_PX_PER_UNIT;
  }

  function onCameraChange(): void {
    if (!sceneApi) return;
    rescaleLabels();
    if (pulseGroup) applyConstantScale(pulseGroup, sceneApi);
    if (cameraGroup?.visible) applyConstantScale(cameraGroup, sceneApi);
    updateLabelVisibility();
  }

  function nearestSpaceId(containerX: number, containerY: number): number | null {
    if (!ctx || !sceneApi) return null;
    const index = ctx.getCurrentPage() - 1;
    const level = levels[index];
    if (!level) return null;
    let best: number | null = null;
    let bestDist = PICK_THRESHOLD_PX;
    for (const r of level.rooms) {
      const wx = r.centroid[0] - offset.x;
      const wy = r.centroid[1] - offset.y;
      const s = sceneApi.worldToScreen(wx, wy);
      const d = Math.hypot(s.x - containerX, s.y - containerY);
      if (d < bestDist) {
        bestDist = d;
        best = r.spaceId;
      }
    }
    return best;
  }

  // ------------------------------------------------------ camera-marker drag

  /** Aim-handle look distance in plan units (direction-only; magnitude is free). */
  function aimDistance(): number {
    const span = Math.max(union.maxX - union.minX, union.maxY - union.minY);
    return span > 0 ? span * 0.1 : 1;
  }

  /** Event client coords → container-relative px. */
  function toContainer(ev: PointerEvent): { x: number; y: number } {
    const rect = ctx!.container.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  /** Which part of the marker (if any) the cursor is over. */
  function hitTestMarker(containerX: number, containerY: number): 'aim' | 'move' | null {
    if (!sceneApi || !cameraGroup?.visible || !lastPose) return null;
    const c = cameraGroup.position;
    const wpp = sceneApi.worldPerPx();
    const rot = cameraGroup.rotation.z;
    const hWorld = sceneApi.worldToScreen(
      c.x + Math.cos(rot) * CAM_HANDLE_PX * wpp,
      c.y + Math.sin(rot) * CAM_HANDLE_PX * wpp,
    );
    if (Math.hypot(hWorld.x - containerX, hWorld.y - containerY) <= CAM_AIM_HIT_PX) return 'aim';
    const cScreen = sceneApi.worldToScreen(c.x, c.y);
    if (Math.hypot(cScreen.x - containerX, cScreen.y - containerY) <= CAM_MOVE_HIT_PX) return 'move';
    return null;
  }

  let dragMode: 'aim' | 'move' | null = null;

  function onDragMove(ev: PointerEvent): void {
    if (!sceneApi || !cameraGroup || !lastPose || !dragMode) return;
    const world = containerPointToWorld(ev, ctx!, sceneApi);
    if (dragMode === 'move') {
      // Reposition; keep the current heading (carry the here→look delta).
      const dx = lastPose.lookX - lastPose.hereX;
      const dy = lastPose.lookY - lastPose.hereY;
      const hereX = world.x + offset.x;
      const hereY = world.y + offset.y;
      lastPose = { hereX, hereY, lookX: hereX + dx, lookY: hereY + dy };
      cameraGroup.position.set(world.x, world.y, 0);
    } else {
      // Aim: keep position, point toward the cursor.
      const angle = Math.atan2(world.y - cameraGroup.position.y, world.x - cameraGroup.position.x);
      const d = aimDistance();
      lastPose = {
        hereX: lastPose.hereX,
        hereY: lastPose.hereY,
        lookX: lastPose.hereX + Math.cos(angle) * d,
        lookY: lastPose.hereY + Math.sin(angle) * d,
      };
      cameraGroup.rotation.z = angle;
    }
    applyConstantScale(cameraGroup, sceneApi);
    sceneApi.requestRender();
    ctx!.events.emit('floorplan:cameraPose', { ...lastPose });
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

  const api: DocumentPlugin & FloorPlanPluginAPI = {
    name: NAME,
    dependencies: ['scene'],

    setLevel(index: number): void {
      ctx?.setCurrentPage(index + 1);
    },

    getLevels(): FloorPlanLevel[] {
      return levels;
    },

    planOffset(): { x: number; y: number } {
      return { ...offset };
    },

    focusPlanPoint(planX: number, planY: number): void {
      if (!sceneApi || !ctx) return;
      const wx = planX - offset.x;
      const wy = planY - offset.y;
      // Pan the camera-controls rig (setting camera.position directly would be
      // overwritten by camera-controls.update on the next frame).
      const cam = ctx.plugins.get<CameraPluginAPI>('camera');
      if (cam) {
        void cam.controls.setLookAt(wx, wy, 10, wx, wy, 0, true);
      }
    },

    pulseAt(planX: number, planY: number): void {
      if (!sceneApi || !pulseGroup) return;
      clearGroup(pulseGroup);
      if (pulseTimer !== null) clearTimeout(pulseTimer);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(PULSE_R - 2, PULSE_R, 32),
        new THREE.MeshBasicMaterial({ color: colors.accent, depthTest: false, transparent: true }),
      );
      ring.renderOrder = RENDER_ORDER + 3;
      ring.frustumCulled = false;
      pulseGroup.add(ring);
      pulseGroup.position.set(planX - offset.x, planY - offset.y, 0);
      applyConstantScale(pulseGroup, sceneApi);
      sceneApi.requestRender();
      pulseTimer = setTimeout(() => {
        clearGroup(pulseGroup);
        sceneApi?.requestRender();
        pulseTimer = null;
      }, PULSE_MS);
    },

    setCameraPose(pose): void {
      if (!sceneApi || !cameraGroup) return;
      // A live drag owns the marker — ignore echoed poses (the camera:change →
      // minimap:pose round-trip) until the drag ends.
      if (draggingCamera) return;
      if (!pose) {
        lastPose = null;
        cameraGroup.visible = false;
        sceneApi.requestRender();
        return;
      }
      lastPose = { hereX: pose.hereX, hereY: pose.hereY, lookX: pose.lookX, lookY: pose.lookY };
      cameraGroup.visible = true;
      // Clamp the marker to the plan extent (with a small inset) so an exterior
      // camera — whose position projects outside the footprint — still shows at
      // the plan edge, pointing inward (matches the canvas minimap's clamp).
      const insetX = (union.maxX - union.minX) * 0.02;
      const insetY = (union.maxY - union.minY) * 0.02;
      const cx = Math.min(Math.max(pose.hereX, union.minX + insetX), union.maxX - insetX);
      const cy = Math.min(Math.max(pose.hereY, union.minY + insetY), union.maxY - insetY);
      cameraGroup.position.set(cx - offset.x, cy - offset.y, 0);
      // Heading from the true (unclamped) here → look (world Y-up, no flip).
      cameraGroup.rotation.z = Math.atan2(pose.lookY - pose.hereY, pose.lookX - pose.hereX);
      applyConstantScale(cameraGroup, sceneApi);
      sceneApi.requestRender();
    },

    install(context: DocumentContext): void {
      ctx = context;
      sceneApi = context.plugins.get<SceneAPI>('scene');
      if (!sceneApi) throw new Error('floorplan requires the scene plugin');
      layer = sceneApi.addLayer(LAYER, RENDER_ORDER);
      lineGroup = new THREE.Group();
      labelGroup = new THREE.Group();
      pulseGroup = new THREE.Group();
      cameraGroup = buildCameraMarker(colors.accent);
      cameraGroup.visible = false;
      layer.add(lineGroup, labelGroup, pulseGroup, cameraGroup);

      cleanups.push(context.events.on('page:rendered', rebuild));
      cleanups.push(context.events.on('camera:change', onCameraChange));

      // Grab the camera marker on pointerdown (capture phase) so a drag on it
      // pre-empts camera-controls truck. Mirrors the measure plugin's pattern.
      context.container.addEventListener('pointerdown', onMarkerPointerDown, true);
      cleanups.push(() => {
        context.container.removeEventListener('pointerdown', onMarkerPointerDown, true);
        endDrag();
      });

      context.commands.register<{ index: number }>('floorplan.setLevel', (a) => api.setLevel(a.index), {
        title: 'Set floor-plan level',
      });
      context.commands.register('floorplan.getLevels', () => api.getLevels(), {
        title: 'Get floor-plan levels',
      });
      context.commands.register<{ planX: number; planY: number }>('floorplan.focusPlanPoint', (a) => {
        api.focusPlanPoint(a.planX, a.planY);
      }, { title: 'Center the plan on a point' });
      context.commands.register<{ hereX: number; hereY: number; lookX: number; lookY: number } | null>(
        'floorplan.setCameraPose',
        (a) => { api.setCameraPose(a ?? null); },
        { title: 'Set the you-are-here camera marker' },
      );
      context.commands.register<{ planX: number; planY: number }>('floorplan.pulse', (a) => {
        api.pulseAt(a.planX, a.planY);
      }, { title: 'Pulse a ring at a plan point' });

      // Bound to click:left by the FloorPlanViewer's mouse-bindings overrides.
      context.commands.register<{ containerX: number; containerY: number }>('floorplan.pick', (a) => {
        if (!sceneApi || !ctx) return;
        const world = sceneApi.screenToWorld(a.containerX, a.containerY);
        const spaceId = nearestSpaceId(a.containerX, a.containerY);
        ctx.events.emit('floorplan:pick', {
          planX: world.x + offset.x,
          planY: world.y + offset.y,
          spaceId,
        });
      }, { title: 'Pick a plan point + nearest room' });

      // Synchronous screen → plan conversion (no nearest-room, no event). Used by
      // the right-click "Add finding" flow, which converts the resulting plan
      // point to a 3D world anchor via the minimap calibration. Same math as
      // `floorplan.pick` so the two paths stay in lockstep.
      context.commands.register<{ containerX: number; containerY: number }, { planX: number; planY: number } | null>(
        'floorplan.planPointAt',
        (a) => {
          if (!sceneApi || !ctx) return null;
          const world = sceneApi.screenToWorld(a.containerX, a.containerY);
          return { planX: world.x + offset.x, planY: world.y + offset.y };
        },
        { title: 'Convert a screen point to a plan point' },
      );

      // Normalized page point (0..1, top-left, Y-down — the shape carried by the
      // 2D `interaction:resolved` event) → plan point. Inverse of the union-box
      // normalization in `useFloorPlanFindingMarkers`. The "update finding pin"
      // flow converts the picked normalized point to a plan point here, then to a
      // 3D world anchor via the minimap calibration.
      context.commands.register<{ nx: number; ny: number }, { planX: number; planY: number } | null>(
        'floorplan.planPointAtNorm',
        (a) => {
          const planW = union.maxX - union.minX || 1;
          const planH = union.maxY - union.minY || 1;
          return {
            planX: union.minX + a.nx * planW,
            planY: union.minY + (1 - a.ny) * planH,
          };
        },
        { title: 'Convert a normalized page point to a plan point' },
      );

      // The engine emits page:rendered on load; if it already fired before this
      // plugin installed (it won't, install precedes load), rebuild defensively.
      if (ctx.getUnscaledViewport()) rebuild();
    },

    uninstall(): void {
      firstFit = true;
      if (pulseTimer !== null) {
        clearTimeout(pulseTimer);
        pulseTimer = null;
      }
      for (const c of cleanups.splice(0)) c();
      clearGroup(lineGroup);
      clearGroup(labelGroup);
      clearGroup(pulseGroup);
      clearGroup(cameraGroup);
      if (sceneApi) sceneApi.removeLayer(LAYER);
      lineGroup = null;
      labelGroup = null;
      pulseGroup = null;
      cameraGroup = null;
      layer = null;
      sceneApi = null;
      ctx = null;
    },
  };

  return api;
}
