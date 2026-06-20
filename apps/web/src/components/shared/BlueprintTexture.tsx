import { useId, type JSX } from 'react';

type Props = {
  cellSize?: number;
  className?: string;
  toneClassName?: string;
};

/**
 * Blueprint grid texture — a token-faithful port of the portal's
 * `BlueprintTexture`. Uses `currentColor` + a Tailwind tone class so the line
 * color comes from the design tokens and adapts to light/dark automatically
 * (never a raw hex). Opacity is left to the caller via `className`
 * (e.g. `opacity-[0.06]`) so the same primitive works as a card wash or a
 * placeholder backdrop. Absolutely positioned — the parent needs
 * `relative overflow-hidden`.
 */
export function BlueprintTexture({
  cellSize = 32,
  className,
  toneClassName = 'text-primary',
}: Props): JSX.Element {
  const patternId = useId();

  return (
    <svg
      width="100%"
      height="100%"
      className={`pointer-events-none absolute inset-0 ${className ?? ''}`}
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
            className={toneClassName}
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
}
