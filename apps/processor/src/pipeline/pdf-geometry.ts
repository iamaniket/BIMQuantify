/**
 * Pure (I/O-free) PDF vector-geometry + text extraction over the pdfjs
 * operator list. Produces a compact, Y-up JSON artifact per page.
 *
 * Coordinate space: PDF user space (Y-up, bottom-left origin), normalised so
 * (0,0) sits at the page box's bottom-left corner. We do NOT apply pdfjs's
 * device viewport transform (which would flip to Y-down) — the artifact is
 * meant for a Three.js-style consumer.
 *
 * Compact line tuple layout: [sx, sy, ex, ey] or [sx, sy, ex, ey, w]
 *   sx,sy = start point, ex,ey = end point (page points, 2dp)
 *   w     = stroke width in points (2dp); appended ONLY when outside the
 *           hairline band (~0.5–1.5pt) to keep the JSON small.
 */

import { OPS, Util } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** `[x0, y0, x1, y1]` page box (cropbox clipped to mediabox), PDF points. */
export type ViewBox = [number, number, number, number];

/** Affine matrix `[a, b, c, d, e, f]`. */
type Matrix = [number, number, number, number, number, number];

/** `[sx, sy, ex, ey]` or `[sx, sy, ex, ey, strokeWidth]`. */
export type Line =
  | [number, number, number, number]
  | [number, number, number, number, number];

export type TextEntry = {
  s: string;
  p: [number, number];
  z: number;
  r?: number;
};

export type PageGeometry = {
  i: number;
  w: number;
  h: number;
  rot?: number;
  l: Line[];
  t: TextEntry[];
};

export type GeometryArtifact = {
  v: 1;
  p: PageGeometry[];
};

/** Minimal structural view of `page.getOperatorList()`. */
export type RawOpList = { fnArray: number[]; argsArray: unknown[] };

/** Minimal structural view of a `getTextContent()` text item. */
type TextItemLike = {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  fontName?: string;
};
export type TextContentLike = { items: unknown[] };

const CURVE_STEPS = 16;
const MIN_SEGMENT_LEN = 0.05; // points — drop sub-pixel noise.
const HAIRLINE_LO = 0.5;
const HAIRLINE_HI = 1.5;
const MAX_LINES_PER_PAGE = 200_000;

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function apply(m: Matrix, x: number, y: number): [number, number] {
  return Util.applyTransform([x, y], m) as [number, number];
}

/** Average axis scale of a matrix — converts user-space lengths to points. */
function matrixScale(m: Matrix): number {
  const det = m[0] * m[3] - m[1] * m[2];
  return Math.sqrt(Math.abs(det)) || 1;
}

/**
 * Walk an operator list and return the stroked/filled geometry flattened to
 * straight segments, in page points (Y-up, box-relative).
 */
export function walkOperatorList(opList: RawOpList, viewBox: ViewBox): Line[] {
  const [x0, y0] = viewBox;
  const out: Line[] = [];

  // Graphics state.
  let ctm: Matrix = [...IDENTITY] as Matrix;
  const ctmStack: Matrix[] = [];
  let lineWidth = 1; // PDF default.

  // Current path cursor (PDF user space, pre-CTM — matches the canvas executor).
  let cx = 0;
  let cy = 0;
  let sx = 0; // subpath start
  let sy = 0;
  // Segments built since the last paint/clear. Endpoints are stored in page
  // space (CTM already applied) because the canvas executor bakes the path
  // transform in at build time; a later save/restore must not retro-transform
  // already-built points. Each entry also carries the line-width scale that
  // was in effect when it was built.
  let pending: Array<[number, number, number, number, number]> = [];

  /** Build a segment from LOCAL (user-space) endpoints, applying the current CTM. */
  const pushSegment = (ax: number, ay: number, bx: number, by: number): void => {
    const [pax, pay] = apply(ctm, ax, ay);
    const [pbx, pby] = apply(ctm, bx, by);
    pending.push([pax, pay, pbx, pby, matrixScale(ctm)]);
  };

  const flatten = (
    p0x: number,
    p0y: number,
    p1x: number,
    p1y: number,
    p2x: number,
    p2y: number,
    p3x: number,
    p3y: number,
  ): void => {
    let px = p0x;
    let py = p0y;
    for (let k = 1; k <= CURVE_STEPS; k += 1) {
      const t = k / CURVE_STEPS;
      const mt = 1 - t;
      const a = mt * mt * mt;
      const b = 3 * mt * mt * t;
      const c = 3 * mt * t * t;
      const d = t * t * t;
      const nx = a * p0x + b * p1x + c * p2x + d * p3x;
      const ny = a * p0y + b * p1y + c * p2y + d * p3y;
      pushSegment(px, py, nx, ny);
      px = nx;
      py = ny;
    }
  };

  const emitPending = (): void => {
    for (const [pax, pay, pbx, pby, scale] of pending) {
      if (out.length >= MAX_LINES_PER_PAGE) break;
      const sxp = round2(pax - x0);
      const syp = round2(pay - y0);
      const exp = round2(pbx - x0);
      const eyp = round2(pby - y0);
      if (Math.hypot(exp - sxp, eyp - syp) < MIN_SEGMENT_LEN) continue;
      const w = round2(lineWidth * scale);
      const includeW = w < HAIRLINE_LO || w > HAIRLINE_HI;
      out.push(includeW ? [sxp, syp, exp, eyp, w] : [sxp, syp, exp, eyp]);
    }
    pending = [];
  };

  const { fnArray, argsArray } = opList;
  for (let i = 0; i < fnArray.length; i += 1) {
    const fn = fnArray[i];
    const args = argsArray[i];
    switch (fn) {
      case OPS.save:
        ctmStack.push([...ctm] as Matrix);
        break;
      case OPS.restore: {
        const popped = ctmStack.pop();
        if (popped !== undefined) ctm = popped;
        break;
      }
      case OPS.transform:
        if (Array.isArray(args) && args.length === 6) {
          ctm = Util.transform(ctm, args) as Matrix;
        }
        break;
      case OPS.setLineWidth:
        if (typeof args === 'number') lineWidth = args;
        else if (Array.isArray(args) && typeof args[0] === 'number') lineWidth = args[0];
        break;
      case OPS.constructPath: {
        if (!Array.isArray(args)) break;
        const subOps = args[0] as number[] | undefined;
        const coords = args[1] as ArrayLike<number> | undefined;
        if (!Array.isArray(subOps) || coords === undefined) break;
        let j = 0;
        for (let s = 0; s < subOps.length; s += 1) {
          switch ((subOps[s] ?? -1) | 0) {
            case OPS.rectangle: {
              const rx = coords[j++]!;
              const ry = coords[j++]!;
              const rw = coords[j++]!;
              const rh = coords[j++]!;
              const xw = rx + rw;
              const yh = ry + rh;
              if (rw === 0 || rh === 0) {
                pushSegment(rx, ry, xw, yh);
              } else {
                pushSegment(rx, ry, xw, ry);
                pushSegment(xw, ry, xw, yh);
                pushSegment(xw, yh, rx, yh);
                pushSegment(rx, yh, rx, ry);
              }
              cx = rx;
              cy = ry;
              sx = rx;
              sy = ry;
              break;
            }
            case OPS.moveTo:
              cx = coords[j++]!;
              cy = coords[j++]!;
              sx = cx;
              sy = cy;
              break;
            case OPS.lineTo: {
              const nx = coords[j++]!;
              const ny = coords[j++]!;
              pushSegment(cx, cy, nx, ny);
              cx = nx;
              cy = ny;
              break;
            }
            case OPS.curveTo: {
              const c1x = coords[j]!;
              const c1y = coords[j + 1]!;
              const c2x = coords[j + 2]!;
              const c2y = coords[j + 3]!;
              const ex = coords[j + 4]!;
              const ey = coords[j + 5]!;
              flatten(cx, cy, c1x, c1y, c2x, c2y, ex, ey);
              cx = ex;
              cy = ey;
              j += 6;
              break;
            }
            case OPS.curveTo2: {
              // First control point is the current point.
              const c2x = coords[j]!;
              const c2y = coords[j + 1]!;
              const ex = coords[j + 2]!;
              const ey = coords[j + 3]!;
              flatten(cx, cy, cx, cy, c2x, c2y, ex, ey);
              cx = ex;
              cy = ey;
              j += 4;
              break;
            }
            case OPS.curveTo3: {
              // Second control point coincides with the end point.
              const c1x = coords[j]!;
              const c1y = coords[j + 1]!;
              const ex = coords[j + 2]!;
              const ey = coords[j + 3]!;
              flatten(cx, cy, c1x, c1y, ex, ey, ex, ey);
              cx = ex;
              cy = ey;
              j += 4;
              break;
            }
            case OPS.closePath:
              if (cx !== sx || cy !== sy) pushSegment(cx, cy, sx, sy);
              cx = sx;
              cy = sy;
              break;
            default:
              break;
          }
        }
        break;
      }
      case OPS.closeStroke:
      case OPS.closeFillStroke:
      case OPS.closeEOFillStroke:
        if (cx !== sx || cy !== sy) pushSegment(cx, cy, sx, sy);
        cx = sx;
        cy = sy;
        emitPending();
        break;
      case OPS.stroke:
      case OPS.fill:
      case OPS.eoFill:
      case OPS.fillStroke:
      case OPS.eoFillStroke:
        emitPending();
        break;
      case OPS.endPath:
      case OPS.clip:
      case OPS.eoClip:
        pending = []; // discard — clip regions are not visible geometry.
        break;
      default:
        break;
    }
  }

  return out;
}

/** Extract positioned text in the same Y-up, box-relative space as the lines. */
export function extractTextItems(content: TextContentLike, viewBox: ViewBox): TextEntry[] {
  const [x0, y0] = viewBox;
  const out: TextEntry[] = [];
  for (const raw of content.items) {
    const item = raw as TextItemLike;
    const str = item.str;
    const tf = item.transform;
    if (typeof str !== 'string' || str.trim().length === 0) continue;
    if (!Array.isArray(tf) || tf.length < 6) continue;
    const [a, b, c, d, e, f] = tf as [number, number, number, number, number, number];
    const z = round1(Math.hypot(c, d));
    const entry: TextEntry = {
      s: str,
      p: [round2(e - x0), round2(f - y0)],
      z,
    };
    const r = Math.atan2(b, a);
    if (Math.abs(r) > 0.01) entry.r = Math.round(r * 1000) / 1000;
    out.push(entry);
  }
  return out;
}

/** Build the compact geometry for one page. */
export async function buildPageGeometry(
  page: PDFPageProxy,
  pageIndex: number,
): Promise<PageGeometry> {
  const viewport = page.getViewport({ scale: 1, rotation: 0 });
  const vb = viewport.viewBox as number[];
  const viewBox: ViewBox = [vb[0]!, vb[1]!, vb[2]!, vb[3]!];
  const w = round2(viewBox[2] - viewBox[0]);
  const h = round2(viewBox[3] - viewBox[1]);

  const opList = (await page.getOperatorList()) as unknown as RawOpList;
  const lines = walkOperatorList(opList, viewBox);

  const textContent = (await page.getTextContent()) as unknown as TextContentLike;
  const texts = extractTextItems(textContent, viewBox);

  const result: PageGeometry = { i: pageIndex, w, h, l: lines, t: texts };
  const rot = (page.rotate ?? 0) % 360;
  if (rot !== 0) result.rot = rot;
  return result;
}
