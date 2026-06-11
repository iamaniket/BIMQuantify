'use client';

import {
  type MouseEvent,
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslations } from 'next-intl';

import type { ViewerHandle } from '@bimstitch/viewer';

import type { ModelMetadata, SpatialNode } from '@/lib/api/viewerTypes';

import {
  makeCalibration,
  planToViewer,
  viewerToPlan,
  type Calibration,
  type ViewerVec3,
  type WorldBox,
} from './planCoords';
import { useFloorPlans, type RawLevel } from './useFloorPlans';

type Props = {
  handle: ViewerHandle | null;
  viewerReady: boolean;
  floorPlansUrl: string | null;
  metadata: ModelMetadata | undefined;
};

type DisplayLevel = RawLevel & {
  name: string;
  roomNames: (string | null)[];
};

type CameraPose = { position: ViewerVec3; target: ViewerVec3 };

type PlanTransform = { scale: number; offsetX: number; offsetY: number; minX: number; minY: number };

const SIZE = 168; // canvas css px (square)
const PAD = 10;

function collectSpatialNames(
  node: SpatialNode | null,
  storeys: Map<number, string>,
  spaces: Map<number, string>,
): void {
  if (!node) return;
  if (node.type === 'IfcBuildingStorey' && node.name) storeys.set(node.expressID, node.name);
  if (node.type === 'IfcSpace' && node.name) spaces.set(node.expressID, node.name);
  for (const child of node.children) collectSpatialNames(child, storeys, spaces);
}

/** Resolve a Tailwind text-color utility to a concrete rgb() for canvas use. */
function resolveColor(className: string): string {
  if (typeof document === 'undefined') return '#888';
  const probe = document.createElement('span');
  probe.className = className;
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.style.pointerEvents = 'none';
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color || '#888';
}

export function Minimap({ handle, viewerReady, floorPlansUrl, metadata }: Props): ReactElement | null {
  const t = useTranslations('viewer.minimap');
  const { data: fp } = useFloorPlans(floorPlansUrl);
  const rawLevels = fp?.levels;

  // Join storey/room names from the model metadata; order top → bottom.
  const levels = useMemo<DisplayLevel[]>(() => {
    if (!rawLevels || rawLevels.length === 0) return [];
    const storeyNames = new Map<number, string>();
    const spaceNames = new Map<number, string>();
    collectSpatialNames(metadata?.spatialTree ?? null, storeyNames, spaceNames);
    const out = rawLevels.map((lv, i): DisplayLevel => ({
      ...lv,
      name: storeyNames.get(lv.storeyExpressID) ?? t('levelFallback', { n: i + 1 }),
      roomNames: lv.rooms.map((r) => spaceNames.get(r.spaceId) ?? null),
    }));
    out.sort((a, b) => b.elevation - a.elevation);
    return out;
  }, [rawLevels, metadata, t]);

  const [selected, setSelected] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const level = levels[Math.min(selected, Math.max(0, levels.length - 1))] ?? null;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const transformRef = useRef<PlanTransform | null>(null);
  const poseRef = useRef<CameraPose | null>(null);
  const rafRef = useRef<number | null>(null);
  const colorsRef = useRef<{ wall: string; room: string; label: string; accent: string } | null>(null);
  const calibrationRef = useRef<Calibration | null>(null);

  // Draw the camera "you are here" marker over the cached plan.
  const composite = useCallback(() => {
    rafRef.current = null;
    const canvas = canvasRef.current;
    const offscreen = offscreenRef.current;
    const xf = transformRef.current;
    const colors = colorsRef.current;
    if (!canvas || !offscreen || !xf || !colors) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(offscreen, 0, 0, SIZE, SIZE);

    const pose = poseRef.current;
    const cal = calibrationRef.current;
    if (!pose || !cal) return;
    const planToCanvas = (px: number, py: number): [number, number] => [
      xf.offsetX + (px - xf.minX) * xf.scale,
      SIZE - xf.offsetY - (py - xf.minY) * xf.scale,
    ];
    const here = viewerToPlan(pose.position, cal);
    const look = viewerToPlan(pose.target, cal);
    let [cx, cy] = planToCanvas(here.x, here.y);
    cx = Math.max(6, Math.min(SIZE - 6, cx));
    cy = Math.max(6, Math.min(SIZE - 6, cy));
    // Heading: direction from camera to target, in canvas space (Y flipped).
    const hx = look.x - here.x;
    const hy = -(look.y - here.y);
    const angle = Math.atan2(hy, hx);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    // View-cone triangle pointing in the look direction.
    ctx.beginPath();
    ctx.moveTo(11, 0);
    ctx.lineTo(-4, -6);
    ctx.lineTo(-4, 6);
    ctx.closePath();
    ctx.fillStyle = colors.accent;
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fillStyle = colors.accent;
    ctx.globalAlpha = 1;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }, []);

  const scheduleComposite = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = window.requestAnimationFrame(composite);
  }, [composite]);

  // Render the selected level's plan into the offscreen cache, then composite.
  useEffect(() => {
    if (collapsed || !level) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;

    if (!offscreenRef.current) offscreenRef.current = document.createElement('canvas');
    const offscreen = offscreenRef.current;
    offscreen.width = SIZE * dpr;
    offscreen.height = SIZE * dpr;
    const octx = offscreen.getContext('2d');
    if (!octx) return;

    if (!colorsRef.current) {
      colorsRef.current = {
        wall: resolveColor('text-foreground'),
        room: resolveColor('text-foreground-tertiary'),
        label: resolveColor('text-foreground-secondary'),
        accent: resolveColor('text-primary'),
      };
    }
    const colors = colorsRef.current;

    const { minX, minY, maxX, maxY } = level.bbox;
    const w = Math.max(maxX - minX, 1e-3);
    const h = Math.max(maxY - minY, 1e-3);
    const scale = Math.min((SIZE - 2 * PAD) / w, (SIZE - 2 * PAD) / h);
    const offsetX = (SIZE - w * scale) / 2;
    const offsetY = (SIZE - h * scale) / 2;
    transformRef.current = { scale, offsetX, offsetY, minX, minY };
    const toCanvas = (px: number, py: number): [number, number] => [
      offsetX + (px - minX) * scale,
      SIZE - offsetY - (py - minY) * scale,
    ];

    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, SIZE, SIZE);

    // Rooms first (subtle), so wall lines sit on top.
    octx.strokeStyle = colors.room;
    octx.globalAlpha = 0.5;
    octx.lineWidth = 0.75;
    for (const room of level.rooms) {
      const s = room.segments;
      octx.beginPath();
      for (let i = 0; i + 3 < s.length; i += 4) {
        octx.moveTo(...toCanvas(s[i]!, s[i + 1]!));
        octx.lineTo(...toCanvas(s[i + 2]!, s[i + 3]!));
      }
      octx.stroke();
    }
    octx.globalAlpha = 1;

    // Walls.
    octx.strokeStyle = colors.wall;
    octx.lineWidth = 1;
    octx.lineCap = 'round';
    octx.beginPath();
    const walls = level.wallSegments;
    for (let i = 0; i + 3 < walls.length; i += 4) {
      octx.moveTo(...toCanvas(walls[i]!, walls[i + 1]!));
      octx.lineTo(...toCanvas(walls[i + 2]!, walls[i + 3]!));
    }
    octx.stroke();

    // Room labels at centroids (skip when the room is too small to read).
    octx.fillStyle = colors.label;
    octx.font = '8px ui-sans-serif, system-ui, sans-serif';
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    level.rooms.forEach((room, i) => {
      const name = level.roomNames[i];
      if (!name) return;
      const [lx, ly] = toCanvas(room.centroid[0], room.centroid[1]);
      octx.fillText(name.length > 14 ? `${name.slice(0, 13)}…` : name, lx, ly);
    });

    scheduleComposite();
  }, [level, collapsed, scheduleComposite]);

  // Track the live camera pose; seed it once so the marker shows immediately.
  useEffect(() => {
    if (!handle || !viewerReady) return undefined;
    handle.commands
      .execute<CameraPose>('camera.getPose')
      .then((pose) => {
        poseRef.current = pose;
        scheduleComposite();
      })
      .catch(() => undefined);
    const off = handle.events.on('camera:change', (pose) => {
      poseRef.current = pose;
      scheduleComposite();
    });
    return off;
  }, [handle, viewerReady, scheduleComposite]);

  // Calibrate the IFC↔viewer transform from the model's IFC bbox (metadata) and
  // its world AABB (camera.getSceneBox) — cancels the on-load recentering.
  useEffect(() => {
    const ifcBbox = metadata?.bbox;
    if (!handle || !viewerReady || !ifcBbox || !fp) return undefined;
    let cancelled = false;
    handle.commands
      .execute<WorldBox | null>('camera.getSceneBox')
      .then((box) => {
        if (cancelled || !box) return;
        calibrationRef.current = makeCalibration(ifcBbox, box, fp.planAxisX, fp.planAxisY);
        scheduleComposite();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [handle, viewerReady, metadata, fp, scheduleComposite]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const handleCanvasClick = useCallback(
    (e: MouseEvent<HTMLCanvasElement>) => {
      const xf = transformRef.current;
      const cal = calibrationRef.current;
      if (!xf || !level || !handle || !cal) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const planX = xf.minX + (cx - xf.offsetX) / xf.scale;
      const planY = xf.minY + (SIZE - cy - xf.offsetY) / xf.scale;
      const target = planToViewer(planX, planY, level.elevation, cal);
      handle.commands
        .execute('camera.flyToPoint', { x: target.x, y: target.y, z: target.z, animate: true })
        .catch(() => undefined);
    },
    [handle, level],
  );

  if (!level) return null;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        aria-label={t('expand')}
        className="absolute bottom-3 right-3 z-30 flex h-10 w-10 items-center justify-center rounded-md border border-border bg-surface-low/95 text-foreground-secondary shadow-md backdrop-blur-sm hover:text-foreground"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 3v18M3 9h18" />
        </svg>
      </button>
    );
  }

  return (
    <div className="absolute bottom-3 right-3 z-30 overflow-hidden rounded-md border border-border bg-surface-low/95 shadow-md backdrop-blur-sm">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1">
        <span className="text-caption font-semibold uppercase tracking-wide text-foreground-tertiary">
          {t('title')}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {levels.length > 1 ? (
            <select
              aria-label={t('level')}
              value={selected}
              onChange={(e) => setSelected(Number(e.target.value))}
              className="max-w-[96px] truncate rounded border border-border bg-background px-1 py-0.5 text-caption text-foreground"
            >
              {levels.map((lv, i) => (
                <option key={lv.storeyExpressID} value={i}>
                  {lv.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="max-w-[96px] truncate text-caption text-foreground-secondary">{level.name}</span>
          )}
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            aria-label={t('collapse')}
            className="flex h-5 w-5 items-center justify-center rounded text-foreground-tertiary hover:text-foreground"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M5 12h14" />
            </svg>
          </button>
        </div>
      </div>
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        title={t('clickToNavigate')}
        style={{ width: SIZE, height: SIZE }}
        className="block cursor-pointer touch-manipulation"
      />
    </div>
  );
}
