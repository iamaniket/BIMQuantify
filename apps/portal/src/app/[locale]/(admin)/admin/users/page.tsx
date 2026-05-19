'use client';

import { Search } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import { Input, PageHeader, Skeleton } from '@bimstitch/ui';

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
      </div>

      {query.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : query.isError ? (
        <p className="text-body3 text-error">{t('loadError')}</p>
      ) : (
        <UsersTable users={query.data ?? []} currentUserId={me?.user.id} />
      )}
    </main>
  );
}
