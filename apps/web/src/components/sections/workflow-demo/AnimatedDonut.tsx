'use client';

// Adapted from apps/portal/src/components/shared/charts/DonutChart.tsx (the
// portal source is untouched). Web-side additions: a `drawn` reveal gate that
// sweeps the arcs in once (rAF, ease-out cubic, sequential across segments),
// CSS dash transitions for live data updates after the sweep, and
// reduced-motion suppression (final arcs render instantly).

import { Eyebrow } from '@bimdossier/ui';
import { useEffect, useState, type JSX } from 'react';

import { useReducedMotion } from '@/hooks/useReducedMotion';

export type DonutSegment = {
  value: number;
  /** Any CSS color — prefer a design token, e.g. `var(--success)`. */
  color: string;
};

type Props = {
  segments: DonutSegment[];
  centerValue: string;
  centerLabel?: string;
  size?: number;
  /** Ring thickness in px. Defaults to ~13% of `size`. */
  thickness?: number;
  /** Gap between segments, in degrees. */
  gap?: number;
  /** Reveal gate — `false` renders zero arcs; flipping true sweeps them in. */
  drawn: boolean;
  /** Intro sweep length / start delay in ms (reveal choreography). */
  sweepDuration?: number;
  sweepDelay?: number;
};

/** Lightweight SVG donut — no chart lib. Uses `var(--token)` fills so it
 * re-themes automatically. Arcs are positioned via `stroke-dashoffset` (not a
 * per-segment rotation) so post-sweep value changes animate smoothly with a
 * plain CSS transition. */
export function AnimatedDonut({
  segments,
  centerValue,
  centerLabel,
  size = 168,
  thickness,
  gap = 2,
  drawn,
  sweepDuration = 1000,
  sweepDelay = 200,
}: Props): JSX.Element {
  const reducedMotion = useReducedMotion();
  // Sweep progress 0..1. Starts at 1 so SSR/no-JS HTML carries the finished
  // chart; the zero state appears only after mount, pre-reveal (the same
  // hidden-until-reveal convention as Reveal.tsx / useCountUp).
  const [progress, setProgress] = useState(1);
  // True once the intro sweep has landed — from then on the arcs move via the
  // CSS dash transitions below (no rAF needed for live data updates).
  const [swept, setSwept] = useState(false);

  useEffect(() => {
    if (swept) return undefined;
    if (reducedMotion) {
      setProgress(1);
      setSwept(true);
      return undefined;
    }
    if (!drawn) {
      setProgress(0);
      return undefined;
    }
    setProgress(0);
    let raf = 0;
    let start: number | null = null;
    const tick = (now: number): void => {
      if (start === null) start = now;
      const t = Math.min((now - start) / sweepDuration, 1);
      setProgress(1 - (1 - t) ** 3);
      if (t < 1) raf = requestAnimationFrame(tick);
      else setSwept(true);
    };
    const timer = setTimeout(() => {
      raf = requestAnimationFrame(tick);
    }, sweepDelay);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [drawn, reducedMotion, swept, sweepDelay, sweepDuration]);

  const stroke = thickness ?? Math.round(size * 0.13);
  const radius = (size - stroke) / 2 - 1;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;

  const total = segments.reduce((sum, s) => sum + Math.max(s.value, 0), 0);
  const activeCount = segments.filter((s) => s.value > 0).length;
  const useGap = activeCount > 1;
  const progressDeg = progress * 360;

  let startDeg = 0;
  // Every segment renders (zero-value ones at dash 0) so a value passing
  // through zero transitions its arc instead of unmounting it.
  const arcs = segments.map((seg, i) => {
    const segDeg = total > 0 ? (Math.max(seg.value, 0) / total) * 360 : 0;
    const fullDeg = segDeg <= 0 ? 0 : useGap ? Math.max(segDeg - gap, 0.5) : segDeg;
    // Sequential sweep: a segment only draws once the frontier reaches it.
    const drawnDeg = Math.min(fullDeg, Math.max(progressDeg - startDeg, 0));
    const dash = (drawnDeg / 360) * circumference;
    const offsetDeg = startDeg + (useGap ? gap / 2 : 0);
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
        strokeDashoffset={-((offsetDeg / 360) * circumference)}
        transform={`rotate(-90 ${String(center)} ${String(center)})`}
        style={
          swept && !reducedMotion
            ? { transition: 'stroke-dasharray 400ms ease, stroke-dashoffset 400ms ease' }
            : undefined
        }
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
        <span className="text-h4 font-semibold leading-none tabular-nums text-foreground">
          {centerValue}
        </span>
        {centerLabel !== undefined && (
          <Eyebrow size="xs" className="mt-1 font-normal text-foreground-tertiary">
            {centerLabel}
          </Eyebrow>
        )}
      </div>
    </div>
  );
}
