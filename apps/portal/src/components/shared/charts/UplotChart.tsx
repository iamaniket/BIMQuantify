'use client';

import 'uplot/dist/uPlot.min.css';

import uPlot from 'uplot';
import { useEffect, useRef, type JSX } from 'react';

type Props = {
  data: uPlot.AlignedData;
  /**
   * Builds uPlot options for the measured container width. Must return options
   * including `height`. Memoize with `useCallback` keyed on the theme palette
   * so the chart rebuilds (and canvas colors refresh) only when needed.
   */
  makeOptions: (width: number) => uPlot.Options;
  height: number;
  className?: string;
};

/** Thin React wrapper around uPlot: responsive width via ResizeObserver,
 * data pushed without a rebuild, full rebuild when `makeOptions` changes
 * (e.g. on theme switch). Client-only — uPlot touches the canvas. */
export function UplotChart({
  data, makeOptions, height, className,
}: Props): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<uPlot | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return undefined;

    const width = Math.max(1, Math.floor(el.clientWidth));
     
    const chart = new uPlot(makeOptions(width), data, el);
    chartRef.current = chart;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined && entry.contentRect.width > 0) {
        chart.setSize({ width: Math.floor(entry.contentRect.width), height });
      }
    });
    ro.observe(el);

    return () => {
      ro.disconnect();
      chart.destroy();
      chartRef.current = null;
    };
    // `data` is pushed via setData below so updates don't tear down the instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [makeOptions, height]);

  useEffect(() => {
    const chart = chartRef.current;
    if (chart !== null) chart.setData(data);
  }, [data]);

  return <div ref={containerRef} className={className} style={{ width: '100%', height }} />;
}
