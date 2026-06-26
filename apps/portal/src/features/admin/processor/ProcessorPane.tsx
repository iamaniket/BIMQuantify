'use client';

import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import { Button } from '@bimdossier/ui';
import { Activity, AlertTriangle, RefreshCw } from '@bimdossier/ui/icons';

import { StatCard } from '@/components/shared/charts/StatCard';

import { JobsTable } from './JobsTable';
import { useAdminActiveJobs } from './useAdminActiveJobs';
import { useProcessorQueue } from './useProcessorQueue';

const LIMIT = 200;

/** Live, read-only processor/extractor monitoring. Queue depth + ongoing/stuck
 * jobs across all orgs, polled ~10s. */
export function ProcessorPane(): JSX.Element {
  const t = useTranslations('admin.processor');
  const queue = useProcessorQueue();
  const active = useAdminActiveJobs(LIMIT);

  const q = queue.data?.jobs;
  const refreshing = queue.isFetching || active.isFetching;
  const stuckCount = active.data?.summary.stuck ?? 0;

  const onRefresh = (): void => {
    void queue.refetch();
    void active.refetch();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-body3 text-foreground-tertiary">{t('pane.subtitle')}</p>
          <Button size="md" variant="border" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {t('pane.refresh')}
          </Button>
        </div>

        {queue.isError ? (
          <div className="flex items-center gap-2 rounded-xl border border-warning-light bg-warning-lighter px-3.5 py-3 text-body3 text-warning">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {t('pane.processorUnreachable')}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard label={t('queue.waiting')} value={q?.['waiting'] ?? 0} accent="neutral" />
            <StatCard label={t('queue.active')} value={q?.['active'] ?? 0} accent="primary" />
            <StatCard label={t('queue.delayed')} value={q?.['delayed'] ?? 0} accent="warning" />
            <StatCard
              label={t('queue.completed')}
              value={q?.['completed'] ?? 0}
              sub={t('queue.recent')}
              accent="success"
            />
            <StatCard
              label={t('queue.failed')}
              value={q?.['failed'] ?? 0}
              sub={t('queue.recent')}
              accent="error"
            />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <StatCard
            label={t('summary.ongoing')}
            value={active.data?.summary.active ?? 0}
            icon={<Activity className="h-3 w-3" />}
            accent="primary"
          />
          <StatCard
            label={t('summary.stuck')}
            value={stuckCount}
            accent={stuckCount > 0 ? 'warning' : 'neutral'}
          />
        </div>

        {active.data?.truncated === true && (
          <p className="text-caption text-foreground-tertiary">
            {t('table.truncated', { limit: LIMIT })}
          </p>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col border-t border-border pt-3">
        <JobsTable
          jobs={active.data?.items ?? []}
          isLoading={active.isLoading}
          isError={active.isError}
          isFetching={active.isFetching}
        />
      </div>
    </div>
  );
}
