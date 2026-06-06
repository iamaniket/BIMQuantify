/**
 * PDF underlay plugin — positions the PDF canvas and text layer via CSS
 * transforms driven by the shared ortho camera on `DocumentContext`. Each
 * frame it reads the camera frustum and computes translate + scale, giving
 * instant smooth pan/zoom without re-rendering the PDF.
 *
 * A debounced re-render fires after the camera settles so the raster stays
 * sharp at the final zoom level.
 */

import {
  clampScale,
  MAX_CANVAS_DIM,
  type DocumentContext,
  type DocumentPlugin,
  type DocumentRotation,
  type PageDimensions,
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

  let revealed = false;
  let prevScreenX = 0;
  let prevScreenY = 0;
  let prevCssScale = 1;

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

    const dX = Math.abs(screenX - prevScreenX);
    const dY = Math.abs(screenY - prevScreenY);
    const dS = Math.abs(cssScale - prevCssScale);
    if (dX > 20 || dY > 20 || dS > 0.1) {
      console.log('[syncTransform] JUMP', {
        screenX: screenX.toFixed(1), screenY: screenY.toFixed(1), cssScale: cssScale.toFixed(4),
        prev: { x: prevScreenX.toFixed(1), y: prevScreenY.toFixed(1), s: prevCssScale.toFixed(4) },
        delta: { x: dX.toFixed(1), y: dY.toFixed(1), s: dS.toFixed(4) },
        zoom: zoom.toFixed(4), renderScale: renderScale.toFixed(4), pxPerUnit: pxPerUnit.toFixed(4),
        camPos: { x: cx.toFixed(2), y: cy.toFixed(2) },
        frustum: { l: camera.left.toFixed(1), r: camera.right.toFixed(1), t: camera.top.toFixed(1), b: camera.bottom.toFixed(1) },
      });
    }
    prevScreenX = screenX;
    prevScreenY = screenY;
    prevCssScale = cssScale;

    ctx.canvas.style.transform = transform;
    ctx.canvas.style.transformOrigin = '0 0';
    ctx.textLayer.style.transform = transform;
    ctx.textLayer.style.transformOrigin = '0 0';
    ctx.overlayHost.style.transform = transform;
    ctx.overlayHost.style.transformOrigin = '0 0';

    // Show the canvas only after the first valid CSS transform is applied,
    // preventing the flash of an untransformed full-size canvas on load.
    if (!revealed) {
      revealed = true;
      ctx.canvas.style.visibility = 'visible';
      ctx.textLayer.style.visibility = 'visible';
      ctx.overlayHost.style.visibility = 'visible';
    }

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
    // Compute the effective render scale the engine will actually use:
    // clamp to MAX_SCALE, then cap to stay within browser canvas limits.
    const clamped = clampScale(pxPerUnit);
    const uv = ctx.getUnscaledViewport();
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const maxDim = Math.max(uv?.width ?? 0, uv?.height ?? 0);
    const maxSafeScale = maxDim > 0 ? MAX_CANVAS_DIM / (maxDim * dpr) : clamped;
    const effectiveScale = Math.min(clamped, maxSafeScale);
    console.log('[pdf-underlay] rerenderAtCurrentZoom', {
      pxPerUnit: pxPerUnit.toFixed(4), effectiveScale: effectiveScale.toFixed(4),
      currentScale: ctx.getScale().toFixed(4), zoom: zoom.toFixed(4),
    });
    // Update renderScale immediately so syncTransform doesn't use a stale
    // value during the async re-render window (canvas resizes synchronously
    // but page:rendered fires after the render completes).
    if (renderState) {
      renderState.renderScale = effectiveScale;
    }
    ctx.setScale(pxPerUnit);
  }

  let firstRender = true;

  let lastFrustumPageW = 0;
  let lastFrustumPageH = 0;

  function onPageRendered(ev: { dims: PageDimensions; scale: number; rotation: DocumentRotation }): void {
    if (!ctx) return;
    const uv = ctx.getUnscaledViewport();
    if (!uv) return;

    console.log('[pdf-underlay] onPageRendered', {
      evScale: ev.scale.toFixed(4), evDims: ev.dims,
      uvW: uv.width.toFixed(1), uvH: uv.height.toFixed(1), firstRender,
    });

    renderState = {
      renderScale: ev.scale,
      pageW: uv.width,
      pageH: uv.height,
      canvasCssW: ev.dims.width,
      canvasCssH: ev.dims.height,
    };

    const containerW = ctx.container.clientWidth;
    const containerH = ctx.container.clientHeight;
    if (containerW === 0 || containerH === 0) return;

    // Only recalculate the frustum when the page dimensions change (first
    // render, page navigation, rotation) — not on zoom-triggered re-renders
    // where the unscaled viewport stays the same.
    const pageDimsChanged = uv.width !== lastFrustumPageW || uv.height !== lastFrustumPageH;
    if (pageDimsChanged) {
      lastFrustumPageW = uv.width;
      lastFrustumPageH = uv.height;
      const camera = sceneApi!.camera;
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
      context.canvas.style.visibility = 'hidden';
      context.textLayer.style.position = 'absolute';
      context.textLayer.style.transformOrigin = '0 0';
      context.textLayer.style.visibility = 'hidden';
      context.overlayHost.style.visibility = 'hidden';

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
      revealed = false;
      lastFrustumPageW = 0;
      lastFrustumPageH = 0;
      sceneApi = null;
      ctx = null;
    },
  };

  return api;
}
