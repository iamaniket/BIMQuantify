'use client';

import { useTranslations } from 'next-intl';
import { useState, type JSX } from 'react';

import { PageHeader } from '@bimdossier/ui';

import { SearchInput, TableToolbar } from '@/components/shared/PageTable';
import { TablePaginationFooter } from '@/components/shared/TablePaginationFooter';
import { adminUsersListKey } from '@/features/admin/users/queryKeys';
import { UsersTable } from '@/features/admin/users/UsersTable';
import { listAdminUsersPage } from '@/lib/api/admin';
import { useTableQuery } from '@/lib/query/useTableQuery';
import type { AdminUserRead } from '@/lib/api/schemas';
import { useAuth } from '@/providers/AuthProvider';

export default function AdminUsersPage(): JSX.Element {
  const t = useTranslations('admin.users');
  const { me } = useAuth();
  const [search, setSearch] = useState('');

  const filters = { q: search === '' ? undefined : search };
  const table = useTableQuery<AdminUserRead, typeof filters>({
    filters,
    queryKey: (p) => adminUsersListKey(p),
    queryFn: (token, p) => listAdminUsersPage(token, p),
    initialSort: { key: 'email', dir: 'asc' },
  });

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="shrink-0 px-4 pt-6 sm:px-6 lg:px-8">
        <PageHeader
          title={t('pageTitle')}
          subtitle={t('pageSubtitle')}
          actions={undefined}
          className={undefined}
        />
      </div>

      <TableToolbar>
        <SearchInput
          placeholder={t('searchPlaceholder')}
          value={search}
          onChange={setSearch}
          aria-label={t('searchAria')}
        />
      </TableToolbar>

      <UsersTable table={table} currentUserId={me?.user.id} />

      <TablePaginationFooter
        table={table}
        className="shrink-0 border-t border-border px-5 py-2.5"
      />
    </div>
  );
}
