/**
 * `markup-core` — the shared base for 2D PDF markup. The per-shape plugins
 * (rect/arrow/cloud/freehand/text) each register a {@link MarkupToolDefinition}
 * with this plugin; the core owns everything common:
 *
 *   • a transparent three.js WebGL overlay inside `ctx.overlayHost` (page-aligned,
 *     ortho camera in CSS px) — same approach as the measure plugin;
 *   • draft + committed state, stored in ARTIFACT space (PDF pts) and reprojected
 *     to CSS on every `page:rendered`, so markup stays locked through zoom/rotate;
 *   • pointer routing to the active tool's interaction while drawing;
 *   • click hit-testing of committed markup (→ `markup:select`);
 *   • the `markup.*` command surface and `markup:*` events;
 *   • snapshot compositing (`markup.captureSnapshot`).
 *
 * Persistence uses NORMALIZED coords (0..1, top-left) — see `core/normalize.ts`.
 */

import * as THREE from 'three';

import type {
  DocumentContext,
  DocumentPlugin,
  DocumentTool,
} from '../../../../pdf-core/documentTypes.js';
import {
  artifactToCss,
  cssToArtifact,
  type PdfTransformParams,
} from '../../measure/transform.js';
import type { Pt } from '../../measure/math.js';
import type { PageGeometryLike } from '../../measure/geometryTypes.js';
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
import { normCentroid, pointsToArtifact, pointsToNorm } from './normalize.js';
import { hitTestCommitted, type HitShape } from './hitTest.js';
import { compositeSnapshot } from './snapshot.js';

export const MARKUP_CORE_NAME = 'markup-core' as const;

const DEFAULT_STYLE: MarkupStyle = { color: '#ef4444', strokeWidth: 2 };

interface LiveShape {
  tool: MarkupTool;
  pts: Pt[]; // artifact space
  text?: string;
}

export function markupCorePlugin(): DocumentPlugin & MarkupCoreAPI {
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

  // ---- state ----
  const tools = new Map<MarkupTool, MarkupToolDefinition>();
  let pageGeometry: PageGeometryLike | null = null;
  let style: MarkupStyle = { ...DEFAULT_STYLE };
  let activeTool: MarkupTool | null = null;
  let activeInteraction: MarkupInteraction | null = null;
  let live: LiveShape | null = null; // in-progress drawing
  let draft: LiveShape | null = null; // completed-but-unsaved
  let committed: CommittedMarkupItem[] = [];
  let hitShapes: HitShape[] = [];
  let savedTool: DocumentTool | null = null;

  // ----------------------------------------------------------------- transforms

  function boxDims(): { w: number; h: number; rot: number } | null {
    if (pageGeometry) return { w: pageGeometry.w, h: pageGeometry.h, rot: pageGeometry.rot ?? 0 };
    if (!ctx) return null;
    const uv = ctx.getUnscaledViewport();
    if (!uv) return null;
    const rot = ctx.getRotation();
    // getUnscaledViewport() is post-rotation; un-transpose to the unrotated box.
    if (rot === 90 || rot === 270) return { w: uv.height, h: uv.width, rot: 0 };
    return { w: uv.width, h: uv.height, rot: 0 };
  }

  function params(): PdfTransformParams | null {
    if (!ctx) return null;
    const dims = ctx.getPageDimensions();
    const box = boxDims();
    if (!dims || !box) return null;
    const rotation = (((ctx.getRotation() + box.rot) % 360) + 360) % 360;
    return { w: box.w, h: box.h, pageW: dims.width, pageH: dims.height, rotation };
  }

  function toCss(p: Pt, t: PdfTransformParams): Pt {
    return artifactToCss(p[0], p[1], t);
  }

  function pageCssSize(): { w: number; h: number } {
    const dims = ctx?.getPageDimensions();
    return { w: dims?.width ?? 0, h: dims?.height ?? 0 };
  }

  function render(): void {
    if (renderer && scene && camera) renderer.render(scene, camera);
  }

  // ------------------------------------------------------------------ geometry

  function disposeGroup(group: THREE.Group | null): void {
    if (!group) return;
    for (const child of [...group.children]) {
      child.traverse((obj) => {
        const o = obj as THREE.Mesh & THREE.Line;
        o.geometry?.dispose?.();
        const mat = (o as unknown as { material?: THREE.Material | THREE.Material[] }).material;
        if (mat) {
          const mats = Array.isArray(mat) ? mat : [mat];
          for (const m of mats) {
            (m as THREE.Material & { map?: THREE.Texture | null }).map?.dispose?.();
            m.dispose();
          }
        }
      });
    }
    group.clear();
  }

  function buildInto(
    group: THREE.Group,
    tool: MarkupTool,
    artifactPts: Pt[],
    text: string | undefined,
    st: MarkupStyle,
    t: PdfTransformParams,
  ): void {
    const def = tools.get(tool);
    if (!def) return;
    const css = artifactPts.map((p) => toCss(p, t));
    const opts: MarkupBuildOpts = { pageCss: pageCssSize(), ...(text !== undefined ? { text } : {}) };
    for (const obj of def.build(css, st, opts)) group.add(obj);
  }

  // -------------------------------------------------------------- redraw paths

  function rebuildCommitted(): void {
    if (!committedGroup || !ctx) return;
    disposeGroup(committedGroup);
    hitShapes = [];
    const t = params();
    if (t) {
      const page = ctx.getCurrentPage();
      const box = boxDims();
      for (const item of committed) {
        if (item.page !== page) continue;
        for (const ann of item.annotations) {
          const artifact = box ? pointsToArtifact(ann.points, box.w, box.h) : [];
          buildInto(committedGroup, ann.tool, artifact, ann.text, { color: ann.color, strokeWidth: ann.strokeWidth }, t);
          hitShapes.push({
            topicId: item.topicId,
            tool: ann.tool,
            css: artifact.map((p) => toCss(p, t)),
            ...(ann.text !== undefined ? { text: ann.text } : {}),
          });
        }
      }
    }
    rebuildPreview();
  }

  function rebuildPreview(): void {
    if (!previewGroup) return;
    disposeGroup(previewGroup);
    const t = params();
    if (t) {
      if (draft) buildInto(previewGroup, draft.tool, draft.pts, draft.text, style, t);
      if (live && live.pts.length > 0) buildInto(previewGroup, live.tool, live.pts, live.text, style, t);
    }
    render();
  }

  // ------------------------------------------------------------- tool context

  function cursorToArtifact(e: PointerEvent | MouseEvent): Pt {
    const t = params();
    if (!t || !pluginRoot) return [0, 0];
    const rect = pluginRoot.getBoundingClientRect();
    return cssToArtifact(e.clientX - rect.left, e.clientY - rect.top, t);
  }

  function artifactToCssPt(p: Pt): Pt {
    const t = params();
    return t ? toCss(p, t) : [0, 0];
  }

  function makeToolContext(): MarkupToolContext {
    return {
      cursorToArtifact,
      artifactToCss: artifactToCssPt,
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
      requestRender: render,
      labelHost: labelHost!,
      root: pluginRoot!,
      page: () => ctx?.getCurrentPage() ?? 1,
    };
  }

  // ------------------------------------------------------------- draft lifecycle

  function buildDraftPayload(d: LiveShape): MarkupDraft | null {
    const box = boxDims();
    if (!box) return null;
    const points = pointsToNorm(d.pts, box.w, box.h);
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
    if (!pluginRoot) return;
    pluginRoot.style.pointerEvents = on ? 'auto' : 'none';
    pluginRoot.style.cursor = on ? 'crosshair' : 'default';
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

  function onPointerDown(e: PointerEvent): void {
    activeInteraction?.onPointerDown?.(e);
  }
  function onPointerMove(e: PointerEvent): void {
    activeInteraction?.onPointerMove?.(e);
  }
  function onPointerUp(e: PointerEvent): void {
    activeInteraction?.onPointerUp?.(e);
  }
  function onDoubleClick(e: MouseEvent): void {
    activeInteraction?.onDoubleClick?.(e);
  }
  function onKeyDown(e: KeyboardEvent): void {
    if (e.key !== 'Escape' || activeTool === null) return;
    if (live !== null) cancelLive();
    else deactivate();
  }

  // Capture-phase click on the container: select committed markup without
  // swallowing pans (misses fall through to camera/other handlers).
  function onContainerClick(e: MouseEvent): void {
    if (activeTool !== null || !ctx || !pluginRoot || hitShapes.length === 0) return;
    const rect = pluginRoot.getBoundingClientRect();
    const topicId = hitTestCommitted(
      e.clientX - rect.left,
      e.clientY - rect.top,
      hitShapes,
      pageCssSize().h,
    );
    if (topicId !== null) {
      e.stopPropagation();
      ctx.events.emit('markup:select', { topicId });
    }
  }

  // -------------------------------------------------------------- view state

  function getViewState(): { page: number; center_x: number; center_y: number; zoom: number } {
    return {
      page: ctx?.getCurrentPage() ?? 1,
      center_x: 0.5,
      center_y: 0.5,
      zoom: ctx?.getScale() ?? 1,
    };
  }

  function captureSnapshot(maxWidth = 480): string | null {
    if (!ctx || !renderer) return null;
    render(); // ensure the markup buffer is current before reading it
    const dims = ctx.getPageDimensions();
    if (!dims) return null;
    return compositeSnapshot(ctx.canvas, renderer.domElement, dims, maxWidth);
  }

  // ------------------------------------------------------------------- resize

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

  // ------------------------------------------------------------------- plugin

  const api: DocumentPlugin & MarkupCoreAPI = {
    name: MARKUP_CORE_NAME,

    registerTool(def: MarkupToolDefinition): void {
      tools.set(def.tool, def);
    },
    isActive: () => activeTool !== null,
    mode: () => activeTool,

    install(context: DocumentContext): void {
      ctx = context;

      pluginRoot = document.createElement('div');
      pluginRoot.dataset['bqMarkup'] = '';
      pluginRoot.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
      canvasHost = document.createElement('div');
      canvasHost.style.cssText = 'position:absolute;inset:0;';
      labelHost = document.createElement('div');
      labelHost.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
      pluginRoot.append(canvasHost, labelHost);
      context.overlayHost.appendChild(pluginRoot);

      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
      renderer.setClearColor(0x000000, 0);
      renderer.domElement.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
      canvasHost.appendChild(renderer.domElement);

      scene = new THREE.Scene();
      camera = new THREE.OrthographicCamera(0, 1, 0, 1, -1, 1);
      committedGroup = new THREE.Group();
      previewGroup = new THREE.Group();
      scene.add(committedGroup, previewGroup);

      const root = pluginRoot;
      root.addEventListener('pointerdown', onPointerDown);
      root.addEventListener('pointermove', onPointerMove);
      root.addEventListener('pointerup', onPointerUp);
      root.addEventListener('dblclick', onDoubleClick);
      window.addEventListener('keydown', onKeyDown);
      context.container.addEventListener('click', onContainerClick, true);
      cleanups.push(() => {
        root.removeEventListener('pointerdown', onPointerDown);
        root.removeEventListener('pointermove', onPointerMove);
        root.removeEventListener('pointerup', onPointerUp);
        root.removeEventListener('dblclick', onDoubleClick);
        window.removeEventListener('keydown', onKeyDown);
        context.container.removeEventListener('click', onContainerClick, true);
      });

      cleanups.push(context.events.on('page:rendered', () => {
        resize();
        rebuildCommitted();
      }));
      cleanups.push(context.events.on('page:change', () => {
        if (activeTool !== null) cancelLive();
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

      resize();
      render();
    },

    uninstall(): void {
      for (const c of cleanups.splice(0)) c();
      deactivate();
      committed = [];
      hitShapes = [];
      disposeGroup(committedGroup);
      disposeGroup(previewGroup);
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
      tools.clear();
      ctx = null;
    },
  };

  return api;
}
