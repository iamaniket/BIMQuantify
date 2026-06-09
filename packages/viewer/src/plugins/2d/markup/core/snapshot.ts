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

export function compositeSnapshot(
  pageCanvas: HTMLCanvasElement,
  markupCanvas: HTMLCanvasElement,
  pageCss: { width: number; height: number },
  maxWidth = 480,
): string | null {
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
