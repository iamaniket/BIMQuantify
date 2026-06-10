/**
 * `markup-core` — the shared base for 2D PDF markup. The per-shape plugins
 * (rect/arrow/cloud/freehand/text) each register a {@link MarkupToolDefinition}
 * with this plugin; the core owns everything common:
 *
 *   • a `markup` layer (THREE.Group) in the SHARED world-space scene, so markup
 *     pans/zooms via the camera with no per-plugin renderer or CSS reproject;
 *   • draft + committed state, stored NORMALIZED (0..1, top-left — the
 *     persistence space) and projected to world coords (PDF pts, Y-up) on build;
 *   • pointer routing to the active tool's interaction while drawing, mapping
 *     screen → world via the shared camera;
 *   • click hit-testing of committed markup by raycasting (→ `markup:select`);
 *   • the `markup.*` command surface and `markup:*` events;
 *   • snapshot compositing (`markup.captureSnapshot`).
 */

import * as THREE from 'three';

import type {
  DocumentContext,
  DocumentPlugin,
  DocumentTool,
} from '../../../../pdf-core/documentTypes.js';
import type { Pt } from '../../measure/math.js';
import type { PageGeometryLike } from '../../measure/geometryTypes.js';
import type { SceneAPI } from '../../scene/index.js';
import {
  normPointsToWorld,
  worldParams,
  worldPointsToNorm,
  type WorldParams,
} from '../../shared/worldTransform.js';
import { clearGroup, containerPointToWorld } from '../../shared/screenConstant.js';
import type {
  CommittedMarkupItem,
  MarkupDraft,
  MarkupStyle,
  MarkupTool,
} from '../types.js';
import type {
  MarkupBuildOpts,
  MarkupCoreAPI,
  MarkupInteraction,
  MarkupToolContext,
  MarkupToolDefinition,
} from './api.js';
import { normCentroid } from './normalize.js';
import { compositeSnapshot, type ViewportCrop } from './snapshot.js';

export const MARKUP_CORE_NAME = 'markup-core' as const;

const LAYER = 'markup' as const;
/** Layer render order — above measure (10), below entity markers (30). */
const RENDER_ORDER = 20;
const DEFAULT_STYLE: MarkupStyle = { color: '#ef4444', strokeWidth: 2 };

interface LiveShape {
  tool: MarkupTool;
  pts: Pt[]; // world space (PDF pts, Y-up)
  text?: string;
}

export function markupCorePlugin(): DocumentPlugin & MarkupCoreAPI {
  let ctx: DocumentContext | null = null;
  let sceneApi: SceneAPI | null = null;
  const cleanups: Array<() => void> = [];

  // ---- shared-scene layer ----
  let layerGroup: THREE.Group | null = null;
  let committedGroup: THREE.Group | null = null;
  let previewGroup: THREE.Group | null = null;
  let labelHost: HTMLDivElement | null = null;
  const raycaster = new THREE.Raycaster();

  // ---- state ----
  const tools = new Map<MarkupTool, MarkupToolDefinition>();
  let pageGeometry: PageGeometryLike | null = null;
  let style: MarkupStyle = { ...DEFAULT_STYLE };
  let activeTool: MarkupTool | null = null;
  let activeInteraction: MarkupInteraction | null = null;
  let live: LiveShape | null = null; // in-progress drawing
  let draft: LiveShape | null = null; // completed-but-unsaved
  let committed: CommittedMarkupItem[] = [];
  let savedTool: DocumentTool | null = null;

  // ----------------------------------------------------------------- transforms

  function wparams(): WorldParams | null {
    if (!ctx) return null;
    if (pageGeometry) {
      return worldParams(ctx, { w: pageGeometry.w, h: pageGeometry.h, rot: pageGeometry.rot ?? 0 });
    }
    return worldParams(ctx, null);
  }

  function pageWorldSize(): { w: number; h: number } {
    const uv = ctx?.getUnscaledViewport();
    return { w: uv?.width ?? 0, h: uv?.height ?? 0 };
  }

  function cursorToWorld(e: PointerEvent | MouseEvent): Pt {
    if (!ctx || !sceneApi) return [0, 0];
    const w = containerPointToWorld(e, ctx, sceneApi);
    return [w.x, w.y];
  }

  function worldToScreenPt(p: Pt): Pt {
    if (!sceneApi) return [0, 0];
    const s = sceneApi.worldToScreen(p[0], p[1]);
    return [s.x, s.y];
  }

  // ------------------------------------------------------------------ geometry

  function buildInto(
    group: THREE.Group,
    tool: MarkupTool,
    worldPts: Pt[],
    text: string | undefined,
    st: MarkupStyle,
    topicId?: string,
  ): void {
    const def = tools.get(tool);
    if (!def) return;
    const opts: MarkupBuildOpts = { pageWorld: pageWorldSize(), ...(text !== undefined ? { text } : {}) };
    for (const obj of def.build(worldPts, st, opts)) {
      obj.traverse((o) => {
        o.renderOrder += RENDER_ORDER;
        if (topicId !== undefined) o.userData['topicId'] = topicId;
      });
      group.add(obj);
    }
  }

  function rebuildCommitted(): void {
    if (!committedGroup || !ctx) return;
    clearGroup(committedGroup);
    const p = wparams();
    if (p) {
      const page = ctx.getCurrentPage();
      for (const item of committed) {
        if (item.page !== page) continue;
        for (const ann of item.annotations) {
          const worldPts = normPointsToWorld(ann.points, p);
          buildInto(committedGroup, ann.tool, worldPts, ann.text, { color: ann.color, strokeWidth: ann.strokeWidth }, item.topicId);
        }
      }
    }
    rebuildPreview();
  }

  function rebuildPreview(): void {
    if (!previewGroup) return;
    clearGroup(previewGroup);
    const p = wparams();
    if (p) {
      if (draft) buildInto(previewGroup, draft.tool, draft.pts, draft.text, style);
      if (live && live.pts.length > 0) buildInto(previewGroup, live.tool, live.pts, live.text, style);
    }
    sceneApi?.requestRender();
  }

  // ------------------------------------------------------------- tool context

  function makeToolContext(): MarkupToolContext {
    return {
      cursorToWorld,
      worldToScreen: worldToScreenPt,
      getStyle: () => ({ ...style }),
      preview: (points, text) => {
        if (activeTool === null) return;
        live = { tool: activeTool, pts: points, ...(text !== undefined ? { text } : {}) };
        rebuildPreview();
      },
      clearPreview: () => {
        live = null;
        rebuildPreview();
      },
      submit: (points, text) => {
        completeDraft(points, text);
      },
      cancel: () => {
        cancelLive();
      },
      requestRender: () => sceneApi?.requestRender(),
      labelHost: labelHost!,
      root: ctx!.container,
      page: () => ctx?.getCurrentPage() ?? 1,
    };
  }

  // ------------------------------------------------------------- draft lifecycle

  function buildDraftPayload(d: LiveShape): MarkupDraft | null {
    const p = wparams();
    if (!p) return null;
    const points = worldPointsToNorm(d.pts, p);
    const anchor = normCentroid(points);
    return {
      tool: d.tool,
      page: ctx?.getCurrentPage() ?? 1,
      points,
      ...(d.text !== undefined ? { text: d.text } : {}),
      color: style.color,
      strokeWidth: style.strokeWidth,
      anchor,
    };
  }

  function completeDraft(points: Pt[], text?: string): void {
    if (activeTool === null || !ctx) return;
    draft = { tool: activeTool, pts: points, ...(text !== undefined ? { text } : {}) };
    const payload = buildDraftPayload(draft);
    live = null;
    deactivate(); // tool self-deactivates; draft stays visible
    rebuildPreview();
    if (payload) ctx.events.emit('markup:draftComplete', payload);
    emitChange();
  }

  function cancelLive(): void {
    live = null;
    // Reset the interaction so its internal state (first point, etc.) clears.
    if (activeTool !== null) {
      const def = tools.get(activeTool);
      activeInteraction?.dispose?.();
      activeInteraction = def ? def.createInteraction(makeToolContext()) : null;
    }
    rebuildPreview();
  }

  function clearDraft(): void {
    draft = null;
    rebuildPreview();
    emitChange();
  }

  function emitChange(): void {
    ctx?.events.emit('markup:change', { committedCount: committed.length, hasDraft: draft !== null });
  }

  // ------------------------------------------------------------------ control

  function setRootInteractive(on: boolean): void {
    if (!ctx) return;
    ctx.container.style.cursor = on ? 'crosshair' : '';
  }

  function activate(tool: MarkupTool): void {
    if (!ctx) return;
    const def = tools.get(tool);
    if (!def) return;
    if (activeTool === null) savedTool = ctx.getTool();
    activeInteraction?.dispose?.();
    activeTool = tool;
    live = null;
    ctx.setTool('select'); // neutralize the camera's left-drag while drawing
    activeInteraction = def.createInteraction(makeToolContext());
    setRootInteractive(true);
    rebuildPreview();
  }

  function deactivate(): void {
    if (activeTool === null) return;
    activeInteraction?.dispose?.();
    activeInteraction = null;
    activeTool = null;
    live = null;
    setRootInteractive(false);
    if (ctx && savedTool) ctx.setTool(savedTool);
    savedTool = null;
    rebuildPreview();
  }

  // ----------------------------------------------------------- pointer + click

  // Capture-phase pointer routing: while a tool is active we consume the events
  // (stopPropagation) so camera-controls never pans during a draw. With no tool
  // active we ignore them entirely, so navigation works normally.
  function onPointerDown(e: PointerEvent): void {
    if (activeTool === null) return;
    e.stopPropagation();
    activeInteraction?.onPointerDown?.(e);
  }
  function onPointerMove(e: PointerEvent): void {
    if (activeTool === null) return;
    activeInteraction?.onPointerMove?.(e);
  }
  function onPointerUp(e: PointerEvent): void {
    if (activeTool === null) return;
    activeInteraction?.onPointerUp?.(e);
  }
  function onDoubleClick(e: MouseEvent): void {
    if (activeTool === null) return;
    activeInteraction?.onDoubleClick?.(e);
  }
  function onKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || activeTool === null) return;
    if (live !== null) cancelLive();
    else deactivate();
  }

  function resolveTopicId(obj: THREE.Object3D | null): string | null {
    let o: THREE.Object3D | null = obj;
    while (o) {
      const id = o.userData['topicId'];
      if (typeof id === 'string') return id;
      o = o.parent;
    }
    return null;
  }

  function raycastCommitted(clientX: number, clientY: number): string | null {
    if (!ctx || !sceneApi || !committedGroup) return null;
    const rect = ctx.container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, sceneApi.camera);
    const lineParams = raycaster.params.Line;
    if (lineParams) lineParams.threshold = 6 * sceneApi.worldPerPx();
    const hits = raycaster.intersectObjects(committedGroup.children, true);
    for (const h of hits) {
      const id = resolveTopicId(h.object);
      if (id) return id;
    }
    return null;
  }

  // Capture-phase click selects committed markup without swallowing pans (misses
  // fall through to camera / other handlers).
  function onContainerClick(e: MouseEvent): void {
    if (activeTool !== null || !ctx || !committedGroup || committedGroup.children.length === 0) return;
    const topicId = raycastCommitted(e.clientX, e.clientY);
    if (topicId !== null) {
      e.stopPropagation();
      ctx.events.emit('markup:select', { topicId });
    }
  }

  // -------------------------------------------------------------- view state

  function getSceneCamera(): THREE.OrthographicCamera | null {
    return sceneApi?.camera ?? null;
  }

  function getViewState(): { page: number; center_x: number; center_y: number; zoom: number } {
    if (!ctx) return { page: 1, center_x: 0.5, center_y: 0.5, zoom: 1 };
    const cam = getSceneCamera();
    const uv = ctx.getUnscaledViewport();
    let centerX = 0.5;
    let centerY = 0.5;
    if (cam && uv && uv.width > 0 && uv.height > 0) {
      centerX = Math.max(0, Math.min(1, cam.position.x / uv.width));
      centerY = Math.max(0, Math.min(1, 1 - cam.position.y / uv.height));
    }
    return {
      page: ctx.getCurrentPage(),
      center_x: centerX,
      center_y: centerY,
      // Camera-controls zoom (the value that defines on-screen framing), not the
      // engine render scale — so center + zoom round-trip on restore.
      zoom: cam?.zoom ?? 1,
    };
  }

  function computeViewportCrop(): ViewportCrop | undefined {
    if (!ctx) return undefined;
    const cam = getSceneCamera();
    if (!cam) return undefined;
    const containerW = ctx.container.clientWidth;
    const containerH = ctx.container.clientHeight;
    if (containerW === 0 || containerH === 0) return undefined;
    const uv = ctx.getUnscaledViewport();
    if (!uv) return undefined;

    const zoom = cam.zoom;
    const frustumW = (cam.right - cam.left) / zoom;
    const frustumH = (cam.top - cam.bottom) / zoom;
    const cx = cam.position.x;
    const cy = cam.position.y;
    const visLeft = cx - frustumW / 2;
    const visTop = cy + frustumH / 2;

    const pxPerUnit = containerW / frustumW;
    const renderScale = ctx.getScale();

    const screenX = (0 - visLeft) * pxPerUnit;
    const screenY = (visTop - uv.height) * pxPerUnit;
    const cssScale = pxPerUnit / renderScale;

    return { containerW, containerH, screenX, screenY, cssScale };
  }

  function captureSnapshot(maxWidth = 480): string | null {
    if (!ctx || !sceneApi) return null;
    // The shared renderer draws every layer; a markup snapshot wants only the
    // page + markup, so hide the measure + entity-marker layers for the capture.
    const measureLayer = sceneApi.getLayer('measure');
    const markerLayer = sceneApi.getLayer('entity-markers');
    const mPrev = measureLayer?.visible ?? true;
    const kPrev = markerLayer?.visible ?? true;
    if (measureLayer) measureLayer.visible = false;
    if (markerLayer) markerLayer.visible = false;
    sceneApi.renderer.render(sceneApi.scene, sceneApi.camera);
    let out: string | null = null;
    const dims = ctx.getPageDimensions();
    if (dims) out = compositeSnapshot(ctx.canvas, sceneApi.renderer.domElement, dims, maxWidth, computeViewportCrop());
    if (measureLayer) measureLayer.visible = mPrev;
    if (markerLayer) markerLayer.visible = kPrev;
    sceneApi.requestRender();
    return out;
  }

  // ------------------------------------------------------------------- plugin

  const api: DocumentPlugin & MarkupCoreAPI = {
    name: MARKUP_CORE_NAME,
    dependencies: ['scene'],

    registerTool(def: MarkupToolDefinition): void {
      tools.set(def.tool, def);
    },
    isActive: () => activeTool !== null,
    mode: () => activeTool,

    install(context: DocumentContext): void {
      ctx = context;
      sceneApi = context.plugins.get<SceneAPI>('scene');
      if (!sceneApi) throw new Error('markup-core requires the scene plugin');

      layerGroup = sceneApi.addLayer(LAYER, RENDER_ORDER);
      committedGroup = new THREE.Group();
      previewGroup = new THREE.Group();
      layerGroup.add(committedGroup, previewGroup);

      // Transient DOM (the text input) lives in the viewport-pinned overlay, so
      // worldToScreen px line up regardless of the page's CSS transform.
      labelHost = document.createElement('div');
      labelHost.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
      context.viewportOverlay.appendChild(labelHost);

      const el = context.container;
      el.addEventListener('pointerdown', onPointerDown, true);
      el.addEventListener('pointermove', onPointerMove, true);
      el.addEventListener('pointerup', onPointerUp, true);
      el.addEventListener('dblclick', onDoubleClick, true);
      el.addEventListener('click', onContainerClick, true);
      window.addEventListener('keydown', onKeyDown);
      cleanups.push(() => {
        el.removeEventListener('pointerdown', onPointerDown, true);
        el.removeEventListener('pointermove', onPointerMove, true);
        el.removeEventListener('pointerup', onPointerUp, true);
        el.removeEventListener('dblclick', onDoubleClick, true);
        el.removeEventListener('click', onContainerClick, true);
        window.removeEventListener('keydown', onKeyDown);
      });

      cleanups.push(context.events.on('page:rendered', () => {
        rebuildCommitted();
      }));
      cleanups.push(context.events.on('page:change', () => {
        if (activeTool !== null) cancelLive();
        // The draft's world points belong to the page it was drawn on; drop it
        // rather than rendering it at stale coordinates on the new page.
        draft = null;
        rebuildCommitted();
      }));

      // --- commands ---
      context.commands.register<{ mode: MarkupTool }>('markup.activate', (a) => { activate(a.mode); }, {
        title: 'Start a markup tool',
      });
      context.commands.register('markup.deactivate', () => { deactivate(); }, { title: 'Stop the markup tool' });
      context.commands.register<{ color?: string; strokeWidth?: number }>('markup.setStyle', (a) => {
        if (a.color !== undefined) style.color = a.color;
        if (a.strokeWidth !== undefined) style.strokeWidth = a.strokeWidth;
        rebuildPreview();
      }, { title: 'Set markup colour / width' });
      context.commands.register('markup.getStyle', () => ({ ...style }), { title: 'Current markup style' });
      context.commands.register('markup.clearDraft', () => { clearDraft(); }, { title: 'Discard the unsaved markup' });
      context.commands.register('markup.getDraft', () => (draft ? buildDraftPayload(draft) : null), {
        title: 'Get the unsaved markup draft',
      });
      context.commands.register('markup.getViewState', () => getViewState(), { title: 'Current 2D view state' });
      context.commands.register<{ items: CommittedMarkupItem[] }>('markup.setCommitted', (a) => {
        committed = a.items ?? [];
        rebuildCommitted();
        emitChange();
      }, { title: 'Set committed markup' });
      context.commands.register('markup.clearCommitted', () => {
        committed = [];
        rebuildCommitted();
        emitChange();
      }, { title: 'Clear committed markup' });
      context.commands.register<{ maxWidth?: number } | undefined>('markup.captureSnapshot', (a) =>
        captureSnapshot(a?.maxWidth), { title: 'Composite a PNG snapshot of the page + markup' });
      context.commands.register('markup.isActive', () => activeTool !== null, { title: 'Is a markup tool active' });
      context.commands.register('markup.getMode', () => activeTool, { title: 'Active markup tool' });
      context.commands.register<{ pageGeometry: PageGeometryLike | null }>('markup.setPageGeometry', (a) => {
        pageGeometry = a.pageGeometry ?? null;
        rebuildCommitted();
      }, { title: 'Provide the precise page box for normalization' });

      rebuildCommitted();
    },

    uninstall(): void {
      for (const c of cleanups.splice(0)) c();
      deactivate();
      committed = [];
      clearGroup(committedGroup);
      clearGroup(previewGroup);
      if (sceneApi) sceneApi.removeLayer(LAYER);
      if (labelHost?.parentNode) labelHost.parentNode.removeChild(labelHost);
      labelHost = null;
      layerGroup = null;
      committedGroup = null;
      previewGroup = null;
      tools.clear();
      sceneApi = null;
      ctx = null;
    },
  };

  return api;
}
