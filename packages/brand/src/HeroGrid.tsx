import { useId, type CSSProperties, type JSX } from 'react';

export interface HeroGridProps {
  opacity?: number;
  stroke?: string;
  step?: number;
  style?: CSSProperties;
  className?: string;
}

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
