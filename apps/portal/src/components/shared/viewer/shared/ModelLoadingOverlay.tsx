'use client';

import { Progress } from '@bimstitch/ui';
import type { JSX } from 'react';

const ROWS = [
  { y: 110, cols: 5, offset: 0 },
  { y: 96, cols: 4, offset: 14 },
  { y: 82, cols: 5, offset: 0 },
  { y: 68, cols: 4, offset: 14 },
  { y: 54, cols: 5, offset: 0 },
  { y: 40, cols: 4, offset: 14 },
];

const BRICK_W = 26;
const BRICK_H = 12;
const GAP = 2;
const WALL_X = 30;
const ROW_DELAY = 600;
const COL_DELAY = 80;

function HouseBuildAnimation(): JSX.Element {
  const bricks: JSX.Element[] = [];

  for (let r = 0; r < ROWS.length; r++) {
    const row = ROWS[r]!;
    for (let c = 0; c < row.cols; c++) {
      const x = WALL_X + row.offset + c * (BRICK_W + GAP);
      const delay = r * ROW_DELAY + c * COL_DELAY;
      bricks.push(
        <rect
          key={`b-${r}-${c}`}
          x={x}
          y={row.y}
          width={BRICK_W}
          height={BRICK_H}
          rx={1}
          className="animate-brick-appear fill-primary"
          style={{ animationDelay: `${delay}ms`, opacity: 0 }}
        />,
      );
    }
  }

  const roofDelay = ROWS.length * ROW_DELAY;

  return (
    <svg
      viewBox="0 0 200 160"
      className="h-36 w-44"
      role="img"
      aria-label="Loading animation"
    >
      {/* Blueprint layer — dashed outlines always visible */}
      <g
        fill="none"
        className="stroke-foreground-tertiary"
        strokeWidth={1.2}
        strokeDasharray="4 3"
      >
        {/* Foundation */}
        <line x1={24} y1={126} x2={176} y2={126} />
        {/* Walls */}
        <line x1={28} y1={126} x2={28} y2={36} />
        <line x1={172} y1={126} x2={172} y2={36} />
        {/* Roof */}
        <polyline points="20,36 100,4 180,36" />
        {/* Door */}
        <rect x={82} y={96} width={24} height={30} rx={2} />
        {/* Window left */}
        <rect x={42} y={62} width={20} height={18} rx={1} />
        <line x1={52} y1={62} x2={52} y2={80} />
        <line x1={42} y1={71} x2={62} y2={71} />
        {/* Window right */}
        <rect x={138} y={62} width={20} height={18} rx={1} />
        <line x1={148} y1={62} x2={148} y2={80} />
        <line x1={138} y1={71} x2={158} y2={71} />
      </g>

      {/* Brick fill layer — animated row-by-row */}
      <g>{bricks}</g>

      {/* Roof fill */}
      <polygon
        points="24,36 100,6 176,36"
        className="animate-roof-appear fill-primary-dark"
        style={{ animationDelay: `${roofDelay}ms`, opacity: 0 }}
      />

      {/* Chimney */}
      <rect
        x={136}
        y={10}
        width={12}
        height={20}
        rx={1}
        className="animate-roof-appear fill-primary-dark"
        style={{ animationDelay: `${roofDelay + 200}ms`, opacity: 0 }}
      />
    </svg>
  );
}

type ModelLoadingOverlayProps = {
  progress: number;
  fading?: boolean;
};

export function ModelLoadingOverlay({ progress, fading = false }: ModelLoadingOverlayProps): JSX.Element {
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <div
      className={
        fading
          ? 'pointer-events-none absolute inset-0 z-30 flex items-center justify-center transition-opacity duration-700 ease-out opacity-0'
          : 'pointer-events-none absolute inset-0 z-30 flex items-center justify-center animate-viewer-fade-in'
      }
    >
      <div className="flex w-56 flex-col items-center gap-3 rounded-xl bg-surface-main/90 px-5 py-5 shadow-lg backdrop-blur-sm">
        <HouseBuildAnimation />
        <div className="flex w-full flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-body3 text-foreground-secondary">
              Loading model…
            </span>
            <span className="text-caption tabular-nums text-foreground-tertiary">
              {clamped}%
            </span>
          </div>
          <Progress value={clamped} variant="primary" />
        </div>
      </div>
    </div>
  );
}
