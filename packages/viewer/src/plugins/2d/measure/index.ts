/**
 * 2D measure plugin — distance / angle / area in **raw PDF points** (session-
 * only, in-memory, keyed per page).
 *
 * Renders into the shared world-space scene (a `measure` layer), so it pans and
 * zooms via the camera with no per-plugin renderer. Measurements are stored in
 * artifact space (PDF points, Y-up, unrotated box) — rotation-independent — and
 * projected to world coords on every rebuild, so they stay locked through zoom +
 * rotation. Value labels are DOM elements pinned to the viewport overlay (crisp,
 * upright). Snapping runs in world space (threshold scaled from screen px).
 *
 * Host apps drive it through `measure.*` commands on the `DocumentViewerHandle`
 * and react to `measurement:change` / `measure:modeExit` — identical in shape to
 * how the 3D viewer is driven, so one shared panel serves both.
 */

import * as THREE from 'three';

import type {
  DocumentContext,
  DocumentPlugin,
  DocumentTool,
} from '../../../pdf-core/documentTypes.js';
import type { PageGeometryLike } from './geometryTypes.js';
import { artifactDistance } from './transform.js';
import {
  buildPageSnapData,
  findNearestSnap,
  type PageSnapData,
  type SnapProjector,
  type SnapResult,
} from './snap.js';
import type { PdfMeasureMode, PdfMeasurement } from './types.js';
import {
  angleDegrees,
  centroid,
  formatAngle,
  formatArea,
  formatDistance,
  polygonArea,
  type Pt,
} from './math.js';
import type { SceneAPI } from '../scene/index.js';
import {
  artifactToWorld,
  worldParams,
  worldToArtifact,
  type WorldParams,
} from '../shared/worldTransform.js';
import { applyConstantScale, containerPointToWorld } from '../shared/screenConstant.js';
import { createLabelLayer, type LabelLayer } from '../shared/labels.js';

const SNAP_THRESHOLD_PX = 10;
const MARKER_HALF = 7; // px half-extent of the (screen-constant) snap-marker glyph.
const CLOSE_THRESHOLD_PX = 12; // click within this (screen px) of the first point closes an area.
const ARC_RADIUS_FRAC = 0.35; // angle arc radius as a fraction of the shorter arm.
const ARC_MIN = 14; // world units (PDF pts)
const ARC_MAX = 64;

// Raw colour numbers are the three.js convention (same as the 3D viewer):
// primary-blue ink, amber snap marker.
const INK_COLOR = 0x2563eb;
const SNAP_COLOR = 0xf59e0b;
const AREA_OPACITY = 0.15;

const LAYER = 'measure' as const;
/** Layer render order — below markup (20) and entity markers (30). */
const RENDER_ORDER = 10;

export interface MeasurePluginAPI {
  isActive(): boolean;
  mode(): PdfMeasureMode | null;
  measurements(): PdfMeasurement[];
}

export function measurePlugin(): DocumentPlugin & MeasurePluginAPI {
  let ctx: DocumentContext | null = null;
  let sceneApi: SceneAPI | null = null;
  const cleanups: Array<() => void> = [];

  // ---- shared-scene layer ----
  let layerGroup: THREE.Group | null = null;
  let committedGroup: THREE.Group | null = null;
  let previewGroup: THREE.Group | null = null;
  let markerGroup: THREE.Group | null = null;
  let markerScale: THREE.Group | null = null; // scaled by worldPerPx for constant screen size
  let markerSquare: THREE.LineLoop | null = null;
  let markerCross: THREE.LineSegments | null = null;
  let labels: LabelLayer | null = null;

  const inkMaterial = new THREE.LineBasicMaterial({ color: INK_COLOR, depthTest: false });
  const fillMaterial = new THREE.MeshBasicMaterial({
    color: INK_COLOR,
    transparent: true,
    opacity: AREA_OPACITY,
    side: THREE.DoubleSide,
    depthTest: false,
  });
  const markerMaterial = new THREE.LineBasicMaterial({ color: SNAP_COLOR, depthTest: false });

  // ---- state ----
  let pageGeometry: PageGeometryLike | null = null;
  let snapData: PageSnapData | null = null;
  const completed = new Map<string, PdfMeasurement>();
  let currentMode: PdfMeasureMode | null = null;
  let pending: Pt[] = []; // artifact space
  let liveEnd: Pt | null = null; // artifact space
  let liveSnap: SnapResult | null = null;
  let savedTool: DocumentTool | null = null;
  let idCounter = 0;

  // ---------------------------------------------------------------- transforms

  function wparams(): WorldParams | null {
    if (!ctx) return null;
    if (pageGeometry) {
      return worldParams(ctx, { w: pageGeometry.w, h: pageGeometry.h, rot: pageGeometry.rot ?? 0 });
    }
    return worldParams(ctx, null);
  }

  // ------------------------------------------------------------------ geometry

  function lineObject(a: Pt, b: Pt): THREE.Line {
    const geom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(a[0], a[1], 0),
      new THREE.Vector3(b[0], b[1], 0),
    ]);
    const line = new THREE.Line(geom, inkMaterial);
    line.frustumCulled = false;
    line.renderOrder = RENDER_ORDER + 1;
    return line;
  }

  function polylineObject(pts: Pt[], close: boolean): THREE.Line {
    const verts = pts.map((p) => new THREE.Vector3(p[0], p[1], 0));
    if (close && verts.length > 0) verts.push(verts[0]!.clone());
    const geom = new THREE.BufferGeometry().setFromPoints(verts);
    const line = new THREE.Line(geom, inkMaterial);
    line.frustumCulled = false;
    line.renderOrder = RENDER_ORDER + 1;
    return line;
  }

  function fillObject(pts: Pt[]): THREE.Mesh {
    const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], p[1])));
    const geom = new THREE.ShapeGeometry(shape);
    const mesh = new THREE.Mesh(geom, fillMaterial);
    mesh.frustumCulled = false;
    mesh.renderOrder = RENDER_ORDER;
    return mesh;
  }

  function arcObject(v: Pt, a: Pt, b: Pt): { arc: THREE.Line; labelAt: Pt } {
    const da: Pt = [a[0] - v[0], a[1] - v[1]];
    const db: Pt = [b[0] - v[0], b[1] - v[1]];
    const lenA = Math.hypot(da[0], da[1]) || 1;
    const lenB = Math.hypot(db[0], db[1]) || 1;
    const radius = Math.min(ARC_MAX, Math.max(ARC_MIN, ARC_RADIUS_FRAC * Math.min(lenA, lenB)));
    const angA = Math.atan2(da[1], da[0]);
    const angB = Math.atan2(db[1], db[0]);
    let delta = angB - angA;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    const STEPS = 28;
    const verts: THREE.Vector3[] = [];
    for (let i = 0; i <= STEPS; i += 1) {
      const ang = angA + (delta * i) / STEPS;
      verts.push(new THREE.Vector3(v[0] + radius * Math.cos(ang), v[1] + radius * Math.sin(ang), 0));
    }
    const geom = new THREE.BufferGeometry().setFromPoints(verts);
    const arc = new THREE.Line(geom, inkMaterial);
    arc.frustumCulled = false;
    arc.renderOrder = RENDER_ORDER + 1;
    const mid = angA + delta / 2;
    const labelAt: Pt = [
      v[0] + (radius + 14) * Math.cos(mid),
      v[1] + (radius + 14) * Math.sin(mid),
    ];
    return { arc, labelAt };
  }

  /** Dispose only geometry (materials are shared singletons) and clear the group. */
  function clearGeom(group: THREE.Group | null): void {
    if (!group) return;
    for (const child of [...group.children]) {
      (child as THREE.Mesh | THREE.Line).geometry?.dispose();
    }
    group.clear();
  }

  /** Build the visuals (three objects + one DOM label) for one shape, in world space. */
  function buildShape(
    type: PdfMeasureMode,
    artifactPts: Pt[],
    wp: WorldParams,
    group: THREE.Group,
    labelKey: string,
  ): void {
    const world = artifactPts.map((p) => artifactToWorld(p[0], p[1], wp));
    if (type === 'distance') {
      if (world.length < 2) return;
      group.add(lineObject(world[0]!, world[1]!));
      const value = artifactDistance(artifactPts[0]![0], artifactPts[0]![1], artifactPts[1]![0], artifactPts[1]![1]);
      const mid: Pt = [(world[0]![0] + world[1]![0]) / 2, (world[0]![1] + world[1]![1]) / 2];
      labels?.set(labelKey, formatDistance(value), mid[0], mid[1]);
      return;
    }
    if (type === 'angle') {
      if (world.length < 3) {
        if (world.length === 2) group.add(lineObject(world[0]!, world[1]!));
        return;
      }
      const [a, v, b] = [world[0]!, world[1]!, world[2]!];
      group.add(lineObject(v, a));
      group.add(lineObject(v, b));
      const { arc, labelAt } = arcObject(v, a, b);
      group.add(arc);
      const deg = angleDegrees(artifactPts[0]!, artifactPts[1]!, artifactPts[2]!);
      labels?.set(labelKey, formatAngle(deg), labelAt[0], labelAt[1]);
      return;
    }
    // area
    if (world.length < 2) return;
    if (world.length >= 3) group.add(fillObject(world));
    group.add(polylineObject(world, world.length >= 3));
    if (world.length >= 3) {
      const area = polygonArea(artifactPts);
      const cArtifact = centroid(artifactPts);
      const cWorld = artifactToWorld(cArtifact[0], cArtifact[1], wp);
      labels?.set(labelKey, formatArea(area), cWorld[0], cWorld[1]);
    }
  }

  // -------------------------------------------------------------- redraw paths

  function rebuildCommitted(): void {
    if (!committedGroup) return;
    clearGeom(committedGroup);
    labels?.clear();
    const wp = wparams();
    if (wp && ctx) {
      const page = ctx.getCurrentPage();
      for (const m of completed.values()) {
        if (m.page !== page || !m.visible) continue;
        buildShape(m.type, m.points, wp, committedGroup, m.id);
      }
    }
    // The live preview owns its own label key, so re-add it after the wipe.
    rebuildPreview();
  }

  function rebuildPreview(): void {
    if (!previewGroup) return;
    clearGeom(previewGroup);
    labels?.remove('preview');
    const wp = wparams();
    if (wp && currentMode && pending.length > 0) {
      const pts = liveEnd ? [...pending, liveEnd] : [...pending];
      buildShape(currentMode, pts, wp, previewGroup, 'preview');
    }
    updateMarker();
    sceneApi?.requestRender();
  }

  function updateMarker(): void {
    if (!markerGroup || !markerScale || !markerSquare || !markerCross || !sceneApi) return;
    if (currentMode && liveSnap) {
      markerGroup.visible = true;
      markerGroup.position.set(liveSnap.px, liveSnap.py, 0);
      applyConstantScale(markerScale, sceneApi);
      markerSquare.visible = liveSnap.kind === 'endpoint';
      markerCross.visible = liveSnap.kind === 'intersection';
    } else {
      markerGroup.visible = false;
    }
  }

  // ------------------------------------------------------------- interaction

  function cursorToWorld(e: PointerEvent | MouseEvent): Pt {
    if (!ctx || !sceneApi) return [0, 0];
    const w = containerPointToWorld(e, ctx, sceneApi);
    return [w.x, w.y];
  }

  function snapProjector(wp: WorldParams): SnapProjector {
    return (ax, ay) => artifactToWorld(ax, ay, wp);
  }

  function resolvePoint(world: Pt): { pt: Pt; worldX: number; worldY: number; snap: SnapResult | null } {
    const wp = wparams();
    if (!wp) return { pt: [0, 0], worldX: world[0], worldY: world[1], snap: null };
    if (snapData && sceneApi) {
      const thr = SNAP_THRESHOLD_PX * sceneApi.worldPerPx();
      const snap = findNearestSnap(snapData, { x: world[0], y: world[1] }, snapProjector(wp), thr);
      if (snap) return { pt: [snap.ax, snap.ay], worldX: snap.px, worldY: snap.py, snap };
    }
    const [ax, ay] = worldToArtifact(world[0], world[1], wp);
    return { pt: [ax, ay], worldX: world[0], worldY: world[1], snap: null };
  }

  function needFor(mode: PdfMeasureMode): number {
    return mode === 'distance' ? 2 : mode === 'angle' ? 3 : Infinity; // area closes manually
  }

  function commit(): void {
    if (!ctx || !currentMode || pending.length === 0) return;
    const id = `m${(idCounter += 1)}`;
    const pts = pending.map((p) => [p[0], p[1]] as Pt);
    let value = 0;
    let label = '';
    if (currentMode === 'distance') {
      value = artifactDistance(pts[0]![0], pts[0]![1], pts[1]![0], pts[1]![1]);
      label = formatDistance(value);
    } else if (currentMode === 'angle') {
      value = angleDegrees(pts[0]!, pts[1]!, pts[2]!);
      label = formatAngle(value);
    } else {
      value = polygonArea(pts);
      label = formatArea(value);
    }
    completed.set(id, {
      id,
      type: currentMode,
      points: pts,
      valuePoints: value,
      label,
      visible: true,
      page: ctx.getCurrentPage(),
    });
    pending = [];
    liveEnd = null;
    rebuildCommitted();
    ctx.events.emit('measurement:change', { count: completed.size });
    ctx.events.emit('measurement:complete', { id, type: currentMode, valuePoints: value });
  }

  function onPointerDown(e: PointerEvent): void {
    if (!currentMode || e.button !== 0) return; // let middle-drag pan bubble through
    e.preventDefault();
    e.stopPropagation();
    const world = cursorToWorld(e);
    const r = resolvePoint(world);

    // Area: clicking near the first point closes the polygon.
    if (currentMode === 'area' && pending.length >= 3) {
      const wp = wparams();
      if (wp && sceneApi) {
        const first = artifactToWorld(pending[0]![0], pending[0]![1], wp);
        const closeThr = CLOSE_THRESHOLD_PX * sceneApi.worldPerPx();
        if (Math.hypot(first[0] - r.worldX, first[1] - r.worldY) <= closeThr) {
          commit();
          return;
        }
      }
    }

    pending.push(r.pt);
    liveEnd = r.pt;
    if (pending.length >= needFor(currentMode)) {
      commit();
      return;
    }
    rebuildPreview();
  }

  function onPointerMove(e: PointerEvent): void {
    if (!currentMode) return;
    const r = resolvePoint(cursorToWorld(e));
    liveSnap = r.snap;
    liveEnd = r.pt;
    rebuildPreview();
  }

  function onContextMenu(e: MouseEvent): void {
    if (!currentMode) return;
    e.preventDefault();
    e.stopPropagation();
    if (currentMode === 'area' && pending.length >= 3) {
      liveEnd = null;
      commit();
    } else {
      cancelPending();
    }
  }

  function onDoubleClick(e: MouseEvent): void {
    if (currentMode !== 'area') return;
    e.preventDefault();
    e.stopPropagation();
    if (pending.length >= 3) {
      liveEnd = null;
      commit();
    }
  }

  // Swallow the trailing click while measuring so it never reaches another
  // plugin's click handler (e.g. markup select).
  function onClick(e: MouseEvent): void {
    if (currentMode) e.stopPropagation();
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (!currentMode || e.key !== 'Escape') return;
    if (pending.length > 0) cancelPending();
    else deactivate();
  }

  function cancelPending(): void {
    pending = [];
    liveEnd = null;
    rebuildPreview();
  }

  // ------------------------------------------------------------------ control

  function setRootInteractive(on: boolean): void {
    if (!ctx) return;
    ctx.container.style.cursor = on ? 'crosshair' : '';
  }

  function activate(mode: PdfMeasureMode): void {
    if (!ctx) return;
    if (currentMode === null) savedTool = ctx.getTool();
    currentMode = mode;
    pending = [];
    liveEnd = null;
    liveSnap = null;
    ctx.setTool('select'); // disable pan's left-drag branch while measuring
    setRootInteractive(true);
    rebuildPreview();
  }

  function deactivate(): void {
    if (currentMode === null) return;
    currentMode = null;
    pending = [];
    liveEnd = null;
    liveSnap = null;
    setRootInteractive(false);
    if (ctx && savedTool) ctx.setTool(savedTool);
    savedTool = null;
    rebuildPreview();
    ctx?.events.emit('measure:modeExit', undefined);
  }

  function listForPage(): PdfMeasurement[] {
    if (!ctx) return [];
    const page = ctx.getCurrentPage();
    return [...completed.values()].filter((m) => m.page === page);
  }

  function setPageGeometry(geom: PageGeometryLike | null): void {
    pageGeometry = geom;
    snapData = geom ? buildPageSnapData(geom.l) : null;
    rebuildCommitted();
  }

  // ------------------------------------------------------------------- plugin

  const api: DocumentPlugin & MeasurePluginAPI = {
    name: 'measure',
    dependencies: ['scene'],

    isActive: () => currentMode !== null,
    mode: () => currentMode,
    measurements: () => listForPage(),

    install(context: DocumentContext): void {
      ctx = context;
      sceneApi = context.plugins.get<SceneAPI>('scene');
      if (!sceneApi) throw new Error('measure requires the scene plugin');

      layerGroup = sceneApi.addLayer(LAYER, RENDER_ORDER);
      committedGroup = new THREE.Group();
      previewGroup = new THREE.Group();
      layerGroup.add(committedGroup, previewGroup);

      // Snap marker: authored in px, kept constant on screen via worldPerPx scale.
      markerGroup = new THREE.Group();
      markerGroup.visible = false;
      markerScale = new THREE.Group();
      markerGroup.add(markerScale);
      const s = MARKER_HALF;
      const squareGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-s, -s, 0),
        new THREE.Vector3(s, -s, 0),
        new THREE.Vector3(s, s, 0),
        new THREE.Vector3(-s, s, 0),
      ]);
      markerSquare = new THREE.LineLoop(squareGeom, markerMaterial);
      markerSquare.frustumCulled = false;
      markerSquare.renderOrder = RENDER_ORDER + 2;
      const crossGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-s, -s, 0),
        new THREE.Vector3(s, s, 0),
        new THREE.Vector3(-s, s, 0),
        new THREE.Vector3(s, -s, 0),
      ]);
      markerCross = new THREE.LineSegments(crossGeom, markerMaterial);
      markerCross.frustumCulled = false;
      markerCross.renderOrder = RENDER_ORDER + 2;
      markerScale.add(markerSquare, markerCross);
      layerGroup.add(markerGroup);

      labels = createLabelLayer(context.viewportOverlay, sceneApi);

      // --- pointer + key listeners on the container (capture: preempt camera while measuring) ---
      const el = context.container;
      el.addEventListener('pointerdown', onPointerDown, true);
      el.addEventListener('pointermove', onPointerMove, true);
      el.addEventListener('contextmenu', onContextMenu, true);
      el.addEventListener('dblclick', onDoubleClick, true);
      el.addEventListener('click', onClick, true);
      window.addEventListener('keydown', onKeyDown);
      cleanups.push(() => {
        el.removeEventListener('pointerdown', onPointerDown, true);
        el.removeEventListener('pointermove', onPointerMove, true);
        el.removeEventListener('contextmenu', onContextMenu, true);
        el.removeEventListener('dblclick', onDoubleClick, true);
        el.removeEventListener('click', onClick, true);
        window.removeEventListener('keydown', onKeyDown);
      });

      // --- engine events: reproject on render, swap set on page change, labels on camera ---
      cleanups.push(context.events.on('page:rendered', () => {
        rebuildCommitted();
      }));
      cleanups.push(context.events.on('page:change', () => {
        if (currentMode) cancelPending();
        rebuildCommitted();
        context.events.emit('measurement:change', { count: completed.size });
      }));
      cleanups.push(context.events.on('camera:change', () => {
        labels?.syncAll();
        if (markerGroup?.visible && markerScale && sceneApi) applyConstantScale(markerScale, sceneApi);
      }));

      // --- commands (mirror the 3D measure.* surface) ---
      context.commands.register<{ mode: PdfMeasureMode }>('measure.activate', (a) => { activate(a.mode); }, {
        title: 'Start measuring',
      });
      context.commands.register('measure.deactivate', () => { deactivate(); }, { title: 'Stop measuring' });
      context.commands.register('measure.cancelPending', () => { cancelPending(); }, { title: 'Cancel current measurement' });
      context.commands.register('measure.isActive', () => currentMode !== null, { title: 'Is measuring' });
      context.commands.register('measure.getMode', () => currentMode, { title: 'Current measure mode' });
      context.commands.register('measure.list', () => listForPage(), { title: 'List measurements (current page)' });
      context.commands.register<{ id: string }>('measure.remove', (a) => {
        if (completed.delete(a.id)) {
          rebuildCommitted();
          context.events.emit('measurement:change', { count: completed.size });
        }
      }, { title: 'Remove a measurement' });
      context.commands.register<{ id: string; visible: boolean }>('measure.setVisible', (a) => {
        const m = completed.get(a.id);
        if (m) {
          m.visible = a.visible;
          rebuildCommitted();
          context.events.emit('measurement:change', { count: completed.size });
        }
      }, { title: 'Toggle measurement visibility' });
      // Whole-layer show/hide — drives the side-rail count pill (mirrors 3D
      // `measure.setAllVisible`).
      context.commands.register<{ visible: boolean }>('measure.setAllVisible', (a) => {
        for (const m of completed.values()) m.visible = a.visible;
        rebuildCommitted();
        context.events.emit('measurement:change', { count: completed.size });
      }, { title: 'Show or hide all measurements' });
      context.commands.register('measure.clear', () => {
        const page = context.getCurrentPage();
        for (const [id, m] of [...completed]) if (m.page === page) completed.delete(id);
        rebuildCommitted();
        context.events.emit('measurement:change', { count: completed.size });
      }, { title: 'Clear measurements on this page' });
      context.commands.register('measure.clearAll', () => {
        completed.clear();
        rebuildCommitted();
        context.events.emit('measurement:change', { count: completed.size });
      }, { title: 'Clear all measurements' });
      context.commands.register<{ pageGeometry: PageGeometryLike | null }>('measure.setPageGeometry', (a) => {
        setPageGeometry(a.pageGeometry ?? null);
      }, { title: 'Provide per-page vector geometry for snapping' });

      rebuildCommitted();
    },

    uninstall(): void {
      for (const c of cleanups.splice(0)) c();
      deactivate();
      completed.clear();
      clearGeom(committedGroup);
      clearGeom(previewGroup);
      markerSquare?.geometry.dispose();
      markerCross?.geometry.dispose();
      inkMaterial.dispose();
      fillMaterial.dispose();
      markerMaterial.dispose();
      labels?.dispose();
      if (sceneApi) sceneApi.removeLayer(LAYER);
      labels = null;
      layerGroup = null;
      committedGroup = null;
      previewGroup = null;
      markerGroup = null;
      markerScale = null;
      markerSquare = null;
      markerCross = null;
      sceneApi = null;
      ctx = null;
    },
  };

  return api;
}
