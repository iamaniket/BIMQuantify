/**
 * Measurement plugin — distance (2 clicks) and angle (3 clicks).
 *
 * When active, pointer clicks place endpoints via raycasting. After
 * the required number of clicks a visual annotation appears.
 * All state lives in JS memory — no persistence.
 *
 * Labels use CSS2DRenderer for crisp text at any zoom level.
 */

import * as THREE from 'three';

import { LAYER_OVERLAY } from '../../../core/layers.js';
import type { Plugin, ViewerContext } from '../../../core/types.js';
import { pick } from '../../../core/Raycaster.js';
import type { SnappingPluginAPI } from '../snapping/index.js';
import type { MouseBindingsAPI } from '../mouse-bindings/index.js';
import {
  acquireCss2dOverlay,
  releaseCss2dOverlay,
  CSS2DObject,
} from '../shared/css2d-overlay.js';
import type { Css2dOverlay } from '../shared/css2d-overlay.js';
import { Magnifier } from './magnifier.js';

const NAME = 'measurement' as const;

export type MeasurementMode = 'distance' | 'angle' | 'area' | 'volume';

export interface Measurement {
  id: string;
  type: MeasurementMode;
  value: number;
  unit: string;
  points: Array<{ x: number; y: number; z: number }>;
  /** Height of extrusion (volume measurements only). */
  height?: number;
  visible: boolean;
}

export interface MeasurementConfig {
  directColor: number;
  xColor: number;
  yColor: number;
  zColor: number;
  areaColor: number;
  areaOpacity: number;
  labelScale: number;
  dotScale: number;
  precision: number;
  snapThreshold: number;
  showDecomposition: boolean;
}

export interface MeasurementPluginAPI {
  isActive(): boolean;
  mode(): MeasurementMode | null;
  measurements(): Measurement[];
  getConfig(): MeasurementConfig;
  setConfig(cfg: Partial<MeasurementConfig>): void;
}

const DEFAULT_CONFIG: MeasurementConfig = {
  directColor: 0xb8860b,
  xColor: 0xe53935,
  yColor: 0x43a047,
  zColor: 0x1e88e5,
  areaColor: 0x2196f3,
  areaOpacity: 0.25,
  labelScale: 1.0,
  dotScale: 1.0,
  precision: 3,
  snapThreshold: 15,
  showDecomposition: true,
};

let nextId = 0;

// ----- CSS label helper -----

function hexToCssRgba(hex: number, alpha: number): string {
  const r = (hex >> 16) & 0xff;
  const g = (hex >> 8) & 0xff;
  const b = hex & 0xff;
  return `rgba(${String(r)},${String(g)},${String(b)},${String(alpha)})`;
}

function createCssLabel(
  ov: Css2dOverlay,
  text: string,
  labelScale: number,
  parent: THREE.Object3D,
  position: THREE.Vector3,
  bgColor?: number,
): CSS2DObject {
  const obj = ov.createLabel(text, position, parent);
  const fontSize = Math.round(12 * labelScale);
  obj.element.style.fontSize = `${String(fontSize)}px`;
  obj.element.style.fontWeight = 'bold';
  if (bgColor !== undefined) {
    obj.element.style.background = hexToCssRgba(bgColor, 0.82);
  }
  obj.layers.set(LAYER_OVERLAY);
  return obj;
}

// ----- plugin -----

export function measurementPlugin(): Plugin & MeasurementPluginAPI {
  let ctxRef: ViewerContext | null = null;
  let overlay: Css2dOverlay | null = null;
  let currentMode: MeasurementMode | null = null;
  let pendingPoints: THREE.Vector3[] = [];
  let pendingDots: THREE.Mesh[] = [];
  let pendingLines: THREE.Line[] = [];
  let clickUnsub: (() => void) | null = null;
  let moveUnsub: (() => void) | null = null;
  let dblclickUnsub: (() => void) | null = null;
  // Clicks are serialized through this promise chain: a double-click is two
  // `pointer:click` events (each async via raycasting) followed by a sync
  // `pointer:doubleclick`. Chaining guarantees both points settle before the
  // finish handler runs, so it can pop the duplicate 2nd-click point.
  let clickChain: Promise<void> = Promise.resolve();
  // While a measurement mode is active we steal the `doubleclick:left`
  // gesture from whatever else owns it (e.g. visibility.isolateAtPointer)
  // and restore it on exit.
  let savedDblClickBinding: string | null = null;
  let dblClickSuppressed = false;
  let exiting = false;

  // Area/volume polygon preview state
  let polygonFillMesh: THREE.Mesh | null = null;
  let polygonEdgeLines: THREE.Line[] = [];
  let volumePhase: 'base' | 'height' | null = null;
  let volumeBasePoints: THREE.Vector3[] = [];
  let volumeBaseNormal: THREE.Vector3 | null = null;
  let volumePreviewGroup: THREE.Group | null = null;

  // Rubber-band preview state
  let axisLockActive = false;
  let magnifier: Magnifier | null = null;

  let previewInFlight = false;
  let previewPendingNdc: { x: number; y: number } | null = null;
  let rubberLine: THREE.Line | null = null;
  let rubberLineGeo: THREE.BufferGeometry | null = null;
  let rubberLabel: CSS2DObject | null = null;
  let rubberArc: THREE.Line | null = null;
  let rubberXLine: THREE.Line | null = null;
  let rubberXLineGeo: THREE.BufferGeometry | null = null;
  let rubberYLine: THREE.Line | null = null;
  let rubberYLineGeo: THREE.BufferGeometry | null = null;
  let rubberZLine: THREE.Line | null = null;
  let rubberZLineGeo: THREE.BufferGeometry | null = null;
  let rubberCorner: THREE.Line | null = null;
  let rubberCorner2: THREE.Line | null = null;

  const config: MeasurementConfig = { ...DEFAULT_CONFIG };

  const completed = new Map<string, Measurement>();
  const sceneGroups = new Map<string, THREE.Group>();

  const DOT_GEO = new THREE.SphereGeometry(0.05, 12, 12);
  const DOT_MAT = new THREE.MeshBasicMaterial({ color: config.directColor, depthTest: false });
  const LINE_MAT = new THREE.LineBasicMaterial({ color: config.directColor, depthTest: false });
  const ARC_MAT = new THREE.LineBasicMaterial({ color: config.directColor, depthTest: false });

  const axisColor = (axis: string): number =>
    axis === 'X' ? config.xColor : axis === 'Y' ? config.yColor : config.zColor;

  // ----- CSS2D overlay rendering (event-driven, no perpetual loop) -----
  // Labels track the camera via the shared overlay's own `camera:change`
  // subscription, so there's nothing to render every frame. `startCss2dLoop`
  // now just nudges a one-shot repaint when a measurement is added/changed;
  // the live rubber-band preview pokes its own render on each pointer move
  // (see handlePreviewMove). Names kept so the many call sites stay untouched.

  const needsCss2dLoop = (): boolean =>
    completed.size > 0 || currentMode !== null;

  const startCss2dLoop = (): void => {
    overlay?.requestRender();
  };

  const stopCss2dLoop = (): void => {
    // no-op: overlay rendering is event-driven (camera:change + requestRender)
  };

  // ----- geometry helpers -----

  const getModelScale = (): number => {
    if (!ctxRef) return 10;
    const box = new THREE.Box3();
    for (const model of ctxRef.models().values()) {
      const mBox = model.box;
      if (mBox && !mBox.isEmpty()) box.union(mBox);
    }
    if (box.isEmpty()) return 10;
    const size = box.getSize(new THREE.Vector3());
    return Math.max(size.x, size.y, size.z, 1);
  };

  const createDot = (pos: THREE.Vector3): THREE.Mesh => {
    const scale = Math.max(getModelScale() / 200, 0.02) * config.dotScale;
    const dot = new THREE.Mesh(DOT_GEO, DOT_MAT);
    dot.position.copy(pos);
    dot.scale.setScalar(scale / 0.05);
    dot.renderOrder = 999;
    dot.layers.set(LAYER_OVERLAY);
    return dot;
  };

  const formatDistance = (d: number): string => {
    const p = config.precision;
    if (d < 0.01) return `${(d * 1000).toFixed(Math.max(p - 2, 1))} mm`;
    if (d < 1) return `${(d * 1000).toFixed(Math.max(p - 3, 0))} mm`;
    if (d < 100) return `${d.toFixed(p)} m`;
    return `${d.toFixed(Math.max(p - 2, 1))} m`;
  };

  const formatAngle = (radians: number): string => {
    const deg = radians * (180 / Math.PI);
    return `${deg.toFixed(Math.max(config.precision - 2, 1))}°`;
  };

  const formatArea = (area: number): string => {
    const p = config.precision;
    if (area < 0.0001) return `${(area * 1e6).toFixed(Math.max(p - 2, 1))} mm²`;
    if (area < 0.01) return `${(area * 1e4).toFixed(Math.max(p - 2, 1))} cm²`;
    return `${area.toFixed(p)} m²`;
  };

  const formatVolume = (vol: number): string => {
    const p = config.precision;
    if (vol < 0.000001) return `${(vol * 1e9).toFixed(Math.max(p - 2, 1))} mm³`;
    if (vol < 0.001) return `${(vol * 1e6).toFixed(Math.max(p - 2, 1))} cm³`;
    return `${vol.toFixed(p)} m³`;
  };

  const computePolygonNormal = (pts: THREE.Vector3[]): THREE.Vector3 => {
    const n = new THREE.Vector3();
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i]!;
      const next = pts[(i + 1) % pts.length]!;
      n.x += (cur.y - next.y) * (cur.z + next.z);
      n.y += (cur.z - next.z) * (cur.x + next.x);
      n.z += (cur.x - next.x) * (cur.y + next.y);
    }
    if (n.lengthSq() < 1e-12) n.set(0, 1, 0);
    return n.normalize();
  };

  const computePolygonArea = (pts: THREE.Vector3[]): number => {
    if (pts.length < 3) return 0;
    const normal = computePolygonNormal(pts);
    const cross = new THREE.Vector3();
    const total = new THREE.Vector3();
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i]!;
      const next = pts[(i + 1) % pts.length]!;
      cross.crossVectors(cur, next);
      total.add(cross);
    }
    return Math.abs(total.dot(normal)) * 0.5;
  };

  const computePolygonCentroid = (pts: THREE.Vector3[]): THREE.Vector3 => {
    const c = new THREE.Vector3();
    for (const p of pts) c.add(p);
    c.divideScalar(pts.length);
    return c;
  };

  const createPolygonFill = (
    pts: THREE.Vector3[],
    color: number,
    opacity: number,
    parent: THREE.Object3D,
  ): THREE.Mesh => {
    const normal = computePolygonNormal(pts);
    const up = Math.abs(normal.y) > 0.99
      ? new THREE.Vector3(1, 0, 0)
      : new THREE.Vector3(0, 1, 0);
    const xAxis = new THREE.Vector3().crossVectors(up, normal).normalize();
    const yAxis = new THREE.Vector3().crossVectors(normal, xAxis).normalize();
    const origin = pts[0]!;

    const shape = new THREE.Shape();
    const projected = pts.map((p) => {
      const d = new THREE.Vector3().subVectors(p, origin);
      return new THREE.Vector2(d.dot(xAxis), d.dot(yAxis));
    });
    shape.moveTo(projected[0]!.x, projected[0]!.y);
    for (let i = 1; i < projected.length; i++) {
      shape.lineTo(projected[i]!.x, projected[i]!.y);
    }
    shape.closePath();

    const geo = new THREE.ShapeGeometry(shape);
    const positions = geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < positions.count; i++) {
      const u = positions.getX(i);
      const v = positions.getY(i);
      const world = origin.clone()
        .addScaledVector(xAxis, u)
        .addScaledVector(yAxis, v);
      positions.setXYZ(i, world.x, world.y, world.z);
    }
    positions.needsUpdate = true;
    geo.computeVertexNormals();

    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      side: THREE.DoubleSide,
      depthTest: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 997;
    mesh.layers.set(LAYER_OVERLAY);
    parent.add(mesh);
    return mesh;
  };

  const applyAxisLock = (anchor: THREE.Vector3, target: THREE.Vector3): { point: THREE.Vector3; axis: 'x' | 'y' | 'z' } => {
    const delta = new THREE.Vector3().subVectors(target, anchor);
    const absX = Math.abs(delta.x);
    const absY = Math.abs(delta.y);
    const absZ = Math.abs(delta.z);

    let axis: 'x' | 'y' | 'z';
    const locked = anchor.clone();

    if (absX >= absY && absX >= absZ) {
      axis = 'x';
      locked.x += delta.x;
    } else if (absY >= absX && absY >= absZ) {
      axis = 'y';
      locked.y += delta.y;
    } else {
      axis = 'z';
      locked.z += delta.z;
    }

    return { point: locked, axis };
  };

  let axisLockLabel: HTMLDivElement | null = null;

  const showAxisLockLabel = (axis: 'x' | 'y' | 'z', screenX: number, screenY: number): void => {
    if (!axisLockLabel) {
      axisLockLabel = document.createElement('div');
      axisLockLabel.style.cssText =
        'position:fixed;pointer-events:none;user-select:none;' +
        'font-family:system-ui,sans-serif;font-size:10px;font-weight:700;' +
        'padding:1px 5px;border-radius:3px;white-space:nowrap;z-index:10001;' +
        'color:#fff;letter-spacing:0.5px;';
      document.body.appendChild(axisLockLabel);
    }
    const colorHex = axis === 'x' ? config.xColor : axis === 'y' ? config.yColor : config.zColor;
    const r = (colorHex >> 16) & 0xff;
    const g = (colorHex >> 8) & 0xff;
    const b = colorHex & 0xff;
    axisLockLabel.style.background = `rgba(${r},${g},${b},0.9)`;
    axisLockLabel.textContent = `${axis.toUpperCase()}-Lock`;
    axisLockLabel.style.left = `${screenX + 16}px`;
    axisLockLabel.style.top = `${screenY + 16}px`;
  };

  const hideAxisLockLabel = (): void => {
    if (axisLockLabel) {
      axisLockLabel.remove();
      axisLockLabel = null;
    }
  };

  const toggleAxisLock = (): void => {
    if (currentMode === null || pendingPoints.length === 0) return;
    axisLockActive = !axisLockActive;
    if (!axisLockActive) hideAxisLockLabel();
    ctxRef?.events.emit('measurement:axisLock', {
      active: axisLockActive,
      axis: null,
    });
  };

  const emitChange = (): void => {
    ctxRef?.events.emit('measurement:change', {
      measurements: [...completed.values()],
    });
  };

  const createDashedLine = (a: THREE.Vector3, b: THREE.Vector3, color?: number): THREE.Line => {
    const scale = getModelScale();
    const mat = new THREE.LineDashedMaterial({
      color: color ?? config.directColor,
      depthTest: false,
      dashSize: scale / 80,
      gapSize: scale / 120,
    });
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geo, mat);
    line.computeLineDistances();
    line.renderOrder = 998;
    return line;
  };

  const createRightAngleIndicator = (
    corner: THREE.Vector3, dirH: THREE.Vector3, dirV: THREE.Vector3, size: number,
    color?: number,
  ): THREE.Line => {
    const hNorm = dirH.clone().normalize();
    const vNorm = dirV.clone().normalize();
    const pts = [
      corner.clone().addScaledVector(hNorm, size),
      corner.clone().addScaledVector(hNorm, size).addScaledVector(vNorm, size),
      corner.clone().addScaledVector(vNorm, size),
    ];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: color ?? config.directColor, depthTest: false });
    const line = new THREE.Line(geo, mat);
    line.renderOrder = 998;
    return line;
  };

  const buildDistanceGroup = (p1: THREE.Vector3, p2: THREE.Vector3): THREE.Group => {
    const distance = p1.distanceTo(p2);
    const group = new THREE.Group();
    group.renderOrder = 999;

    group.add(createDot(p1));
    group.add(createDot(p2));

    // Direct line (solid)
    const lineGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const line = new THREE.Line(lineGeo, LINE_MAT);
    line.renderOrder = 999;
    group.add(line);

    const mid = new THREE.Vector3().lerpVectors(p1, p2, 0.5);
    createCssLabel(overlay!, formatDistance(distance), config.labelScale, group, mid, config.directColor);

    // Decomposition guides (X, Y, Z axes)
    const dX = Math.abs(p2.x - p1.x);
    const dY = Math.abs(p2.y - p1.y);
    const dZ = Math.abs(p2.z - p1.z);
    const nonTrivialAxes = (dX > 0.001 ? 1 : 0) + (dY > 0.001 ? 1 : 0) + (dZ > 0.001 ? 1 : 0);

    if (config.showDecomposition && nonTrivialAxes >= 2) {
      // Path: p1 → pX → pXZ → p2
      const pX = new THREE.Vector3(p2.x, p1.y, p1.z);
      const pXZ = new THREE.Vector3(p2.x, p1.y, p2.z);

      type Leg = { from: THREE.Vector3; to: THREE.Vector3; axis: string; dist: number };
      const legs: Leg[] = [];
      if (dX > 0.001) legs.push({ from: p1, to: pX, axis: 'X', dist: dX });
      if (dZ > 0.001) legs.push({ from: dX > 0.001 ? pX : p1, to: pXZ, axis: 'Z', dist: dZ });
      if (dY > 0.001) legs.push({ from: pXZ, to: p2, axis: 'Y', dist: dY });

      for (const leg of legs) {
        const ac = axisColor(leg.axis);
        group.add(createDashedLine(leg.from, leg.to, ac));
        const legMid = new THREE.Vector3().lerpVectors(leg.from, leg.to, 0.5);
        createCssLabel(overlay!, `${leg.axis}: ${formatDistance(leg.dist)}`, config.labelScale * 0.7, group, legMid, ac);
      }

      for (let i = 0; i < legs.length - 1; i++) {
        const legA = legs[i]!;
        const legB = legs[i + 1]!;
        const corner = legA.to;
        const dirA = new THREE.Vector3().subVectors(legA.from, corner);
        const dirB = new THREE.Vector3().subVectors(legB.to, corner);
        if (dirA.length() > 1e-6 && dirB.length() > 1e-6) {
          const size = Math.min(dirA.length(), dirB.length()) * 0.08;
          const cornerColor = axisColor(legB.axis);
          group.add(createRightAngleIndicator(corner, dirA, dirB, size, cornerColor));
        }
      }
    }

    group.traverse((child) => child.layers.set(LAYER_OVERLAY));
    return group;
  };

  const finishDistance = (p1: THREE.Vector3, p2: THREE.Vector3): void => {
    if (!ctxRef) return;
    const id = `measure-${String(++nextId)}`;
    const distance = p1.distanceTo(p2);

    const group = buildDistanceGroup(p1, p2);
    group.name = `measurement-${id}`;
    ctxRef.scene.add(group);
    sceneGroups.set(id, group);
    startCss2dLoop();

    completed.set(id, {
      id,
      type: 'distance',
      value: distance,
      unit: 'm',
      visible: true,
      points: [
        { x: p1.x, y: p1.y, z: p1.z },
        { x: p2.x, y: p2.y, z: p2.z },
      ],
    });

    emitChange();
    ctxRef.events.emit('measurement:complete', { id, type: 'distance', value: distance });
  };

  const createArc = (
    vertex: THREE.Vector3,
    dirA: THREE.Vector3,
    dirB: THREE.Vector3,
    angle: number,
    radius: number,
  ): THREE.Line => {
    const segments = Math.max(Math.ceil(Math.abs(angle) / (Math.PI / 36)), 8);
    const points: THREE.Vector3[] = [];

    const nA = dirA.clone().normalize();
    const nB = dirB.clone().normalize();

    // Build a local frame: X = nA, compute Y perpendicular in the plane of nA/nB
    const cross = new THREE.Vector3().crossVectors(nA, nB).normalize();
    const perpY = new THREE.Vector3().crossVectors(cross, nA).normalize();

    for (let i = 0; i <= segments; i++) {
      const t = (i / segments) * angle;
      const dir = new THREE.Vector3()
        .addScaledVector(nA, Math.cos(t))
        .addScaledVector(perpY, Math.sin(t))
        .normalize();
      points.push(vertex.clone().addScaledVector(dir, radius));
    }

    const geo = new THREE.BufferGeometry().setFromPoints(points);
    const arc = new THREE.Line(geo, ARC_MAT);
    arc.renderOrder = 999;
    return arc;
  };

  const buildAngleGroup = (
    p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3,
  ): { group: THREE.Group; degrees: number } | null => {
    const armA = new THREE.Vector3().subVectors(p1, p2);
    const armB = new THREE.Vector3().subVectors(p3, p2);
    const lenA = armA.length();
    const lenB = armB.length();
    if (lenA < 1e-6 || lenB < 1e-6) return null;

    const cosAngle = THREE.MathUtils.clamp(armA.dot(armB) / (lenA * lenB), -1, 1);
    const angle = Math.acos(cosAngle);

    const group = new THREE.Group();
    group.renderOrder = 999;

    group.add(createDot(p1));
    group.add(createDot(p2));
    group.add(createDot(p3));

    const lineGeo1 = new THREE.BufferGeometry().setFromPoints([p2, p1]);
    const line1 = new THREE.Line(lineGeo1, LINE_MAT);
    line1.renderOrder = 999;
    group.add(line1);

    const lineGeo2 = new THREE.BufferGeometry().setFromPoints([p2, p3]);
    const line2 = new THREE.Line(lineGeo2, LINE_MAT);
    line2.renderOrder = 999;
    group.add(line2);

    const arcRadius = Math.min(lenA, lenB) * 0.3;
    const arc = createArc(p2, armA, armB, angle, arcRadius);
    group.add(arc);

    const bisector = new THREE.Vector3()
      .addVectors(armA.clone().normalize(), armB.clone().normalize())
      .normalize();
    const labelOffset = arcRadius * 1.6;
    const labelPos = p2.clone().addScaledVector(bisector, labelOffset);
    createCssLabel(overlay!, formatAngle(angle), config.labelScale, group, labelPos, config.directColor);

    group.traverse((child) => child.layers.set(LAYER_OVERLAY));
    return { group, degrees: angle * (180 / Math.PI) };
  };

  const finishAngle = (p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3): void => {
    if (!ctxRef) return;
    const result = buildAngleGroup(p1, p2, p3);
    if (!result) return;

    const id = `measure-${String(++nextId)}`;
    result.group.name = `measurement-${id}`;
    ctxRef.scene.add(result.group);
    sceneGroups.set(id, result.group);
    startCss2dLoop();

    completed.set(id, {
      id,
      type: 'angle',
      value: result.degrees,
      unit: 'deg',
      visible: true,
      points: [
        { x: p1.x, y: p1.y, z: p1.z },
        { x: p2.x, y: p2.y, z: p2.z },
        { x: p3.x, y: p3.y, z: p3.z },
      ],
    });

    emitChange();
    ctxRef.events.emit('measurement:complete', { id, type: 'angle', value: result.degrees });
  };

  // ----- area / volume group builders -----

  const buildAreaGroup = (pts: THREE.Vector3[]): THREE.Group => {
    const area = computePolygonArea(pts);
    const centroid = computePolygonCentroid(pts);
    const group = new THREE.Group();
    group.renderOrder = 999;

    for (const p of pts) group.add(createDot(p));

    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      const lineGeo = new THREE.BufferGeometry().setFromPoints([a, b]);
      const line = new THREE.Line(lineGeo, LINE_MAT);
      line.renderOrder = 999;
      group.add(line);
    }

    createPolygonFill(pts, config.areaColor, config.areaOpacity, group);
    createCssLabel(overlay!, formatArea(area), config.labelScale, group, centroid, config.areaColor);

    group.traverse((child) => child.layers.set(LAYER_OVERLAY));
    return group;
  };

  const finishArea = (pts: THREE.Vector3[]): void => {
    if (!ctxRef || pts.length < 3) return;
    const id = `measure-${String(++nextId)}`;
    const area = computePolygonArea(pts);

    const group = buildAreaGroup(pts);
    group.name = `measurement-${id}`;
    ctxRef.scene.add(group);
    sceneGroups.set(id, group);
    startCss2dLoop();

    completed.set(id, {
      id,
      type: 'area',
      value: area,
      unit: 'm²',
      visible: true,
      points: pts.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    });

    emitChange();
    ctxRef.events.emit('measurement:complete', { id, type: 'area', value: area });
  };

  const buildVolumeGroup = (
    basePts: THREE.Vector3[], height: number, normal: THREE.Vector3,
  ): THREE.Group => {
    const baseArea = computePolygonArea(basePts);
    const volume = Math.abs(baseArea * height);
    const offset = normal.clone().multiplyScalar(height);
    const topPts = basePts.map((p) => p.clone().add(offset));

    const group = new THREE.Group();
    group.renderOrder = 999;

    for (const p of basePts) group.add(createDot(p));
    for (const p of topPts) group.add(createDot(p));

    // Base edges
    for (let i = 0; i < basePts.length; i++) {
      const a = basePts[i]!;
      const b = basePts[(i + 1) % basePts.length]!;
      const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
      const line = new THREE.Line(geo, LINE_MAT);
      line.renderOrder = 999;
      group.add(line);
    }

    // Top edges
    for (let i = 0; i < topPts.length; i++) {
      const a = topPts[i]!;
      const b = topPts[(i + 1) % topPts.length]!;
      const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
      const line = new THREE.Line(geo, LINE_MAT);
      line.renderOrder = 999;
      group.add(line);
    }

    // Vertical edges
    for (let i = 0; i < basePts.length; i++) {
      const geo = new THREE.BufferGeometry().setFromPoints([basePts[i]!, topPts[i]!]);
      const line = new THREE.Line(geo, LINE_MAT);
      line.renderOrder = 999;
      group.add(line);
    }

    // Translucent base + top fills
    createPolygonFill(basePts, config.areaColor, config.areaOpacity, group);
    createPolygonFill(topPts, config.areaColor, config.areaOpacity, group);

    // Label at center of prism
    const baseCentroid = computePolygonCentroid(basePts);
    const labelPos = baseCentroid.clone().addScaledVector(normal, height * 0.5);
    createCssLabel(overlay!, formatVolume(volume), config.labelScale, group, labelPos, config.areaColor);

    // Height label on the first vertical edge
    const heightMid = basePts[0]!.clone().addScaledVector(normal, height * 0.5);
    createCssLabel(overlay!, formatDistance(Math.abs(height)), config.labelScale * 0.7, group, heightMid, config.directColor);

    group.traverse((child) => child.layers.set(LAYER_OVERLAY));
    return group;
  };

  const finishVolume = (basePts: THREE.Vector3[], height: number, normal: THREE.Vector3): void => {
    if (!ctxRef || basePts.length < 3) return;
    const id = `measure-${String(++nextId)}`;
    const baseArea = computePolygonArea(basePts);
    const volume = Math.abs(baseArea * height);

    const group = buildVolumeGroup(basePts, height, normal);
    group.name = `measurement-${id}`;
    ctxRef.scene.add(group);
    sceneGroups.set(id, group);
    startCss2dLoop();

    completed.set(id, {
      id,
      type: 'volume',
      value: volume,
      unit: 'm³',
      visible: true,
      height,
      points: basePts.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    });

    emitChange();
    ctxRef.events.emit('measurement:complete', { id, type: 'volume', value: volume });
  };

  // ---- restore (recreate a persisted measurement, no user interaction) ----

  const polygonNormal = (pts: THREE.Vector3[]): THREE.Vector3 => {
    // Newell's method — robust for arbitrary (possibly non-planar) polygons.
    const n = new THREE.Vector3();
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % pts.length]!;
      n.x += (a.y - b.y) * (a.z + b.z);
      n.y += (a.z - b.z) * (a.x + b.x);
      n.z += (a.x - b.x) * (a.y + b.y);
    }
    return n.lengthSq() < 1e-12 ? new THREE.Vector3(0, 1, 0) : n.normalize();
  };

  const restoreMeasurement = (m: {
    type: MeasurementMode;
    points: Array<{ x: number; y: number; z: number }>;
    height?: number | null;
  }): void => {
    if (!ctxRef) return;
    const pts = m.points.map((p) => new THREE.Vector3(p.x, p.y, p.z));

    let group: THREE.Group | null = null;
    let value = 0;
    let unit = '';
    let height: number | undefined;

    if (m.type === 'distance' && pts.length >= 2) {
      group = buildDistanceGroup(pts[0]!, pts[1]!);
      value = pts[0]!.distanceTo(pts[1]!);
      unit = 'm';
    } else if (m.type === 'angle' && pts.length >= 3) {
      const res = buildAngleGroup(pts[0]!, pts[1]!, pts[2]!);
      if (res) {
        group = res.group;
        value = res.degrees;
        unit = 'deg';
      }
    } else if (m.type === 'area' && pts.length >= 3) {
      group = buildAreaGroup(pts);
      value = computePolygonArea(pts);
      unit = 'm²';
    } else if (m.type === 'volume' && pts.length >= 3) {
      // The base-plane normal isn't persisted; derive it. The extrusion
      // direction may flip vs the original, but the value and base are exact.
      const h = m.height ?? 0;
      group = buildVolumeGroup(pts, h, polygonNormal(pts));
      value = Math.abs(computePolygonArea(pts) * h);
      unit = 'm³';
      height = h;
    }

    if (!group) return;
    const id = `measure-${String(++nextId)}`;
    group.name = `measurement-${id}`;
    ctxRef.scene.add(group);
    sceneGroups.set(id, group);
    startCss2dLoop();

    completed.set(id, {
      id,
      type: m.type,
      value,
      unit,
      visible: true,
      ...(height !== undefined ? { height } : {}),
      points: m.points.map((p) => ({ x: p.x, y: p.y, z: p.z })),
    });
    emitChange();
  };

  // ---- rubber-band preview helpers ----

  const clearRubberBand = (): void => {
    if (rubberLine) rubberLine.removeFromParent();
    if (rubberLineGeo) { rubberLineGeo.dispose(); rubberLineGeo = null; }
    rubberLine = null;

    if (rubberLabel) {
      overlay?.removeLabel(rubberLabel);
      rubberLabel = null;
    }

    if (rubberArc) { rubberArc.geometry.dispose(); rubberArc.removeFromParent(); rubberArc = null; }

    if (rubberXLine) { rubberXLineGeo?.dispose(); (rubberXLine.material as THREE.Material).dispose(); rubberXLine.removeFromParent(); }
    rubberXLine = null; rubberXLineGeo = null;
    if (rubberYLine) { rubberYLineGeo?.dispose(); (rubberYLine.material as THREE.Material).dispose(); rubberYLine.removeFromParent(); }
    rubberYLine = null; rubberYLineGeo = null;
    if (rubberZLine) { rubberZLineGeo?.dispose(); (rubberZLine.material as THREE.Material).dispose(); rubberZLine.removeFromParent(); }
    rubberZLine = null; rubberZLineGeo = null;
    if (rubberCorner) { rubberCorner.geometry.dispose(); (rubberCorner.material as THREE.Material).dispose(); rubberCorner.removeFromParent(); }
    rubberCorner = null;
    if (rubberCorner2) { rubberCorner2.geometry.dispose(); (rubberCorner2.material as THREE.Material).dispose(); rubberCorner2.removeFromParent(); }
    rubberCorner2 = null;
  };

  const createRubberLine = (anchor: THREE.Vector3): void => {
    if (!ctxRef) return;
    clearRubberBand();
    const positions = new Float32Array([
      anchor.x, anchor.y, anchor.z,
      anchor.x, anchor.y, anchor.z,
    ]);
    rubberLineGeo = new THREE.BufferGeometry();
    rubberLineGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    rubberLine = new THREE.Line(rubberLineGeo, LINE_MAT);
    rubberLine.renderOrder = 999;
    rubberLine.layers.set(LAYER_OVERLAY);
    rubberLine.frustumCulled = false;
    ctxRef.scene.add(rubberLine);
  };

  const updateRubberLine = (endPos: THREE.Vector3): void => {
    if (!rubberLineGeo) return;
    const posAttr = rubberLineGeo.getAttribute('position') as THREE.BufferAttribute;
    posAttr.setXYZ(1, endPos.x, endPos.y, endPos.z);
    posAttr.needsUpdate = true;
    rubberLineGeo.computeBoundingSphere();
  };

  const updateRubberLabel = (text: string, position: THREE.Vector3): void => {
    if (!overlay) return;
    if (!rubberLabel) {
      rubberLabel = overlay.createLabel(text, position);
      const fontSize = Math.round(12 * config.labelScale);
      rubberLabel.element.style.fontSize = `${String(fontSize)}px`;
      rubberLabel.element.style.fontWeight = 'bold';
      rubberLabel.element.style.background = hexToCssRgba(config.directColor, 0.82);
      rubberLabel.layers.set(LAYER_OVERLAY);
    } else {
      rubberLabel.element.textContent = text;
      rubberLabel.position.copy(position);
    }
  };

  const resolvePreviewPoint = async (
    ndc: { x: number; y: number },
  ): Promise<THREE.Vector3 | null> => {
    if (!ctxRef) return null;
    const snapping = ctxRef.plugins.get<SnappingPluginAPI>('snapping');
    const snap = snapping?.currentSnap();
    let pt: THREE.Vector3 | null = null;
    if (snap) {
      pt = new THREE.Vector3(snap.point.x, snap.point.y, snap.point.z);
    } else {
      pt = await pickOrGround(ctxRef, ndc);
    }
    if (pt && axisLockActive && pendingPoints.length > 0) {
      const anchor = pendingPoints[pendingPoints.length - 1]!;
      const { point, axis } = applyAxisLock(anchor, pt);

      // Project to screen for label positioning
      const ndcPt = point.clone().project(ctxRef.camera);
      const rect = ctxRef.canvas.getBoundingClientRect();
      const sx = ((ndcPt.x + 1) / 2) * rect.width + rect.left;
      const sy = ((1 - ndcPt.y) / 2) * rect.height + rect.top;
      showAxisLockLabel(axis, sx, sy);

      ctxRef.events.emit('measurement:axisLock', { active: true, axis });

      // Change rubber-band color to match locked axis
      const lockColor = axisColor(axis.toUpperCase());
      LINE_MAT.color.setHex(lockColor);

      return point;
    }
    if (!axisLockActive) {
      hideAxisLockLabel();
      LINE_MAT.color.setHex(config.directColor);
    }
    return pt;
  };

  const updateMagnifier = async (
    ndc: { x: number; y: number },
    clientX: number,
    clientY: number,
  ): Promise<void> => {
    if (!ctxRef || !magnifier) return;
    const result = await pick(ctxRef, ndc);
    if (result) {
      const pt = new THREE.Vector3(result.point.x, result.point.y, result.point.z);
      magnifier.update(pt, clientX, clientY);
    } else {
      // Ground plane fallback
      const camera = ctxRef.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
      raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
      const hit = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(groundPlane, hit)) {
        magnifier.update(hit, clientX, clientY);
      }
    }
  };

  const processPreviewMove = async (
    ndc: { x: number; y: number },
    clientX?: number,
    clientY?: number,
  ): Promise<void> => {
    if (!ctxRef || currentMode === null) return;

    // Always update magnifier, even before first point is placed
    if (magnifier) {
      await updateMagnifier(ndc, clientX ?? 0, clientY ?? 0);
    }

    const inVolumeHeight = currentMode === 'volume' && volumePhase === 'height';
    if (pendingPoints.length === 0 && !inVolumeHeight) return;
    const pt = await resolvePreviewPoint(ndc);
    if (!pt) return;

    if (!inVolumeHeight) updateRubberLine(pt);

    if (currentMode === 'distance') {
      const p1 = pendingPoints[0]!;
      const dist = p1.distanceTo(pt);
      const mid = new THREE.Vector3().lerpVectors(p1, pt, 0.5);
      updateRubberLabel(formatDistance(dist), mid);

      // Decomposition preview (X, Y, Z axes)
      const rdX = Math.abs(pt.x - p1.x);
      const rdY = Math.abs(pt.y - p1.y);
      const rdZ = Math.abs(pt.z - p1.z);
      const rAxes = (rdX > 0.001 ? 1 : 0) + (rdY > 0.001 ? 1 : 0) + (rdZ > 0.001 ? 1 : 0);

      if (config.showDecomposition && rAxes >= 2) {
        const scale = getModelScale();

        const pX = new THREE.Vector3(pt.x, p1.y, p1.z);
        const pXZ = new THREE.Vector3(pt.x, p1.y, pt.z);

        const ensureDashedLine = (
          ref: THREE.Line | null, geoRef: THREE.BufferGeometry | null,
          a: THREE.Vector3, b: THREE.Vector3, color: number,
        ): [THREE.Line, THREE.BufferGeometry] => {
          let line = ref;
          let geo = geoRef;
          if (!line) {
            const mat = new THREE.LineDashedMaterial({
              color, depthTest: false, dashSize: scale / 80, gapSize: scale / 120,
            });
            geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
            line = new THREE.Line(geo, mat);
            line.renderOrder = 998;
            line.layers.set(LAYER_OVERLAY);
            line.frustumCulled = false;
            ctxRef!.scene.add(line);
          }
          const attr = geo!.getAttribute('position') as THREE.BufferAttribute;
          attr.setXYZ(0, a.x, a.y, a.z);
          attr.setXYZ(1, b.x, b.y, b.z);
          attr.needsUpdate = true;
          geo!.computeBoundingSphere();
          line.computeLineDistances();
          return [line, geo!];
        };

        const removeDashedLine = (
          ref: THREE.Line | null, geoRef: THREE.BufferGeometry | null,
        ): [null, null] => {
          if (ref) { ref.removeFromParent(); geoRef?.dispose(); }
          return [null, null];
        };

        // X axis
        if (rdX > 0.001) {
          [rubberXLine, rubberXLineGeo] = ensureDashedLine(rubberXLine, rubberXLineGeo, p1, pX, config.xColor);
        } else {
          [rubberXLine, rubberXLineGeo] = removeDashedLine(rubberXLine, rubberXLineGeo);
        }

        // Z axis
        if (rdZ > 0.001) {
          const zFrom = rdX > 0.001 ? pX : p1;
          [rubberZLine, rubberZLineGeo] = ensureDashedLine(rubberZLine, rubberZLineGeo, zFrom, pXZ, config.zColor);
        } else {
          [rubberZLine, rubberZLineGeo] = removeDashedLine(rubberZLine, rubberZLineGeo);
        }

        // Y axis
        if (rdY > 0.001) {
          [rubberYLine, rubberYLineGeo] = ensureDashedLine(rubberYLine, rubberYLineGeo, pXZ, pt, config.yColor);
        } else {
          [rubberYLine, rubberYLineGeo] = removeDashedLine(rubberYLine, rubberYLineGeo);
        }

        // Corner indicators
        if (rubberCorner) { rubberCorner.geometry.dispose(); rubberCorner.removeFromParent(); rubberCorner = null; }
        if (rubberCorner2) { rubberCorner2.geometry.dispose(); rubberCorner2.removeFromParent(); rubberCorner2 = null; }

        if (rdX > 0.001 && rdZ > 0.001) {
          const d1 = new THREE.Vector3().subVectors(p1, pX);
          const d2 = new THREE.Vector3().subVectors(pXZ, pX);
          const sz = Math.min(rdX, rdZ) * 0.08;
          rubberCorner = createRightAngleIndicator(pX, d1, d2, sz, config.zColor);
          rubberCorner.layers.set(LAYER_OVERLAY);
          ctxRef!.scene.add(rubberCorner);
        }
        const lastHorizEnd = rdZ > 0.001 ? pXZ : (rdX > 0.001 ? pX : null);
        if (lastHorizEnd && rdY > 0.001) {
          const prevFrom = rdZ > 0.001 ? (rdX > 0.001 ? pX : p1) : p1;
          const d1 = new THREE.Vector3().subVectors(prevFrom, lastHorizEnd);
          const d2 = new THREE.Vector3().subVectors(pt, lastHorizEnd);
          if (d1.length() > 1e-6 && d2.length() > 1e-6) {
            const sz = Math.min(d1.length(), d2.length()) * 0.08;
            rubberCorner2 = createRightAngleIndicator(lastHorizEnd, d1, d2, sz, config.yColor);
            rubberCorner2.layers.set(LAYER_OVERLAY);
            ctxRef!.scene.add(rubberCorner2);
          }
        }
      } else {
        if (rubberXLine) { (rubberXLine.material as THREE.Material).dispose(); rubberXLine.removeFromParent(); rubberXLineGeo?.dispose(); rubberXLine = null; rubberXLineGeo = null; }
        if (rubberYLine) { (rubberYLine.material as THREE.Material).dispose(); rubberYLine.removeFromParent(); rubberYLineGeo?.dispose(); rubberYLine = null; rubberYLineGeo = null; }
        if (rubberZLine) { (rubberZLine.material as THREE.Material).dispose(); rubberZLine.removeFromParent(); rubberZLineGeo?.dispose(); rubberZLine = null; rubberZLineGeo = null; }
        if (rubberCorner) { rubberCorner.geometry.dispose(); (rubberCorner.material as THREE.Material).dispose(); rubberCorner.removeFromParent(); rubberCorner = null; }
        if (rubberCorner2) { rubberCorner2.geometry.dispose(); (rubberCorner2.material as THREE.Material).dispose(); rubberCorner2.removeFromParent(); rubberCorner2 = null; }
      }
    } else if (currentMode === 'angle') {
      if (pendingPoints.length === 1) {
        // Phase 1: just the line, no label
      } else if (pendingPoints.length === 2) {
        const vertex = pendingPoints[1]!;
        const armA = new THREE.Vector3().subVectors(pendingPoints[0]!, vertex);
        const armB = new THREE.Vector3().subVectors(pt, vertex);
        const lenA = armA.length();
        const lenB = armB.length();
        if (lenA > 1e-6 && lenB > 1e-6) {
          const cosAngle = THREE.MathUtils.clamp(armA.dot(armB) / (lenA * lenB), -1, 1);
          const angle = Math.acos(cosAngle);

          if (rubberArc) { rubberArc.geometry.dispose(); rubberArc.removeFromParent(); rubberArc = null; }
          const arcRadius = Math.min(lenA, lenB) * 0.3;
          rubberArc = createArc(vertex, armA, armB, angle, arcRadius);
          rubberArc.layers.set(LAYER_OVERLAY);
          ctxRef.scene.add(rubberArc);

          const bisector = new THREE.Vector3()
            .addVectors(armA.clone().normalize(), armB.clone().normalize())
            .normalize();
          const labelPos = vertex.clone().addScaledVector(bisector, arcRadius * 1.6);
          updateRubberLabel(formatAngle(angle), labelPos);
        }
      }
    } else if (currentMode === 'area') {
      if (pendingPoints.length >= 2) {
        clearPolygonPreview();
        const previewPts = [...pendingPoints, pt];
        // Closing line from cursor to first point
        const closeGeo = new THREE.BufferGeometry().setFromPoints([pt, pendingPoints[0]!]);
        const closeMat = new THREE.LineDashedMaterial({
          color: config.areaColor, depthTest: false,
          dashSize: getModelScale() / 80, gapSize: getModelScale() / 120,
        });
        const closeLine = new THREE.Line(closeGeo, closeMat);
        closeLine.computeLineDistances();
        closeLine.renderOrder = 998;
        closeLine.layers.set(LAYER_OVERLAY);
        closeLine.frustumCulled = false;
        ctxRef.scene.add(closeLine);
        polygonEdgeLines.push(closeLine);

        if (previewPts.length >= 3) {
          const fillMat = new THREE.MeshBasicMaterial({
            color: config.areaColor, transparent: true, opacity: config.areaOpacity * 0.5,
            side: THREE.DoubleSide, depthTest: false,
          });
          const tempGroup = new THREE.Group();
          polygonFillMesh = createPolygonFill(previewPts, config.areaColor, config.areaOpacity * 0.5, tempGroup);
          polygonFillMesh.material = fillMat;
          tempGroup.remove(polygonFillMesh);
          ctxRef.scene.add(polygonFillMesh);

          const area = computePolygonArea(previewPts);
          const centroid = computePolygonCentroid(previewPts);
          updateRubberLabel(formatArea(area), centroid);
        }
      }
    } else if (currentMode === 'volume' && volumePhase === 'height') {
      if (volumeBasePoints.length >= 3 && volumeBaseNormal) {
        const baseCentroid = computePolygonCentroid(volumeBasePoints);
        const height = new THREE.Vector3().subVectors(pt, baseCentroid).dot(volumeBaseNormal);

        clearPolygonPreview();
        if (Math.abs(height) > 1e-6) {
          const offset = volumeBaseNormal.clone().multiplyScalar(height);
          const topPts = volumeBasePoints.map((p) => p.clone().add(offset));
          volumePreviewGroup = new THREE.Group();
          volumePreviewGroup.renderOrder = 999;

          // Base + top edges (dashed)
          for (const pts of [volumeBasePoints, topPts]) {
            for (let i = 0; i < pts.length; i++) {
              const a = pts[i]!;
              const b = pts[(i + 1) % pts.length]!;
              const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
              const mat = new THREE.LineDashedMaterial({
                color: config.areaColor, depthTest: false,
                dashSize: getModelScale() / 80, gapSize: getModelScale() / 120,
              });
              const line = new THREE.Line(geo, mat);
              line.computeLineDistances();
              line.renderOrder = 998;
              line.layers.set(LAYER_OVERLAY);
              volumePreviewGroup.add(line);
            }
          }

          // Vertical edges
          for (let i = 0; i < volumeBasePoints.length; i++) {
            const geo = new THREE.BufferGeometry().setFromPoints([volumeBasePoints[i]!, topPts[i]!]);
            const mat = new THREE.LineDashedMaterial({
              color: config.areaColor, depthTest: false,
              dashSize: getModelScale() / 80, gapSize: getModelScale() / 120,
            });
            const line = new THREE.Line(geo, mat);
            line.computeLineDistances();
            line.renderOrder = 998;
            line.layers.set(LAYER_OVERLAY);
            volumePreviewGroup.add(line);
          }

          // Fills
          createPolygonFill(volumeBasePoints, config.areaColor, config.areaOpacity * 0.4, volumePreviewGroup);
          createPolygonFill(topPts, config.areaColor, config.areaOpacity * 0.4, volumePreviewGroup);

          volumePreviewGroup.traverse((child) => child.layers.set(LAYER_OVERLAY));
          ctxRef.scene.add(volumePreviewGroup);

          const baseArea = computePolygonArea(volumeBasePoints);
          const volume = Math.abs(baseArea * height);
          const labelPos = baseCentroid.clone().addScaledVector(volumeBaseNormal, height * 0.5);
          updateRubberLabel(formatVolume(volume), labelPos);
        }
      }
    }
  };

  let previewPendingClient: { x: number; y: number } | null = null;

  const handlePreviewMove = async (
    e: { ndc: { x: number; y: number }; clientX?: number; clientY?: number },
  ): Promise<void> => {
    if (currentMode === null) return;
    if (previewInFlight) {
      previewPendingNdc = e.ndc;
      previewPendingClient = { x: e.clientX ?? 0, y: e.clientY ?? 0 };
      return;
    }
    previewInFlight = true;
    let ndc: { x: number; y: number } | null = e.ndc;
    let client = { x: e.clientX ?? 0, y: e.clientY ?? 0 };
    while (ndc) {
      previewPendingNdc = null;
      const c = previewPendingClient ?? client;
      previewPendingClient = null;
      await processPreviewMove(ndc, c.x, c.y);
      ndc = previewPendingNdc;
      if (previewPendingClient) client = previewPendingClient;
    }
    previewInFlight = false;
    // The rubber-band preview (3D line + CSS2D label) follows the cursor, not
    // the camera — wake the on-demand renderer and repaint the label overlay.
    ctxRef?.requestRender();
    overlay?.requestRender();
  };

  // ---- end rubber-band preview ----

  const clearPolygonPreview = (): void => {
    if (polygonFillMesh) {
      polygonFillMesh.geometry.dispose();
      (polygonFillMesh.material as THREE.Material).dispose();
      polygonFillMesh.removeFromParent();
      polygonFillMesh = null;
    }
    for (const line of polygonEdgeLines) {
      line.geometry.dispose();
      line.removeFromParent();
    }
    polygonEdgeLines = [];
    if (volumePreviewGroup) {
      volumePreviewGroup.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material && mesh.material !== DOT_MAT && mesh.material !== LINE_MAT) {
          (mesh.material as THREE.Material).dispose();
        }
      });
      volumePreviewGroup.removeFromParent();
      volumePreviewGroup = null;
    }
  };

  const clearPending = (): void => {
    clearRubberBand();
    clearPolygonPreview();
    axisLockActive = false;
    hideAxisLockLabel();
    LINE_MAT.color.setHex(config.directColor);
    for (const dot of pendingDots) dot.removeFromParent();
    for (const line of pendingLines) {
      line.geometry.dispose();
      line.removeFromParent();
    }
    pendingDots = [];
    pendingLines = [];
    pendingPoints = [];
    volumePhase = null;
    volumeBasePoints = [];
    volumeBaseNormal = null;
  };

  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const raycaster = new THREE.Raycaster();

  const pickOrGround = async (
    ctx: ViewerContext,
    ndc: { x: number; y: number },
  ): Promise<THREE.Vector3 | null> => {
    const result = await pick(ctx, ndc);
    if (result) {
      const snapping = ctx.plugins.get<SnappingPluginAPI>('snapping');
      const snapped = snapping?.resolve(result);
      if (snapped) return new THREE.Vector3(snapped.point.x, snapped.point.y, snapped.point.z);
      return new THREE.Vector3(result.point.x, result.point.y, result.point.z);
    }

    const camera = ctx.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera;
    raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(groundPlane, hit)) return hit;
    return null;
  };

  const isNearFirstPoint = (pt: THREE.Vector3): boolean => {
    if (pendingPoints.length < 3) return false;
    const first = pendingPoints[0]!;
    const scale = getModelScale();
    const threshold = scale * 0.01;
    return pt.distanceTo(first) < threshold;
  };

  const handleClick = async (payload: {
    ndc: { x: number; y: number };
    button: number;
  }): Promise<void> => {
    if (!ctxRef || currentMode === null) return;

    // Right-click: finish polygon (area/volume) if enough points, else cancel
    if (payload.button === 2) {
      if ((currentMode === 'area' || (currentMode === 'volume' && volumePhase === 'base')) && pendingPoints.length >= 3) {
        if (currentMode === 'area') {
          finishArea(pendingPoints);
          clearPending();
        } else {
          volumePhase = 'height';
          volumeBasePoints = [...pendingPoints];
          volumeBaseNormal = computePolygonNormal(volumeBasePoints);
          clearRubberBand();
        }
      } else {
        clearPending();
      }
      return;
    }
    if (payload.button !== 0) return;

    // Volume height phase: click sets the height
    if (currentMode === 'volume' && volumePhase === 'height') {
      const pt = await pickOrGround(ctxRef, payload.ndc);
      if (!pt || !volumeBaseNormal || volumeBasePoints.length < 3) return;
      const baseCentroid = computePolygonCentroid(volumeBasePoints);
      const height = new THREE.Vector3().subVectors(pt, baseCentroid).dot(volumeBaseNormal);
      if (Math.abs(height) > 1e-6) {
        finishVolume(volumeBasePoints, height, volumeBaseNormal);
      }
      clearPending();
      return;
    }

    const pt = await pickOrGround(ctxRef, payload.ndc);
    if (!pt) return;

    // Area / volume base polygon: close polygon if clicking near first point
    if ((currentMode === 'area' || currentMode === 'volume') && isNearFirstPoint(pt)) {
      if (currentMode === 'area') {
        finishArea(pendingPoints);
        clearPending();
      } else {
        volumePhase = 'height';
        volumeBasePoints = [...pendingPoints];
        volumeBaseNormal = computePolygonNormal(volumeBasePoints);
        clearRubberBand();
        clearPolygonPreview();
      }
      return;
    }

    pendingPoints.push(pt);

    // Add preview dot
    const dot = createDot(pt);
    ctxRef.scene.add(dot);
    pendingDots.push(dot);

    // Add preview line from previous point
    if (pendingPoints.length > 1) {
      const prev = pendingPoints[pendingPoints.length - 2]!;
      const lineGeo = new THREE.BufferGeometry().setFromPoints([prev, pt]);
      const line = new THREE.Line(lineGeo, LINE_MAT);
      line.renderOrder = 999;
      line.layers.set(LAYER_OVERLAY);
      ctxRef.scene.add(line);
      pendingLines.push(line);
    }

    // Start or reset the rubber-band preview for the next point
    if (currentMode === 'area' || currentMode === 'volume') {
      createRubberLine(pt);
    } else {
      const needed = currentMode === 'distance' ? 2 : 3;
      if (pendingPoints.length < needed) {
        const anchor = currentMode === 'angle' && pendingPoints.length === 2
          ? pendingPoints[1]!
          : pt;
        createRubberLine(anchor);
      }

      if (pendingPoints.length >= needed) {
        axisLockActive = false;
        hideAxisLockLabel();
        LINE_MAT.color.setHex(config.directColor);
        if (currentMode === 'distance') {
          finishDistance(pendingPoints[0]!, pendingPoints[1]!);
        } else {
          finishAngle(pendingPoints[0]!, pendingPoints[1]!, pendingPoints[2]!);
        }
        clearPending();
      }
    }
  };

  // Remove the most-recently placed pending point and its dot/line. Used by
  // the double-click finish to drop the duplicate point left by the 2nd click.
  const popLastPendingPoint = (): void => {
    if (pendingPoints.length === 0) return;
    pendingPoints.pop();
    const dot = pendingDots.pop();
    if (dot) dot.removeFromParent();
    const line = pendingLines.pop();
    if (line) {
      line.geometry.dispose();
      line.removeFromParent();
    }
    clearRubberBand();
    clearPolygonPreview();
    const last = pendingPoints[pendingPoints.length - 1];
    if (last) createRubberLine(last);
  };

  // Double-click finishes an area polygon. The two clicks of the gesture each
  // placed a point at (nearly) the same spot, so drop the duplicate and close
  // the loop if we still have the 3 points a polygon needs.
  const handleDoubleClick = (payload: { button: number }): void => {
    if (!ctxRef || currentMode !== 'area' || payload.button !== 0) return;
    popLastPendingPoint();
    if (pendingPoints.length >= 3) {
      finishArea(pendingPoints);
      clearPending();
    }
  };

  const disposeGroup = (id: string): void => {
    const group = sceneGroups.get(id);
    if (!group) return;
    group.traverse((child) => {
      if (child instanceof CSS2DObject) {
        overlay?.removeLabel(child);
        return;
      }
      const mesh = child as THREE.Mesh;
      if (mesh.geometry && mesh.geometry !== DOT_GEO) mesh.geometry.dispose();
      if (mesh.material && mesh.material !== DOT_MAT && mesh.material !== LINE_MAT && mesh.material !== ARC_MAT) {
        (mesh.material as THREE.Material).dispose();
      }
    });
    group.removeFromParent();
    sceneGroups.delete(id);
    if (!needsCss2dLoop()) stopCss2dLoop();
  };

  // ----- commands -----

  const modeLabel = (mode: MeasurementMode): string => {
    switch (mode) {
      case 'distance': return 'Measurement — Distance';
      case 'angle': return 'Measurement — Angle';
      case 'area': return 'Measurement — Area';
      case 'volume': return 'Measurement — Volume';
    }
  };

  const suppressDoubleClickBinding = (): void => {
    if (!ctxRef || dblClickSuppressed) return;
    const mb = ctxRef.plugins.get<MouseBindingsAPI>('mouse-bindings');
    if (!mb) return;
    savedDblClickBinding =
      mb.list().find((b) => b.gesture === 'doubleclick:left')?.command ?? null;
    mb.unbind('doubleclick:left');
    dblClickSuppressed = true;
  };

  const restoreDoubleClickBinding = (): void => {
    if (!ctxRef || !dblClickSuppressed) return;
    dblClickSuppressed = false;
    const cmd = savedDblClickBinding;
    savedDblClickBinding = null;
    if (cmd) ctxRef.plugins.get<MouseBindingsAPI>('mouse-bindings')?.bind('doubleclick:left', cmd);
  };

  const activate = async (args: unknown): Promise<void> => {
    if (!ctxRef) return;
    const mode = typeof args === 'string'
      ? args
      : (args as { mode?: string })?.mode;
    if (mode !== 'distance' && mode !== 'angle' && mode !== 'area' && mode !== 'volume') return;

    if (currentMode !== null) deactivate();
    currentMode = mode;
    clearPending();

    ctxRef.commands.execute('snapping.enable').catch(() => undefined);

    clickChain = Promise.resolve();
    clickUnsub = ctxRef.events.on('pointer:click', (e) => {
      clickChain = clickChain.then(() => handleClick(e)).catch(() => undefined);
    });
    moveUnsub = ctxRef.events.on('pointer:move', (e) => void handlePreviewMove(e));
    dblclickUnsub = ctxRef.events.on('pointer:doubleclick', (e) => {
      clickChain = clickChain.then(() => { handleDoubleClick(e); }).catch(() => undefined);
    });
    suppressDoubleClickBinding();

    if (!magnifier) {
      magnifier = new Magnifier(
        ctxRef.container,
        ctxRef.renderer,
        ctxRef.scene,
        ctxRef.camera as THREE.PerspectiveCamera | THREE.OrthographicCamera,
      );
    }
    magnifier.show();

    startCss2dLoop();

    await ctxRef.commands.execute('mode.enter', {
      name: `measurement.${mode}`,
      label: modeLabel(mode),
      preserveCamera: true,
      cancel: () => false,
      onExit: () => {
        clearPending();
        clickUnsub?.();
        clickUnsub = null;
        moveUnsub?.();
        moveUnsub = null;
        dblclickUnsub?.();
        dblclickUnsub = null;
        restoreDoubleClickBinding();
        currentMode = null;
        magnifier?.hide();
        ctxRef?.commands.execute('snapping.disable').catch(() => undefined);
        if (!needsCss2dLoop()) stopCss2dLoop();
      },
    }).catch(() => undefined);
  };

  const deactivate = (): void => {
    if (!ctxRef || exiting) return;
    exiting = true;
    clearPending();
    magnifier?.hide();
    clickUnsub?.();
    clickUnsub = null;
    moveUnsub?.();
    moveUnsub = null;
    dblclickUnsub?.();
    dblclickUnsub = null;
    restoreDoubleClickBinding();
    currentMode = null;
    ctxRef.commands.execute('snapping.disable').catch(() => undefined);
    ctxRef.commands.execute('mode.exit').catch(() => undefined);
    if (!needsCss2dLoop()) stopCss2dLoop();
    exiting = false;
  };

  const clear = (): void => {
    clearPending();
    for (const id of completed.keys()) {
      disposeGroup(id);
    }
    completed.clear();
    if (!needsCss2dLoop()) stopCss2dLoop();
    emitChange();
  };

  const removeMeasurement = (args: unknown): void => {
    const id = typeof args === 'string' ? args : (args as { id?: string })?.id;
    if (!id) return;
    disposeGroup(id);
    completed.delete(id);
    emitChange();
  };

  const setVisibility = (args: unknown): void => {
    const { id, visible } = args as { id?: string; visible?: boolean };
    if (!id || visible === undefined) return;

    const measurement = completed.get(id);
    if (!measurement) return;

    measurement.visible = visible;

    const group = sceneGroups.get(id);
    if (group) group.visible = visible;

    emitChange();
  };

  const applyConfig = (partial: Partial<MeasurementConfig>): void => {
    Object.assign(config, partial);

    // Update shared materials when direct color changes
    if (partial.directColor !== undefined) {
      DOT_MAT.color.setHex(config.directColor);
      LINE_MAT.color.setHex(config.directColor);
      ARC_MAT.color.setHex(config.directColor);
    }

    // Update snap threshold
    if (partial.snapThreshold !== undefined) {
      ctxRef?.commands.execute('snapping.setThreshold', { px: config.snapThreshold }).catch(() => undefined);
    }

    const colorChanged = partial.directColor !== undefined || partial.xColor !== undefined || partial.yColor !== undefined || partial.zColor !== undefined;
    const areaChanged = partial.areaColor !== undefined || partial.areaOpacity !== undefined;

    // Re-render existing measurement labels (rebuild groups)
    if (partial.labelScale !== undefined || partial.dotScale !== undefined || partial.precision !== undefined || colorChanged || areaChanged || partial.showDecomposition !== undefined) {
      for (const [id, m] of completed) {
        disposeGroup(id);
        const pts = m.points.map((p) => new THREE.Vector3(p.x, p.y, p.z));
        if (m.type === 'distance' && pts.length >= 2) {
          const group = buildDistanceGroup(pts[0]!, pts[1]!);
          group.visible = m.visible;
          ctxRef?.scene.add(group);
          sceneGroups.set(id, group);
          startCss2dLoop();
          m.value = pts[0]!.distanceTo(pts[1]!);
        } else if (m.type === 'angle' && pts.length >= 3) {
          const result = buildAngleGroup(pts[0]!, pts[1]!, pts[2]!);
          if (result) {
            result.group.visible = m.visible;
            ctxRef?.scene.add(result.group);
            sceneGroups.set(id, result.group);
            startCss2dLoop();
            m.value = result.degrees;
          }
        } else if (m.type === 'area' && pts.length >= 3) {
          const group = buildAreaGroup(pts);
          group.visible = m.visible;
          ctxRef?.scene.add(group);
          sceneGroups.set(id, group);
          startCss2dLoop();
          m.value = computePolygonArea(pts);
        } else if (m.type === 'volume' && pts.length >= 3 && m.height !== undefined) {
          const normal = computePolygonNormal(pts);
          const group = buildVolumeGroup(pts, m.height, normal);
          group.visible = m.visible;
          ctxRef?.scene.add(group);
          sceneGroups.set(id, group);
          startCss2dLoop();
          m.value = Math.abs(computePolygonArea(pts) * m.height);
        }
      }
    }

    emitChange();
  };

  const api: Plugin & MeasurementPluginAPI = {
    name: NAME,
    dependencies: ['mode'],
    optionalDependencies: ['snapping', 'mouse-bindings'],

    isActive() { return currentMode !== null; },
    mode() { return currentMode; },
    measurements() { return [...completed.values()]; },
    getConfig() { return { ...config }; },
    setConfig(cfg: Partial<MeasurementConfig>) { applyConfig(cfg); },

    install(ctx: ViewerContext) {
      ctxRef = ctx;
      overlay = acquireCss2dOverlay(ctx);

      ctx.commands.register('measure.activate', (args: unknown) => activate(args), {
        title: 'Start measuring',
      });
      ctx.commands.register('measure.deactivate', () => deactivate(), {
        title: 'Stop measuring',
      });
      ctx.commands.register('measure.clear', () => clear(), {
        title: 'Clear all measurements',
      });
      ctx.commands.register('measure.remove', (args: unknown) => removeMeasurement(args), {
        title: 'Remove a measurement',
      });
      ctx.commands.register('measure.list', () => [...completed.values()], {
        title: 'List measurements',
      });
      ctx.commands.register('measure.restore', (args: unknown) => {
        const list = Array.isArray(args) ? args : args ? [args] : [];
        for (const m of list) {
          if (m && typeof m === 'object') {
            restoreMeasurement(
              m as {
                type: MeasurementMode;
                points: Array<{ x: number; y: number; z: number }>;
                height?: number | null;
              },
            );
          }
        }
      }, { title: 'Restore persisted measurements' });
      ctx.commands.register('measure.isActive', () => currentMode !== null, {
        title: 'Check measurement mode',
      });
      ctx.commands.register('measure.getMode', () => currentMode, {
        title: 'Get current measurement mode',
      });
      ctx.commands.register('measure.cancelPending', () => clearPending(), {
        title: 'Cancel in-progress measurement',
      });
      ctx.commands.register('measure.setVisible', (args: unknown) => setVisibility(args), {
        title: 'Show or hide a measurement',
      });
      ctx.commands.register('measure.toggleAxisLock', () => toggleAxisLock(), {
        title: 'Toggle axis lock',
        defaultShortcut: 'Shift+A',
      });
      ctx.commands
        .execute('shortcuts.bind', { combo: 'Shift+A', command: 'measure.toggleAxisLock' })
        .catch(() => undefined);
      ctx.commands.register('measure.getConfig', () => ({ ...config }), {
        title: 'Get measurement config',
      });
      ctx.commands.register('measure.setConfig', (args: unknown) => {
        if (args && typeof args === 'object') applyConfig(args as Partial<MeasurementConfig>);
      }, {
        title: 'Update measurement config',
      });
    },

    uninstall() {
      deactivate();
      clear();
      magnifier?.dispose();
      magnifier = null;
      hideAxisLockLabel();
      stopCss2dLoop();
      releaseCss2dOverlay();
      overlay = null;
      DOT_GEO.dispose();
      DOT_MAT.dispose();
      LINE_MAT.dispose();
      ARC_MAT.dispose();
      ctxRef = null;
    },
  };

  return api;
}
