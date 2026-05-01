import { useId, type JSX } from 'react';

type Props = {
  cellSize?: number;
  className?: string;
};

export function BlueprintTexture({ cellSize = 32, className }: Props): JSX.Element {
  const patternId = useId();

  return (
    <svg
      width="100%"
      height="100%"
      className={`pointer-events-none absolute inset-0 opacity-[0.06] dark:opacity-10 ${className ?? ''}`}
      aria-hidden="true"
    >
      <defs>
        <pattern
          id={patternId}
          width={cellSize}
          height={cellSize}
          patternUnits="userSpaceOnUse"
        >
          <path
            d={`M ${cellSize} 0 L 0 0 0 ${cellSize}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="0.6"
            className="text-primary dark:text-white"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
}
