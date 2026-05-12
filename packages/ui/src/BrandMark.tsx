import type { CSSProperties, JSX } from 'react';

import { cn } from './lib/cn.js';

export type BrandMarkTone = 'on-dark' | 'on-light';

export interface BrandMarkProps {
  /** Square edge length in pixels. Defaults to 32. */
  size?: number;
  /** Background/stroke palette. `on-dark` is the translucent tile used on
   * coloured panels; `on-light` is the solid blue gradient tile. */
  tone?: BrandMarkTone;
  className?: string;
  style?: CSSProperties;
}

const toneStyles: Record<BrandMarkTone, { bg: string; border: string; stroke: string }> = {
  'on-dark': {
    bg: 'rgba(255,255,255,0.16)',
    border: 'rgba(255,255,255,0.28)',
    stroke: '#ffffff',
  },
  'on-light': {
    bg: 'linear-gradient(135deg,#2c5697,#1e3e72)',
    border: 'rgba(0,0,0,0.06)',
    stroke: '#ffffff',
  },
};

/**
 * BimStitch logomark — two stacked zig-zags ("stitched" lines). Used on the
 * login brand canvas, request-access hero and any auth-adjacent header.
 */
export function BrandMark({
  size = 32,
  tone = 'on-dark',
  className,
  style,
}: BrandMarkProps): JSX.Element {
  const t = toneStyles[tone];
  const inner = Math.round(size * 0.55);
  return (
    <span
      aria-hidden
      className={cn('inline-grid place-items-center', className)}
      style={{
        width: size,
        height: size,
        borderRadius: 7,
        background: t.bg,
        border: `1px solid ${t.border}`,
        flexShrink: 0,
        ...style,
      }}
    >
      <svg
        width={inner}
        height={inner}
        viewBox="0 0 24 24"
        fill="none"
        stroke={t.stroke}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 12 L9 6 L15 12 L21 6" />
        <path d="M3 18 L9 12 L15 18 L21 12" />
      </svg>
    </span>
  );
}
