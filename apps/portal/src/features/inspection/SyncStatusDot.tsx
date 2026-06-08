'use client';

import type { JSX } from 'react';

import type { QueueEntryStatus } from '@/lib/offline/types.js';

type Props = {
  status: QueueEntryStatus | undefined;
};

export function SyncStatusDot({ status }: Props): JSX.Element | null {
  if (status === undefined || status === 'succeeded') return null;

  if (status === 'syncing') {
    return (
      <span
        className="inline-block h-2.5 w-2.5 animate-spin rounded-full border-[1.5px] border-primary border-t-transparent"
        role="status"
        aria-label="Syncing"
      />
    );
  }

  if (status === 'failed') {
    return (
      <span
        className="inline-block h-2.5 w-2.5 rounded-full bg-error"
        role="status"
        aria-label="Sync failed"
      />
    );
  }

  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full bg-warning"
      role="status"
      aria-label="Pending sync"
    />
  );
}
