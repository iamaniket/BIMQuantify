import { useId, type CSSProperties, type JSX } from 'react';

export interface HeroGridProps {
  /** 0..1 — overall transparency of the grid lines. Defaults to 0.10. */
  opacity?: number;
  /** Line colour. Defaults to white (works on coloured/dark panels). */
  stroke?: string;
  /** Spacing in pixels between lines. Defaults to 32. */
  step?: number;
  /** Inline overrides — e.g. `inset` to position absolutely. */
  style?: CSSProperties;
  className?: string;
}

/**
 * Repeating square grid used as a decorative overlay on brand panels. Pure
 * SVG; no images, no DOM cost. Drop it as an absolutely-positioned sibling
 * inside a `position: relative` container.
 */
export function HeroGrid({
  opacity = 0.1,
  stroke = '#ffffff',
  step = 32,
  style,
  className,
}: HeroGridProps): JSX.Element {
  const id = useId().replace(/:/g, '');
  const patternId = `hero-grid-${id}`;
  return (
    <svg
      aria-hidden
      width="100%"
      height="100%"
      className={className}
      style={{ position: 'absolute', inset: 0, opacity, pointerEvents: 'none', ...style }}
    >
      <defs>
        <pattern id={patternId} width={step} height={step} patternUnits="userSpaceOnUse">
          <path
            d={`M ${step} 0 L 0 0 0 ${step}`}
            fill="none"
            stroke={stroke}
            strokeWidth={0.7}
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
}
