'use client';

import { useEffect, useMemo, useState, type CSSProperties, type JSX } from 'react';

import { NL_PROVINCE_PATHS } from './data/nl-province-paths.js';
import {
  NL_ASPECT_RATIO,
  NL_DEFAULT_ACCENT,
  NL_VIEWBOX,
  createNlProjection,
} from './projection.js';
import type { MapMarker } from '../types.js';

export interface NetherlandsMapProps {
  /**
   * Width of the rendered SVG in pixels. Either `width` or `height` must be
   * provided; the other dimension is computed from the geometry's native
   * aspect ratio (≈ 1.181 × width).
   */
  width?: number;
  /**
   * Height of the rendered SVG in pixels. Provide this instead of `width`
   * when you want to scale the map to fit a fixed vertical region (e.g.
   * "70% of the viewport height"). Width is computed to preserve aspect.
   */
  height?: number;
  /**
   * Pass any CSS value (e.g. `'70vh'` or `'min(70vh, 700px)'`) to make the
   * map respond to the viewport directly. Overrides `width`/`height`. The
   * SVG fills its container; aspect ratio is preserved via `viewBox`.
   */
  responsiveHeight?: string;
  /** Fill applied to the province silhouettes. Defaults to `currentColor`. */
  fill?: string;
  /** Optional stroke between provinces (the "seams"). */
  seamStroke?: string;
  /** Width of the seam stroke (only used when `seamStroke` is set). */
  seamStrokeWidth?: number;
  /** Markers to overlay on the country. Empty/undefined → no markers. */
  markers?: readonly MapMarker[];
  /**
   * Whether the hovered marker shows a radial pulse animation. Defaults to
   * `true`. Set to `false` to honor reduced-motion preferences or to keep
   * the map purely static.
   */
  animatePulse?: boolean;
  /** Optional aria-label. Defaults to "Netherlands". */
  ariaLabel?: string;
  /** Additional inline style on the wrapping `<svg>`. */
  style?: CSSProperties;
  /** Class name on the wrapping `<svg>`. */
  className?: string;
}

const DEFAULT_ACCENT = NL_DEFAULT_ACCENT;

/**
 * SSR-safe `prefers-reduced-motion: reduce` detection. Starts `false` so the
 * server and first client render agree, then resolves on mount and tracks
 * changes. Mirrors the app-level `useReducedMotion` hook, inlined here so the
 * package carries no dependency.
 */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent): void => setReduced(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * Single-tint Netherlands silhouette (12 provinces) with optional lat/lng
 * markers. Markers project via Mercator so they align with the geometry by
 * construction.
 *
 * Markers render as small static dots by default. Hovering one reveals a
 * pill labelled with `marker.label` plus an optional pulse halo; the pill
 * is rendered in a second pass so it always paints on top of neighboring
 * markers (e.g. Den Haag's label is not clipped by Rotterdam's dot).
 *
 * Client component; renders identically given the same props (hover state is
 * local React state, no environment reads). The markers are decorative — they
 * are not exposed to assistive tech (the whole SVG is one `role="img"`), and
 * hover is desktop-pointer-only, so any data a marker encodes (city, count)
 * must also be surfaced as adjacent text by the consumer. The hover pulse is
 * automatically suppressed under `prefers-reduced-motion`.
 */
export function NetherlandsMap({
  width,
  height,
  responsiveHeight,
  fill = 'currentColor',
  seamStroke,
  seamStrokeWidth = 0.6,
  markers,
  animatePulse = true,
  ariaLabel = 'Netherlands',
  style,
  className,
}: NetherlandsMapProps): JSX.Element {
  const aspect = 1 / NL_ASPECT_RATIO;
  // Resolve the rendered size based on whichever dimension was given. Falls
  // back to a sensible default if no sizing prop is provided.
  const useResponsive = responsiveHeight !== undefined;
  const resolvedWidth = useResponsive
    ? undefined
    : width ?? (height !== undefined ? height / aspect : 320);
  const resolvedHeight = useResponsive
    ? undefined
    : height ?? (resolvedWidth !== undefined ? resolvedWidth * aspect : 380);

  const project = useMemo(
    () => createNlProjection(NL_VIEWBOX.width, NL_VIEWBOX.height),
    [],
  );

  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Honor the OS reduced-motion preference regardless of `animatePulse`: the
  // pulse is decorative reinforcement, so a user who asked for less motion
  // never sees it even if the consumer left the prop on.
  const reducedMotion = usePrefersReducedMotion();
  const animate = animatePulse && !reducedMotion;

  // When `responsiveHeight` is in play, the SVG fills its container vertically
  // and computes its width from the viewBox aspect — perfect for vh-based
  // sizing without JS resize listeners.
  const responsiveStyle: CSSProperties | undefined = useResponsive
    ? { height: responsiveHeight, width: 'auto', maxWidth: '100%' }
    : undefined;

  return (
    <svg
      width={resolvedWidth}
      height={resolvedHeight}
      viewBox={`0 0 ${NL_VIEWBOX.width} ${NL_VIEWBOX.height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={ariaLabel}
      className={className}
      style={{ ...responsiveStyle, ...style }}
    >
      <g>
        {NL_PROVINCE_PATHS.map((d, i) => (
          <path
            key={i}
            d={d}
            fill={fill}
            stroke={seamStroke ?? 'none'}
            strokeWidth={seamStroke ? seamStrokeWidth : 0}
            strokeLinejoin="round"
          />
        ))}
      </g>

      {markers && markers.length > 0 ? (
        <g>
          {markers.map((m, i) => {
            const [x, y] = project(m.lat, m.lng);
            const accent = m.accent ?? DEFAULT_ACCENT;
            const isHovered = hoveredIndex === i;
            return (
              <g
                key={`${m.lat}-${m.lng}-${i}`}
                transform={`translate(${x}, ${y})`}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex((prev) => (prev === i ? null : prev))}
                style={{ cursor: m.label ? 'pointer' : 'default' }}
              >
                {animate && isHovered ? (
                  <circle r={14} fill={accent} opacity={0.18}>
                    <animate
                      attributeName="r"
                      values="14;26;14"
                      dur="1.6s"
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="opacity"
                      values="0.32;0;0.32"
                      dur="1.6s"
                      repeatCount="indefinite"
                    />
                  </circle>
                ) : null}
                {/*
                  Transparent hit circle, larger than the visible dot, to give
                  the desktop-pointer hover a forgiving target. Its r is in
                  viewBox units (so it scales with the map); the map renders
                  pointer-only (hidden below `lg` in every consumer), so this is
                  a mouse affordance, not a touch target. The dot + bullseye sit
                  on top with pointer-events disabled so they never swallow it.
                */}
                <circle r={14} fill="transparent" pointerEvents="all" />
                <circle r={7} fill="#fff" stroke={accent} strokeWidth={2.2} pointerEvents="none" />
                <circle r={3} fill={accent} pointerEvents="none" />
              </g>
            );
          })}
          {/*
            Hover label rendered in a second pass after all marker dots so
            it always paints above neighboring markers (otherwise an earlier
            marker's pill would be clipped by a later marker drawn on top).
          */}
          {(() => {
            if (hoveredIndex === null) return null;
            const m = markers[hoveredIndex];
            if (!m || !m.label) return null;
            const [hx, hy] = project(m.lat, m.lng);
            const accent = m.accent ?? DEFAULT_ACCENT;
            // Pill width is a heuristic (assumes the monospace stack resolves
            // and ~6px advance per glyph at 9.5px); fine for short city labels.
            const pw = 10 + m.label.length * 6;
            return (
              <g
                transform={`translate(${hx}, ${hy})`}
                style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.35))' }}
                pointerEvents="none"
              >
                <rect
                  x={11}
                  y={-7}
                  rx={3}
                  ry={3}
                  width={pw}
                  height={14}
                  fill={accent}
                  stroke="#ffffff"
                  strokeWidth={1.2}
                />
                <text
                  x={11 + pw / 2}
                  y={3}
                  textAnchor="middle"
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  fontSize={9.5}
                  fontWeight={600}
                  fill="#ffffff"
                >
                  {m.label}
                </text>
              </g>
            );
          })()}
        </g>
      ) : null}
    </svg>
  );
}
