/**
 * Measurement plugin — distance (2 clicks) and angle (3 clicks).
 *
 * When active, pointer clicks place endpoints via raycasting. After
 * the required number of clicks a visual annotation appears.
 * All state lives in JS memory — no persistence.
 *
 * Labels use THREE.Sprite with a canvas-rendered texture so they
 * always face the camera and need zero extra renderers.
 */

import * as THREE from 'three';

import type { Plugin, ViewerContext } from '../../core/types.js';
import { pick } from '../../core/Raycaster.js';

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

export interface MeasurementPluginAPI {
  isActive(): boolean;
  mode(): MeasurementMode | null;
  measurements(): Measurement[];
}

let nextId = 0;

// ----- sprite text helper -----

function createTextSprite(text: string, modelScale: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  const ctx2d = canvas.getContext('2d')!;

  const fontSize = 48;
  const font = `bold ${String(fontSize)}px system-ui, sans-serif`;
  ctx2d.font = font;
  const metrics = ctx2d.measureText(text);
  const textW = Math.ceil(metrics.width);
  const padX = 24;
  const padY = 16;
  canvas.width = textW + padX * 2;
  canvas.height = fontSize + padY * 2;

  // Background pill
  ctx2d.fillStyle = 'rgba(0, 0, 0, 0.80)';
  const r = 12;
  roundRect(ctx2d, 0, 0, canvas.width, canvas.height, r);
  ctx2d.fill();

  // Text
  ctx2d.font = font;
  ctx2d.fillStyle = '#ffffff';
  ctx2d.textAlign = 'center';
  ctx2d.textBaseline = 'middle';
  ctx2d.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const mat = new THREE.SpriteMaterial({
    map: texture,
    depthTest: false,
    sizeAttenuation: true,
    transparent: true,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.renderOrder = 1000;

  // Scale the sprite so it has a readable world-space size relative
  // to the model. Aim for roughly 1/15th of the model extent.
  const baseScale = Math.max(modelScale / 15, 0.3);
  const aspect = canvas.width / canvas.height;
  sprite.scale.set(baseScale * aspect, baseScale, 1);

  return sprite;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ----- plugin -----

export function measurementPlugin(): Plugin & MeasurementPluginAPI {
  let ctxRef: ViewerContext | null = null;
  let currentMode: MeasurementMode | null = null;
  let pendingPoints: THREE.Vector3[] = [];
  let pendingDots: THREE.Mesh[] = [];
  let pendingLines: THREE.Line[] = [];
  let clickUnsub: (() => void) | null = null;
  let exiting = false;

  const completed = new Map<string, Measurement>();
  const sceneGroups = new Map<string, THREE.Group>();

  const DOT_GEO = new THREE.SphereGeometry(0.05, 12, 12);
  const DOT_MAT = new THREE.MeshBasicMaterial({ color: 0xff3333, depthTest: false });
  const LINE_MAT = new THREE.LineBasicMaterial({ color: 0xff3333, depthTest: false });
  const ARC_MAT = new THREE.LineBasicMaterial({ color: 0xff3333, depthTest: false });

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
    const scale = Math.max(getModelScale() / 200, 0.02);
    const dot = new THREE.Mesh(DOT_GEO, DOT_MAT);
    dot.position.copy(pos);
    dot.scale.setScalar(scale / 0.05);
    dot.renderOrder = 999;
    return dot;
  };

  const formatDistance = (d: number): string => {
    if (d < 0.01) return `${(d * 1000).toFixed(1)} mm`;
    if (d < 1) return `${(d * 1000).toFixed(0)} mm`;
    if (d < 100) return `${d.toFixed(3)} m`;
    return `${d.toFixed(1)} m`;
  };

  const formatAngle = (radians: number): string => {
    const deg = radians * (180 / Math.PI);
    return `${deg.toFixed(1)}°`;
  };

  const emitChange = (): void => {
    ctxRef?.events.emit('measurement:change', {
      measurements: [...completed.values()],
    });
  };

  const finishDistance = (p1: THREE.Vector3, p2: THREE.Vector3): void => {
    if (!ctxRef) return;
    const id = `measure-${String(++nextId)}`;
    const distance = p1.distanceTo(p2);

    const group = new THREE.Group();
    group.name = `measurement-${id}`;
    group.renderOrder = 999;

    group.add(createDot(p1));
    group.add(createDot(p2));

    const lineGeo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
    const line = new THREE.Line(lineGeo, LINE_MAT);
    line.renderOrder = 999;
    group.add(line);

    const mid = new THREE.Vector3().lerpVectors(p1, p2, 0.5);
    const label = createTextSprite(formatDistance(distance), getModelScale());
    label.position.copy(mid);
    const up = new THREE.Vector3(0, 1, 0);
    label.position.addScaledVector(up, label.scale.y * 0.6);
    group.add(label);

    ctxRef.scene.add(group);
    sceneGroups.set(id, group);

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

  const finishAngle = (p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3): void => {
    if (!ctxRef) return;
    const id = `measure-${String(++nextId)}`;

    // p2 is the vertex
    const armA = new THREE.Vector3().subVectors(p1, p2);
    const armB = new THREE.Vector3().subVectors(p3, p2);
    const lenA = armA.length();
    const lenB = armB.length();

    if (lenA < 1e-6 || lenB < 1e-6) return;

    const cosAngle = THREE.MathUtils.clamp(armA.dot(armB) / (lenA * lenB), -1, 1);
    const angle = Math.acos(cosAngle);

    const group = new THREE.Group();
    group.name = `measurement-${id}`;
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

    // Arc at vertex
    const arcRadius = Math.min(lenA, lenB) * 0.3;
    const arc = createArc(p2, armA, armB, angle, arcRadius);
    group.add(arc);

    // Label along bisector
    const bisector = new THREE.Vector3()
      .addVectors(armA.clone().normalize(), armB.clone().normalize())
      .normalize();
    const labelOffset = arcRadius * 1.6;
    const labelPos = p2.clone().addScaledVector(bisector, labelOffset);
    const label = createTextSprite(formatAngle(angle), getModelScale());
    label.position.copy(labelPos);
    group.add(label);

    ctxRef.scene.add(group);
    sceneGroups.set(id, group);

    const degrees = angle * (180 / Math.PI);
    completed.set(id, {
      id,
      type: 'angle',
      value: degrees,
      unit: 'deg',
      visible: true,
      points: [
        { x: p1.x, y: p1.y, z: p1.z },
        { x: p2.x, y: p2.y, z: p2.z },
        { x: p3.x, y: p3.y, z: p3.z },
      ],
    });

    emitChange();
    ctxRef.events.emit('measurement:complete', { id, type: 'angle', value: degrees });
  };

  const clearPending = (): void => {
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
    if (result) return new THREE.Vector3(result.point.x, result.point.y, result.point.z);

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
      ctxRef.scene.add(line);
      pendingLines.push(line);
    }

    const needed = currentMode === 'distance' ? 2 : 3;
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
      const mesh = child as THREE.Mesh;
      if (mesh.geometry && mesh.geometry !== DOT_GEO) mesh.geometry.dispose();
      if (mesh.material && mesh.material !== DOT_MAT && mesh.material !== LINE_MAT && mesh.material !== ARC_MAT) {
        const mat = mesh.material as THREE.SpriteMaterial;
        mat.map?.dispose();
        mat.dispose();
      }
    });
    group.removeFromParent();
    sceneGroups.delete(id);
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

    clickUnsub = ctxRef.events.on('pointer:click', (e) => void handleClick(e));

    await ctxRef.commands.execute('mode.enter', {
      name: `measurement.${mode}`,
      label: modeLabel(mode),
      cancel: () => false,
      onExit: () => {
        clearPending();
        clickUnsub?.();
        clickUnsub = null;
        currentMode = null;
      },
    }).catch(() => undefined);
  };

  const deactivate = (): void => {
    if (!ctxRef || exiting) return;
    exiting = true;
    clearPending();
    clickUnsub?.();
    clickUnsub = null;
    currentMode = null;
    ctxRef.commands.execute('mode.exit').catch(() => undefined);
    exiting = false;
  };

  const clear = (): void => {
    clearPending();
    for (const id of completed.keys()) {
      disposeGroup(id);
    }
    completed.clear();
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

  const api: Plugin & MeasurementPluginAPI = {
    name: NAME,
    dependencies: ['mode'],

    isActive() { return currentMode !== null; },
    mode() { return currentMode; },
    measurements() { return [...completed.values()]; },

    install(ctx: ViewerContext) {
      ctxRef = ctx;

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
    },

    uninstall() {
      deactivate();
      clear();
      DOT_GEO.dispose();
      DOT_MAT.dispose();
      LINE_MAT.dispose();
      ARC_MAT.dispose();
      ctxRef = null;
    },
  };

  return api;
}
