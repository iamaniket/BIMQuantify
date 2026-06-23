'use client';

import { useEffect, useState, type JSX, type KeyboardEvent } from 'react';

export type RingDescriptor = {
  /** Stable identity, e.g. 'findings'. */
  key: string;
  /** Localized label (used for the aria-label). */
  label: string;
  /** Filled count. */
  value: number;
  /** Denominator (may be 0 — caller precomputes `pct`). */
  total: number;
  /** 0..100, precomputed by the caller so the SVG never divides. */
  pct: number;
  /** Any CSS color — prefer a token, e.g. `var(--success)`. */
  color: string;
  /** Unfilled track color. Defaults to `var(--surface-low)`. */
  trackColor?: string;
};

type Props = {
  /** Index 0 is the OUTERMOST ring. */
  rings: RingDescriptor[];
  /** Internal viewBox resolution (the SVG scales to fill its container width via
   * CSS). Geometry/stroke ratios derive from this; display size is controlled by
   * the parent's width. */
  size?: number;
  /** Per-ring stroke width (in viewBox units). Defaults to a value derived from
   * size & ring count. */
  thickness?: number;
  /** Radial gap between rings (viewBox units). */
  gap?: number;
  activeKey?: string | null;
  onRingClick?: (key: string) => void;
  onRingHover?: (key: string | null) => void;
  centerValue?: string;
  centerLabel?: string;
  reducedMotion?: boolean;
  /** Wraps each ring's transparent hit element so the panel can attach a
   * tooltip without this primitive importing Radix. */
  renderRingHit?: (ring: RingDescriptor, hit: JSX.Element) => JSX.Element;
  ariaLabelFor?: (ring: RingDescriptor) => string;
};

const clampPct = (pct: number): number => Math.max(0, Math.min(100, pct));

/**
 * Concentric progress rings — an N-ring generalization of {@link DonutChart}.
 * Each ring is a single filled fraction (colored arc over a gray track),
 * starting at 12 o'clock and filling clockwise. Pure SVG with `var(--token)`
 * strokes (re-themes for free) — no chart lib, no Radix, no token resolution.
 */
export function ConcentricRings({
  rings,
  size = 200,
  thickness,
  gap,
  activeKey = null,
  onRingClick,
  onRingHover,
  centerValue,
  centerLabel,
  reducedMotion = false,
  renderRingHit,
  ariaLabelFor,
}: Props): JSX.Element {
  // Draw-on: start every arc empty, then flip to the real offset after the first
  // paint (a layout effect after commit) so the fill transitions in. Reduced
  // motion starts already-mounted (instant, no transition).
  const [mounted, setMounted] = useState(reducedMotion);
  useEffect(() => {
    setMounted(true);
  }, []);

  const count = Math.max(rings.length, 1);
  // Derive a thickness that fits `count` rings with gaps inside the radius.
  const stroke = thickness ?? Math.max(6, Math.round((size * 0.42) / (count * 1.6)));
  const ringGap = gap ?? Math.round(stroke * 0.55);
  const center = size / 2;
  const rOuter = (size - stroke) / 2 - 1;

  return (
    <div className="relative aspect-square w-full">
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${String(size)} ${String(size)}`}
      >
        {rings.map((ring, i) => {
          const r = rOuter - i * (stroke + ringGap);
          if (r <= stroke / 2) return null; // no room for this ring
          return (
            <circle
              key={`track-${ring.key}`}
              cx={center}
              cy={center}
              r={r}
              fill="none"
              stroke={ring.trackColor ?? 'var(--surface-low)'}
              strokeWidth={stroke}
              aria-hidden
              style={{ pointerEvents: 'none' }}
            />
          );
        })}

        {/* Filled arcs (drawn above all tracks). */}
        {rings.map((ring, i) => {
          const r = rOuter - i * (stroke + ringGap);
          if (r <= stroke / 2) return null;
          const circumference = 2 * Math.PI * r;
          const pct = clampPct(ring.pct);
          if (pct <= 0) return null; // skip — a round cap would leave a stray dot
          const offset = mounted ? circumference * (1 - pct / 100) : circumference;
          const isActive = activeKey === ring.key;

          return (
            <circle
              key={`arc-${ring.key}`}
              cx={center}
              cy={center}
              r={r}
              fill="none"
              stroke={ring.color}
              strokeWidth={isActive ? stroke + 2 : stroke}
              strokeLinecap="round"
              strokeDasharray={`${String(circumference)} ${String(circumference)}`}
              transform={`rotate(-90 ${String(center)} ${String(center)})`}
              aria-hidden
              style={{
                strokeDashoffset: offset,
                pointerEvents: 'none',
                transition: reducedMotion
                  ? 'none'
                  : 'stroke-dashoffset 700ms ease-out, stroke-width 150ms ease-out',
                transitionDelay: reducedMotion ? '0ms' : `${String(i * 80)}ms`,
              }}
            />
          );
        })}

        {/* Transparent hit bands (drawn last → on top, capture pointer/keys). */}
        {rings.map((ring, i) => {
          const r = rOuter - i * (stroke + ringGap);
          if (r <= stroke / 2) return null;
          const onActivate = (): void => onRingClick?.(ring.key);
          const onKeyDown = (e: KeyboardEvent<SVGCircleElement>): void => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onActivate();
            }
          };
          const hit = (
            <circle
              key={`hit-${ring.key}`}
              cx={center}
              cy={center}
              r={r}
              fill="none"
              stroke="transparent"
              strokeWidth={stroke + ringGap}
              role="button"
              tabIndex={0}
              aria-label={ariaLabelFor?.(ring) ?? `${ring.label}: ${String(ring.value)}/${String(ring.total)}`}
              onClick={onActivate}
              onKeyDown={onKeyDown}
              onPointerEnter={() => onRingHover?.(ring.key)}
              onPointerLeave={() => onRingHover?.(null)}
              className="cursor-pointer outline-none [stroke-linecap:butt] focus-visible:stroke-[var(--ring)]"
              style={{ pointerEvents: 'stroke' }}
            />
          );
          return renderRingHit ? renderRingHit(ring, hit) : hit;
        })}
      </svg>

      {(centerValue !== undefined || centerLabel !== undefined) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {centerValue !== undefined && (
            <span className="text-h3 font-semibold leading-none text-foreground tabular-nums">
              {centerValue}
            </span>
          )}
          {centerLabel !== undefined && (
            <span className="mt-1 text-body3 text-foreground-tertiary">{centerLabel}</span>
          )}
        </div>
      )}
    </div>
  );
}
