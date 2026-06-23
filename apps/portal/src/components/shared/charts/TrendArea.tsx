'use client';

import uPlot from 'uplot';
import { createPortal } from 'react-dom';
import {
  useCallback, useMemo, useState, type JSX, type ReactNode,
} from 'react';

import { UplotChart } from './UplotChart';
import { readToken, useChartColors, withAlpha } from './chartTokens';

type CursorState = { idx: number; left: number; top: number };

type Props = {
  /** Y values, one per point. */
  values: number[];
  /** Optional x-axis tick labels, one per point. When omitted, axes are hidden
   * (sparkline mode). */
  labels?: string[];
  height?: number;
  /** Override the line/fill color (concrete color). Defaults to `--primary`. */
  color?: string;
  /** When provided, the chart becomes interactive: visible point markers + a
   * cursor focus point, and this renders the floating hover card for the
   * hovered point index. Omit to keep the static, non-interactive trend. */
  tooltip?: (index: number) => ReactNode;
  /** Paint the trailing point as a hollow ring (an in-progress / partial
   * bucket) so it reads as distinct from the completed points. */
  partialLastPoint?: boolean;
};

const AXIS_FONT = '11px ui-sans-serif, system-ui, sans-serif';

/** Repaint the last marker as a hollow ring (fill = chart background, stroke =
 * line) so a partial/in-progress bucket is visually distinct. Runs after the
 * series so it masks the filled dot underneath. Canvas pixels throughout. */
function hollowLastPointPlugin(stroke: string, fill: string): uPlot.Plugin {
  return {
    hooks: {
      draw: (u: uPlot) => {
        const xs = u.data[0];
        const ys = u.data[1];
        if (xs === undefined || ys === undefined) return;
        const i = xs.length - 1;
        const xVal = xs[i];
        const yVal = ys[i];
        if (xVal === undefined || yVal === undefined || yVal === null) return;

        const pxr = uPlot.pxRatio;
        const cx = u.valToPos(xVal, 'x', true);
        const cy = u.valToPos(yVal, 'y', true);
        const { ctx } = u;
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, 4 * pxr, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.lineWidth = 2 * pxr;
        ctx.strokeStyle = stroke;
        ctx.stroke();
        ctx.restore();
      },
    },
  };
}

/** uPlot area/line trend. Compact sparkline when `labels` is omitted, full
 * chart with axes when provided. Primary-tinted gradient fill by default.
 * Pass `tooltip` to opt into hover interactivity (markers + floating card). */
export function TrendArea({
  values, labels, height = 160, color, tooltip, partialLastPoint,
}: Props): JSX.Element {
  const colors = useChartColors();
  const line = color ?? colors.primary;
  const interactive = tooltip !== undefined;

  // `setCursor` is a stable useState setter, so referencing it from the plugin
  // keeps `makeOptions` identity stable across hovers — UplotChart only rebuilds
  // the chart when `makeOptions` changes, never on mouse move.
  const [cursor, setCursor] = useState<CursorState | null>(null);

  const data = useMemo<uPlot.AlignedData>(
    () => [values.map((_, i) => i), values],
    [values],
  );

  const makeOptions = useCallback(
    (width: number): uPlot.Options => {
      // Inline narrowing: in the non-undefined branch `labels` is `string[]`.
      const axes: uPlot.Axis[] = labels === undefined
        ? [{ show: false }, { show: false }]
        : [
          {
            stroke: colors.foregroundTertiary,
            grid: { show: false },
            ticks: { show: false },
            font: AXIS_FONT,
            size: 26,
            splits: () => values.map((_, i) => i),
            values: () => labels,
          },
          {
            stroke: colors.foregroundTertiary,
            grid: { stroke: colors.border, width: 1 },
            ticks: { show: false },
            font: AXIS_FONT,
            size: 34,
          },
        ];

      const plugins: uPlot.Plugin[] = [];
      if (interactive) {
        plugins.push({
          hooks: {
            setCursor: (u: uPlot) => {
              const { idx } = u.cursor;
              const cl = u.cursor.left;
              if (idx === undefined || idx === null || cl === undefined || cl < 0) {
                setCursor(null);
                return;
              }
              const ycol = u.data[1];
              const yVal = ycol === undefined ? undefined : ycol[idx];
              if (yVal === undefined || yVal === null) {
                setCursor(null);
                return;
              }
              // Over-relative CSS px + the plot area's viewport offset → viewport
              // coords, so the portal tooltip (position: fixed) escapes the
              // card's `overflow-hidden` clipping.
              const rect = u.over.getBoundingClientRect();
              setCursor({
                idx,
                left: rect.left + u.valToPos(idx, 'x'),
                top: rect.top + u.valToPos(yVal, 'y'),
              });
            },
          },
        });
      }
      if (partialLastPoint) {
        plugins.push(hollowLastPointPlugin(line, readToken('--background')));
      }

      return {
        width,
        height,
        legend: { show: false },
        cursor: interactive
          ? {
            show: true, x: false, y: false, points: { size: 8, width: 2 },
          }
          : { show: false },
        scales: {
          x: { time: false },
          y: { range: (_u, _min, max) => [0, Math.max(max, 1) * 1.15] },
        },
        axes,
        series: [
          {},
          {
            stroke: line,
            width: 1.75,
            points: interactive
              ? {
                show: true, size: 5, stroke: line, fill: line,
              }
              : { show: false },
            fill: (u: uPlot) => {
              const { ctx } = u;
              const { top, height: h } = u.bbox;
              const grad = ctx.createLinearGradient(0, top, 0, top + h);
              grad.addColorStop(0, withAlpha(line, 0.24));
              grad.addColorStop(1, withAlpha(line, 0.02));
              return grad;
            },
          },
        ],
        plugins,
      };
    },
    [colors, line, height, labels, values, interactive, partialLastPoint, setCursor],
  );

  return (
    <>
      <UplotChart data={data} makeOptions={makeOptions} height={height} />
      {interactive && cursor !== null && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="pointer-events-none fixed z-50 -mt-3 -translate-x-1/2 -translate-y-full"
              style={{ left: cursor.left, top: cursor.top }}
            >
              {tooltip(cursor.idx)}
            </div>,
            document.body,
        )
        : null}
    </>
  );
}
