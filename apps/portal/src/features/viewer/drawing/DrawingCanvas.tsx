'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';

import type { PageGeometry } from '@/lib/api/schemas/geometry';

type Props = {
  page: PageGeometry;
};

type ViewBox = { x: number; y: number; w: number; h: number };

const MIN_SPAN = 1e-3;
const ZOOM_STEP = 1.15;

/**
 * Renders a DXF/DWG vector page directly as SVG. The compact artifact is Y-up
 * (DXF model space), so a flip matrix maps it into SVG's Y-down space. Lines use
 * a non-scaling stroke so they stay crisp at any zoom; text is drawn unflipped
 * at the mirrored Y so glyphs read upright. There is no raster page — this is
 * the whole drawing.
 */
export function DrawingCanvas({ page }: Props): JSX.Element {
  const svgRef = useRef<SVGSVGElement>(null);
  const { w, h } = page;

  const fit = useCallback((): ViewBox => {
    const margin = Math.max(w, h, 1) * 0.05;
    return { x: -margin, y: -margin, w: w + margin * 2, h: h + margin * 2 };
  }, [w, h]);

  const [view, setView] = useState<ViewBox>(fit);
  const panRef = useRef<{ px: number; py: number; start: ViewBox } | null>(null);

  // Reset the view whenever the page (file) changes.
  useEffect(() => {
    setView(fit());
  }, [fit]);

  const clientToSvg = useCallback((clientX: number, clientY: number, vb: ViewBox): [number, number] => {
    const svg = svgRef.current;
    if (svg === null) return [vb.x, vb.y];
    const rect = svg.getBoundingClientRect();
    // SVG uses xMidYMid meet — derive the on-screen scale and letterbox offset.
    const scale = Math.min(rect.width / vb.w, rect.height / vb.h);
    const drawnW = vb.w * scale;
    const drawnH = vb.h * scale;
    const offX = (rect.width - drawnW) / 2;
    const offY = (rect.height - drawnH) / 2;
    const sx = vb.x + (clientX - rect.left - offX) / scale;
    const sy = vb.y + (clientY - rect.top - offY) / scale;
    return [sx, sy];
  }, []);

  const handleWheel = useCallback((e: ReactWheelEvent<SVGSVGElement>): void => {
    e.preventDefault();
    setView((vb) => {
      const factor = e.deltaY < 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
      const [ax, ay] = clientToSvg(e.clientX, e.clientY, vb);
      const nw = Math.max(MIN_SPAN, vb.w * factor);
      const nh = Math.max(MIN_SPAN, vb.h * factor);
      // Keep the cursor anchored to the same drawing point across the zoom.
      return {
        x: ax - (ax - vb.x) * (nw / vb.w),
        y: ay - (ay - vb.y) * (nh / vb.h),
        w: nw,
        h: nh,
      };
    });
  }, [clientToSvg]);

  const handlePointerDown = useCallback((e: ReactPointerEvent<SVGSVGElement>): void => {
    if (e.button !== 0 && e.button !== 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    panRef.current = { px: e.clientX, py: e.clientY, start: view };
  }, [view]);

  const handlePointerMove = useCallback((e: ReactPointerEvent<SVGSVGElement>): void => {
    const pan = panRef.current;
    if (pan === null) return;
    const svg = svgRef.current;
    if (svg === null) return;
    const rect = svg.getBoundingClientRect();
    const scale = Math.min(rect.width / pan.start.w, rect.height / pan.start.h);
    setView({
      ...pan.start,
      x: pan.start.x - (e.clientX - pan.px) / scale,
      y: pan.start.y - (e.clientY - pan.py) / scale,
    });
  }, []);

  const endPan = useCallback((e: ReactPointerEvent<SVGSVGElement>): void => {
    panRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, []);

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 h-full w-full touch-none bg-surface-low text-foreground"
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      preserveAspectRatio="xMidYMid meet"
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onDoubleClick={() => { setView(fit()); }}
      style={{ cursor: panRef.current !== null ? 'grabbing' : 'grab' }}
    >
      {/* Sheet bounds */}
      <rect
        x={0}
        y={0}
        width={w}
        height={h}
        className="fill-background stroke-border"
        vectorEffect="non-scaling-stroke"
      />
      {/* Lines — flipped from Y-up artifact space to SVG Y-down. */}
      <g transform={`matrix(1 0 0 -1 0 ${h})`}>
        {page.l.map((line, i) => (
          <line
            // eslint-disable-next-line react/no-array-index-key
            key={i}
            x1={line[0]}
            y1={line[1]}
            x2={line[2]}
            y2={line[3]}
            stroke="currentColor"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </g>
      {/* Text — drawn unflipped at the mirrored Y so glyphs read upright. */}
      {page.t.map((entry, i) => {
        const tx = entry.p[0];
        const ty = h - entry.p[1];
        const rotDeg = entry.r !== undefined ? -(entry.r * 180) / Math.PI : 0;
        return (
          <text
            // eslint-disable-next-line react/no-array-index-key
            key={i}
            x={tx}
            y={ty}
            fontSize={entry.z > 0 ? entry.z : 1}
            fill="currentColor"
            transform={rotDeg !== 0 ? `rotate(${rotDeg} ${tx} ${ty})` : undefined}
          >
            {entry.s}
          </text>
        );
      })}
    </svg>
  );
}
