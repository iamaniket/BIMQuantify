'use client';

import type { JSX } from 'react';

import { TrendArea } from './TrendArea';

type Props = {
  data: number[];
  width?: number;
  height?: number;
  /** Concrete color (not a `var(...)` string). Defaults to `--primary`. */
  color?: string;
};

/** Compact area sparkline. Thin wrapper over {@link TrendArea} (was recharts;
 * now uPlot). Public API unchanged. */
export function TrendSparkline({
  data, width = 300, height = 42, color,
}: Props): JSX.Element {
  return (
    <div style={{ width }}>
      <TrendArea values={data} height={height} {...(color !== undefined ? { color } : {})} />
    </div>
  );
}
