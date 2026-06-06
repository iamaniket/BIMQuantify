/**
 * PDF underlay plugin — positions the PDF canvas and text layer via CSS
 * transforms driven by the shared ortho camera on `DocumentContext`. Each
 * frame it reads the camera frustum and computes translate + scale, giving
 * instant smooth pan/zoom without re-rendering the PDF.
 *
 * A debounced re-render fires after the camera settles so the raster stays
 * sharp at the final zoom level.
 */

import type {
  DocumentContext,
  DocumentPlugin,
  DocumentRotation,
  PageDimensions,
} from '../../../pdf-core/documentTypes.js';
import type { SceneAPI } from '../scene/index.js';

const NAME = 'pdf-underlay' as const;
const SETTLE_MS = 300;

export interface PdfUnderlayAPI {
  effectiveScale(): number;
  rerender(): void;
}

interface RenderState {
  renderScale: number;
  pageW: number;
  pageH: number;
  canvasCssW: number;
  canvasCssH: number;
}

export function pdfUnderlayPlugin(): DocumentPlugin & PdfUnderlayAPI {
  let ctx: DocumentContext | null = null;
  let sceneApi: SceneAPI | null = null;
  let rafId = 0;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let renderState: RenderState | null = null;
  let lastCameraZoom = 1;
  const cleanups: Array<() => void> = [];

  function syncTransform(): void {
    if (!ctx || !renderState || !sceneApi) return;
    const camera = sceneApi.camera;
    const containerW = ctx.container.clientWidth;
    const containerH = ctx.container.clientHeight;
    if (containerW === 0 || containerH === 0) return;

    const zoom = camera.zoom;
    const frustumW = (camera.right - camera.left) / zoom;
    const frustumH = (camera.top - camera.bottom) / zoom;
    const cx = camera.position.x;
    const cy = camera.position.y;
    const visLeft = cx - frustumW / 2;
    const visTop = cy + frustumH / 2;

    const pxPerUnit = containerW / frustumW;
    const { pageH, renderScale } = renderState;

    const pageTopLeftWorldX = 0;
    const pageTopLeftWorldY = pageH;

    const screenX = (pageTopLeftWorldX - visLeft) * pxPerUnit;
    const screenY = (visTop - pageTopLeftWorldY) * pxPerUnit;

    const cssScale = pxPerUnit / renderScale;
    const transform = `translate(${screenX}px, ${screenY}px) scale(${cssScale})`;

    ctx.canvas.style.transform = transform;
    ctx.canvas.style.transformOrigin = '0 0';
    ctx.textLayer.style.transform = transform;
    ctx.textLayer.style.transformOrigin = '0 0';

    if (Math.abs(zoom - lastCameraZoom) > 0.001) {
      lastCameraZoom = zoom;
      scheduleRerender();
    }
  }

  function scheduleRerender(): void {
    if (settleTimer !== null) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      rerenderAtCurrentZoom();
    }, SETTLE_MS);
  }

  function rerenderAtCurrentZoom(): void {
    if (!ctx || !sceneApi) return;
    const camera = sceneApi.camera;
    const zoom = camera.zoom;
    const containerW = ctx.container.clientWidth;
    const frustumW = (camera.right - camera.left) / zoom;
    const pxPerUnit = containerW / frustumW;
    ctx.setScale(pxPerUnit);
  }

  let firstRender = true;

  function onPageRendered(ev: { dims: PageDimensions; scale: number; rotation: DocumentRotation }): void {
    if (!ctx) return;
    const uv = ctx.getUnscaledViewport();
    if (!uv) return;

    renderState = {
      renderScale: ev.scale,
      pageW: uv.width,
      pageH: uv.height,
      canvasCssW: ev.dims.width,
      canvasCssH: ev.dims.height,
    };

    // Update camera frustum to match the container aspect ratio.
    const camera = sceneApi!.camera;
    const containerW = ctx.container.clientWidth;
    const containerH = ctx.container.clientHeight;
    if (containerW > 0 && containerH > 0) {
      const aspect = containerW / containerH;
      const halfH = uv.height / 2;
      const halfW = halfH * aspect;
      camera.left = -halfW;
      camera.right = halfW;
      camera.top = halfH;
      camera.bottom = -halfH;
      camera.updateProjectionMatrix();
      sceneApi!.requestRender();
    }

    // On first render, fit the camera to the actual page dimensions.
    if (firstRender) {
      firstRender = false;
      void ctx.commands.execute('camera.fitPage', {
        pageW: uv.width,
        pageH: uv.height,
        animate: false,
      });
    }
  }

  function frameTick(): void {
    syncTransform();
    rafId = requestAnimationFrame(frameTick);
  }

  const api: DocumentPlugin & PdfUnderlayAPI = {
    name: NAME,

    effectiveScale(): number {
      if (!ctx || !sceneApi) return 1;
      const camera = sceneApi.camera;
      const containerW = ctx.container.clientWidth;
      const frustumW = (camera.right - camera.left) / camera.zoom;
      return containerW / frustumW;
    },

    rerender(): void {
      rerenderAtCurrentZoom();
    },

    dependencies: ['scene'],

    install(context: DocumentContext): void {
      ctx = context;
      sceneApi = context.plugins.get<SceneAPI>('scene')!;
      context.container.style.overflow = 'hidden';
      context.canvas.style.position = 'absolute';
      context.canvas.style.transformOrigin = '0 0';
      context.textLayer.style.position = 'absolute';
      context.textLayer.style.transformOrigin = '0 0';

      const off = context.events.on('page:rendered', onPageRendered);
      cleanups.push(off);

      rafId = requestAnimationFrame(frameTick);

      context.commands.register('pdfUnderlay.rerender', () => {
        rerenderAtCurrentZoom();
      }, { title: 'Re-render PDF at current zoom' });
    },

    uninstall(): void {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      if (settleTimer !== null) {
        clearTimeout(settleTimer);
        settleTimer = null;
      }
      for (const c of cleanups.splice(0)) c();
      renderState = null;
      firstRender = true;
      sceneApi = null;
      ctx = null;
    },
  };

  return api;
}
