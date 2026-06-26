'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Badge } from '@bimdossier/ui';

import type { JobStatus } from '@/lib/api/schemas/jobs';

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'primary';

const STATUS_VARIANT: Record<JobStatus, BadgeVariant> = {
  pending: 'default',
  started: 'info',
  running: 'primary',
  succeeded: 'success',
  failed: 'error',
  cancelled: 'default',
};

/** Color-coded job status pill, localized via `admin.processor.status.*`. */
export function JobStatusBadge({ status }: { status: JobStatus }): JSX.Element {
  const t = useTranslations('admin.processor.status');
  return (
    <Badge variant={STATUS_VARIANT[status]} size="md" bordered>
      {t(status)}
    </Badge>
  );
}
