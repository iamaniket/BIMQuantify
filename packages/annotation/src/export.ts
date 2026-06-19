/**
 * Flatten an image + annotations into a raster Blob, client-side, no heavy lib.
 *
 * The source image is loaded upright (EXIF orientation applied once via
 * `createImageBitmap(..., { imageOrientation: 'from-image' })`), drawn to a
 * canvas at its intrinsic resolution, then each annotation is drawn on top with
 * the SAME geometry the SVG editor uses (`geometry.ts`). Blur/redact regions are
 * DESTRUCTIVE here — the pixels are pixelated in the output bitmap, not hidden.
 *
 * CORS note: the source URL must be served with permissive CORS or the canvas
 * taints and `toBlob` throws. Presigned MinIO/S3 GETs are configured for this.
 */

import { normPointsToPx, strokeWidthToPx, type PxPoint } from './coords.js';
import { arrowGeometry, cloudPoints } from './geometry.js';
import { shapeMetrics, type RenderBox } from './shapes.js';
import type { Annotation2D } from './types.js';

export interface ExportOptions {
  mimeType?: 'image/jpeg' | 'image/png';
  /** JPEG quality 0..1 (ignored for PNG). */
  quality?: number;
  /** Cap the longest output edge (downscale only) — e.g. for thumbnails. */
  maxEdge?: number;
}

interface LoadedImage {
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  width: number;
  height: number;
}

async function loadUpright(imageUrl: string): Promise<LoadedImage> {
  // Preferred path: fetch bytes + createImageBitmap with EXIF orientation baked in.
  if (typeof createImageBitmap === 'function' && typeof fetch === 'function') {
    try {
      const res = await fetch(imageUrl, { mode: 'cors' });
      const blob = await res.blob();
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      return {
        width: bmp.width,
        height: bmp.height,
        draw: (ctx, w, h) => { ctx.drawImage(bmp, 0, 0, w, h); },
      };
    } catch {
      // fall through to <img>
    }
  }
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => { resolve(el); };
    el.onerror = () => { reject(new Error('image-load-failed')); };
    el.src = imageUrl;
  });
  return {
    width: img.naturalWidth,
    height: img.naturalHeight,
    draw: (ctx, w, h) => { ctx.drawImage(img, 0, 0, w, h); },
  };
}

function strokeCommon(ctx: CanvasRenderingContext2D, a: Annotation2D, lineWidth: number): void {
  ctx.strokeStyle = a.color;
  ctx.lineWidth = Math.max(lineWidth, 0.5);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

function polyline(ctx: CanvasRenderingContext2D, pts: PxPoint[], close: boolean): void {
  if (pts.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 1; i < pts.length; i += 1) ctx.lineTo(pts[i]![0], pts[i]![1]);
  if (close) ctx.closePath();
  ctx.stroke();
}

/** Destructive pixelation of a region of the already-drawn canvas. */
function pixelateRegion(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  if (w < 1 || h < 1) return;
  const block = Math.max(4, Math.floor(Math.min(w, h) / 10));
  const tw = Math.max(1, Math.round(w / block));
  const th = Math.max(1, Math.round(h / block));
  const tmp = document.createElement('canvas');
  tmp.width = tw;
  tmp.height = th;
  const tctx = tmp.getContext('2d');
  if (tctx === null) return;
  // Downscale the region, then upscale it back with smoothing off → blocky.
  tctx.drawImage(ctx.canvas, x, y, w, h, 0, 0, tw, th);
  const prev = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tmp, 0, 0, tw, th, x, y, w, h);
  ctx.imageSmoothingEnabled = prev;
}

function rectFrom(p0: PxPoint, p1: PxPoint): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.min(p0[0], p1[0]),
    y: Math.min(p0[1], p1[1]),
    w: Math.abs(p1[0] - p0[0]),
    h: Math.abs(p1[1] - p0[1]),
  };
}

/** Draw one annotation onto the canvas (canvas is already at `box` resolution). */
export function drawAnnotation(ctx: CanvasRenderingContext2D, a: Annotation2D, box: RenderBox): void {
  const pts = normPointsToPx(a.points, box.width, box.height);
  const m = shapeMetrics(a, box);

  switch (a.tool) {
    case 'rect': {
      if (pts.length < 2) return;
      const r = rectFrom(pts[0]!, pts[1]!);
      strokeCommon(ctx, a, m.sw);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      return;
    }
    case 'ellipse': {
      if (pts.length < 2) return;
      const r = rectFrom(pts[0]!, pts[1]!);
      strokeCommon(ctx, a, m.sw);
      ctx.beginPath();
      ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }
    case 'line': {
      if (pts.length < 2) return;
      strokeCommon(ctx, a, m.sw);
      polyline(ctx, [pts[0]!, pts[1]!], false);
      return;
    }
    case 'arrow': {
      if (pts.length < 2) return;
      const g = arrowGeometry(pts[0]!, pts[1]!, m.headLen);
      strokeCommon(ctx, a, m.sw);
      polyline(ctx, [g.shaft[0], g.shaft[1]], false);
      polyline(ctx, [g.head[0], g.head[1], g.head[2]], false);
      return;
    }
    case 'cloud': {
      if (pts.length < 2) return;
      strokeCommon(ctx, a, m.sw);
      polyline(ctx, cloudPoints(pts[0]!, pts[1]!, m.arcD), true);
      return;
    }
    case 'freehand': {
      if (pts.length < 2) return;
      strokeCommon(ctx, a, m.sw);
      polyline(ctx, pts, false);
      return;
    }
    case 'text': {
      if (pts.length < 1) return;
      ctx.fillStyle = a.color;
      ctx.textBaseline = 'top';
      ctx.font = `${m.fontPx}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
      ctx.fillText(a.text ?? '', pts[0]![0], pts[0]![1]);
      return;
    }
    case 'blur': {
      if (pts.length < 2) return;
      const r = rectFrom(pts[0]!, pts[1]!);
      pixelateRegion(ctx, Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h));
      return;
    }
    default:
      return;
  }
}

function toBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => { blob === null ? reject(new Error('toBlob-failed')) : resolve(blob); },
      mime,
      quality,
    );
  });
}

/**
 * Flatten `imageUrl` + `annotations` into a raster Blob. Blur regions are baked
 * in destructively. Returns the burned image; the caller uploads it as a new
 * attachment version and keeps the vectors separately for re-editing.
 */
export async function exportAnnotatedImage(
  imageUrl: string,
  annotations: Annotation2D[],
  opts: ExportOptions = {},
): Promise<Blob> {
  const mime = opts.mimeType ?? 'image/jpeg';
  const quality = opts.quality ?? 0.92;
  const src = await loadUpright(imageUrl);

  let w = src.width;
  let h = src.height;
  if (opts.maxEdge !== undefined && opts.maxEdge > 0) {
    const longest = Math.max(w, h);
    if (longest > opts.maxEdge) {
      const scale = opts.maxEdge / longest;
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('canvas-2d-unavailable');

  src.draw(ctx, canvas.width, canvas.height);
  const box: RenderBox = { width: canvas.width, height: canvas.height };
  for (const a of annotations) drawAnnotation(ctx, a, box);

  return toBlob(canvas, mime, quality);
}
