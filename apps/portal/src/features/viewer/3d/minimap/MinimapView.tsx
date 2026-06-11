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

import { useFloorPlans, type RawLevel } from './useFloorPlans';

/**
 * Minimap presentation. The model interaction (calibration, camera→plan
 * projection, click-navigation, storey isolation) lives in the `minimap`
 * viewer plugin; this component only fetches + decodes the floor-plan
 * artifact, draws it, and drives the plugin through `handle.commands`.
 *
 * Two variants share the drawing code:
 *   - `overlay` — the classic bottom-right locator (collapsible, fixed size).
 *   - `full`    — fills its pane for Split / 2D mode; selecting a level
 *                 isolates that storey in 3D (plugin handles the hide).
 */

type Variant = 'overlay' | 'full';

type Props = {
  handle: ViewerHandle | null;
  viewerReady: boolean;
  floorPlansUrl: string | null;
  metadata: ModelMetadata | undefined;
  variant?: Variant;
};

type DisplayLevel = RawLevel & {
  /** Display name, with a "Level N" fallback. */
  name: string;
  /** Real IfcBuildingStorey name used to isolate the storey, or null. */
  storeyName: string | null;
  roomNames: (string | null)[];
};

/** Camera pose already projected onto the plan (IFC plan X/Y) by the plugin. */
type PlanPose = { here: { x: number; y: number }; look: { x: number; y: number } };

type PlanTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
  minX: number;
  minY: number;
  w: number;
  h: number;
};

const OVERLAY_SIZE = 168; // css px (square)
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

/**
 * Map each storey express id → the express ids of every element on that storey.
 * Built from the extraction metadata: an element's `containedIn` is its direct
 * spatial container (often an IfcSpace), so we walk each storey's subtree to map
 * every descendant container back to the storey, then bucket elements by it.
 * Express id == fragments local id, so these feed `visibility.isolateItem`
 * directly. (The runtime classifier can't do this — the viewer loads only
 * geometry, not the IFC spatial relations.)
 */
function buildStoreyMembership(meta: ModelMetadata | undefined): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const elements = meta?.elements;
  const tree = meta?.spatialTree;
  if (!elements || !tree) return out;
  const storeyOfContainer = new Map<number, number>();
  const mark = (node: SpatialNode, storeyId: number): void => {
    storeyOfContainer.set(node.expressID, storeyId);
    for (const c of node.children) mark(c, storeyId);
  };
  const findStoreys = (node: SpatialNode | null): void => {
    if (!node) return;
    if (node.type === 'IfcBuildingStorey') {
      mark(node, node.expressID);
      return;
    }
    for (const c of node.children) findStoreys(c);
  };
  findStoreys(tree);
  for (const e of elements) {
    if (e.containedIn == null) continue;
    const sid = storeyOfContainer.get(e.containedIn);
    if (sid == null) continue;
    const arr = out.get(sid);
    if (arr) arr.push(e.expressID);
    else out.set(sid, [e.expressID]);
  }
  return out;
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

export function MinimapView({
  handle,
  viewerReady,
  floorPlansUrl,
  metadata,
  variant = 'overlay',
}: Props): ReactElement | null {
  const t = useTranslations('viewer.minimap');
  const { data: fp } = useFloorPlans(floorPlansUrl);
  const rawLevels = fp?.levels;
  const isFull = variant === 'full';

  // Join storey/room names from the model metadata; order top → bottom.
  const levels = useMemo<DisplayLevel[]>(() => {
    if (!rawLevels || rawLevels.length === 0) return [];
    const storeyNames = new Map<number, string>();
    const spaceNames = new Map<number, string>();
    collectSpatialNames(metadata?.spatialTree ?? null, storeyNames, spaceNames);
    const out = rawLevels.map((lv, i): DisplayLevel => {
      const storeyName = storeyNames.get(lv.storeyExpressID) ?? null;
      return {
        ...lv,
        name: storeyName ?? t('levelFallback', { n: i + 1 }),
        storeyName,
        roomNames: lv.rooms.map((r) => spaceNames.get(r.spaceId) ?? null),
      };
    });
    out.sort((a, b) => b.elevation - a.elevation);
    return out;
  }, [rawLevels, metadata, t]);

  const storeyMembership = useMemo(() => buildStoreyMembership(metadata), [metadata]);

  const [selected, setSelected] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  // Full variant isolates the selected storey by default (Split/2D behaviour).
  const [isolate, setIsolate] = useState(true);
  const level = levels[Math.min(selected, Math.max(0, levels.length - 1))] ?? null;

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const transformRef = useRef<PlanTransform | null>(null);
  const poseRef = useRef<PlanPose | null>(null);
  const rafRef = useRef<number | null>(null);
  const colorsRef = useRef<{ wall: string; room: string; label: string; accent: string } | null>(null);
  // Full variant resizes to its pane; overlay is fixed.
  const [dims, setDims] = useState({ w: OVERLAY_SIZE, h: OVERLAY_SIZE });

  // Track the pane size (full variant only).
  useEffect(() => {
    if (!isFull) {
      setDims({ w: OVERLAY_SIZE, h: OVERLAY_SIZE });
      return undefined;
    }
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r && r.width > 0 && r.height > 0) {
        setDims({ w: Math.round(r.width), h: Math.round(r.height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [isFull]);

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
    const { w, h } = xf;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(offscreen, 0, 0, w, h);

    const pose = poseRef.current;
    if (!pose) return;
    const planToCanvas = (px: number, py: number): [number, number] => [
      xf.offsetX + (px - xf.minX) * xf.scale,
      h - xf.offsetY - (py - xf.minY) * xf.scale,
    ];
    let [cx, cy] = planToCanvas(pose.here.x, pose.here.y);
    cx = Math.max(6, Math.min(w - 6, cx));
    cy = Math.max(6, Math.min(h - 6, cy));
    // Heading: direction from camera to target, in canvas space (Y flipped).
    const hx = pose.look.x - pose.here.x;
    const hy = -(pose.look.y - pose.here.y);
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
    const { w, h } = dims;
    const canvas = canvasRef.current;
    if (!canvas || w <= 0 || h <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    if (!offscreenRef.current) offscreenRef.current = document.createElement('canvas');
    const offscreen = offscreenRef.current;
    offscreen.width = w * dpr;
    offscreen.height = h * dpr;
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
    const planW = Math.max(maxX - minX, 1e-3);
    const planH = Math.max(maxY - minY, 1e-3);
    const scale = Math.min((w - 2 * PAD) / planW, (h - 2 * PAD) / planH);
    const offsetX = (w - planW * scale) / 2;
    const offsetY = (h - planH * scale) / 2;
    transformRef.current = { scale, offsetX, offsetY, minX, minY, w, h };
    const toCanvas = (px: number, py: number): [number, number] => [
      offsetX + (px - minX) * scale,
      h - offsetY - (py - minY) * scale,
    ];

    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.clearRect(0, 0, w, h);

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
    octx.lineWidth = isFull ? 1.25 : 1;
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
    octx.font = `${isFull ? 11 : 8}px ui-sans-serif, system-ui, sans-serif`;
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    level.rooms.forEach((room, i) => {
      const name = level.roomNames[i];
      if (!name) return;
      const [lx, ly] = toCanvas(room.centroid[0], room.centroid[1]);
      octx.fillText(name.length > 18 ? `${name.slice(0, 17)}…` : name, lx, ly);
    });

    // Paint synchronously — the offscreen is ready now. Scheduling here races
    // with the resize-driven re-render (a pending rAF would skip the redraw and
    // leave the canvas blank in the full variant, whose size changes on mount).
    composite();
  }, [level, collapsed, dims, isFull, composite]);

  // Calibrate the plugin's IFC↔viewer transform, then listen for the projected
  // camera pose it emits. All world-space math lives in the plugin.
  useEffect(() => {
    const ifcBbox = metadata?.bbox;
    if (!handle || !viewerReady || !ifcBbox || !fp) return undefined;
    handle.commands
      .execute('minimap.calibrate', {
        ifcBbox,
        planAxisX: fp.planAxisX,
        planAxisY: fp.planAxisY,
      })
      .catch(() => undefined);
    const off = handle.events.on('minimap:pose', (pose) => {
      poseRef.current = pose;
      scheduleComposite();
    });
    return off;
  }, [handle, viewerReady, metadata, fp, scheduleComposite]);

  // Full variant: isolate the selected storey in 3D (hide other levels). On
  // unmount (leaving Split/2D), restore the full model.
  useEffect(() => {
    if (!isFull || !handle || !viewerReady) return undefined;
    const localIds = level ? (storeyMembership.get(level.storeyExpressID) ?? []) : [];
    if (isolate && localIds.length > 0) {
      handle.commands
        .execute('minimap.isolateItems', { localIds, label: level?.name ?? null })
        .catch(() => undefined);
    } else {
      handle.commands.execute('minimap.showAllLevels').catch(() => undefined);
    }
    return () => {
      handle.commands.execute('minimap.showAllLevels').catch(() => undefined);
    };
  }, [isFull, handle, viewerReady, isolate, level, storeyMembership]);

  useEffect(
    () => () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const handleCanvasClick = useCallback(
    (e: MouseEvent<HTMLCanvasElement>) => {
      const xf = transformRef.current;
      if (!xf || !level || !handle) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const planX = xf.minX + (cx - xf.offsetX) / xf.scale;
      const planY = xf.minY + (xf.h - cy - xf.offsetY) / xf.scale;
      handle.commands
        .execute('minimap.navigateTo', { planX, planY, elevation: level.elevation })
        .catch(() => undefined);
    },
    [handle, level],
  );

  if (!level) return null;

  const levelPicker =
    levels.length > 1 ? (
      <select
        aria-label={t('level')}
        value={selected}
        onChange={(e) => setSelected(Number(e.target.value))}
        className="max-w-[120px] truncate rounded border border-border bg-background px-1 py-0.5 text-caption text-foreground"
      >
        {levels.map((lv, i) => (
          <option key={lv.storeyExpressID} value={i}>
            {lv.name}
          </option>
        ))}
      </select>
    ) : (
      <span className="max-w-[120px] truncate text-caption text-foreground-secondary">{level.name}</span>
    );

  if (isFull) {
    return (
      <div ref={wrapRef} className="relative h-full w-full overflow-hidden bg-surface-low">
        <div className="absolute left-2 top-2 z-10 flex items-center gap-1 rounded-md border border-border bg-surface-low/95 px-2 py-1 shadow-sm backdrop-blur-sm">
          <span className="text-caption font-semibold uppercase tracking-wide text-foreground-tertiary">
            {t('title')}
          </span>
          {levelPicker}
          <button
            type="button"
            onClick={() => setIsolate((v) => !v)}
            aria-pressed={isolate}
            title={isolate ? t('allLevels') : t('isolateLevel')}
            className={`flex h-5 items-center rounded px-1.5 text-caption ${
              isolate
                ? 'bg-primary/15 text-primary'
                : 'text-foreground-tertiary hover:text-foreground'
            }`}
          >
            {isolate ? t('isolateLevel') : t('allLevels')}
          </button>
        </div>
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          title={t('clickToNavigate')}
          className="absolute inset-0 block h-full w-full cursor-pointer touch-manipulation"
        />
      </div>
    );
  }

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
          {levelPicker}
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
        style={{ width: OVERLAY_SIZE, height: OVERLAY_SIZE }}
        className="block cursor-pointer touch-manipulation"
      />
    </div>
  );
}
