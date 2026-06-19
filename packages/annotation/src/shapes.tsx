/**
 * Per-tool geometry, SVG rendering, hit-testing and editable handles. The SVG
 * path here and the Canvas2D path in `export.ts` are kept in lock-step via the
 * shared helpers in `geometry.ts`, so a shape looks identical on screen and in
 * the flattened raster.
 */

import type { JSX } from 'react';

import {
  distSqToSegment,
  normBBox,
  normPointsToPx,
  strokeWidthToPx,
  type NormPoint,
  type PxPoint,
} from './coords.js';
import { arrowGeometry, cloudPoints, pointsToPathD } from './geometry.js';
import type { Annotation2D, MarkupTool } from './types.js';

/** Authored stroke widths (in REFERENCE_EXTENT units) for the toolbar tiers. */
export const STROKE_PRESETS = { thin: 3, medium: 6, thick: 10 } as const;

/** How a tool turns pointer input into stored points. */
export type PointMode = 'two' | 'path' | 'single';

export const TOOL_POINT_MODE: Record<MarkupTool, PointMode> = {
  rect: 'two',
  ellipse: 'two',
  line: 'two',
  arrow: 'two',
  cloud: 'two',
  blur: 'two',
  freehand: 'path',
  text: 'single',
};

/** The pixel size of the box a shape is being rendered into. */
export interface RenderBox {
  width: number;
  height: number;
}

export interface ShapeMetrics {
  sw: number;
  headLen: number;
  arcD: number;
  fontPx: number;
}

function longestEdge(box: RenderBox): number {
  return Math.max(box.width, box.height);
}

/** Pixel-space sizing for one annotation in a render box (shared by SVG + canvas). */
export function shapeMetrics(a: Annotation2D, box: RenderBox): ShapeMetrics {
  const edge = longestEdge(box);
  const sw = strokeWidthToPx(a.strokeWidth, edge);
  return {
    sw,
    headLen: Math.max(sw * 5, edge * 0.03),
    arcD: Math.max(edge * 0.03, 10),
    fontPx: Math.max(sw * 6, 11),
  };
}

/** Normalize a 2-point box to `{x,y,w,h}` (handles inverted drags). */
function rectFromTwo(p0: PxPoint, p1: PxPoint): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.min(p0[0], p1[0]),
    y: Math.min(p0[1], p1[1]),
    w: Math.abs(p1[0] - p0[0]),
    h: Math.abs(p1[1] - p0[1]),
  };
}

/** Estimate a text annotation's box in px (top-left anchored). */
export function textBoxPx(a: Annotation2D, box: RenderBox): { x: number; y: number; w: number; h: number } {
  const [anchor] = normPointsToPx(a.points, box.width, box.height);
  const { fontPx } = shapeMetrics(a, box);
  const chars = Math.max(a.text?.length ?? 1, 1);
  return { x: anchor![0], y: anchor![1], w: chars * fontPx * 0.55, h: fontPx * 1.25 };
}

// --------------------------------------------------------------- SVG rendering

/** Render one annotation as SVG. Selection chrome is drawn separately. */
export function ShapeView({ a, box }: { a: Annotation2D; box: RenderBox }): JSX.Element | null {
  const pts = normPointsToPx(a.points, box.width, box.height);
  const { sw, headLen, arcD, fontPx } = shapeMetrics(a, box);
  const common = {
    stroke: a.color,
    strokeWidth: sw,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none' as const,
    vectorEffect: 'non-scaling-stroke' as const,
  };

  switch (a.tool) {
    case 'rect': {
      if (pts.length < 2) return null;
      const r = rectFromTwo(pts[0]!, pts[1]!);
      return <rect x={r.x} y={r.y} width={r.w} height={r.h} {...common} />;
    }
    case 'ellipse': {
      if (pts.length < 2) return null;
      const r = rectFromTwo(pts[0]!, pts[1]!);
      return <ellipse cx={r.x + r.w / 2} cy={r.y + r.h / 2} rx={r.w / 2} ry={r.h / 2} {...common} />;
    }
    case 'line': {
      if (pts.length < 2) return null;
      return <line x1={pts[0]![0]} y1={pts[0]![1]} x2={pts[1]![0]} y2={pts[1]![1]} {...common} />;
    }
    case 'arrow': {
      if (pts.length < 2) return null;
      const g = arrowGeometry(pts[0]!, pts[1]!, headLen);
      return (
        <g {...common}>
          <line x1={g.shaft[0][0]} y1={g.shaft[0][1]} x2={g.shaft[1][0]} y2={g.shaft[1][1]} />
          <polyline points={g.head.map((p) => `${p[0]},${p[1]}`).join(' ')} />
        </g>
      );
    }
    case 'cloud': {
      if (pts.length < 2) return null;
      return <path d={pointsToPathD(cloudPoints(pts[0]!, pts[1]!, arcD), true)} {...common} />;
    }
    case 'freehand': {
      if (pts.length < 2) return null;
      return <path d={pointsToPathD(pts, false)} {...common} />;
    }
    case 'text': {
      if (pts.length < 1) return null;
      return (
        <text
          x={pts[0]![0]}
          y={pts[0]![1]}
          fontSize={fontPx}
          fill={a.color}
          dominantBaseline="hanging"
          style={{ fontFamily: 'var(--font-sans, ui-sans-serif, system-ui, sans-serif)' }}
        >
          {a.text ?? ''}
        </text>
      );
    }
    case 'blur': {
      if (pts.length < 2) return null;
      const r = rectFromTwo(pts[0]!, pts[1]!);
      const patternId = `bim-blur-${a.id}`;
      return (
        <g>
          <defs>
            <pattern id={patternId} width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width={8} height={8} fill={a.color} fillOpacity={0.18} />
              <line x1={0} y1={0} x2={0} y2={8} stroke={a.color} strokeWidth={2} strokeOpacity={0.5} />
            </pattern>
          </defs>
          <rect
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
            fill={`url(#${patternId})`}
            stroke={a.color}
            strokeWidth={Math.max(sw, 1)}
            strokeDasharray="4 3"
          />
        </g>
      );
    }
    default:
      return null;
  }
}

// ----------------------------------------------------------------- hit-testing

/** Does a click at `p` (px) hit annotation `a`? `tol` is the slop in px. */
export function hitTest(a: Annotation2D, p: PxPoint, box: RenderBox, tol: number): boolean {
  const pts = normPointsToPx(a.points, box.width, box.height);

  switch (a.tool) {
    case 'line':
    case 'arrow': {
      if (pts.length < 2) return false;
      return distSqToSegment(p, pts[0]!, pts[1]!) <= tol * tol;
    }
    case 'freehand': {
      for (let i = 1; i < pts.length; i += 1) {
        if (distSqToSegment(p, pts[i - 1]!, pts[i]!) <= tol * tol) return true;
      }
      return false;
    }
    case 'text': {
      const b = textBoxPx(a, box);
      return p[0] >= b.x - tol && p[0] <= b.x + b.w + tol && p[1] >= b.y - tol && p[1] <= b.y + b.h + tol;
    }
    default: {
      // bbox shapes: rect / ellipse / cloud / blur — selectable anywhere inside.
      if (pts.length < 2) return false;
      const r = rectFromTwo(pts[0]!, pts[1]!);
      return p[0] >= r.x - tol && p[0] <= r.x + r.w + tol && p[1] >= r.y - tol && p[1] <= r.y + r.h + tol;
    }
  }
}

/** Editable vertex handles (normalized). Freehand/text expose no resize handles. */
export function handlePoints(a: Annotation2D): NormPoint[] {
  if (a.tool === 'freehand') return [];
  if (a.tool === 'text') return [];
  return a.points.slice(0, 2);
}

/** Normalized bounding box of an annotation (for the selection outline). */
export function annotationNormBox(a: Annotation2D, box: RenderBox): { x: number; y: number; w: number; h: number } {
  if (a.tool === 'text') {
    const b = textBoxPx(a, box);
    return { x: b.x / box.width, y: b.y / box.height, w: b.w / box.width, h: b.h / box.height };
  }
  return normBBox(a.points);
}
