import type { CSSProperties, JSX } from 'react';

import { cn } from '@bimstitch/ui';

export type BrandMarkTone = 'on-dark' | 'on-light';

export interface BrandMarkProps {
  size?: number;
  tone?: BrandMarkTone;
  className?: string;
  style?: CSSProperties;
}

const toneStyles: Record<BrandMarkTone, { bg: string; border: string; color: string }> = {
  'on-dark': {
    bg: 'rgba(255,255,255,0.16)',
    border: 'rgba(255,255,255,0.28)',
    color: '#ffffff',
  },
  'on-light': {
    bg: 'linear-gradient(135deg, var(--brand-gradient-start), var(--brand-gradient-end))',
    border: 'rgba(0,0,0,0.06)',
    color: '#ffffff',
  },
};

export function BrandMark({
  size = 32,
  tone = 'on-dark',
  className,
  style,
}: BrandMarkProps): JSX.Element {
  const t = toneStyles[tone];
  const fontSize = Math.round(size * 0.5);
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
        color: t.color,
        fontFamily:
          "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        fontWeight: 700,
        fontSize,
        lineHeight: 1,
        letterSpacing: -1,
        flexShrink: 0,
        ...style,
      }}
    >
      BD
    </span>
  );
}
