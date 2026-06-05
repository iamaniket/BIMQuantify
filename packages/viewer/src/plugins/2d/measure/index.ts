/**
 * 2D measure plugin — the document-engine counterpart to the 3D
 * `measurementPlugin`. Owns its own three.js WebGL overlay inside
 * `ctx.overlayHost` and supports distance / angle / area in **raw PDF points**
 * (session-only, in-memory, keyed per page).
 *
 * Everything is stored in artifact space (PDF points, Y-up); visuals are
 * projected to CSS px via {@link artifactToCss} on every reproject, so they stay
 * locked to the drawing through zoom + rotation. Snapping reuses the same
 * endpoint/intersection engine as the legacy overlay.
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
import {
  artifactDistance,
  artifactToCss,
  cssToArtifact,
  type PdfTransformParams,
} from './transform.js';
import {
  buildPageSnapData,
  findNearestSnap,
  type PageSnapData,
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

const SNAP_THRESHOLD_PX = 10;
const MARKER_HALF = 7; // px half-extent of the snap-marker glyph.
const CLOSE_THRESHOLD_PX = 12; // click within this of the first point closes an area.
const ARC_RADIUS_FRAC = 0.35; // angle arc radius as a fraction of the shorter arm.
const ARC_MIN_PX = 14;
const ARC_MAX_PX = 64;

// Raw colour numbers are the three.js convention (same as the 3D viewer):
// primary-blue ink, amber snap marker.
const INK_COLOR = 0x2563eb;
const SNAP_COLOR = 0xf59e0b;
const AREA_OPACITY = 0.15;

export interface MeasurePluginAPI {
  isActive(): boolean;
  mode(): PdfMeasureMode | null;
  measurements(): PdfMeasurement[];
}

export function measurePlugin(): DocumentPlugin & MeasurePluginAPI {
  let ctx: DocumentContext | null = null;
  const cleanups: Array<() => void> = [];

  // ---- DOM hosts (appended into ctx.overlayHost) ----
  let pluginRoot: HTMLDivElement | null = null;
  let canvasHost: HTMLDivElement | null = null;
  let labelHost: HTMLDivElement | null = null;

  // ---- three.js ----
  let renderer: THREE.WebGLRenderer | null = null;
  let scene: THREE.Scene | null = null;
  let camera: THREE.OrthographicCamera | null = null;
  let committedGroup: THREE.Group | null = null;
  let previewGroup: THREE.Group | null = null;
  let markerGroup: THREE.Group | null = null;
  let markerSquare: THREE.LineLoop | null = null;
  let markerCross: THREE.LineSegments | null = null;
  const inkMaterial = new THREE.LineBasicMaterial({ color: INK_COLOR });
  const fillMaterial = new THREE.MeshBasicMaterial({
    color: INK_COLOR,
    transparent: true,
    opacity: AREA_OPACITY,
    side: THREE.DoubleSide,
    depthTest: false,
  });
  const markerMaterial = new THREE.LineBasicMaterial({ color: SNAP_COLOR });

  // ---- state ----
  let pageGeometry: PageGeometryLike | null = null;
  let snapData: PageSnapData | null = null;
  const completed = new Map<string, PdfMeasurement>();
  let currentMode: PdfMeasureMode | null = null;
  let pending: Pt[] = [];
  let liveEnd: Pt | null = null;
  let liveSnap: SnapResult | null = null;
  let savedTool: DocumentTool | null = null;
  let idCounter = 0;

  // ---------------------------------------------------------------- transforms

  function params(): PdfTransformParams | null {
    if (!ctx || !pageGeometry) return null;
    const dims = ctx.getPageDimensions();
    if (!dims) return null;
    const rot = (((ctx.getRotation() + (pageGeometry.rot ?? 0)) % 360) + 360) % 360;
    return { w: pageGeometry.w, h: pageGeometry.h, pageW: dims.width, pageH: dims.height, rotation: rot };
  }

  function toCss(p: Pt, t: PdfTransformParams): Pt {
    return artifactToCss(p[0], p[1], t);
  }

  function render(): void {
    if (renderer && scene && camera) renderer.render(scene, camera);
  }

  // ----------------------------------------------------------------- geometry

  function lineObject(a: Pt, b: Pt): THREE.Line {
    const geom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(a[0], a[1], 0),
      new THREE.Vector3(b[0], b[1], 0),
    ]);
    const line = new THREE.Line(geom, inkMaterial);
    line.frustumCulled = false;
    line.renderOrder = 1;
    return line;
  }

  function polylineObject(cssPts: Pt[], close: boolean): THREE.Line {
    const verts = cssPts.map((p) => new THREE.Vector3(p[0], p[1], 0));
    if (close && verts.length > 0) verts.push(verts[0]!.clone());
    const geom = new THREE.BufferGeometry().setFromPoints(verts);
    const line = new THREE.Line(geom, inkMaterial);
    line.frustumCulled = false;
    line.renderOrder = 1;
    return line;
  }

  function fillObject(cssPts: Pt[]): THREE.Mesh {
    const shape = new THREE.Shape(cssPts.map((p) => new THREE.Vector2(p[0], p[1])));
    const geom = new THREE.ShapeGeometry(shape);
    const mesh = new THREE.Mesh(geom, fillMaterial);
    mesh.frustumCulled = false;
    mesh.renderOrder = 0;
    return mesh;
  }

  function arcObject(vCss: Pt, aCss: Pt, bCss: Pt): { arc: THREE.Line; labelAt: Pt } {
    const da = [aCss[0] - vCss[0], aCss[1] - vCss[1]] as Pt;
    const db = [bCss[0] - vCss[0], bCss[1] - vCss[1]] as Pt;
    const lenA = Math.hypot(da[0], da[1]) || 1;
    const lenB = Math.hypot(db[0], db[1]) || 1;
    const radius = Math.min(ARC_MAX_PX, Math.max(ARC_MIN_PX, ARC_RADIUS_FRAC * Math.min(lenA, lenB)));
    const angA = Math.atan2(da[1], da[0]);
    const angB = Math.atan2(db[1], db[0]);
    let delta = angB - angA;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    const STEPS = 28;
    const verts: THREE.Vector3[] = [];
    for (let i = 0; i <= STEPS; i += 1) {
      const ang = angA + (delta * i) / STEPS;
      verts.push(new THREE.Vector3(vCss[0] + radius * Math.cos(ang), vCss[1] + radius * Math.sin(ang), 0));
    }
    const geom = new THREE.BufferGeometry().setFromPoints(verts);
    const arc = new THREE.Line(geom, inkMaterial);
    arc.frustumCulled = false;
    arc.renderOrder = 1;
    const mid = angA + delta / 2;
    const labelAt: Pt = [
      vCss[0] + (radius + 14) * Math.cos(mid),
      vCss[1] + (radius + 14) * Math.sin(mid),
    ];
    return { arc, labelAt };
  }

  function addLabel(text: string, cssX: number, cssY: number): void {
    if (!labelHost) return;
    const el = document.createElement('div');
    el.textContent = text;
    el.style.cssText = [
      'position:absolute',
      'transform:translate(-50%,-50%)',
      'white-space:nowrap',
      'padding:1px 5px',
      'border-radius:3px',
      "font:600 11px/1.45 ui-sans-serif,system-ui,-apple-system,sans-serif",
      'background:rgba(255,255,255,0.92)',
      'color:#1e293b',
      'box-shadow:0 1px 3px rgba(0,0,0,0.18)',
      'pointer-events:none',
    ].join(';');
    el.style.left = `${cssX}px`;
    el.style.top = `${cssY}px`;
    labelHost.appendChild(el);
  }

  function disposeGroup(group: THREE.Group | null): void {
    if (!group) return;
    for (const child of [...group.children]) {
      const obj = child as THREE.Mesh | THREE.Line;
      obj.geometry?.dispose();
    }
    group.clear();
  }

  /** Build the visuals (three objects + DOM labels) for one finished/previewed shape. */
  function buildShape(type: PdfMeasureMode, artifactPts: Pt[], t: PdfTransformParams, group: THREE.Group): void {
    const css = artifactPts.map((p) => toCss(p, t));
    if (type === 'distance') {
      if (css.length < 2) return;
      group.add(lineObject(css[0]!, css[1]!));
      const value = artifactDistance(artifactPts[0]![0], artifactPts[0]![1], artifactPts[1]![0], artifactPts[1]![1]);
      const mid: Pt = [(css[0]![0] + css[1]![0]) / 2, (css[0]![1] + css[1]![1]) / 2];
      addLabel(formatDistance(value), mid[0], mid[1]);
      return;
    }
    if (type === 'angle') {
      if (css.length < 3) {
        if (css.length === 2) group.add(lineObject(css[0]!, css[1]!));
        return;
      }
      const [a, v, b] = [css[0]!, css[1]!, css[2]!];
      group.add(lineObject(v, a));
      group.add(lineObject(v, b));
      const { arc, labelAt } = arcObject(v, a, b);
      group.add(arc);
      const deg = angleDegrees(artifactPts[0]!, artifactPts[1]!, artifactPts[2]!);
      addLabel(formatAngle(deg), labelAt[0], labelAt[1]);
      return;
    }
    // area
    if (css.length < 2) return;
    if (css.length >= 3) group.add(fillObject(css));
    group.add(polylineObject(css, css.length >= 3));
    if (css.length >= 3) {
      const area = polygonArea(artifactPts);
      const c = toCss(centroid(artifactPts), t);
      addLabel(formatArea(area), c[0], c[1]);
    }
  }

  // -------------------------------------------------------------- redraw paths

  function rebuildCommitted(): void {
    if (!committedGroup) return;
    disposeGroup(committedGroup);
    if (labelHost) labelHost.replaceChildren();
    const t = params();
    if (t && ctx) {
      const page = ctx.getCurrentPage();
      for (const m of completed.values()) {
        if (m.page !== page || !m.visible) continue;
        buildShape(m.type, m.points, t, committedGroup);
      }
    }
    // The live preview owns its own label cleanup, so rebuild it after wiping.
    rebuildPreview();
  }

  function rebuildPreview(): void {
    if (!previewGroup) return;
    disposeGroup(previewGroup);
    const t = params();
    if (t && currentMode && pending.length > 0) {
      const pts = liveEnd ? [...pending, liveEnd] : [...pending];
      buildShape(currentMode, pts, t, previewGroup);
    }
    updateMarker();
    render();
  }

  function updateMarker(): void {
    if (!markerGroup || !markerSquare || !markerCross) return;
    if (currentMode && liveSnap) {
      markerGroup.visible = true;
      markerGroup.position.set(liveSnap.cssX, liveSnap.cssY, 0);
      markerSquare.visible = liveSnap.kind === 'endpoint';
      markerCross.visible = liveSnap.kind === 'intersection';
    } else {
      markerGroup.visible = false;
    }
  }

  // ------------------------------------------------------------- interaction

  function cursorToCss(e: PointerEvent | MouseEvent): Pt {
    const rect = pluginRoot!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function resolvePoint(cssX: number, cssY: number): { pt: Pt; cssX: number; cssY: number; snap: SnapResult | null } {
    const t = params();
    if (!t) return { pt: [0, 0], cssX, cssY, snap: null };
    const snap = snapData ? findNearestSnap(snapData, { x: cssX, y: cssY }, t, SNAP_THRESHOLD_PX) : null;
    if (snap) return { pt: [snap.ax, snap.ay], cssX: snap.cssX, cssY: snap.cssY, snap };
    const [ax, ay] = cssToArtifact(cssX, cssY, t);
    return { pt: [ax, ay], cssX, cssY, snap: null };
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
    const [cx, cy] = cursorToCss(e);
    const r = resolvePoint(cx, cy);

    // Area: clicking near the first point closes the polygon.
    if (currentMode === 'area' && pending.length >= 3) {
      const t = params();
      if (t) {
        const first = toCss(pending[0]!, t);
        if (Math.hypot(first[0] - r.cssX, first[1] - r.cssY) <= CLOSE_THRESHOLD_PX) {
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
    const [cx, cy] = cursorToCss(e);
    const r = resolvePoint(cx, cy);
    liveSnap = r.snap;
    liveEnd = r.pt;
    rebuildPreview();
  }

  function onContextMenu(e: MouseEvent): void {
    if (!currentMode) return;
    e.preventDefault();
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
    if (!pluginRoot) return;
    pluginRoot.style.pointerEvents = on ? 'auto' : 'none';
    pluginRoot.style.cursor = on ? 'crosshair' : 'default';
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

    isActive: () => currentMode !== null,
    mode: () => currentMode,
    measurements: () => listForPage(),

    install(context: DocumentContext): void {
      ctx = context;

      // --- DOM hosts inside the page-aligned overlay slot ---
      pluginRoot = document.createElement('div');
      pluginRoot.dataset['bqMeasure'] = '';
      pluginRoot.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
      canvasHost = document.createElement('div');
      canvasHost.style.cssText = 'position:absolute;inset:0;';
      labelHost = document.createElement('div');
      labelHost.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
      pluginRoot.append(canvasHost, labelHost);
      context.overlayHost.appendChild(pluginRoot);

      // --- three.js scene ---
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setClearColor(0x000000, 0);
      renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
      canvasHost.appendChild(renderer.domElement);

      scene = new THREE.Scene();
      camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1);

      committedGroup = new THREE.Group();
      previewGroup = new THREE.Group();
      scene.add(committedGroup, previewGroup);

      markerGroup = new THREE.Group();
      markerGroup.visible = false;
      markerGroup.renderOrder = 2;
      const s = MARKER_HALF;
      const squareGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-s, -s, 0),
        new THREE.Vector3(s, -s, 0),
        new THREE.Vector3(s, s, 0),
        new THREE.Vector3(-s, s, 0),
      ]);
      markerSquare = new THREE.LineLoop(squareGeom, markerMaterial);
      markerSquare.frustumCulled = false;
      const crossGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-s, -s, 0),
        new THREE.Vector3(s, s, 0),
        new THREE.Vector3(-s, s, 0),
        new THREE.Vector3(s, -s, 0),
      ]);
      markerCross = new THREE.LineSegments(crossGeom, markerMaterial);
      markerCross.frustumCulled = false;
      markerGroup.add(markerSquare, markerCross);
      scene.add(markerGroup);

      // --- pointer + key listeners on the plugin overlay ---
      const root = pluginRoot;
      root.addEventListener('pointerdown', onPointerDown);
      root.addEventListener('pointermove', onPointerMove);
      root.addEventListener('contextmenu', onContextMenu);
      root.addEventListener('dblclick', onDoubleClick);
      window.addEventListener('keydown', onKeyDown);
      cleanups.push(() => {
        root.removeEventListener('pointerdown', onPointerDown);
        root.removeEventListener('pointermove', onPointerMove);
        root.removeEventListener('contextmenu', onContextMenu);
        root.removeEventListener('dblclick', onDoubleClick);
        window.removeEventListener('keydown', onKeyDown);
      });

      // --- engine events: reproject on render, swap set on page change ---
      cleanups.push(context.events.on('page:rendered', () => {
        resize();
        rebuildCommitted();
      }));
      cleanups.push(context.events.on('page:change', () => {
        if (currentMode) cancelPending();
        rebuildCommitted();
        context.events.emit('measurement:change', { count: completed.size });
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

      resize();
      render();
    },

    uninstall(): void {
      for (const c of cleanups.splice(0)) c();
      deactivate();
      completed.clear();
      disposeGroup(committedGroup);
      disposeGroup(previewGroup);
      markerSquare?.geometry.dispose();
      markerCross?.geometry.dispose();
      inkMaterial.dispose();
      fillMaterial.dispose();
      markerMaterial.dispose();
      if (renderer) {
        renderer.dispose();
        renderer.forceContextLoss();
      }
      if (pluginRoot?.parentNode) pluginRoot.parentNode.removeChild(pluginRoot);
      pluginRoot = null;
      canvasHost = null;
      labelHost = null;
      renderer = null;
      scene = null;
      camera = null;
      committedGroup = null;
      previewGroup = null;
      markerGroup = null;
      markerSquare = null;
      markerCross = null;
      ctx = null;
    },
  };

  // ---- resize lives here so it can see renderer/camera in the closure ----
  function resize(): void {
    if (!ctx || !renderer || !camera || !pluginRoot) return;
    const dims = ctx.getPageDimensions();
    if (!dims) return;
    const W = dims.width;
    const H = dims.height;
    pluginRoot.style.width = `${W}px`;
    pluginRoot.style.height = `${H}px`;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, true);
    camera.left = 0;
    camera.right = W;
    camera.top = 0;
    camera.bottom = H;
    camera.updateProjectionMatrix();
  }

  return api;
}
