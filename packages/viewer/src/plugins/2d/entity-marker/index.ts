/**
 * `entity-marker-2d` — renders finding markers as real three.js glyphs in the
 * shared world-space scene (the 2D counterpart to the 3D `entity-marker`
 * plugin, which uses CSS2D DOM elements).
 *
 * Each marker is a small glyph (a status-colored disc inside a ring) authored
 * in px and placed in a per-marker group scaled by {@link SceneAPI.worldPerPx}
 * so it stays a **constant size on screen** at any zoom, positioned at the
 * anchor's world point. Clicks/hover are resolved by raycasting the shared
 * camera; a placement mode converts a click back to a normalized page point for
 * "drop a pin here" flows. Finding styling (fill + ring color, sizes) is the
 * shared source of truth in {@link findingMarkerStyle}, kept in lockstep with
 * the 3D plugin.
 *
 * Replaces the DOM `EntityPinLayer` / `AnnotationPinLayer` overlays.
 */

import * as THREE from 'three';

import type {
  DocumentContext,
  DocumentPlugin,
} from '../../../pdf-core/documentTypes.js';
import {
  MARKER_DIAMETER_PX,
  MARKER_RING_PX,
  DRAFT_RING_COLOR,
  DRAFT_HALO_SCALE,
  DRAFT_HALO_ALPHA,
  findingFillColor,
  findingRingColor,
} from '../../shared/findingMarkerStyle.js';
import type { SceneAPI } from '../scene/index.js';
import { normToWorld, worldToNorm, worldParams } from '../shared/worldTransform.js';

const NAME = 'entity-marker-2d' as const;
const LAYER = 'entity-markers' as const;
const RENDER_ORDER = 30;
const GLYPH_R = MARKER_DIAMETER_PX / 2; // px half-extent of the glyph (matches 3D)
const HOVER_SCALE = 1.3;
const CLICK_MOVE_TOL = 5; // px — pointer travel under this counts as a click, not a pan/drag

export type EntityMarker2DType = 'finding';

export interface EntityMarker2DData {
  id: string;
  type: EntityMarker2DType;
  /** Normalized 0..1, top-left origin, Y-down — relative to the unrotated page box. */
  x: number;
  y: number;
  label: string;
  entityId: string;
  /** Finding lifecycle status — drives the glyph color for findings. */
  status?: string;
  /**
   * Render as an unsaved draft preview (accent ring + translucent accent halo) —
   * the "update finding pin" flow shows the staged position before it is saved.
   */
  draft?: boolean;
}

export interface EntityMarker2DAPI {
  sync(markers: EntityMarker2DData[]): void;
  clear(): void;
  setVisible(visible: boolean): void;
  beginPlace(type: EntityMarker2DType): void;
  endPlace(): void;
}

interface MarkerEntry {
  data: EntityMarker2DData;
  group: THREE.Group;
}

/** 28-segment circle perimeter (px, centered on origin) at the given radius. */
function circlePerimeter(r: number = GLYPH_R): THREE.Vector2[] {
  const seg = 28;
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < seg; i += 1) {
    const t = (i / seg) * Math.PI * 2;
    pts.push(new THREE.Vector2(Math.cos(t) * r, Math.sin(t) * r));
  }
  return pts;
}

/** Filled mesh from a perimeter (px, centered on origin), tagged with `markerId`. */
function fillMesh(
  perimeter: THREE.Vector2[],
  color: THREE.ColorRepresentation,
  markerId: string,
  renderOrder: number,
  opacity = 1,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.ShapeGeometry(new THREE.Shape(perimeter)),
    new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity }),
  );
  mesh.renderOrder = renderOrder;
  mesh.frustumCulled = false;
  mesh.userData['markerId'] = markerId;
  return mesh;
}

/** Closed line loop tracing a perimeter, tagged with `markerId`. */
function outlineLoop(
  perimeter: THREE.Vector2[],
  color: THREE.ColorRepresentation,
  markerId: string,
  renderOrder: number,
): THREE.Line {
  const first = perimeter[0]!;
  const loop = perimeter.map((p) => new THREE.Vector3(p.x, p.y, 0));
  loop.push(new THREE.Vector3(first.x, first.y, 0));
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(loop),
    new THREE.LineBasicMaterial({ color, depthTest: false }),
  );
  line.renderOrder = renderOrder;
  line.frustumCulled = false;
  line.userData['markerId'] = markerId;
  return line;
}

/** Build the finding glyph objects for a marker, tagged with `markerId`. */
function buildGlyph(markerId: string, status?: string, draft?: boolean): THREE.Object3D[] {
  // Concentric discs: a status-colored fill inside a ring (red while open,
  // neutral once resolved), plus a white hairline for separation on busy
  // backgrounds. The ring is a filled disc rather than a thick line because
  // WebGL does not render line widths above 1px reliably across platforms.
  const outer = circlePerimeter(GLYPH_R);
  const inner = circlePerimeter(GLYPH_R - MARKER_RING_PX);
  // A draft uses the accent ring + a translucent accent halo behind the glyph so
  // a staged-but-unsaved pin reads clearly apart from every persisted finding.
  const ring = draft ? DRAFT_RING_COLOR : findingRingColor(status);
  const objs: THREE.Object3D[] = [];
  if (draft) {
    objs.push(
      fillMesh(circlePerimeter(GLYPH_R * DRAFT_HALO_SCALE), DRAFT_RING_COLOR, markerId, RENDER_ORDER - 1, DRAFT_HALO_ALPHA),
    );
  }
  objs.push(
    fillMesh(outer, ring, markerId, RENDER_ORDER),
    fillMesh(inner, findingFillColor(status), markerId, RENDER_ORDER + 1),
    outlineLoop(outer, 0xffffff, markerId, RENDER_ORDER + 2),
  );
  return objs;
}

export function entityMarker2DPlugin(): DocumentPlugin & EntityMarker2DAPI {
  let ctx: DocumentContext | null = null;
  let sceneApi: SceneAPI | null = null;
  let layer: THREE.Group | null = null;
  let tooltip: HTMLDivElement | null = null;
  const raycaster = new THREE.Raycaster();
  const markers = new Map<string, MarkerEntry>();
  const cleanups: Array<() => void> = [];

  let visible = true;
  let hoveredId: string | null = null;
  let placing: EntityMarker2DType | null = null;
  let downAt: { x: number; y: number } | null = null;

  function scaleFor(id: string): number {
    const base = sceneApi?.worldPerPx() ?? 1;
    return base * (id === hoveredId ? HOVER_SCALE : 1);
  }

  function rescale(entry: MarkerEntry): void {
    const s = scaleFor(entry.data.id);
    entry.group.scale.set(s, s, 1);
  }

  function reposition(entry: MarkerEntry): void {
    if (!ctx) return;
    const p = worldParams(ctx);
    if (!p) return;
    const [wx, wy] = normToWorld(entry.data.x, entry.data.y, p);
    entry.group.position.set(wx, wy, 0);
    rescale(entry);
  }

  function addMarker(data: EntityMarker2DData): void {
    if (!layer) return;
    const group = new THREE.Group();
    group.userData['markerId'] = data.id;
    for (const obj of buildGlyph(data.id, data.status, data.draft)) group.add(obj);
    layer.add(group);
    const entry: MarkerEntry = { data, group };
    markers.set(data.id, entry);
    reposition(entry);
  }

  function removeMarker(id: string): void {
    const entry = markers.get(id);
    if (!entry) return;
    entry.group.traverse((o) => {
      const m = o as THREE.Mesh & THREE.Line;
      m.geometry?.dispose?.();
      const mat = (o as unknown as { material?: THREE.Material | THREE.Material[] }).material;
      if (mat) (Array.isArray(mat) ? mat : [mat]).forEach((x) => x.dispose());
    });
    entry.group.removeFromParent();
    markers.delete(id);
    if (hoveredId === id) hoveredId = null;
  }

  function resolveMarkerId(obj: THREE.Object3D | null): string | null {
    let o: THREE.Object3D | null = obj;
    while (o) {
      const id = o.userData['markerId'];
      if (typeof id === 'string') return id;
      o = o.parent;
    }
    return null;
  }

  function pickAt(clientX: number, clientY: number): MarkerEntry | null {
    if (!ctx || !sceneApi || !layer || markers.size === 0) return null;
    const rect = ctx.container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, sceneApi.camera);
    const hits = raycaster.intersectObjects(layer.children, true);
    for (const h of hits) {
      const id = resolveMarkerId(h.object);
      if (id) return markers.get(id) ?? null;
    }
    return null;
  }

  function setTooltip(entry: MarkerEntry | null): void {
    if (!tooltip || !sceneApi) return;
    if (!entry) {
      tooltip.style.display = 'none';
      return;
    }
    const { x, y } = sceneApi.worldToScreen(entry.group.position.x, entry.group.position.y);
    tooltip.textContent = entry.data.label;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y - GLYPH_R - 8}px`;
    tooltip.style.display = 'block';
  }

  function setHovered(id: string | null): void {
    if (hoveredId === id) return;
    const prev = hoveredId ? markers.get(hoveredId) : null;
    hoveredId = id;
    if (prev) rescale(prev);
    const next = id ? markers.get(id) : null;
    if (next) rescale(next);
    setTooltip(next ?? null);
    if (ctx) ctx.container.style.cursor = placing ? 'crosshair' : id ? 'pointer' : '';
    sceneApi?.requestRender();
  }

  // ----------------------------------------------------------------- pointer

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    downAt = { x: e.clientX, y: e.clientY };
  }

  function onPointerMove(e: PointerEvent): void {
    if (markers.size === 0 && !placing) return;
    if (placing) return; // hover highlight is suppressed while placing
    const entry = pickAt(e.clientX, e.clientY);
    setHovered(entry?.data.id ?? null);
  }

  function onPointerUp(e: PointerEvent): void {
    if (e.button !== 0 || !downAt) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    downAt = null;
    if (moved > CLICK_MOVE_TOL) return; // a drag/pan, not a click

    if (placing && ctx && sceneApi) {
      const rect = ctx.container.getBoundingClientRect();
      const world = sceneApi.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
      const p = worldParams(ctx);
      if (p) {
        const [nx, ny] = worldToNorm(world.x, world.y, p);
        ctx.events.emit('entity-marker:place', { x: nx, y: ny, page: ctx.getCurrentPage() });
      }
      api.endPlace();
      return;
    }

    const entry = pickAt(e.clientX, e.clientY);
    if (entry && ctx) {
      ctx.events.emit('entity-marker:click', {
        id: entry.data.id,
        type: entry.data.type,
        entityId: entry.data.entityId,
      });
    }
  }

  // ------------------------------------------------------------------ plugin

  const api: DocumentPlugin & EntityMarker2DAPI = {
    name: NAME,
    dependencies: ['scene'],

    sync(next: EntityMarker2DData[]): void {
      const incoming = new Map(next.map((m) => [m.id, m]));
      for (const id of [...markers.keys()]) {
        if (!incoming.has(id)) removeMarker(id);
      }
      for (const m of next) {
        const existing = markers.get(m.id);
        if (!existing) {
          addMarker(m);
        } else if (
          existing.data.x !== m.x ||
          existing.data.y !== m.y ||
          existing.data.type !== m.type ||
          existing.data.status !== m.status ||
          existing.data.draft !== m.draft ||
          existing.data.label !== m.label ||
          existing.data.entityId !== m.entityId
        ) {
          removeMarker(m.id);
          addMarker(m);
        }
      }
      sceneApi?.requestRender();
    },

    clear(): void {
      for (const id of [...markers.keys()]) removeMarker(id);
      setTooltip(null);
      sceneApi?.requestRender();
    },

    setVisible(v: boolean): void {
      visible = v;
      if (layer) layer.visible = v;
      if (!v) setTooltip(null);
      sceneApi?.requestRender();
    },

    beginPlace(type: EntityMarker2DType): void {
      placing = type;
      setHovered(null);
      if (ctx) ctx.container.style.cursor = 'crosshair';
    },

    endPlace(): void {
      placing = null;
      if (ctx) ctx.container.style.cursor = '';
    },

    install(context: DocumentContext): void {
      ctx = context;
      sceneApi = context.plugins.get<SceneAPI>('scene');
      if (!sceneApi) throw new Error('entity-marker-2d requires the scene plugin');
      layer = sceneApi.addLayer(LAYER, RENDER_ORDER);
      layer.visible = visible;

      tooltip = document.createElement('div');
      tooltip.style.cssText =
        'position:absolute;display:none;transform:translate(-50%,-100%);' +
        'padding:2px 6px;border-radius:4px;white-space:nowrap;pointer-events:none;' +
        'max-width:200px;overflow:hidden;text-overflow:ellipsis;' +
        'font:500 11px ui-sans-serif,system-ui,-apple-system,sans-serif;' +
        'background:rgba(17,24,39,0.85);color:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.3);';
      context.viewportOverlay.appendChild(tooltip);

      const el = context.container;
      el.addEventListener('pointerdown', onPointerDown);
      el.addEventListener('pointermove', onPointerMove);
      el.addEventListener('pointerup', onPointerUp);
      cleanups.push(() => {
        el.removeEventListener('pointerdown', onPointerDown);
        el.removeEventListener('pointermove', onPointerMove);
        el.removeEventListener('pointerup', onPointerUp);
      });

      const reprojectAll = (): void => {
        for (const entry of markers.values()) reposition(entry);
        if (hoveredId) setTooltip(markers.get(hoveredId) ?? null);
        sceneApi?.requestRender();
      };
      const rescaleAll = (): void => {
        for (const entry of markers.values()) rescale(entry);
        if (hoveredId) setTooltip(markers.get(hoveredId) ?? null);
        sceneApi?.requestRender();
      };
      cleanups.push(context.events.on('page:rendered', reprojectAll));
      cleanups.push(context.events.on('rotation:change', reprojectAll));
      cleanups.push(context.events.on('camera:change', rescaleAll));

      context.commands.register<EntityMarker2DData[]>('entity-marker-2d.sync', (a) => api.sync(a ?? []), {
        title: 'Sync 2D entity markers',
      });
      context.commands.register('entity-marker-2d.clear', () => api.clear(), { title: 'Clear 2D entity markers' });
      context.commands.register<{ visible: boolean }>('entity-marker-2d.setVisible', (a) => api.setVisible(a.visible), {
        title: 'Toggle 2D entity marker visibility',
      });
      context.commands.register<{ type: EntityMarker2DType }>('entity-marker-2d.beginPlace', (a) => api.beginPlace(a.type), {
        title: 'Begin placing a marker',
      });
      context.commands.register('entity-marker-2d.endPlace', () => api.endPlace(), { title: 'Cancel marker placement' });
    },

    uninstall(): void {
      for (const c of cleanups.splice(0)) c();
      api.clear();
      if (sceneApi) sceneApi.removeLayer(LAYER);
      if (tooltip?.parentNode) tooltip.parentNode.removeChild(tooltip);
      if (ctx) ctx.container.style.cursor = '';
      tooltip = null;
      layer = null;
      sceneApi = null;
      ctx = null;
    },
  };

  return api;
}
