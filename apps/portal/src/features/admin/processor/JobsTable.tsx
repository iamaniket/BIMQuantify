'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { JSX } from 'react';

import type { Locale } from '@bimdossier/i18n';
import { Badge } from '@bimdossier/ui';

import { DataTable } from '@/components/shared/DataTable';
import type { Column } from '@/components/shared/PageTable';
import type { AdminJobItem } from '@/lib/api/schemas/adminJobs';
import { formatAgo } from '@/lib/formatting/dates';

import { JobStatusBadge } from './JobStatusBadge';
import { JobTypeLabel } from './JobTypeLabel';

type Props = {
  jobs: AdminJobItem[];
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
};

/** The live ongoing/stuck jobs feed, across all orgs. Read-only. */
export function JobsTable({ jobs, isLoading, isError, isFetching }: Props): JSX.Element {
  const t = useTranslations('admin.processor.table');
  const locale = useLocale() as Locale;

  const columns: Column<AdminJobItem>[] = [
    {
      header: t('org'),
      className: 'whitespace-nowrap font-medium text-foreground',
      cell: (job) => job.org_name,
    },
    {
      header: t('type'),
      className: 'whitespace-nowrap',
      cell: (job) => <JobTypeLabel type={job.job_type} />,
    },
    {
      header: t('status'),
      className: 'whitespace-nowrap',
      cell: (job) => (
        <div className="flex items-center gap-1.5">
          <JobStatusBadge status={job.status} />
          {job.is_stuck && (
            <Badge variant="warning" size="md" bordered>
              {t('stuck')}
            </Badge>
          )}
        </div>
      ),
    },
    {
      header: t('age'),
      className: 'whitespace-nowrap tabular-nums text-foreground-secondary',
      cell: (job) => formatAgo(job.age_seconds, locale),
    },
    {
      header: t('attempt'),
      className: 'tabular-nums text-foreground-secondary',
      cell: (job) => job.attempt,
    },
    {
      header: t('error'),
      className: 'max-w-[28rem] truncate text-foreground-tertiary',
      cell: (job) => job.error ?? '—',
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={jobs}
      rowKey={(job) => job.id}
      emptyMessage={t('empty')}
      sort={{ key: '', dir: 'asc' }}
      onToggleSort={() => undefined}
      isLoading={isLoading}
      isError={isError}
      errorMessage={t('loadError')}
      isFetching={isFetching}
      className="flex-1"
    />
  );
}
