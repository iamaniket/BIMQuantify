/**
 * Composite the pdf.js page raster and the markup WebGL canvas into one PNG
 * data URL (≤ maxWidth). Both source canvases represent the same page rect at
 * different native resolutions, so drawing each into the same output rect keeps
 * them aligned. Text markup lives in the WebGL canvas (CanvasTexture), so there
 * is nothing DOM to composite separately.
 *
 * The caller must render the markup scene immediately before calling this and
 * create the renderer with `preserveDrawingBuffer: true`, or the WebGL drawing
 * buffer may already be cleared.
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
  markupCanvas: HTMLCanvasElement,
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

  // The pdf-underlay positions page-space canvases in the container via
  // `translate(screenX, screenY) scale(cssScale)`. We replicate that here
  // so the composite shows exactly what the user sees.
  const sx = vp.screenX * downscale;
  const sy = vp.screenY * downscale;
  const sc = vp.cssScale * downscale;

  // Page canvas: native size → page CSS size is implicit (canvas CSS size),
  // so we draw from native pixels and scale to pageCss * cssScale.
  if (pageCanvas.width > 0 && pageCanvas.height > 0) {
    const dstW = pageCss.width * sc;
    const dstH = pageCss.height * sc;
    g.drawImage(pageCanvas, 0, 0, pageCanvas.width, pageCanvas.height, sx, sy, dstW, dstH);
  }

  // Markup canvas: same page-space coordinate system, same transform.
  if (markupCanvas.width > 0 && markupCanvas.height > 0) {
    const dstW = pageCss.width * sc;
    const dstH = pageCss.height * sc;
    g.drawImage(markupCanvas, 0, 0, markupCanvas.width, markupCanvas.height, sx, sy, dstW, dstH);
  }

  return out.toDataURL('image/png');
}
