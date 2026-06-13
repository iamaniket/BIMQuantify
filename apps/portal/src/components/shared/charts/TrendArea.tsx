'use client';

import uPlot from 'uplot';
import { useCallback, useMemo, type JSX } from 'react';

import { UplotChart } from './UplotChart';
import { useChartColors, withAlpha } from './chartTokens';

type Props = {
  /** Y values, one per point. */
  values: number[];
  /** Optional x-axis tick labels, one per point. When omitted, axes are hidden
   * (sparkline mode). */
  labels?: string[];
  height?: number;
  /** Override the line/fill color (concrete color). Defaults to `--primary`. */
  color?: string;
};

const AXIS_FONT = '11px ui-sans-serif, system-ui, sans-serif';

/** uPlot area/line trend. Compact sparkline when `labels` is omitted, full
 * chart with axes when provided. Primary-tinted gradient fill by default. */
export function TrendArea({
  values, labels, height = 160, color,
}: Props): JSX.Element {
  const colors = useChartColors();
  const line = color ?? colors.primary;

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

      return {
        width,
        height,
        legend: { show: false },
        cursor: { show: false },
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
            points: { show: false },
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
      };
    },
    [colors, line, height, labels, values],
  );

  return <UplotChart data={data} makeOptions={makeOptions} height={height} />;
}
