'use client';

import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import { Input, PageHeader } from '@bimstitch/ui';

import { PageTableContent } from '@/components/shared/PageTable';
import { AuditLogTable } from '@/features/admin/audit/AuditLogTable';
import { useGlobalAuditLog } from '@/features/admin/audit/useAuditLog';

export default function AdminAuditLogPage(): JSX.Element {
  const t = useTranslations('admin.audit');
  const [actionFilter, setActionFilter] = useState('');
  const [resourceFilter, setResourceFilter] = useState('');
  const query = useGlobalAuditLog({
    action: actionFilter === '' ? undefined : actionFilter,
    resource_type: resourceFilter === '' ? undefined : resourceFilter,
    limit: 100,
  });

  return (
    <main className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title={t('pageTitle')}
        subtitle={t('pageSubtitle')}
        actions={undefined}
        className={undefined}
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Input
          placeholder={t('filterActionPlaceholder')}
          value={actionFilter}
          onChange={(e) => { setActionFilter(e.target.value); }}
          className="w-64"
          aria-label={t('filterActionAria')}
        />
        <Input
          placeholder={t('filterResourcePlaceholder')}
          value={resourceFilter}
          onChange={(e) => { setResourceFilter(e.target.value); }}
          className="w-64"
          aria-label={t('filterResourceAria')}
        />
      </div>

      <PageTableContent isLoading={query.isLoading} isError={query.isError} errorMessage={t('loadError')} skeletonRows={1}>
        <AuditLogTable entries={query.data ?? []} />
      </PageTableContent>
    </main>
  );
}
