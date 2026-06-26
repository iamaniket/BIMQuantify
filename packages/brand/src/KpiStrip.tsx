import type { JSX, ReactNode } from 'react';

import { cn } from '@bimdossier/ui';

export type KpiTone = 'on-dark' | 'on-light';

export interface KpiItem {
  label: string;
  value: ReactNode;
  valueColor?: string;
}

export interface KpiStripProps {
  items: readonly KpiItem[];
  tone?: KpiTone;
  className?: string;
}

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
