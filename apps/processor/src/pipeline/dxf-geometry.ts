/**
 * Pure (I/O-free) DXF → compact geometry + drawing-metadata extraction.
 *
 * The geometry artifact is intentionally byte-compatible with the PDF vector
 * artifact (`pdf-geometry.ts`) so the portal's format-agnostic
 * `PdfVectorOverlay` renders it unchanged: a single page, Y-up, box-relative
 * coordinates rounded to 2dp, with `l` (lines) and `t` (text). DXF model space
 * is already Y-up, so no axis flip is needed — we only subtract the drawing's
 * lower-left extent so (0,0) sits at the page-box corner.
 *
 * Curves (ARC/CIRCLE/ELLIPSE and LWPOLYLINE/POLYLINE bulges) are flattened to
 * straight segments. Layer membership is captured additively (`lyr`/`ll`/`tl`)
 * so a later layer-toggle UI has the data; the overlay ignores those fields.
 */

import type { IDxf, IEntity, IPoint } from 'dxf-parser';

/** `[sx, sy, ex, ey]` (DXF model units, 2dp, box-relative). */
export type Line = [number, number, number, number];

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
  /** Layer-name table; index referenced by `ll`/`tl`. */
  lyr?: string[];
  /** Layer index per line in `l` (parallel array). */
  ll?: number[];
  /** Layer index per text in `t` (parallel array). */
  tl?: number[];
};

export type GeometryArtifact = {
  v: 1;
  p: PageGeometry[];
};

export type LayerMeta = {
  name: string;
  color: number;
  linetype: string;
  off: boolean;
  frozen: boolean;
  count: number;
};

export type DrawingMetadata = {
  source: 'dxf' | 'dwg';
  cadVersion: string | null;
  units: string;
  unitsCode: number | null;
  extents: { min: [number, number]; max: [number, number] } | null;
  createdAt: string | null;
  modifiedAt: string | null;
  savedBy: string | null;
  layers: LayerMeta[];
  entityCounts: Record<string, number>;
};

const SEGMENTS_PER_CIRCLE = 64;
const MIN_SEGMENT_LEN = 1e-6;

// AutoCAD $INSUNITS code → human label. Codes beyond this table fall back to
// "unknown"; 0 / missing is the genuinely unitless model-space default.
const INSUNITS: Record<number, string> = {
  0: 'unitless',
  1: 'inches',
  2: 'feet',
  3: 'miles',
  4: 'millimeters',
  5: 'centimeters',
  6: 'meters',
  7: 'kilometers',
  8: 'microinches',
  9: 'mils',
  10: 'yards',
  11: 'angstroms',
  12: 'nanometers',
  13: 'microns',
  14: 'decimeters',
  15: 'decameters',
  16: 'hectometers',
  17: 'gigameters',
  18: 'astronomical units',
  19: 'light years',
  20: 'parsecs',
  21: 'US survey feet',
  22: 'US survey inches',
  23: 'US survey yards',
  24: 'US survey miles',
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isPoint(v: unknown): v is IPoint {
  return typeof v === 'object' && v !== null && 'x' in v && 'y' in v;
}

/** Sample an angular sweep around a center into a flat point list (inclusive of both ends). */
function sampleArc(
  cx: number,
  cy: number,
  startAngle: number,
  sweep: number,
  pointAt: (a: number) => [number, number],
): Array<[number, number]> {
  const steps = Math.max(2, Math.ceil((Math.abs(sweep) / (2 * Math.PI)) * SEGMENTS_PER_CIRCLE));
  const out: Array<[number, number]> = [];
  for (let k = 0; k <= steps; k += 1) {
    out.push(pointAt(startAngle + (sweep * k) / steps));
  }
  return out;
}

function circlePoints(cx: number, cy: number, r: number, a0: number, sweep: number): Array<[number, number]> {
  return sampleArc(cx, cy, a0, sweep, (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)]);
}

/**
 * Flatten a bulged polyline segment (P0→P1, `bulge` = tan(¼ included angle),
 * negative = clockwise) into points. Straight when bulge ≈ 0.
 */
function bulgePoints(p0: IPoint, p1: IPoint, bulge: number): Array<[number, number]> {
  if (!bulge) return [[p1.x, p1.y]];
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const chord = Math.hypot(dx, dy);
  if (chord < MIN_SEGMENT_LEN) return [[p1.x, p1.y]];

  const angle = 4 * Math.atan(bulge); // signed included angle
  const r = chord / (2 * Math.sin(angle / 2)); // signed radius
  const ux = dx / chord;
  const uy = dy / chord;
  // Center sits on the chord's left normal at the (signed) apothem distance.
  const apothem = r * Math.cos(angle / 2);
  const cx = (p0.x + p1.x) / 2 - uy * apothem;
  const cy = (p0.y + p1.y) / 2 + ux * apothem;
  const radius = Math.abs(r);
  const a0 = Math.atan2(p0.y - cy, p0.x - cx);
  const pts = circlePoints(cx, cy, radius, a0, angle);
  pts.shift(); // P0 is already the previous vertex; emit only the new points.
  return pts;
}

/** Accumulates lines + text with their per-entity layer index. */
class GeometryBuilder {
  readonly lines: Line[] = [];
  readonly text: TextEntry[] = [];
  readonly lineLayer: number[] = [];
  readonly textLayer: number[] = [];
  private readonly layerIndex = new Map<string, number>();
  readonly layerNames: string[] = [];

  private layerOf(name: string): number {
    const key = name || '0';
    const existing = this.layerIndex.get(key);
    if (existing !== undefined) return existing;
    const idx = this.layerNames.length;
    this.layerNames.push(key);
    this.layerIndex.set(key, idx);
    return idx;
  }

  addPolyline(points: Array<[number, number]>, layer: string, closed: boolean): void {
    const li = this.layerOf(layer);
    const pts = closed && points.length > 2 ? [...points, points[0]!] : points;
    for (let k = 0; k + 1 < pts.length; k += 1) {
      const a = pts[k]!;
      const b = pts[k + 1]!;
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < MIN_SEGMENT_LEN) continue;
      this.lines.push([a[0], a[1], b[0], b[1]]);
      this.lineLayer.push(li);
    }
  }

  addText(entry: TextEntry, layer: string): void {
    this.text.push(entry);
    this.textLayer.push(this.layerOf(layer));
  }
}

function tessellateEntity(builder: GeometryBuilder, e: IEntity): void {
  const layer = e.layer ?? '0';
  switch (e.type) {
    case 'LINE': {
      const v = (e as unknown as { vertices?: IPoint[] }).vertices;
      if (v && v.length >= 2) builder.addPolyline([[v[0]!.x, v[0]!.y], [v[1]!.x, v[1]!.y]], layer, false);
      break;
    }
    case 'LWPOLYLINE':
    case 'POLYLINE': {
      const poly = e as unknown as {
        vertices?: Array<IPoint & { bulge?: number }>;
        shape?: boolean;
      };
      const verts = poly.vertices ?? [];
      if (verts.length < 2) break;
      const closed = poly.shape === true;
      const ring = closed ? [...verts, verts[0]!] : verts;
      const points: Array<[number, number]> = [[ring[0]!.x, ring[0]!.y]];
      for (let k = 0; k + 1 < ring.length; k += 1) {
        const a = ring[k]!;
        const b = ring[k + 1]!;
        const bulge = a.bulge ?? 0;
        if (bulge) points.push(...bulgePoints(a, b, bulge));
        else points.push([b.x, b.y]);
      }
      // `points` already includes the closing vertex when closed; don't re-close.
      builder.addPolyline(points, layer, false);
      break;
    }
    case 'ARC': {
      const a = e as unknown as { center: IPoint; radius: number; startAngle: number; endAngle: number };
      let sweep = a.endAngle - a.startAngle;
      if (sweep <= 0) sweep += 2 * Math.PI; // DXF arcs run CCW from start to end.
      builder.addPolyline(circlePoints(a.center.x, a.center.y, a.radius, a.startAngle, sweep), layer, false);
      break;
    }
    case 'CIRCLE': {
      const c = e as unknown as { center: IPoint; radius: number };
      builder.addPolyline(circlePoints(c.center.x, c.center.y, c.radius, 0, 2 * Math.PI), layer, false);
      break;
    }
    case 'ELLIPSE': {
      const el = e as unknown as {
        center: IPoint;
        majorAxisEndPoint: IPoint;
        axisRatio: number;
        startAngle: number;
        endAngle: number;
      };
      const mx = el.majorAxisEndPoint.x;
      const my = el.majorAxisEndPoint.y;
      const ratio = el.axisRatio ?? 1;
      let sweep = el.endAngle - el.startAngle;
      if (sweep <= 0) sweep += 2 * Math.PI;
      const pts = sampleArc(el.center.x, el.center.y, el.startAngle, sweep, (t) => {
        const cos = Math.cos(t);
        const sin = Math.sin(t);
        // major = (mx,my); minor = perp(major) * ratio = (-my, mx) * ratio.
        return [el.center.x + cos * mx - sin * my * ratio, el.center.y + cos * my + sin * mx * ratio];
      });
      builder.addPolyline(pts, layer, false);
      break;
    }
    case 'TEXT': {
      const t = e as unknown as { startPoint: IPoint; text: string; textHeight: number; rotation?: number };
      if (typeof t.text === 'string' && t.text.trim().length > 0) {
        builder.addText(toTextEntry(t.startPoint, t.text, t.textHeight, t.rotation), layer);
      }
      break;
    }
    case 'MTEXT': {
      const t = e as unknown as { position: IPoint; text: string; height: number; rotation?: number };
      if (typeof t.text === 'string' && t.text.trim().length > 0) {
        builder.addText(toTextEntry(t.position, mtextPlain(t.text), t.height, t.rotation), layer);
      }
      break;
    }
    default:
      break; // INSERT/HATCH/DIMENSION/SPLINE etc. are deferred.
  }
}

function toTextEntry(p: IPoint, s: string, height: number, rotationDeg?: number): TextEntry {
  const entry: TextEntry = { s, p: [round2(p.x), round2(p.y)], z: round2(height || 0) };
  if (rotationDeg) {
    const r = (rotationDeg * Math.PI) / 180;
    if (Math.abs(r) > 0.01) entry.r = Math.round(r * 1000) / 1000;
  }
  return entry;
}

/** Strip the most common MTEXT inline formatting codes to plain text. */
function mtextPlain(raw: string): string {
  return raw
    .replace(/\\P/g, ' ')
    .replace(/\\[A-Za-z][^;\\]*;?/g, '')
    .replace(/[{}]/g, '')
    .trim();
}

/** Build the single-page compact geometry artifact from a parsed DXF. */
export function buildGeometry(dxf: IDxf): GeometryArtifact {
  const builder = new GeometryBuilder();
  for (const e of dxf.entities ?? []) tessellateEntity(builder, e);

  // Box-relative origin: prefer header extents, else compute from geometry so
  // the page always tightly bounds the content the overlay will render.
  const bbox = computeBounds(builder.lines, builder.text);
  const headerExtents = readExtents(dxf);
  const min = headerExtents?.min ?? (bbox ? [bbox.minX, bbox.minY] : [0, 0]);
  const max = headerExtents?.max ?? (bbox ? [bbox.maxX, bbox.maxY] : [0, 0]);
  const x0 = min[0];
  const y0 = min[1];
  const w = round2(Math.max(0, max[0] - min[0]));
  const h = round2(Math.max(0, max[1] - min[1]));

  const l: Line[] = builder.lines.map(([sx, sy, ex, ey]) => [
    round2(sx - x0),
    round2(sy - y0),
    round2(ex - x0),
    round2(ey - y0),
  ]);
  const t: TextEntry[] = builder.text.map((entry) => ({
    ...entry,
    p: [round2(entry.p[0] - x0), round2(entry.p[1] - y0)] as [number, number],
  }));

  const page: PageGeometry = { i: 0, w, h, l, t };
  if (builder.layerNames.length > 0) {
    page.lyr = builder.layerNames;
    page.ll = builder.lineLayer;
    page.tl = builder.textLayer;
  }
  return { v: 1, p: [page] };
}

function computeBounds(
  lines: Line[],
  text: TextEntry[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (x: number, y: number): void => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const [sx, sy, ex, ey] of lines) {
    visit(sx, sy);
    visit(ex, ey);
  }
  for (const entry of text) visit(entry.p[0], entry.p[1]);
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function readExtents(dxf: IDxf): { min: [number, number]; max: [number, number] } | null {
  const header = dxf.header ?? {};
  const lo = header['$EXTMIN'];
  const hi = header['$EXTMAX'];
  if (!isPoint(lo) || !isPoint(hi)) return null;
  if (hi.x <= lo.x || hi.y <= lo.y) return null;
  return { min: [lo.x, lo.y], max: [hi.x, hi.y] };
}

function headerString(dxf: IDxf, key: string): string | null {
  const v = (dxf.header ?? {})[key] as unknown;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function headerNumber(dxf: IDxf, key: string): number | null {
  const v = (dxf.header ?? {})[key] as unknown;
  return typeof v === 'number' ? v : null;
}

/** Build the drawing-metadata blob surfaced in the viewer info panel. */
export function buildMetadata(dxf: IDxf, source: 'dxf' | 'dwg'): DrawingMetadata {
  const entityCounts: Record<string, number> = {};
  const layerCounts = new Map<string, number>();
  for (const e of dxf.entities ?? []) {
    entityCounts[e.type] = (entityCounts[e.type] ?? 0) + 1;
    const layer = e.layer || '0';
    layerCounts.set(layer, (layerCounts.get(layer) ?? 0) + 1);
  }

  const layerTable = dxf.tables?.layer?.layers ?? {};
  const layers: LayerMeta[] = Object.values(layerTable).map((layer) => ({
    name: layer.name,
    color: typeof layer.color === 'number' ? layer.color : 0,
    linetype: (layer as unknown as { lineType?: string }).lineType ?? '',
    off: layer.visible === false,
    frozen: layer.frozen === true,
    count: layerCounts.get(layer.name) ?? 0,
  }));
  // Surface layers that only appear on entities (not declared in the table).
  for (const [name, count] of layerCounts) {
    if (!layers.some((l) => l.name === name)) {
      layers.push({ name, color: 0, linetype: '', off: false, frozen: false, count });
    }
  }

  const unitsCode = headerNumber(dxf, '$INSUNITS');
  const extents = readExtents(dxf);

  return {
    source,
    cadVersion: headerString(dxf, '$ACADVER'),
    units: unitsCode !== null ? (INSUNITS[unitsCode] ?? 'unknown') : 'unitless',
    unitsCode,
    extents,
    createdAt: headerString(dxf, '$TDCREATE'),
    modifiedAt: headerString(dxf, '$TDUPDATE'),
    savedBy: headerString(dxf, '$LASTSAVEDBY'),
    layers,
    entityCounts,
  };
}
