'use client';

import { Progress } from '@bimdossier/ui';
import type { JSX } from 'react';

/* ── Building geometry (viewBox 240 × 180) ─────────────────────────────── */
const FL = 25;
const FR = 140;
const FT = 55;
const FB = 148;
const SDX = 40;
const SDY = -22;
const SKEW_DEG =
  Math.round((Math.atan2(SDY, SDX) * 180) / Math.PI * 10) / 10;

const BW = 15;
const BH = 7;
const BG = 1.3;
const RD = 350;
const CD = 50;

const WINS = [
  { x: 37, y: 66, w: 22, h: 16 },
  { x: 104, y: 66, w: 22, h: 16 },
  { x: 37, y: 108, w: 22, h: 16 },
];
const DOOR_AREA = { x: 100, y: 103, w: 22, h: 45 };
const SIDE_WIN = { x: 8, y: 10, w: 22, h: 16 };

type Area = { x: number; y: number; w: number; h: number };

function hits(bx: number, by: number, a: Area): boolean {
  return (
    bx < a.x + a.w + 1 &&
    bx + BW > a.x - 1 &&
    by < a.y + a.h + 1 &&
    by + BH > a.y - 1
  );
}

/* ── Window sub-component ──────────────────────────────────────────────── */

function WindowEl({
  x,
  y,
  w,
  h,
  d,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  d: number;
}): JSX.Element {
  return (
    <g
      className="animate-window-appear"
      style={{ animationDelay: `${d}ms`, opacity: 0 }}
    >
      {/* Recess shadow */}
      <rect
        x={x - 1.5}
        y={y - 1.5}
        width={w + 3}
        height={h + 3}
        rx={1}
        className="fill-primary-dark"
      />
      {/* Glass */}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={0.5}
        fill="url(#lg-glass)"
      />
      {/* Cross-bars */}
      <line
        x1={x}
        y1={y + h / 2}
        x2={x + w}
        y2={y + h / 2}
        className="stroke-foreground-disabled"
        strokeWidth={1.2}
      />
      <line
        x1={x + w / 2}
        y1={y}
        x2={x + w / 2}
        y2={y + h}
        className="stroke-foreground-disabled"
        strokeWidth={1.2}
      />
      {/* Frame */}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={0.5}
        fill="none"
        className="stroke-border"
        strokeWidth={1.3}
      />
      {/* Sill */}
      <rect
        x={x - 2}
        y={y + h}
        width={w + 4}
        height={2.5}
        rx={0.5}
        className="fill-surface-highest"
      />
      {/* Reflection */}
      <line
        x1={x + 3}
        y1={y + 2}
        x2={x + w / 2 - 2}
        y2={y + h / 2 - 1}
        strokeWidth={0.8}
        className="stroke-primary-foreground"
        opacity={0.3}
      />
    </g>
  );
}

/* ── Main animation ────────────────────────────────────────────────────── */

function HouseBuildAnimation(): JSX.Element {
  const shades = [
    'fill-primary',
    'fill-primary-hover',
    'fill-primary-active',
  ] as const;
  const allSkip: Area[] = [...WINS, DOOR_AREA];

  /* Front bricks */
  const fb: JSX.Element[] = [];
  for (let r = 0; r < 11; r++) {
    const y = FB - (r + 1) * BH - r * BG;
    const off = r % 2 === 1;
    const sx = FL + BG + (off ? (BW + BG) / 2 : 0);
    for (let c = 0; c < (off ? 6 : 7); c++) {
      const x = sx + c * (BW + BG);
      if (x + BW > FR || allSkip.some((a) => hits(x, y, a))) continue;
      fb.push(
        <rect
          key={`f${r}${c}`}
          x={x}
          y={y}
          width={BW}
          height={BH}
          rx={0.6}
          className={`animate-brick-appear ${shades[(r + c) % 3]}`}
          style={{ animationDelay: `${r * RD + c * CD}ms`, opacity: 0 }}
        />,
      );
    }
  }

  /* Side bricks (local coords, skewed by transform) */
  const sb: JSX.Element[] = [];
  const sH = FB - FT;
  for (let r = 0; r < 11; r++) {
    const y = sH - (r + 1) * BH - r * BG;
    const off = r % 2 === 1;
    const sx = BG + (off ? (BW + BG) / 2 : 0);
    for (let c = 0; c < 2; c++) {
      const x = sx + c * (BW + BG);
      if (x + BW > SDX - BG || hits(x, y, SIDE_WIN)) continue;
      sb.push(
        <rect
          key={`s${r}${c}`}
          x={x}
          y={y}
          width={BW}
          height={BH}
          rx={0.6}
          className="animate-brick-appear fill-primary-active"
          style={{
            animationDelay: `${300 + r * RD + c * CD}ms`,
            opacity: 0,
          }}
        />,
      );
    }
  }

  const wd = 6 * RD;
  const rd = 10 * RD;
  const midX = (FL + FR) / 2;
  const peakY = 22;

  return (
    <svg
      viewBox="0 0 240 180"
      className="h-36 w-48"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="lg-glass" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--primary-lighter)" />
          <stop offset="50%" stopColor="var(--primary-light)" />
          <stop offset="100%" stopColor="var(--info-light)" />
        </linearGradient>
        <linearGradient id="lg-roof" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary-dark)" />
          <stop offset="100%" stopColor="var(--primary-active)" />
        </linearGradient>
        <linearGradient id="lg-shadow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--foreground)" stopOpacity="0.08" />
          <stop offset="100%" stopColor="var(--foreground)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* ── Blueprint grid ─────────────────────────────────────────── */}
      <g
        fill="none"
        className="stroke-border"
        strokeWidth={0.3}
        strokeDasharray="3 4"
        opacity={0.35}
      >
        <line x1={8} y1={FB} x2={232} y2={FB} />
        <line x1={FL} y1={172} x2={FL} y2={16} />
        <line x1={FR} y1={172} x2={FR} y2={16} />
      </g>

      {/* ── Ground shadow ──────────────────────────────────────────── */}
      <ellipse
        cx={105}
        cy={FB + 10}
        rx={90}
        ry={10}
        fill="url(#lg-shadow)"
        className="animate-brick-appear"
        style={{ animationDelay: '0ms', opacity: 0 }}
      />

      {/* ── Foundation ─────────────────────────────────────────────── */}
      <g
        className="animate-brick-appear"
        style={{ animationDelay: '50ms', opacity: 0 }}
      >
        <rect
          x={FL - 3}
          y={FB}
          width={FR - FL + 6}
          height={5}
          rx={1}
          className="fill-foreground-disabled"
        />
        <polygon
          points={`${FR + 3},${FB} ${FR + SDX + 3},${FB + SDY} ${FR + SDX + 3},${FB + SDY + 5} ${FR + 3},${FB + 5}`}
          className="fill-foreground-tertiary"
        />
      </g>

      {/* ── Side wall background ───────────────────────────────────── */}
      <polygon
        points={`${FR},${FT} ${FR + SDX},${FT + SDY} ${FR + SDX},${FB + SDY} ${FR},${FB}`}
        className="animate-brick-appear fill-primary-dark"
        style={{ animationDelay: '200ms', opacity: 0 }}
      />

      {/* ── Side wall bricks ───────────────────────────────────────── */}
      <g transform={`translate(${FR}, ${FT}) skewY(${SKEW_DEG})`}>{sb}</g>

      {/* ── Side window ────────────────────────────────────────────── */}
      <g transform={`translate(${FR}, ${FT}) skewY(${SKEW_DEG})`}>
        <g
          className="animate-window-appear"
          style={{ animationDelay: `${wd + 200}ms`, opacity: 0 }}
        >
          <rect
            x={SIDE_WIN.x - 1}
            y={SIDE_WIN.y - 1}
            width={SIDE_WIN.w + 2}
            height={SIDE_WIN.h + 2}
            rx={0.5}
            className="fill-primary-dark"
            opacity={0.7}
          />
          <rect
            x={SIDE_WIN.x}
            y={SIDE_WIN.y}
            width={SIDE_WIN.w}
            height={SIDE_WIN.h}
            rx={0.5}
            fill="url(#lg-glass)"
          />
          <line
            x1={SIDE_WIN.x}
            y1={SIDE_WIN.y + 8}
            x2={SIDE_WIN.x + SIDE_WIN.w}
            y2={SIDE_WIN.y + 8}
            className="stroke-foreground-disabled"
            strokeWidth={1}
          />
          <line
            x1={SIDE_WIN.x + 11}
            y1={SIDE_WIN.y}
            x2={SIDE_WIN.x + 11}
            y2={SIDE_WIN.y + SIDE_WIN.h}
            className="stroke-foreground-disabled"
            strokeWidth={1}
          />
          <rect
            x={SIDE_WIN.x}
            y={SIDE_WIN.y}
            width={SIDE_WIN.w}
            height={SIDE_WIN.h}
            rx={0.5}
            fill="none"
            className="stroke-border"
            strokeWidth={1}
          />
        </g>
      </g>

      {/* ── Front wall bricks ──────────────────────────────────────── */}
      <g>{fb}</g>

      {/* ── Floor band (between stories) ───────────────────────────── */}
      <rect
        x={FL}
        y={95}
        width={FR - FL}
        height={3}
        rx={0.5}
        className="animate-brick-appear fill-foreground-disabled"
        style={{ animationDelay: `${5 * RD}ms`, opacity: 0 }}
      />

      {/* ── Front windows ──────────────────────────────────────────── */}
      <WindowEl x={37} y={66} w={22} h={16} d={wd} />
      <WindowEl x={104} y={66} w={22} h={16} d={wd + 100} />
      <WindowEl x={37} y={108} w={22} h={16} d={wd + 200} />

      {/* ── Door ───────────────────────────────────────────────────── */}
      <g
        className="animate-window-appear"
        style={{ animationDelay: `${wd + 300}ms`, opacity: 0 }}
      >
        <rect
          x={99}
          y={102}
          width={24}
          height={47}
          rx={1}
          className="fill-primary-dark"
        />
        <rect
          x={100}
          y={103}
          width={22}
          height={45}
          rx={1}
          className="fill-primary-active"
        />
        {/* Upper panel */}
        <rect
          x={103}
          y={106}
          width={16}
          height={14}
          rx={1}
          fill="none"
          className="stroke-primary-dark"
          strokeWidth={0.8}
        />
        {/* Lower panel */}
        <rect
          x={103}
          y={124}
          width={16}
          height={18}
          rx={1}
          fill="none"
          className="stroke-primary-dark"
          strokeWidth={0.8}
        />
        {/* Handle */}
        <circle cx={116} cy={128} r={1.5} className="fill-warning" />
        {/* Step */}
        <rect
          x={97}
          y={FB}
          width={28}
          height={3}
          rx={0.5}
          className="fill-surface-highest"
        />
      </g>

      {/* ── Roof ───────────────────────────────────────────────────── */}
      <g
        className="animate-roof-appear"
        style={{ animationDelay: `${rd}ms`, opacity: 0 }}
      >
        {/* Front slope */}
        <polygon
          points={`${FL - 4},${FT} ${midX},${peakY} ${FR + 4},${FT}`}
          fill="url(#lg-roof)"
        />
        {/* Side slope */}
        <polygon
          points={`${FR + 4},${FT} ${midX},${peakY} ${midX + SDX},${peakY + SDY} ${FR + SDX + 4},${FT + SDY}`}
          className="fill-primary-dark"
          opacity={0.85}
        />
        {/* Ridge */}
        <line
          x1={midX}
          y1={peakY}
          x2={midX + SDX}
          y2={peakY + SDY}
          className="stroke-primary-dark"
          strokeWidth={2}
        />
        {/* Eaves */}
        <line
          x1={FL - 4}
          y1={FT}
          x2={FR + 4}
          y2={FT}
          className="stroke-primary-dark"
          strokeWidth={1.5}
        />
        <line
          x1={FR + 4}
          y1={FT}
          x2={FR + SDX + 4}
          y2={FT + SDY}
          className="stroke-primary-dark"
          strokeWidth={1.5}
        />
        {/* Front tile lines */}
        {[0.25, 0.5, 0.75].map((t) => {
          const ly = FT - (FT - peakY) * t;
          const hw = ((FR + 4 - (FL - 4)) / 2) * (1 - t);
          return (
            <line
              key={`t${t}`}
              x1={midX - hw}
              y1={ly}
              x2={midX + hw}
              y2={ly}
              className="stroke-primary-active"
              strokeWidth={0.5}
              opacity={0.5}
            />
          );
        })}
      </g>

      {/* ── Chimney ────────────────────────────────────────────────── */}
      <g
        className="animate-roof-appear"
        style={{ animationDelay: `${rd + 200}ms`, opacity: 0 }}
      >
        <rect
          x={118}
          y={18}
          width={12}
          height={26}
          rx={0.5}
          className="fill-primary"
        />
        <polygon
          points="130,18 136,15 136,41 130,44"
          className="fill-primary-dark"
        />
        <polygon
          points="118,18 124,15 136,15 130,18"
          className="fill-primary-hover"
        />
        {/* Cap */}
        <rect
          x={117}
          y={16.5}
          width={20}
          height={2.5}
          rx={0.5}
          className="fill-foreground-disabled"
        />
      </g>

      {/* ── Smoke ──────────────────────────────────────────────────── */}
      {[
        { cx: 125, cy: 10, r: 2.2, d: 0 },
        { cx: 128, cy: 4, r: 2.8, d: 800 },
        { cx: 124, cy: -2, r: 3.2, d: 1600 },
        { cx: 127, cy: -8, r: 3.5, d: 2400 },
      ].map((s, i) => (
        <circle
          key={`sm${i}`}
          cx={s.cx}
          cy={s.cy}
          r={s.r}
          className="animate-smoke-puff fill-foreground-placeholder"
          style={{ animationDelay: `${s.d}ms`, opacity: 0 }}
        />
      ))}

      {/* ── Dimension markers ──────────────────────────────────────── */}
      <g className="animate-detail-appear" style={{ opacity: 0 }}>
        {/* Width */}
        <line
          x1={FL}
          y1={FB + 14}
          x2={FR}
          y2={FB + 14}
          className="stroke-foreground-placeholder"
          strokeWidth={0.4}
        />
        <line
          x1={FL}
          y1={FB + 11}
          x2={FL}
          y2={FB + 17}
          className="stroke-foreground-placeholder"
          strokeWidth={0.4}
        />
        <line
          x1={FR}
          y1={FB + 11}
          x2={FR}
          y2={FB + 17}
          className="stroke-foreground-placeholder"
          strokeWidth={0.4}
        />
        {/* Height */}
        <line
          x1={FL - 12}
          y1={FT}
          x2={FL - 12}
          y2={FB}
          className="stroke-foreground-placeholder"
          strokeWidth={0.4}
        />
        <line
          x1={FL - 15}
          y1={FT}
          x2={FL - 9}
          y2={FT}
          className="stroke-foreground-placeholder"
          strokeWidth={0.4}
        />
        <line
          x1={FL - 15}
          y1={FB}
          x2={FL - 9}
          y2={FB}
          className="stroke-foreground-placeholder"
          strokeWidth={0.4}
        />
      </g>
    </svg>
  );
}

/* ── Overlay wrapper ───────────────────────────────────────────────────── */

type ModelLoadingOverlayProps = {
  progress: number;
  fading?: boolean;
  /** Status text (host-provided so it's localized). */
  label: string;
  /**
   * No known percentage (model add/remove/unload, where progress isn't
   * reported): hide the progress bar + percent and let the looping house
   * animation carry the indication on its own.
   */
  indeterminate?: boolean;
};

export function ModelLoadingOverlay({
  progress,
  fading = false,
  label,
  indeterminate = false,
}: ModelLoadingOverlayProps): JSX.Element {
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <div
      className={
        fading
          ? 'pointer-events-none absolute inset-0 z-30 flex items-center justify-center transition-opacity duration-700 ease-out opacity-0'
          : 'pointer-events-none absolute inset-0 z-30 flex items-center justify-center animate-viewer-fade-in'
      }
    >
      <div className="flex w-60 flex-col items-center gap-3 rounded-xl bg-surface-main/90 px-5 py-5 shadow-lg backdrop-blur-sm">
        <HouseBuildAnimation />
        <div className="flex w-full flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <span className="text-body3 text-foreground-secondary">
              {label}
            </span>
            {indeterminate ? null : (
              <span className="text-caption tabular-nums text-foreground-tertiary">
                {clamped}%
              </span>
            )}
          </div>
          {indeterminate ? null : <Progress value={clamped} variant="primary" />}
        </div>
      </div>
    </div>
  );
}
