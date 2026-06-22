/**
 * 2D camera plugin — attaches `camera-controls` to the shared ortho camera
 * from `DocumentContext`. Handles mouse-button → action mapping,
 * zoom-at-cursor, fit commands, and tool-mode integration (pan/zoom tools).
 *
 * Rotation is locked (this is a 2D plan viewer). Pan = truck,
 * zoom = camera.zoom on the orthographic camera.
 *
 * This is the sole navigation controller — no separate pan/zoom plugins.
 * The same camera-controls library drives both 2D and 3D viewers, so the
 * mouse-button settings from the settings dialog apply uniformly.
 */

import * as THREE from 'three';
import CameraControls from 'camera-controls';

import type {
  DocumentContext,
  DocumentPlugin,
  DocumentTool,
} from '../../../pdf-core/documentTypes.js';
import type { SceneAPI } from '../scene/index.js';

const NAME = 'camera' as const;

let ccInstalled = false;
function ensureCameraControlsInstalled(): void {
  if (ccInstalled) return;
  CameraControls.install({ THREE });
  ccInstalled = true;
}

const ACTION = CameraControls.ACTION;
const FIT_PADDING = 0.05;

export type CameraAction2D = 'truck' | 'zoom' | 'none';

export interface CameraControlsConfig {
  left?: CameraAction2D;
  middle?: CameraAction2D;
  right?: CameraAction2D;
  wheel?: CameraAction2D;
}

export interface CameraPluginOptions {
  controls?: CameraControlsConfig;
}

export interface CameraPluginAPI {
  readonly controls: CameraControls;
  setButtonConfig(config: CameraControlsConfig): void;
  fitToPage(pageW: number, pageH: number, animate?: boolean): void;
  fitToWidth(pageW: number, pageH: number, animate?: boolean): void;
}

function actionFor(a: CameraAction2D | undefined): typeof ACTION.TRUCK {
  switch (a) {
    case 'truck':
      return ACTION.TRUCK as typeof ACTION.TRUCK;
    case 'zoom':
      return ACTION.ZOOM as typeof ACTION.TRUCK;
    case 'none':
    default:
      return ACTION.NONE as typeof ACTION.TRUCK;
  }
}

export function cameraPlugin(
  options: CameraPluginOptions = {},
): DocumentPlugin & CameraPluginAPI {
  let ctx: DocumentContext | null = null;
  let sceneApi: SceneAPI | null = null;
  let controls: CameraControls | null = null;
  let rafId = 0;
  let lastTime = 0;

  /** The user-configured left-button action (from settings). */
  let configuredLeft: CameraAction2D = 'none';

  // Tracks the page height used in the last fitPage/fitWidth call so the
  // resize observer can correct the frustum aspect ratio without re-fitting.
  let fittedOnce = false;
  let currentPageH = 842;

  const cleanups: Array<() => void> = [];

  function applyConfig(cc: CameraControls, cfg: CameraControlsConfig): void {
    configuredLeft = cfg.left ?? 'none';
    cc.mouseButtons.left = actionFor(configuredLeft) as typeof cc.mouseButtons.left;
    cc.mouseButtons.middle = actionFor(cfg.middle ?? 'truck') as typeof cc.mouseButtons.middle;
    cc.mouseButtons.right = actionFor(cfg.right ?? 'truck') as typeof cc.mouseButtons.right;
    cc.mouseButtons.wheel = actionFor(cfg.wheel ?? 'zoom') as typeof cc.mouseButtons.wheel;
  }

  /**
   * Sync camera-controls' left button with the active tool.
   *
   * - Pan tool  → force TRUCK so left-drag pans, regardless of settings.
   * - Zoom tool → force NONE (zoom-tool clicks are handled separately).
   * - Select    → restore the user's configured left-button action.
   */
  function syncLeftButtonForTool(cc: CameraControls, tool: DocumentTool): void {
    switch (tool) {
      case 'pan':
        cc.mouseButtons.left = ACTION.TRUCK as typeof cc.mouseButtons.left;
        break;
      case 'zoom':
        cc.mouseButtons.left = ACTION.NONE as typeof cc.mouseButtons.left;
        break;
      default:
        cc.mouseButtons.left = actionFor(configuredLeft) as typeof cc.mouseButtons.left;
        break;
    }
  }

  function tick(now: number): void {
    if (!controls) return;
    const delta = lastTime ? (now - lastTime) / 1000 : 0.016;
    lastTime = now;
    const updated = controls.update(delta);
    if (updated) {
      sceneApi?.requestRender();
      ctx?.events.emit('camera:change', undefined);
    }
    rafId = requestAnimationFrame(tick);
  }

  function fitToRect(
    cc: CameraControls,
    camera: THREE.OrthographicCamera,
    containerW: number,
    containerH: number,
    pageW: number,
    pageH: number,
    mode: 'page' | 'width',
    animate: boolean,
  ): void {
    const aspect = containerW / containerH;
    const pageAspect = pageW / pageH;

    // Ensure the frustum matches the actual page dimensions so the zoom
    // target is correct even if this runs before onPageRendered.
    const halfH = pageH / 2;
    const halfW = halfH * aspect;
    camera.left = -halfW;
    camera.right = halfW;
    camera.top = halfH;
    camera.bottom = -halfH;
    camera.updateProjectionMatrix();

    let visibleH: number;

    if (mode === 'width' || pageAspect > aspect) {
      const visibleW = pageW * (1 + FIT_PADDING * 2);
      visibleH = visibleW / aspect;
    } else {
      visibleH = pageH * (1 + FIT_PADDING * 2);
    }

    const centerX = pageW / 2;
    const centerY = pageH / 2;
    const frustumH = camera.top - camera.bottom;
    const targetZoom = frustumH / visibleH;

    void cc.setLookAt(centerX, centerY, 10, centerX, centerY, 0, animate);
    void cc.zoomTo(targetZoom, animate);
    if (!animate) {
      cc.update(10);
    }
  }

  const api: DocumentPlugin & CameraPluginAPI = {
    name: NAME,

    get controls(): CameraControls {
      if (!controls) throw new Error('camera plugin not installed');
      return controls;
    },

    setButtonConfig(config: CameraControlsConfig): void {
      if (!controls) return;
      applyConfig(controls, config);
      // Re-apply tool override after a config change.
      if (ctx) syncLeftButtonForTool(controls, ctx.getTool());
    },

    fitToPage(pageW: number, pageH: number, animate = true): void {
      if (!controls || !ctx || !sceneApi) return;
      const w = ctx.container.clientWidth;
      const h = ctx.container.clientHeight;
      if (w === 0 || h === 0) return;
      fitToRect(controls, sceneApi.camera, w, h, pageW, pageH, 'page', animate);
    },

    fitToWidth(pageW: number, pageH: number, animate = true): void {
      if (!controls || !ctx || !sceneApi) return;
      const w = ctx.container.clientWidth;
      const h = ctx.container.clientHeight;
      if (w === 0 || h === 0) return;
      fitToRect(controls, sceneApi.camera, w, h, pageW, pageH, 'width', animate);
    },

    dependencies: ['scene'],

    install(context: DocumentContext): void {
      ctx = context;
      sceneApi = context.plugins.get<SceneAPI>('scene')!;
      ensureCameraControlsInstalled();

      const cc = new CameraControls(sceneApi.camera, context.container);

      // Lock rotation — this is a 2D plan viewer.
      cc.azimuthRotateSpeed = 0;
      cc.polarRotateSpeed = 0;
      cc.minPolarAngle = Math.PI / 2;
      cc.maxPolarAngle = Math.PI / 2;
      cc.minAzimuthAngle = 0;
      cc.maxAzimuthAngle = 0;

      cc.dollyToCursor = true;
      cc.dollySpeed = 1;
      cc.infinityDolly = false;

      cc.minZoom = 0.05;
      cc.maxZoom = 100;

      cc.smoothTime = 0.1;
      cc.draggingSmoothTime = 0.1;

      const cfg = options.controls ?? {};
      applyConfig(cc, {
        left: cfg.left ?? 'none',
        middle: cfg.middle ?? 'truck',
        right: cfg.right ?? 'truck',
        wheel: cfg.wheel ?? 'zoom',
      });

      cc.touches.one = ACTION.TOUCH_TRUCK;
      cc.touches.two = ACTION.TOUCH_ZOOM_TRUCK as typeof cc.touches.two;
      cc.touches.three = ACTION.TOUCH_TRUCK;

      controls = cc;
      lastTime = 0;

      // ── Aspect-ratio correction on container resize ────────────────
      // The scene plugin's ResizeObserver updates the canvas pixel size but
      // not the ortho frustum. When the container resizes after the first fit
      // (e.g. split→2D mode) this observer corrects the frustum aspect ratio
      // while preserving the current zoom and camera position.
      const roAspect = new ResizeObserver(() => {
        if (!fittedOnce || !sceneApi) return;
        const { clientWidth: w, clientHeight: h } = context.container;
        if (w === 0 || h === 0) return;
        const cam = sceneApi.camera;
        const halfH = currentPageH / 2;
        const halfW = halfH * (w / h);
        cam.left = -halfW;
        cam.right = halfW;
        cam.top = halfH;
        cam.bottom = -halfH;
        cam.updateProjectionMatrix();
        controls?.update(0);
        sceneApi.requestRender();
      });
      roAspect.observe(context.container);
      cleanups.push(() => roAspect.disconnect());

      // ── Tool-mode integration ──────────────────────────────────────
      // Override left button based on the active tool, and handle
      // zoom-tool click gestures.

      syncLeftButtonForTool(cc, context.getTool());
      cleanups.push(context.events.on('tool:change', ({ tool }) => {
        syncLeftButtonForTool(cc, tool);
      }));

      // Zoom-tool: left-click zooms in at cursor, Alt+left zooms out.
      const onZoomToolClick = (ev: MouseEvent): void => {
        if (!controls || context.getTool() !== 'zoom' || ev.button !== 0) return;
        const factor = ev.altKey ? 1 / 1.3 : 1.3;
        void controls.zoom(controls.camera.zoom * (factor - 1), true);
      };
      context.container.addEventListener('click', onZoomToolClick);
      cleanups.push(() => context.container.removeEventListener('click', onZoomToolClick));

      // ── Context menu suppression ───────────────────────────────────

      const onContextMenu = (e: Event): void => {
        if (cc.mouseButtons.right !== ACTION.NONE) e.preventDefault();
      };
      context.container.addEventListener('contextmenu', onContextMenu);
      cleanups.push(() => context.container.removeEventListener('contextmenu', onContextMenu));

      // ── Render loop ────────────────────────────────────────────────

      rafId = requestAnimationFrame(tick);

      // ── Commands ───────────────────────────────────────────────────

      context.commands.register('camera.fitPage', (args?: unknown) => {
        const a = args as { pageW?: number; pageH?: number; animate?: boolean } | undefined;
        const uv = context.getUnscaledViewport();
        const pw = a?.pageW ?? uv?.width ?? 595;
        const ph = a?.pageH ?? uv?.height ?? 842;
        currentPageH = ph;
        fittedOnce = true;
        api.fitToPage(pw, ph, a?.animate ?? true);
      }, { title: 'Fit page', defaultShortcut: '0' });

      context.commands.register('camera.fitWidth', (args?: unknown) => {
        const a = args as { pageW?: number; pageH?: number; animate?: boolean } | undefined;
        const uv = context.getUnscaledViewport();
        const pw = a?.pageW ?? uv?.width ?? 595;
        const ph = a?.pageH ?? uv?.height ?? 842;
        currentPageH = ph;
        fittedOnce = true;
        api.fitToWidth(pw, ph, a?.animate ?? true);
      }, { title: 'Fit width', defaultShortcut: 'W' });

      context.commands.register('camera.zoomIn', () => {
        if (!controls) return;
        void controls.zoom(controls.camera.zoom * 0.3, true);
      }, { title: 'Zoom in', defaultShortcut: '+' });

      context.commands.register('camera.zoomOut', () => {
        if (!controls) return;
        void controls.zoom(-controls.camera.zoom * 0.25, true);
      }, { title: 'Zoom out', defaultShortcut: '-' });

      context.commands.register('camera.actualSize', () => {
        if (!controls) return;
        void controls.zoomTo(1, true);
      }, { title: 'Actual size', defaultShortcut: '1' });

      context.commands.register<{ zoom: number }>('camera.zoomTo', (a) => {
        if (!controls || !a || a.zoom <= 0) return;
        void controls.zoomTo(a.zoom, true);
      }, { title: 'Zoom to level' });

      context.commands.register<CameraControlsConfig>('camera.setControls', (cfg) => {
        api.setButtonConfig(cfg);
      }, { title: 'Set camera controls' });

      // Restore a saved 2D viewpoint: jump to the page, then pan + zoom the
      // camera to the stored framing. `center_x`/`center_y` are normalised
      // (0..1, top-left origin) and `zoom` is the camera-controls zoom — the
      // same quantities `markup.getViewState` captures.
      context.commands.register<{
        page?: number;
        center_x: number;
        center_y: number;
        zoom: number;
      }>('camera.restore2DView', (a) => {
        if (!controls || !ctx) return;
        const place = (): void => {
          const uv = ctx!.getUnscaledViewport();
          if (!controls || !uv || uv.width <= 0 || uv.height <= 0) return;
          const worldX = a.center_x * uv.width;
          const worldY = (1 - a.center_y) * uv.height;
          void controls.setLookAt(worldX, worldY, 10, worldX, worldY, 0, true);
          if (a.zoom > 0) void controls.zoomTo(a.zoom, true);
        };
        // The viewport (page size + frustum) only settles once the target page
        // has rendered, so defer positioning until then on a page change.
        if (typeof a.page === 'number' && a.page !== ctx.getCurrentPage()) {
          const off = ctx.events.on('page:rendered', () => { off(); place(); });
          ctx.setCurrentPage(a.page);
        } else {
          place();
        }
      }, { title: 'Restore 2D viewpoint (page + center + zoom)' });
    },

    uninstall(): void {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      for (const c of cleanups.splice(0)) c();
      if (controls) {
        controls.dispose();
        controls = null;
      }
      lastTime = 0;
      fittedOnce = false;
      currentPageH = 842;
      sceneApi = null;
      ctx = null;
    },
  };

  return api;
}
