import type { JSX } from 'react';

import { cn } from '@bimdossier/ui';

export type SystemStatusValue = 'normal' | 'degraded' | 'down' | 'loading';

export interface SystemStatusBadgeProps {
  status: SystemStatusValue;
  region?: string;
  tone?: 'on-dark' | 'on-light';
  className?: string;
  labels?: Record<SystemStatusValue, string>;
}

const dotColor: Record<SystemStatusValue, string> = {
  normal: 'var(--success, #3f8f65)',
  degraded: 'var(--warning, #a97428)',
  down: 'var(--error, #c94736)',
  loading: 'var(--foreground-tertiary, #94a3b8)',
};

const labelText: Record<SystemStatusValue, string> = {
  normal: 'All systems normal',
  degraded: 'Some systems degraded',
  down: 'Service interruption',
  loading: 'Checking status…',
};

export function SystemStatusBadge({
  status,
  region,
  tone = 'on-light',
  className,
  labels,
}: SystemStatusBadgeProps): JSX.Element {
  const fg = tone === 'on-dark' ? 'rgba(255,255,255,0.85)' : 'var(--foreground-tertiary, #4b5563)';
  const label = labels?.[status] ?? labelText[status];
  return (
    <div
      role="status"
      className={cn('inline-flex items-center gap-2 font-sans text-[11px] tracking-[0.02em]', className)}
      style={{ color: fg }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: dotColor[status],
          boxShadow: status === 'normal' ? '0 0 0 2px rgba(63,143,101,0.12)' : undefined,
        }}
      />
      <span>{label}</span>
      {region ? (
        <>
          <span aria-hidden>·</span>
          <span>{region}</span>
        </>
      ) : null}
    </div>
  );
}
