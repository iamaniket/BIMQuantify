import type { JSX, ReactNode } from 'react';

import { cn } from './lib/cn.js';

export type KpiTone = 'on-dark' | 'on-light';

export interface KpiItem {
  /** Uppercase label rendered above the value. */
  label: string;
  /** The value — usually short text or a small fragment with mixed colour. */
  value: ReactNode;
  /** Override the colour of just this value (e.g. green for "All systems"). */
  valueColor?: string;
}

export interface KpiStripProps {
  items: readonly KpiItem[];
  /** Light dividers on coloured panels vs muted dividers on neutral panels. */
  tone?: KpiTone;
  className?: string;
}

/**
 * Compact horizontal KPI row used on the login brand canvas — small caps
 * label over a display-font value, with vertical dividers between items.
 *
 * The values are deliberately not numeric badges: the design uses this for
 * generic platform info (Wkb version, BBL version, region, status) that
 * is appropriate to show pre-login.
 */
export function KpiStrip({ items, tone = 'on-dark', className }: KpiStripProps): JSX.Element {
  const dividerColor = tone === 'on-dark' ? 'rgba(255,255,255,0.18)' : 'rgba(15,23,42,0.10)';
  const labelColor = tone === 'on-dark' ? 'rgba(255,255,255,0.65)' : 'rgba(15,23,42,0.55)';
  const valueColor = tone === 'on-dark' ? '#ffffff' : '#0f172a';

  return (
    <div className={cn('flex items-stretch', className)}>
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          <div
            key={item.label}
            style={{
              padding: '6px 14px',
              borderLeft: `1px solid ${dividerColor}`,
              borderRight: isLast ? `1px solid ${dividerColor}` : 'none',
            }}
          >
            <div
              style={{
                fontSize: 8.5,
                color: labelColor,
                letterSpacing: '0.10em',
                textTransform: 'uppercase',
                fontWeight: 700,
              }}
            >
              {item.label}
            </div>
            <div
              style={{
                fontFamily: 'var(--font-display, Georgia, serif)',
                fontWeight: 600,
                fontSize: 16,
                color: item.valueColor ?? valueColor,
                letterSpacing: '-0.01em',
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1.05,
                marginTop: 1,
              }}
            >
              {item.value}
            </div>
          </div>
        );
      })}
    </div>
  );
}
