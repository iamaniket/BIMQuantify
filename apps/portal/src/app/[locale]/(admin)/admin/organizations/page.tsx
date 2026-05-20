'use client';

import { Plus, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import { Button, Input, PageHeader, Select, Skeleton } from '@bimstitch/ui';

import { OrgCreateDialog } from '@/features/admin/organizations/OrgCreateDialog';
import { OrgTable } from '@/features/admin/organizations/OrgTable';
import { useAdminOrganizations } from '@/features/admin/organizations/useAdminOrganizations';

export default function AdminOrganizationsPage(): JSX.Element {
  const t = useTranslations('admin.organizations');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [createOpen, setCreateOpen] = useState(false);

  const params = {
    q: search === '' ? undefined : search,
    status: statusFilter === 'all' ? undefined : statusFilter,
  };
  const query = useAdminOrganizations(params);

  return (
    <main className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title={t('pageTitle')}
        subtitle={t('pageSubtitle')}
        actions={undefined}
        className={undefined}
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-tertiary" />
          <Input
            type="search"
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); }}
            className="w-full pl-9"
            aria-label={t('searchAria')}
          />
        </div>
        <Select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); }}
          className="w-auto"
          aria-label={t('statusFilterAria')}
        >
          <option value="all">{t('statusFilters.all')}</option>
          <option value="active">{t('statusFilters.active')}</option>
          <option value="suspended">{t('statusFilters.suspended')}</option>
          <option value="provisioning">{t('statusFilters.provisioning')}</option>
        </Select>
        <div className="ml-auto">
          <Button onClick={() => { setCreateOpen(true); }}>
            <Plus className="mr-1 h-4 w-4" />
            {t('createButton')}
          </Button>
        </div>
      </div>

      {query.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : query.isError ? (
        <p className="text-body3 text-error">{t('loadError')}</p>
      ) : (
        <OrgTable organizations={query.data ?? []} />
      )}

      <OrgCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </main>
  );
}
