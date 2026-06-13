'use client';

import uPlot from 'uplot';
import { useCallback, useMemo, type JSX } from 'react';

import { UplotChart } from './UplotChart';
import { useChartColors } from './chartTokens';

type Props = {
  categories: string[];
  values: number[];
  height?: number;
  /** Bar fill (concrete color). Defaults to `--primary`. */
  color?: string;
};

/** uPlot vertical bar chart with categorical x labels. Single primary fill by
 * default ("primary-forward"); bars are distinguished by height + label. */
export function BarChartMini({
  categories, values, height = 180, color,
}: Props): JSX.Element {
  const colors = useChartColors();
  const fill = color ?? colors.primary;

  const data = useMemo<uPlot.AlignedData>(
    () => [categories.map((_, i) => i), values],
    [categories, values],
  );

  const makeOptions = useCallback(
    (width: number): uPlot.Options => {
      const barsBuilder = uPlot.paths.bars;
      const barSeries: uPlot.Series = {
        stroke: fill,
        fill,
        width: 0,
        points: { show: false },
      };
      if (barsBuilder !== undefined) {
        barSeries.paths = barsBuilder({ size: [0.62, 56], align: 0, radius: 0.12 });
      }
      return {
        width,
        height,
        legend: { show: false },
        cursor: { show: false },
        scales: {
          x: { time: false, range: (_u, min, max) => [min - 0.6, max + 0.6] },
          y: { range: (_u, _min, max) => [0, Math.max(max, 1) * 1.15] },
        },
        axes: [
          {
            stroke: colors.foregroundTertiary,
            grid: { show: false },
            ticks: { show: false },
            font: '11px ui-sans-serif, system-ui, sans-serif',
            size: 26,
            splits: () => categories.map((_, i) => i),
            values: () => categories,
          },
          {
            stroke: colors.foregroundTertiary,
            grid: { stroke: colors.border, width: 1 },
            ticks: { show: false },
            font: '11px ui-sans-serif, system-ui, sans-serif',
            size: 34,
          },
        ],
        series: [{}, barSeries],
      };
    },
    [colors, fill, height, categories],
  );

  return <UplotChart data={data} makeOptions={makeOptions} height={height} />;
}
