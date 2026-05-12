import { useId, useMemo, type CSSProperties, type JSX } from 'react';

import { NL_PROVINCE_PATHS } from './data/nl-province-paths.js';
import { NL_VIEWBOX, createNlProjection } from './projection.js';
import type { MapMarker } from './types.js';

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
  /** Disable the pulse animation around each marker. */
  animatePulse?: boolean;
  /** Tone of marker labels — dark for light backgrounds, light for dark. */
  labelTone?: 'dark' | 'light';
  /** Optional aria-label. Defaults to "Netherlands". */
  ariaLabel?: string;
  /** Additional inline style on the wrapping `<svg>`. */
  style?: CSSProperties;
  /** Class name on the wrapping `<svg>`. */
  className?: string;
}

const DEFAULT_ACCENT = '#2c5697';

/**
 * Single-tint Netherlands silhouette (12 provinces) with optional lat/lng
 * markers. Markers project via Mercator so they align with the geometry by
 * construction.
 *
 * The component is presentational: it reads no environment, has no side
 * effects, and works the same on the server and in the browser. Drop it on
 * a login page, a marketing landing, or a dashboard tile.
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
  labelTone = 'dark',
  ariaLabel = 'Netherlands',
  style,
  className,
}: NetherlandsMapProps): JSX.Element {
  const aspect = NL_VIEWBOX.height / NL_VIEWBOX.width;
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

  const reactId = useId();
  const pulseId = `nl-pulse-${reactId.replace(/:/g, '')}`;

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
        <g aria-hidden={false}>
          {markers.map((m, i) => {
            const [x, y] = project(m.lat, m.lng);
            const accent = m.accent ?? DEFAULT_ACCENT;
            return (
              <g key={`${m.lat}-${m.lng}-${i}`} transform={`translate(${x}, ${y})`}>
                {animatePulse ? (
                  <circle r={14} fill={accent} opacity={0.18}>
                    <animate
                      attributeName="r"
                      values="14;26;14"
                      dur="3.2s"
                      begin={`${i * 0.35}s`}
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="opacity"
                      values="0.28;0;0.28"
                      dur="3.2s"
                      begin={`${i * 0.35}s`}
                      repeatCount="indefinite"
                    />
                  </circle>
                ) : null}
                <circle r={7} fill="#fff" stroke={accent} strokeWidth={2.2} />
                <circle r={3} fill={accent} />
                {m.label ? (
                  <text
                    x={11}
                    y={3.5}
                    fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                    fontSize={10}
                    fontWeight={600}
                    fill={labelTone === 'dark' ? '#1f2937' : '#ffffff'}
                  >
                    {m.label}
                    {typeof m.count === 'number' ? ` · ${m.count}` : ''}
                  </text>
                ) : null}
                {m.label === undefined && typeof m.count === 'number' ? (
                  <g transform="translate(10, -10)">
                    <rect
                      x={-2}
                      y={-9}
                      rx={9}
                      ry={9}
                      width={Math.max(20, 12 + String(m.count).length * 5)}
                      height={18}
                      fill={accent}
                    />
                    <text
                      x={8}
                      y={4}
                      textAnchor="middle"
                      fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                      fontSize={11}
                      fontWeight={700}
                      fill="#fff"
                    >
                      {m.count}
                    </text>
                  </g>
                ) : null}
              </g>
            );
          })}
          {/* Reserve the id so styling tooling can find it; not currently used. */}
          <desc id={pulseId}>Project markers</desc>
        </g>
      ) : null}
    </svg>
  );
}
