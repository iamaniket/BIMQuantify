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

import { LAYER_OVERLAY } from '../../core/layers.js';
import type { Plugin, ViewerContext } from '../../core/types.js';
import { pick } from '../../core/Raycaster.js';
import type { SnappingPluginAPI } from '../snapping/index.js';
import {
  acquireCss2dOverlay,
  releaseCss2dOverlay,
  CSS2DObject,
} from '../shared/css2d-overlay.js';
import type { Css2dOverlay } from '../shared/css2d-overlay.js';

const NAME = 'measurement' as const;

export type MeasurementMode = 'distance' | 'angle';

export interface Measurement {
  id: string;
  type: MeasurementMode;
  value: number;
  unit: string;
  points: Array<{ x: number; y: number; z: number }>;
  visible: boolean;
}

export interface MeasurementConfig {
  directColor: number;
  xColor: number;
  yColor: number;
  zColor: number;
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
  let css2dRafId: number | null = null;
  let currentMode: MeasurementMode | null = null;
  let pendingPoints: THREE.Vector3[] = [];
  let pendingDots: THREE.Mesh[] = [];
  let pendingLines: THREE.Line[] = [];
  let clickUnsub: (() => void) | null = null;
  let moveUnsub: (() => void) | null = null;
  let exiting = false;

  // Rubber-band preview state
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

  // ----- CSS2D render loop -----

  const needsCss2dLoop = (): boolean =>
    completed.size > 0 || currentMode !== null;

  const startCss2dLoop = (): void => {
    if (css2dRafId !== null || !overlay) return;
    const tick = (): void => {
      overlay?.render();
      css2dRafId = requestAnimationFrame(tick);
    };
    css2dRafId = requestAnimationFrame(tick);
  };

  const stopCss2dLoop = (): void => {
    if (css2dRafId !== null) {
      cancelAnimationFrame(css2dRafId);
      css2dRafId = null;
    }
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
    if (snap) return new THREE.Vector3(snap.point.x, snap.point.y, snap.point.z);
    return pickOrGround(ctxRef, ndc);
  };

  const processPreviewMove = async (
    ndc: { x: number; y: number },
  ): Promise<void> => {
    if (!ctxRef || currentMode === null || pendingPoints.length === 0) return;
    const pt = await resolvePreviewPoint(ndc);
    if (!pt) return;

    updateRubberLine(pt);

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
    }
  };

  const handlePreviewMove = async (
    e: { ndc: { x: number; y: number } },
  ): Promise<void> => {
    if (currentMode === null || pendingPoints.length === 0) return;
    if (previewInFlight) { previewPendingNdc = e.ndc; return; }
    previewInFlight = true;
    let ndc: { x: number; y: number } | null = e.ndc;
    while (ndc) {
      previewPendingNdc = null;
      await processPreviewMove(ndc);
      ndc = previewPendingNdc;
    }
    previewInFlight = false;
  };

  // ---- end rubber-band preview ----

  const clearPending = (): void => {
    clearRubberBand();
    for (const dot of pendingDots) dot.removeFromParent();
    for (const line of pendingLines) {
      line.geometry.dispose();
      line.removeFromParent();
    }
    pendingDots = [];
    pendingLines = [];
    pendingPoints = [];
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

  const handleClick = async (payload: {
    ndc: { x: number; y: number };
    button: number;
  }): Promise<void> => {
    if (!ctxRef || currentMode === null) return;

    // Right-click cancels pending
    if (payload.button === 2) {
      clearPending();
      return;
    }
    if (payload.button !== 0) return;

    const pt = await pickOrGround(ctxRef, payload.ndc);
    if (!pt) return;

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
    const needed = currentMode === 'distance' ? 2 : 3;
    if (pendingPoints.length < needed) {
      const anchor = currentMode === 'angle' && pendingPoints.length === 2
        ? pendingPoints[1]!   // angle phase 2: rubber-band from vertex
        : pt;
      createRubberLine(anchor);
    }

    if (pendingPoints.length >= needed) {
      if (currentMode === 'distance') {
        finishDistance(pendingPoints[0]!, pendingPoints[1]!);
      } else {
        finishAngle(pendingPoints[0]!, pendingPoints[1]!, pendingPoints[2]!);
      }
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

  const modeLabel = (mode: MeasurementMode): string =>
    mode === 'distance' ? 'Measurement — Distance' : 'Measurement — Angle';

  const activate = async (args: unknown): Promise<void> => {
    if (!ctxRef) return;
    const mode = typeof args === 'string'
      ? args
      : (args as { mode?: string })?.mode;
    if (mode !== 'distance' && mode !== 'angle') return;

    if (currentMode !== null) deactivate();
    currentMode = mode;
    clearPending();

    ctxRef.commands.execute('snapping.enable').catch(() => undefined);

    clickUnsub = ctxRef.events.on('pointer:click', (e) => void handleClick(e));
    moveUnsub = ctxRef.events.on('pointer:move', (e) => void handlePreviewMove(e));

    startCss2dLoop();

    await ctxRef.commands.execute('mode.enter', {
      name: `measurement.${mode}`,
      label: modeLabel(mode),
      cancel: () => false,
      onExit: () => {
        clearPending();
        clickUnsub?.();
        clickUnsub = null;
        moveUnsub?.();
        moveUnsub = null;
        currentMode = null;
        ctxRef?.commands.execute('snapping.disable').catch(() => undefined);
        if (!needsCss2dLoop()) stopCss2dLoop();
      },
    }).catch(() => undefined);
  };

  const deactivate = (): void => {
    if (!ctxRef || exiting) return;
    exiting = true;
    clearPending();
    clickUnsub?.();
    clickUnsub = null;
    moveUnsub?.();
    moveUnsub = null;
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

    // Re-render existing measurement labels (rebuild groups)
    if (partial.labelScale !== undefined || partial.dotScale !== undefined || partial.precision !== undefined || colorChanged || partial.showDecomposition !== undefined) {
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
        }
      }
    }

    emitChange();
  };

  const api: Plugin & MeasurementPluginAPI = {
    name: NAME,
    dependencies: ['mode'],

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
