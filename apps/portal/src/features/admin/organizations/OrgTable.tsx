'use client';

import { Link } from '@/i18n/navigation';
import { useTranslations } from 'next-intl';
import type { JSX } from 'react';

import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@bimstitch/ui';

import type { OrganizationRead } from '@/lib/api/schemas';
import { TableEmptyState } from '@/components/TableEmptyState';

import { OrgStatusBadge } from './OrgStatusBadge';
import { SeatUsage } from './SeatUsage';

type Props = {
  organizations: OrganizationRead[];
};

export function OrgTable({ organizations }: Props): JSX.Element {
  const t = useTranslations('admin.organizations.table');

  if (organizations.length === 0) {
    return <TableEmptyState message={t('empty')} />;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('name')}</TableHead>
          <TableHead>{t('status')}</TableHead>
          <TableHead>{t('seats')}</TableHead>
          <TableHead>{t('created')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {organizations.map((org) => (
          <TableRow key={org.id} className="hover:bg-background-hover">
            <TableCell>
              <Link
                href={`/admin/organizations/${org.id}`}
                className="font-medium text-foreground hover:underline"
              >
                {org.name}
              </Link>
              <div className="font-mono text-caption text-foreground-tertiary">
                {org.schema_name}
              </div>
            </TableCell>
            <TableCell>
              <OrgStatusBadge status={org.status} />
            </TableCell>
            <TableCell>
              <SeatUsage
                seatCountUsed={org.seat_count_used}
                seatLimit={org.seat_limit}
              />
            </TableCell>
            <TableCell className="text-foreground-tertiary">
              {new Date(org.created_at).toLocaleDateString()}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
