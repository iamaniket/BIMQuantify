'use client';

import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import { PageHeader } from '@bimstitch/ui';

import { PageTableContent, SearchInput } from '@/components/shared/PageTable';
import { useAdminUsers } from '@/features/admin/users/useAdminUsers';
import { UsersTable } from '@/features/admin/users/UsersTable';
import { useAuth } from '@/providers/AuthProvider';

export default function AdminUsersPage(): JSX.Element {
  const t = useTranslations('admin.users');
  const { me } = useAuth();
  const [search, setSearch] = useState('');
  const query = useAdminUsers({ q: search === '' ? undefined : search });

  return (
    <main className="w-full px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title={t('pageTitle')}
        subtitle={t('pageSubtitle')}
        actions={undefined}
        className={undefined}
      />

      <div className="mb-6 flex items-center gap-3">
        <SearchInput placeholder={t('searchPlaceholder')} value={search} onChange={setSearch} aria-label={t('searchAria')} />
      </div>

      <PageTableContent isLoading={query.isLoading} isError={query.isError} errorMessage={t('loadError')} skeletonRows={1}>
        <UsersTable users={query.data ?? []} currentUserId={me?.user.id} />
      </PageTableContent>
    </main>
  );
}
