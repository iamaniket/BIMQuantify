'use client';

import type { JSX } from 'react';

import { Eyebrow } from '@bimdossier/ui';

export type DonutSegment = {
  value: number;
  /** Any CSS color — prefer a design token, e.g. `var(--primary)`. */
  color: string;
  label?: string;
};

type Props = {
  segments: DonutSegment[];
  centerValue: string;
  centerLabel?: string;
  centerSub?: string;
  size?: number;
  /** Ring thickness in px. Defaults to ~13% of `size`. */
  thickness?: number;
  /** Gap between segments, in degrees. */
  gap?: number;
};

/** Lightweight SVG donut — no chart lib. Uses `var(--token)` fills so it
 * re-themes automatically. uPlot is Cartesian-only and can't draw this. */
export function DonutChart({
  segments,
  centerValue,
  centerLabel,
  centerSub,
  size = 200,
  thickness,
  gap = 2,
}: Props): JSX.Element {
  const stroke = thickness ?? Math.round(size * 0.13);
  const radius = (size - stroke) / 2 - 1;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;

  const visible = segments.filter((s) => s.value > 0);
  const total = visible.reduce((sum, s) => sum + s.value, 0);
  const useGap = visible.length > 1;

  let startDeg = 0;
  const arcs = visible.map((seg, i) => {
    const segDeg = total > 0 ? (seg.value / total) * 360 : 0;
    const visibleDeg = useGap ? Math.max(segDeg - gap, 0.5) : segDeg;
    const dash = (visibleDeg / 360) * circumference;
    const rotation = -90 + startDeg + (useGap ? gap / 2 : 0);
    startDeg += segDeg;
    return (
      <circle
        key={i}
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={seg.color}
        strokeWidth={stroke}
        strokeDasharray={`${String(dash)} ${String(circumference - dash)}`}
        transform={`rotate(${String(rotation)} ${String(center)} ${String(center)})`}
      />
    );
  });

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${String(size)} ${String(size)}`} aria-hidden>
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--surface-low)"
          strokeWidth={stroke}
        />
        {arcs}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-h4 font-semibold leading-none text-foreground">{centerValue}</span>
        {centerLabel !== undefined && (
          <Eyebrow size="xs" className="mt-1 font-normal text-foreground-tertiary">
            {centerLabel}
          </Eyebrow>
        )}
        {centerSub !== undefined && (
          <span className="mt-0.5 text-caption text-foreground-tertiary">{centerSub}</span>
        )}
      </div>
    </div>
  );
}
