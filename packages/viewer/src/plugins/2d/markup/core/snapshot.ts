/**
 * Composite the pdf.js page raster and the shared-scene WebGL canvas into one
 * PNG data URL (≤ maxWidth). The PDF canvas is page-sized and positioned via the
 * pdf-underlay CSS transform; the WebGL canvas is container-sized and already
 * camera-projected (it shows exactly the on-screen view), so it maps 1:1 onto
 * the output. Text markup lives in the WebGL canvas (CanvasTexture), so there is
 * nothing DOM to composite separately.
 *
 * The caller must render the scene immediately before calling this and create
 * the renderer with `preserveDrawingBuffer: true`, or the WebGL drawing buffer
 * may already be cleared.
 */

export type ViewportCrop = {
  containerW: number;
  containerH: number;
  screenX: number;
  screenY: number;
  cssScale: number;
};

export function compositeSnapshot(
  pageCanvas: HTMLCanvasElement,
  markupCanvas: HTMLCanvasElement,
  pageCss: { width: number; height: number },
  maxWidth = 480,
  viewport?: ViewportCrop,
): string | null {
  if (viewport) {
    return compositeViewport(pageCanvas, markupCanvas, pageCss, maxWidth, viewport);
  }

  const cssW = Math.max(1, pageCss.width);
  const cssH = Math.max(1, pageCss.height);
  const scale = Math.min(1, maxWidth / cssW);
  const outW = Math.max(1, Math.round(cssW * scale));
  const outH = Math.max(1, Math.round(cssH * scale));

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const g = out.getContext('2d');
  if (g === null) return null;

  if (pageCanvas.width > 0 && pageCanvas.height > 0) {
    g.drawImage(pageCanvas, 0, 0, pageCanvas.width, pageCanvas.height, 0, 0, outW, outH);
  }
  if (markupCanvas.width > 0 && markupCanvas.height > 0) {
    g.drawImage(markupCanvas, 0, 0, markupCanvas.width, markupCanvas.height, 0, 0, outW, outH);
  }
  return out.toDataURL('image/png');
}

function compositeViewport(
  pageCanvas: HTMLCanvasElement,
  webglCanvas: HTMLCanvasElement,
  pageCss: { width: number; height: number },
  maxWidth: number,
  vp: ViewportCrop,
): string | null {
  const vpW = Math.max(1, vp.containerW);
  const vpH = Math.max(1, vp.containerH);
  const downscale = Math.min(1, maxWidth / vpW);
  const outW = Math.max(1, Math.round(vpW * downscale));
  const outH = Math.max(1, Math.round(vpH * downscale));

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const g = out.getContext('2d');
  if (g === null) return null;

  // Page canvas: the pdf-underlay positions it in the container via
  // `translate(screenX, screenY) scale(cssScale)`. Replicate that so the
  // composite shows exactly what the user sees.
  const sx = vp.screenX * downscale;
  const sy = vp.screenY * downscale;
  const sc = vp.cssScale * downscale;
  if (pageCanvas.width > 0 && pageCanvas.height > 0) {
    const dstW = pageCss.width * sc;
    const dstH = pageCss.height * sc;
    g.drawImage(pageCanvas, 0, 0, pageCanvas.width, pageCanvas.height, sx, sy, dstW, dstH);
  }

  // WebGL canvas: container-sized and already camera-projected — it covers the
  // whole viewport, so map its full extent onto the full output.
  if (webglCanvas.width > 0 && webglCanvas.height > 0) {
    g.drawImage(webglCanvas, 0, 0, webglCanvas.width, webglCanvas.height, 0, 0, outW, outH);
  }

  return out.toDataURL('image/png');
}
